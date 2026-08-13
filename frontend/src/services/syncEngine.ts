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
  };
}

type SyncFailureKind = "network" | "auth_unavailable" | "server";

// fetch() itself throwing means the request never reached the server -
// indistinguishable from "offline," and not the survey's fault. A 401 that
// survives httpClient's own refresh-and-retry means the session genuinely
// could not be restored - also not the survey's fault. Anything else is a
// real response from the server about this specific request (validation,
// 409 conflict, 5xx, ...).
function classifySyncError(error: unknown): SyncFailureKind {
  if (error instanceof ApiError) {
    return error.status === 401 ? "auth_unavailable" : "server";
  }
  return "network";
}

type SyncListener = () => void;
const listeners = new Set<SyncListener>();

// Lets the Dashboard react to sync progress (pending -> syncing ->
// synced/failed) without polling or a state-management library.
export function subscribe(listener: SyncListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notify(): void {
  for (const listener of listeners) listener();
}

async function syncOne(record: LocalSurveyRecord): Promise<void> {
  const statusBeforeAttempt: SyncStatus = record.syncStatus;

  await surveyPersistence.updateSyncState(record.id, { syncStatus: "syncing" });
  notify();

  try {
    await surveyApi.syncSurvey(toSyncPayload(record));
    // Deliberately not deleted: the local record is retained so local
    // persistence stays reliable and later phases can change what happens
    // to synced records without risking data loss. The Dashboard's existing
    // syncStatus !== "synced" filter is what keeps it out of Pending Sync.
    await surveyPersistence.updateSyncState(record.id, { syncStatus: "synced", retryCount: 0 });
  } catch (error) {
    const kind = classifySyncError(error);
    if (kind === "server") {
      // A genuine response from the server rejecting this request (4xx
      // including 409, or 5xx). Retrying forever without change won't help,
      // but the record and its image are kept for a deliberate retry.
      await surveyPersistence.updateSyncState(record.id, {
        syncStatus: "failed",
        retryCount: record.retryCount + 1,
      });
    } else {
      // Network unreachable, or the session couldn't be restored - neither
      // is the survey's fault. Revert to whatever it was before this
      // attempt: don't invent a new state, don't touch retryCount, and
      // don't erase a previous run's "failed" (a real rejection) by
      // quietly turning it back into "pending" (merely unattempted).
      await surveyPersistence.updateSyncState(record.id, { syncStatus: statusBeforeAttempt });
    }
  }
  notify();
}

let inFlightRun: Promise<void> | null = null;

// Concurrent triggers (an online event and a manual retry landing close
// together, for example) must not start two queue processors - the second
// caller reuses/awaits the run already in progress rather than starting a
// second pass over the same records.
export function runSync(): Promise<void> {
  if (!inFlightRun) {
    inFlightRun = (async () => {
      if (!navigator.onLine) return;

      // Snapshot once per run; a survey saved mid-run is picked up by the
      // next run (next online event, app restart, or manual retry), not
      // this one - matches "process each pending/failed record once per
      // sync run."
      const records = await surveyPersistence.listPendingSync();
      for (const record of records) {
        await syncOne(record);
      }
    })().finally(() => {
      inFlightRun = null;
    });
  }
  return inFlightRun;
}
