import type { LocalSurvey } from "../types/localSurvey";
import type { LocalSurveyRecord } from "../types/localSurveyRecord";
import type { SyncStatus } from "../types/survey";
import { openDatabase, runInTransaction, SYNC_STATUS_INDEX } from "./indexedDbClient";

export type SurveyPersistenceErrorCode = "quota_exceeded" | "unavailable" | "unknown";

export class SurveyPersistenceError extends Error {
  code: SurveyPersistenceErrorCode;

  constructor(code: SurveyPersistenceErrorCode, message: string) {
    super(message);
    this.name = "SurveyPersistenceError";
    this.code = code;
  }
}

// The capture UI depends on this interface, not on IndexedDB directly.
// listPendingSync/updateSyncState are what the sync engine (Phase 6B) needs.
export interface SurveyPersistence {
  saveSurvey(survey: LocalSurvey): Promise<void>;
  getSurvey(id: string): Promise<LocalSurveyRecord | undefined>;
  listSurveys(): Promise<LocalSurveyRecord[]>;
  listPendingSync(): Promise<LocalSurveyRecord[]>;
  listBySyncStatus(status: SyncStatus): Promise<LocalSurveyRecord[]>;
  updateSyncState(
    id: string,
    patch: Partial<Pick<LocalSurveyRecord, "syncStatus" | "retryCount" | "lastError">>,
  ): Promise<void>;
  deleteSurvey(id: string): Promise<void>;
}

// What actually goes into IndexedDB. The image is stored as raw bytes rather
// than as a Blob: structured clone stores an ArrayBuffer *by value*, whereas
// a Blob is stored as a reference to a browser-managed backing store. On
// mobile browsers that backing store does not reliably survive the session
// that created it - the record reads back with its metadata intact but no
// readable bytes, so a survey captured offline uploaded as an empty file and
// the server rejected it ("The submitted file is empty.") long after the
// capture screen was gone, with nothing on the device left to recapture from.
interface StoredSurveyRecord extends Omit<LocalSurveyRecord, "imageBlob"> {
  imageBytes?: ArrayBuffer;
  // Legacy shape: records written before the switch to imageBytes. Read
  // support only - nothing writes this any more.
  imageBlob?: Blob;
}

async function toStored(record: LocalSurveyRecord): Promise<StoredSurveyRecord> {
  const { imageBlob, ...rest } = record;
  const imageBytes = await imageBlob.arrayBuffer();
  if (imageBytes.byteLength === 0) {
    throw new SurveyPersistenceError(
      "unknown",
      "The captured photo contained no image data. Please retake the photo.",
    );
  }
  return { ...rest, imageBytes };
}

function fromStored(stored: StoredSurveyRecord): LocalSurveyRecord {
  const { imageBytes, imageBlob, ...rest } = stored;
  return {
    ...rest,
    imageBlob: imageBytes
      ? new Blob([imageBytes], { type: stored.imageMimeType })
      : // Legacy record, or one whose bytes were lost by the Blob-reference
        // problem above. An empty Blob here is surfaced by the sync engine's
        // own pre-flight check rather than being uploaded as an empty file.
        (imageBlob ?? new Blob([], { type: stored.imageMimeType })),
  };
}

export function toPersistenceError(error: unknown): SurveyPersistenceError {
  if (error instanceof SurveyPersistenceError) return error;

  if (error instanceof DOMException && error.name === "QuotaExceededError") {
    return new SurveyPersistenceError(
      "quota_exceeded",
      "Not enough storage space on this device to save the survey. Free up space or sync existing surveys, then try again.",
    );
  }

  if (error instanceof Error && /not supported/i.test(error.message)) {
    return new SurveyPersistenceError("unavailable", error.message);
  }

  return new SurveyPersistenceError("unknown", "Could not save the survey to local storage. Please try again.");
}

