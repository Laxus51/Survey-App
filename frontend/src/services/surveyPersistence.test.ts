import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LocalSurvey } from "../types/localSurvey";
import { generateUuid } from "../utils/uuid";

function makeLocalSurvey(overrides: Partial<LocalSurvey> = {}): LocalSurvey {
  const now = new Date().toISOString();
  return {
    id: generateUuid(),
    name: "Utility Pole 12",
    description: "Near the intersection",
    imageBlob: new Blob(["fake-jpeg-bytes"], { type: "image/jpeg" }),
    imageMimeType: "image/jpeg",
    imageFileName: "survey-test.jpg",
    latitude: 33.6844,
    longitude: 73.0479,
    accuracy: 5.5,
    attributes: { "Pole Height": "12", Transformer: "Yes" },
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

// Fresh module instance per test: clears the persistence layer's cached
// IndexedDB connection, the same way a real page reload would - this is
// what lets the "survives reload" test be a genuine test of durability
// rather than just re-reading from an already-open connection. The
// connection must be explicitly closed afterwards (closeForTests, below) -
// without that, unclosed connections from earlier tests pile up against the
// same database name, which deadlocks fake-indexeddb's Blob handling.
let closeCurrentConnection: (() => Promise<void>) | null = null;

async function freshPersistence() {
  vi.resetModules();
  const [persistence, client] = await Promise.all([
    import("./surveyPersistence"),
    import("./indexedDbClient"),
  ]);
  closeCurrentConnection = client.closeDatabaseForTests;
  return persistence;
}

beforeEach(async () => {
  if (closeCurrentConnection) {
    await closeCurrentConnection();
    closeCurrentConnection = null;
  }
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase("SurveyApp");
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });
});

afterEach(async () => {
  if (closeCurrentConnection) {
    await closeCurrentConnection();
    closeCurrentConnection = null;
  }
});

