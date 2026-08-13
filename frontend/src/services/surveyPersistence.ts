import type { LocalSurvey } from "../types/localSurvey";
import type { LocalSurveyRecord } from "../types/localSurveyRecord";
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
// listPendingSync/updateSyncState are what the sync engine (Phase 6B) needs;
// deletion still isn't added since nothing calls it yet - synced records are
// deliberately retained locally (see updateSyncState's docs below).
export interface SurveyPersistence {
  saveSurvey(survey: LocalSurvey): Promise<void>;
  getSurvey(id: string): Promise<LocalSurveyRecord | undefined>;
  listSurveys(): Promise<LocalSurveyRecord[]>;
  listPendingSync(): Promise<LocalSurveyRecord[]>;
  updateSyncState(
    id: string,
    patch: Partial<Pick<LocalSurveyRecord, "syncStatus" | "retryCount">>,
  ): Promise<void>;
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
      const db = await openDatabase();
      await runInTransaction(db, "readwrite", (store) => store.put(record));
    } catch (error) {
      throw toPersistenceError(error);
    }
  }

  async getSurvey(id: string): Promise<LocalSurveyRecord | undefined> {
    try {
      const db = await openDatabase();
      return await runInTransaction<LocalSurveyRecord | undefined>(db, "readonly", (store) => store.get(id));
    } catch (error) {
      throw toPersistenceError(error);
    }
  }

  async listSurveys(): Promise<LocalSurveyRecord[]> {
    try {
      const db = await openDatabase();
      const records = await runInTransaction<LocalSurveyRecord[]>(db, "readonly", (store) => store.getAll());
      return records.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    } catch (error) {
      throw toPersistenceError(error);
    }
  }

  async listPendingSync(): Promise<LocalSurveyRecord[]> {
    try {
      const db = await openDatabase();
      // Two index lookups rather than a full-store scan + JS filter - this
      // is exactly what the syncStatus index (added in Phase 6A ahead of
      // this need) is for.
      const [pending, failed] = await Promise.all([
        runInTransaction<LocalSurveyRecord[]>(db, "readonly", (store) =>
          store.index(SYNC_STATUS_INDEX).getAll("pending"),
        ),
        runInTransaction<LocalSurveyRecord[]>(db, "readonly", (store) =>
          store.index(SYNC_STATUS_INDEX).getAll("failed"),
        ),
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
    patch: Partial<Pick<LocalSurveyRecord, "syncStatus" | "retryCount">>,
  ): Promise<void> {
    try {
      const db = await openDatabase();
      const existing = await runInTransaction<LocalSurveyRecord | undefined>(db, "readonly", (store) =>
        store.get(id),
      );
      if (!existing) {
        throw new SurveyPersistenceError("unknown", `No local survey found with id ${id}.`);
      }
      const updated: LocalSurveyRecord = { ...existing, ...patch };
      await runInTransaction(db, "readwrite", (store) => store.put(updated));
    } catch (error) {
      throw toPersistenceError(error);
    }
  }
}

export const surveyPersistence: SurveyPersistence = new IndexedDBSurveyPersistence();