class IndexedDBSurveyPersistence implements SurveyPersistence {
  async saveSurvey(survey: LocalSurvey): Promise<void> {
    // Every newly captured survey starts pending: "synced" is a claim only
    // the server's confirmation can make, which nothing in this phase does.
    const record: LocalSurveyRecord = {
      ...survey,
      syncStatus: "pending",
      retryCount: 0,
    };

    try {
      // Converted before the transaction opens: reading the Blob's bytes is
      // async, and an IndexedDB transaction auto-closes the moment it yields
      // to a promise that isn't one of its own requests.
      const stored = await toStored(record);
      const db = await openDatabase();
      await runInTransaction(db, "readwrite", (store) => store.put(stored));
    } catch (error) {
      throw toPersistenceError(error);
    }
  }

  async getSurvey(id: string): Promise<LocalSurveyRecord | undefined> {
    try {
      const db = await openDatabase();
      const stored = await runInTransaction<StoredSurveyRecord | undefined>(db, "readonly", (store) =>
        store.get(id),
      );
      return stored ? fromStored(stored) : undefined;
    } catch (error) {
      throw toPersistenceError(error);
    }
  }

  async listSurveys(): Promise<LocalSurveyRecord[]> {
    try {
      const db = await openDatabase();
      const records = await runInTransaction<StoredSurveyRecord[]>(db, "readonly", (store) => store.getAll());
      return records.map(fromStored).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    } catch (error) {
      throw toPersistenceError(error);
    }
  }

  async listBySyncStatus(status: SyncStatus): Promise<LocalSurveyRecord[]> {
    try {
      const db = await openDatabase();
      const records = await runInTransaction<StoredSurveyRecord[]>(db, "readonly", (store) =>
        store.index(SYNC_STATUS_INDEX).getAll(status),
      );
      return records.map(fromStored);
    } catch (error) {
      throw toPersistenceError(error);
    }
  }

  async listPendingSync(): Promise<LocalSurveyRecord[]> {
    try {
      // Two index lookups rather than a full-store scan + JS filter - this
      // is exactly what the syncStatus index (added in Phase 6A ahead of
      // this need) is for.
      //
      // Deliberately excludes "syncing": a record in that state has a request
      // in flight right now, and picking it up again here would double-send
      // it. Records left stranded in "syncing" by an interrupted session are
      // recovered separately at startup (see syncEngine's
      // recoverInterruptedSyncs) rather than by widening this query.
      const [pending, failed] = await Promise.all([
        this.listBySyncStatus("pending"),
        this.listBySyncStatus("failed"),
      ]);
      return [...pending, ...failed].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    } catch (error) {
      throw toPersistenceError(error);
    }
  }

  // Reads the existing record and writes back only the requested fields
  // changed, so the survey's data/image are always preserved untouched.
  // The get-then-put isn't wrapped in one atomic transaction (two sequential
  // transactions instead) - acceptable given the sync engine's own in-flight
  // lock means only one queue processor ever mutates records at a time, and
  // the capture UI only ever creates new records, never mutates existing
  // ones outside this method.
  async updateSyncState(
    id: string,
    patch: Partial<Pick<LocalSurveyRecord, "syncStatus" | "retryCount" | "lastError">>,
  ): Promise<void> {
    try {
      const db = await openDatabase();
      // Merged on the stored shape, so the image bytes are carried through
      // untouched rather than being decoded to a Blob and re-encoded here.
      const existing = await runInTransaction<StoredSurveyRecord | undefined>(db, "readonly", (store) =>
        store.get(id),
      );
      if (!existing) {
        throw new SurveyPersistenceError("unknown", `No local survey found with id ${id}.`);
      }
      const updated: StoredSurveyRecord = { ...existing, ...patch };
      await runInTransaction(db, "readwrite", (store) => store.put(updated));
    } catch (error) {
      throw toPersistenceError(error);
    }
  }

  async deleteSurvey(id: string): Promise<void> {
    try {
      const db = await openDatabase();
      await runInTransaction(db, "readwrite", (store) => store.delete(id));
    } catch (error) {
      throw toPersistenceError(error);
    }
  }
}

export const surveyPersistence: SurveyPersistence = new IndexedDBSurveyPersistence();
