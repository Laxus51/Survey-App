import { ApiError } from "./httpClient";
import * as surveyApi from "./surveyApi";
import { surveyPersistence } from "./surveyPersistence";
import type { LocalSurveyRecord } from "../types/localSurveyRecord";
import type { SurveyWritePayload, SyncStatus } from "../types/survey";

// Maps the local record to the multipart payload POST /api/surveys/sync/
// expects. Same client-generated UUID, same image bytes - nothing is
// regenerated during sync. Wrapping the Blob in a File (rather than passing
// it as-is) just carries the original filename through to the multipart
// part; the bytes and content-type are untouched.
//
// createdAt is the moment the surveyor captured this on the device, recorded
// when the record was first written to IndexedDB. Sending it as capturedAt
// is what stops a survey taken offline on Monday and synced on Friday from
// being recorded as having happened on Friday; the server still stamps its
// own created_at for when the row reached it.
function toSyncPayload(record: LocalSurveyRecord): SurveyWritePayload {
  return {
    id: record.id,
    name: record.name,
    description: record.description,
    image: new File([record.imageBlob], record.imageFileName, { type: record.imageMimeType }),
    latitude: record.latitude,
    longitude: record.longitude,
    accuracy: record.accuracy,
    attributes: record.attributes,
    capturedAt: record.createdAt,
  };
}

type SyncFailureKind = "network" | "auth_unavailable" | "transient" | "server";

// fetch() itself throwing means the request never reached the server -
// indistinguishable from "offline," and not the survey's fault. A 401 that
// survives httpClient's own refresh-and-retry means the session genuinely
// could not be restored - also not the survey's fault.
//
// 502/503/504 and 429 come from infrastructure in front of the application -
// a proxy or tunnel that could not reach it, or asked us to slow down - and
// say nothing about this survey: the identical request typically succeeds
// moments later. Treating those as a rejection marked a perfectly good survey
// "failed" and charged it a retry, which reads as "this one is broken" when
// nothing is.
//
// 500 is deliberately NOT in that set. It means the application itself
// errored, which may well be this payload's doing, so it keeps the original
// behaviour: mark failed and stop, rather than silently re-sending a request
// that crashes the server on every trigger, forever.
//
// That leaves the other 4xx: a considered response about this specific
// request (validation, 409 conflict), which keeps failing until data changes.
const TRANSIENT_STATUSES = new Set([429, 502, 503, 504]);

function classifySyncError(error: unknown): SyncFailureKind {
  if (error instanceof ApiError) {
    if (error.status === 401) return "auth_unavailable";
    if (TRANSIENT_STATUSES.has(error.status)) return "transient";
    return "server";
  }
  return "network";
}

// Turns DRF's field-keyed error body ({"image": ["The submitted file is
// empty."]}) into one readable line. Recorded on the survey so a rejection
// the surveyor could actually act on isn't reduced to a bare "failed" badge.
function describeServerRejection(error: unknown): string {
  if (!(error instanceof ApiError)) return "The sync attempt was rejected.";

  if (error.status === 409) {
    return "This survey's id already belongs to a different account.";
  }

  const data = error.data;
  if (data && typeof data === "object") {
    const parts: string[] = [];
    for (const [field, messages] of Object.entries(data as Record<string, unknown>)) {
      const text = Array.isArray(messages) ? messages.join(" ") : String(messages);
      parts.push(field === "detail" ? text : `${field}: ${text}`);
    }
    if (parts.length > 0) return parts.join(" ");
  }

  return `The server rejected this survey (error ${error.status}).`;
}

// Subscribers are told *what* happened, not merely that "something changed".
// The distinction matters at scale: a run over 100 surveys emits ~200
// record-level events, and a listener that can't tell them apart has no
// choice but to treat each one as a full refresh - which meant 200 server
// round-trips to re-read a list that only meaningfully changes once the run
// has actually landed records on the server.
// A record-changed event carries every field the write actually changed, not
// just the status. That lets a listener mirror the persisted record exactly
// without re-reading it: this engine is the writer, so these values are what
// was just stored, not an inference. Re-reading instead would rebuild the
// image Blob from its stored bytes, and a fresh Blob identity makes the card
// revoke and recreate its object URL - i.e. reload every image, twice per
// record, for the whole run.
//
// lastError is always present (as `string | undefined`) rather than optional,
// so a listener can apply it unconditionally: "cleared on success" and
// "unchanged" would otherwise be indistinguishable from a missing key.
export type SyncEvent =
  | {
      type: "record-changed";
      id: string;
      status: SyncStatus;
      retryCount: number;
      lastError: string | undefined;
    }
  | { type: "run-finished"; syncedCount: number };

type SyncListener = (event: SyncEvent) => void;
const listeners = new Set<SyncListener>();

