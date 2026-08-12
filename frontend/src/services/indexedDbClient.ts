// Native IndexedDB only - no wrapper library. The access pattern here (one
// object store, keyed by UUID, a handful of get/getAll/put calls) is simple
// enough that a wrapper like Dexie would add a dependency without solving a
// problem this doesn't have; see the Phase 6A report for the full rationale.

export const DB_NAME = "SurveyApp";
export const DB_VERSION = 1;
export const SURVEYS_STORE = "surveys";
export const SYNC_STATUS_INDEX = "syncStatus";

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDatabase(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      if (!("indexedDB" in globalThis)) {
        reject(new Error("IndexedDB is not supported in this browser."));
        return;
      }

      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(SURVEYS_STORE)) {
          const store = db.createObjectStore(SURVEYS_STORE, { keyPath: "id" });
          // Not used by this phase - added now because the immediate next
          // phase (sync engine) needs to find all pending/failed surveys
          // without a full-store scan, and adding an index later would mean
          // a second version bump for something already known to be needed.
          store.createIndex(SYNC_STATUS_INDEX, "syncStatus", { unique: false });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error ?? new Error("Failed to open the local database."));
      request.onblocked = () => reject(new Error("Local database upgrade was blocked by another open tab."));
    });
  }
  return dbPromise;
}

// Test support only: nothing in the app ever needs to close the shared
// connection. Without this, tests that simulate separate "page loads" via
// module resets leak IDBDatabase connections - multiple simultaneously-open
// connections to the same database name is exactly the scenario that
// deadlocked fake-indexeddb's Blob handling during Phase 6A verification.
export async function closeDatabaseForTests(): Promise<void> {
  if (!dbPromise) return;
  try {
    const db = await dbPromise;
    db.close();
  } catch {
    // dbPromise had already rejected (e.g. a simulated "IndexedDB
    // unavailable" scenario) - nothing to close.
  } finally {
    dbPromise = null;
  }
}

export function runInTransaction<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    let request: IDBRequest<T>;
    const tx = db.transaction(SURVEYS_STORE, mode);
    const store = tx.objectStore(SURVEYS_STORE);

    tx.onerror = () => reject(tx.error ?? new Error("Local database transaction failed."));
    tx.onabort = () => reject(tx.error ?? new Error("Local database transaction was aborted."));

    request = operation(store);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Local database request failed."));
  });
}