describe("IndexedDBSurveyPersistence", () => {
  it("saves a survey and retrieves it by its UUID", async () => {
    const { surveyPersistence } = await freshPersistence();
    const survey = makeLocalSurvey();

    await surveyPersistence.saveSurvey(survey);
    const record = await surveyPersistence.getSurvey(survey.id);

    expect(record).toBeDefined();
    expect(record!.id).toBe(survey.id);
    expect(record!.name).toBe(survey.name);
  });

  it("preserves the image Blob's type and byte content", async () => {
    const { surveyPersistence } = await freshPersistence();
    const originalBytes = "fake-jpeg-bytes-with-some-length";
    const survey = makeLocalSurvey({ imageBlob: new Blob([originalBytes], { type: "image/jpeg" }) });

    await surveyPersistence.saveSurvey(survey);
    const record = await surveyPersistence.getSurvey(survey.id);

    expect(record!.imageBlob.type).toBe("image/jpeg");
    expect(record!.imageBlob.size).toBe(survey.imageBlob.size);
    const persistedText = await record!.imageBlob.text();
    expect(persistedText).toBe(originalBytes);
  });

  it("preserves custom attributes", async () => {
    const { surveyPersistence } = await freshPersistence();
    const survey = makeLocalSurvey({ attributes: { "Pole Height": "12", Transformer: "Yes", Remarks: "" } });

    await surveyPersistence.saveSurvey(survey);
    const record = await surveyPersistence.getSurvey(survey.id);

    expect(record!.attributes).toEqual({ "Pole Height": "12", Transformer: "Yes", Remarks: "" });
  });

  it("preserves coordinates and accuracy exactly", async () => {
    const { surveyPersistence } = await freshPersistence();
    const survey = makeLocalSurvey({ latitude: -12.345678, longitude: 98.765432, accuracy: 4.2 });

    await surveyPersistence.saveSurvey(survey);
    const record = await surveyPersistence.getSurvey(survey.id);

    expect(record!.latitude).toBe(-12.345678);
    expect(record!.longitude).toBe(98.765432);
    expect(record!.accuracy).toBe(4.2);
  });

  it("initializes new records as pending with zero retries", async () => {
    const { surveyPersistence } = await freshPersistence();
    const survey = makeLocalSurvey();

    await surveyPersistence.saveSurvey(survey);
    const record = await surveyPersistence.getSurvey(survey.id);

    expect(record!.syncStatus).toBe("pending");
    expect(record!.retryCount).toBe(0);
  });

  it("survives a simulated page reload (fresh module state, same underlying database)", async () => {
    const first = await freshPersistence();
    const survey = makeLocalSurvey();
    await first.surveyPersistence.saveSurvey(survey);

    // Simulates closing and reopening the app: the first connection closes
    // (as it would when a real page unloads) before a brand new module
    // instance - no in-memory state carried over - reopens the database.
    await closeCurrentConnection!();
    closeCurrentConnection = null;
    const second = await freshPersistence();
    const record = await second.surveyPersistence.getSurvey(survey.id);

    expect(record).toBeDefined();
    expect(record!.name).toBe(survey.name);
  });

  it("stores multiple surveys and lists them all, newest first", async () => {
    const { surveyPersistence } = await freshPersistence();
    const older = makeLocalSurvey({ name: "Older", createdAt: "2026-01-01T00:00:00.000Z" });
    const newer = makeLocalSurvey({ name: "Newer", createdAt: "2026-06-01T00:00:00.000Z" });

    await surveyPersistence.saveSurvey(older);
    await surveyPersistence.saveSurvey(newer);
    const records = await surveyPersistence.listSurveys();

    expect(records).toHaveLength(2);
    expect(records[0].name).toBe("Newer");
    expect(records[1].name).toBe("Older");
  });

  it("does not make any network request when saving locally", async () => {
    const { surveyPersistence } = await freshPersistence();
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    await surveyPersistence.saveSurvey(makeLocalSurvey());

    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("surfaces IndexedDB unavailability as a SurveyPersistenceError rather than failing silently", async () => {
    const originalIndexedDb = globalThis.indexedDB;
    // @ts-expect-error - deliberately simulating an environment without IndexedDB
    delete globalThis.indexedDB;

    try {
      const { surveyPersistence, SurveyPersistenceError } = await freshPersistence();
      await expect(surveyPersistence.saveSurvey(makeLocalSurvey())).rejects.toBeInstanceOf(
        SurveyPersistenceError,
      );
    } finally {
      globalThis.indexedDB = originalIndexedDb;
    }
  });

  it("maps a QuotaExceededError to a clear, specific SurveyPersistenceError", async () => {
    const { toPersistenceError, SurveyPersistenceError } = await freshPersistence();

    const mapped = toPersistenceError(new DOMException("not enough room", "QuotaExceededError"));

    expect(mapped).toBeInstanceOf(SurveyPersistenceError);
    expect(mapped.code).toBe("quota_exceeded");
    expect(mapped.message).toMatch(/storage space/i);
  });

  it("transitions pending -> syncing -> synced, resetting retryCount to 0", async () => {
    const { surveyPersistence } = await freshPersistence();
    const survey = makeLocalSurvey();
    await surveyPersistence.saveSurvey(survey);

    await surveyPersistence.updateSyncState(survey.id, { syncStatus: "syncing" });
    expect((await surveyPersistence.getSurvey(survey.id))!.syncStatus).toBe("syncing");

    await surveyPersistence.updateSyncState(survey.id, { syncStatus: "synced", retryCount: 0 });
    const record = await surveyPersistence.getSurvey(survey.id);

    expect(record!.syncStatus).toBe("synced");
    expect(record!.retryCount).toBe(0);
  });

  it("transitions pending -> failed and increments retryCount", async () => {
    const { surveyPersistence } = await freshPersistence();
    const survey = makeLocalSurvey();
    await surveyPersistence.saveSurvey(survey);

    await surveyPersistence.updateSyncState(survey.id, { syncStatus: "failed", retryCount: 1 });
    const record = await surveyPersistence.getSurvey(survey.id);

    expect(record!.syncStatus).toBe("failed");
    expect(record!.retryCount).toBe(1);
  });

  it("increments retryCount across repeated failures", async () => {
    const { surveyPersistence } = await freshPersistence();
    const survey = makeLocalSurvey();
    await surveyPersistence.saveSurvey(survey);

    await surveyPersistence.updateSyncState(survey.id, { syncStatus: "failed", retryCount: 1 });
    await surveyPersistence.updateSyncState(survey.id, { syncStatus: "failed", retryCount: 2 });
    const record = await surveyPersistence.getSurvey(survey.id);

    expect(record!.retryCount).toBe(2);
  });

  it("preserves the image and other survey data when only sync metadata changes", async () => {
    const { surveyPersistence } = await freshPersistence();
    const survey = makeLocalSurvey({ name: "Untouched Name" });
    await surveyPersistence.saveSurvey(survey);

    await surveyPersistence.updateSyncState(survey.id, { syncStatus: "synced", retryCount: 0 });
    const record = await surveyPersistence.getSurvey(survey.id);

    expect(record!.name).toBe("Untouched Name");
    expect(record!.imageBlob.size).toBe(survey.imageBlob.size);
    expect(await record!.imageBlob.text()).toBe("fake-jpeg-bytes");
  });

  it("keeps a synced record in IndexedDB rather than deleting it", async () => {
    const { surveyPersistence } = await freshPersistence();
    const survey = makeLocalSurvey();
    await surveyPersistence.saveSurvey(survey);
    await surveyPersistence.updateSyncState(survey.id, { syncStatus: "synced", retryCount: 0 });

    const record = await surveyPersistence.getSurvey(survey.id);
    const all = await surveyPersistence.listSurveys();

    expect(record).toBeDefined();
    expect(all.some((r) => r.id === survey.id)).toBe(true);
  });

  it("listPendingSync returns pending and failed records but not synced ones", async () => {
    const { surveyPersistence } = await freshPersistence();
    const pendingSurvey = makeLocalSurvey({ name: "Pending One" });
    const failedSurvey = makeLocalSurvey({ name: "Failed One" });
    const syncedSurvey = makeLocalSurvey({ name: "Synced One" });

    await surveyPersistence.saveSurvey(pendingSurvey);
    await surveyPersistence.saveSurvey(failedSurvey);
    await surveyPersistence.saveSurvey(syncedSurvey);
    await surveyPersistence.updateSyncState(failedSurvey.id, { syncStatus: "failed", retryCount: 1 });
    await surveyPersistence.updateSyncState(syncedSurvey.id, { syncStatus: "synced", retryCount: 0 });

    const pendingSync = await surveyPersistence.listPendingSync();
    const names = pendingSync.map((r) => r.name).sort();

    expect(names).toEqual(["Failed One", "Pending One"]);
  });

  it("rejects updateSyncState for an id that does not exist", async () => {
    const { surveyPersistence, SurveyPersistenceError } = await freshPersistence();

    await expect(
      surveyPersistence.updateSyncState("00000000-0000-0000-0000-000000000000", { syncStatus: "synced" }),
    ).rejects.toBeInstanceOf(SurveyPersistenceError);
  });

  it("stores image bytes by value, so the data survives independently of the original Blob", async () => {
    // The phone-only failure this guards against: a Blob is structured-cloned
    // into IndexedDB as a *reference* to a browser-managed backing store,
    // which on mobile does not reliably outlive the session that created it.
    // The record then reads back with correct metadata but zero readable
    // bytes, and uploads as an empty file. Storing raw bytes removes the
    // dependency on that backing store entirely.
    const { surveyPersistence } = await freshPersistence();
    const bytes = "real-jpeg-payload-bytes";
    const survey = makeLocalSurvey({ imageBlob: new Blob([bytes], { type: "image/jpeg" }) });

    await surveyPersistence.saveSurvey(survey);
    // Simulates the session that created the Blob going away entirely.
    await closeCurrentConnection!();
    closeCurrentConnection = null;
    const reopened = await freshPersistence();
    const record = await reopened.surveyPersistence.getSurvey(survey.id);

    expect(record!.imageBlob.size).toBe(new Blob([bytes]).size);
    expect(await record!.imageBlob.text()).toBe(bytes);
    expect(record!.imageBlob.type).toBe("image/jpeg");
  });

  it("refuses to persist a survey whose image has no bytes", async () => {
    const { surveyPersistence, SurveyPersistenceError } = await freshPersistence();
    const survey = makeLocalSurvey({ imageBlob: new Blob([], { type: "image/jpeg" }) });

    await expect(surveyPersistence.saveSurvey(survey)).rejects.toBeInstanceOf(SurveyPersistenceError);
    expect(await surveyPersistence.listSurveys()).toHaveLength(0);
  });

  it("preserves image bytes across a sync-state update", async () => {
    const { surveyPersistence } = await freshPersistence();
    const survey = makeLocalSurvey();
    await surveyPersistence.saveSurvey(survey);

    await surveyPersistence.updateSyncState(survey.id, { syncStatus: "failed", retryCount: 1 });
    const record = await surveyPersistence.getSurvey(survey.id);

    expect(await record!.imageBlob.text()).toBe("fake-jpeg-bytes");
  });

  it("records and clears lastError alongside sync state", async () => {
    const { surveyPersistence } = await freshPersistence();
    const survey = makeLocalSurvey();
    await surveyPersistence.saveSurvey(survey);

    await surveyPersistence.updateSyncState(survey.id, {
      syncStatus: "failed",
      retryCount: 1,
      lastError: "image: The submitted file is empty.",
    });
    expect((await surveyPersistence.getSurvey(survey.id))!.lastError).toMatch(/submitted file is empty/);

    await surveyPersistence.updateSyncState(survey.id, {
      syncStatus: "synced",
      retryCount: 0,
      lastError: undefined,
    });
    expect((await surveyPersistence.getSurvey(survey.id))!.lastError).toBeUndefined();
  });

  it("deletes a local record", async () => {
    const { surveyPersistence } = await freshPersistence();
    const survey = makeLocalSurvey();
    await surveyPersistence.saveSurvey(survey);

    await surveyPersistence.deleteSurvey(survey.id);

    expect(await surveyPersistence.getSurvey(survey.id)).toBeUndefined();
    expect(await surveyPersistence.listSurveys()).toHaveLength(0);
  });

  it("deleting an id that does not exist does not throw", async () => {
    const { surveyPersistence } = await freshPersistence();

    await expect(
      surveyPersistence.deleteSurvey("00000000-0000-0000-0000-000000000000"),
    ).resolves.toBeUndefined();
  });
});