// Lets the Dashboard react to sync progress (pending -> syncing ->
// synced/failed) without polling or a state-management library.
export function subscribe(listener: SyncListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function emit(event: SyncEvent): void {
  for (const listener of listeners) listener(event);
}

// Returns true only when the server confirmed the record, so the caller can
// tell whether a run actually changed anything server-side.
async function syncOne(record: LocalSurveyRecord): Promise<boolean> {
  const statusBeforeAttempt: SyncStatus = record.syncStatus;

  // Pre-flight: an image with no bytes can only ever be rejected by the
  // server ("The submitted file is empty."), so uploading it wastes the
  // surveyor's data and, worse, reports back as a generic "failed" that
  // invites endless pointless retries. Fail it here with a reason that says
  // what actually has to happen.
  if (record.imageBlob.size === 0) {
    const lastError =
      "This survey's photo is missing its image data and can't be uploaded. Please delete it and recapture.";
    await surveyPersistence.updateSyncState(record.id, {
      syncStatus: "failed",
      retryCount: record.retryCount + 1,
      lastError,
    });
    emit({
      type: "record-changed",
      id: record.id,
      status: "failed",
      retryCount: record.retryCount + 1,
      lastError,
    });
    return false;
  }

  await surveyPersistence.updateSyncState(record.id, { syncStatus: "syncing" });
  // Only the status changed here, so the record's existing retry count and
  // error are echoed back unchanged rather than dropped.
  emit({
    type: "record-changed",
    id: record.id,
    status: "syncing",
    retryCount: record.retryCount,
    lastError: record.lastError,
  });

  // Mirrors whatever the settle path below writes, so the emitted event and
  // the stored record can't drift apart.
  let settledStatus: SyncStatus;
  let settledRetryCount: number;
  let settledLastError: string | undefined;
  let synced = false;

  try {
    await surveyApi.syncSurvey(toSyncPayload(record));
    // Deliberately not deleted: the local record is retained so local
    // persistence stays reliable and later phases can change what happens
    // to synced records without risking data loss. The Dashboard's existing
    // syncStatus !== "synced" filter is what keeps it out of Pending Sync.
    await surveyPersistence.updateSyncState(record.id, {
      syncStatus: "synced",
      retryCount: 0,
      lastError: undefined,
    });
    settledStatus = "synced";
    settledRetryCount = 0;
    settledLastError = undefined;
    synced = true;
  } catch (error) {
    const kind = classifySyncError(error);
    if (kind === "server") {
      // A genuine response from the server rejecting this request (4xx
      // including 409, or 5xx). Retrying forever without change won't help,
      // but the record and its image are kept for a deliberate retry.
      settledStatus = "failed";
      settledRetryCount = record.retryCount + 1;
      settledLastError = describeServerRejection(error);
      await surveyPersistence.updateSyncState(record.id, {
        syncStatus: settledStatus,
        retryCount: settledRetryCount,
        lastError: settledLastError,
      });
    } else {
      // Network unreachable, the session couldn't be restored, or the server
      // was temporarily unavailable - none is the survey's fault. Revert to
      // whatever it was before this attempt: don't invent a new state, don't
      // touch retryCount, and don't erase a previous run's "failed" (a real
      // rejection) by quietly turning it back into "pending" (merely
      // unattempted). The next trigger picks it up again.
      await surveyPersistence.updateSyncState(record.id, { syncStatus: statusBeforeAttempt });
      settledStatus = statusBeforeAttempt;
      settledRetryCount = record.retryCount;
      settledLastError = record.lastError;
    }
  }

  emit({
    type: "record-changed",
    id: record.id,
    status: settledStatus,
    retryCount: settledRetryCount,
    lastError: settledLastError,
  });
  return synced;
}

// A record is only ever "syncing" while a request from the current page
// session is in flight. Finding one at startup therefore means a previous
// session was interrupted mid-attempt (reload, tab closed, browser evicted
// the page) - nothing is in flight, and because listPendingSync deliberately
// excludes "syncing" to avoid double-sending, no trigger would ever pick it
// up again. Left unrecovered it is stranded permanently, showing "syncing"
// forever while the Retry button silently does nothing.
//
// Resetting to "pending" (not "failed") is deliberate: the attempt was never
// completed, let alone rejected, so retryCount must not be charged for it.
export async function recoverInterruptedSyncs(): Promise<void> {
  const stranded = await surveyPersistence.listBySyncStatus("syncing");
  if (stranded.length === 0) return;

  for (const record of stranded) {
    await surveyPersistence.updateSyncState(record.id, { syncStatus: "pending" });
    emit({
      type: "record-changed",
      id: record.id,
      status: "pending",
      retryCount: record.retryCount,
      lastError: record.lastError,
    });
  }
}

let inFlightRun: Promise<void> | null = null;

// Concurrent triggers (an online event and a manual retry landing close
// together, for example) must not start two queue processors - the second
// caller reuses/awaits the run already in progress rather than starting a
// second pass over the same records.
export function runSync(): Promise<void> {
  if (!inFlightRun) {
    inFlightRun = (async () => {
      let syncedCount = 0;

      if (navigator.onLine) {
        // Snapshot once per run; a survey saved mid-run is picked up by the
        // next run (next online event, app restart, or manual retry), not
        // this one - matches "process each pending/failed record once per
        // sync run."
        const records = await surveyPersistence.listPendingSync();
        for (const record of records) {
          if (await syncOne(record)) syncedCount += 1;
        }
      }

      // One event at the end carrying how many records actually landed on
      // the server, so a listener can refresh server-side data exactly once
      // per run instead of once per record - and skip it entirely when the
      // run changed nothing there.
      emit({ type: "run-finished", syncedCount });
    })().finally(() => {
      inFlightRun = null;
    });
  }
  return inFlightRun;
}
