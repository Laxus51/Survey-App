import type { LocalSurvey } from "../types/localSurvey";
import type { LocalSurveyRecord } from "../types/localSurveyRecord";
import { openDatabase, runInTransaction } from "./indexedDbClient";

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
// Only save/get/list are implemented: what this phase's Dashboard/Details
// integration actually calls. Sync-state mutation and deletion are left for
// the sync-engine phase to add once its actual needs are known, rather than
// guessing at their shape now.
export interface SurveyPersistence {
  saveSurvey(survey: LocalSurvey): Promise<void>;
  getSurvey(id: string): Promise<LocalSurveyRecord | undefined>;
  listSurveys(): Promise<LocalSurveyRecord[]>;
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
}

export const surveyPersistence: SurveyPersistence = new IndexedDBSurveyPersistence();
