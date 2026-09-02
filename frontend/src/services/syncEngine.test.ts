import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LocalSurvey } from "../types/localSurvey";
import type { SurveySyncResult } from "../types/survey";
import { generateUuid } from "../utils/uuid";
import { ApiError } from "./httpClient";
import { closeDatabaseForTests } from "./indexedDbClient";
import { surveyPersistence } from "./surveyPersistence";

vi.mock("./surveyApi", () => ({ syncSurvey: vi.fn() }));

// Imported after the mock declaration; vi.mock is hoisted above this file's
// imports regardless of source order, so `syncSurvey` here is the mock.
import * as surveyApi from "./surveyApi";
import type { SyncEvent } from "./syncEngine";
import { recoverInterruptedSyncs, runSync, subscribe } from "./syncEngine";

// Only `id`/`created` matter to the sync engine's own logic; the rest of a
// real SurveySyncResult is irrelevant to what's under test here.
function fakeSyncResult(id: string, created: boolean): SurveySyncResult {
  return {
    id,
    created,
    user: 1,
    name: "",
    description: "",
    image: "",
    latitude: 0,
    longitude: 0,
    accuracy: 0,
    attributes: {},
    sync_status: "synced",
    retry_count: 0,
    captured_at: null,
    created_at: "",
    updated_at: "",
  };
}

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
    attributes: { "Pole Height": "12" },
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function setOnline(value: boolean) {
  Object.defineProperty(navigator, "onLine", { value, configurable: true });
}

beforeEach(async () => {
  await closeDatabaseForTests();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase("SurveyApp");
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });
  vi.mocked(surveyApi.syncSurvey).mockReset();
  setOnline(true);
});

afterEach(async () => {
  await closeDatabaseForTests();
});

describe("syncEngine", () => {
  it("marks a new survey synced on success (201) and keeps retryCount at 0", async () => {
    const survey = makeLocalSurvey();
    await surveyPersistence.saveSurvey(survey);
    vi.mocked(surveyApi.syncSurvey).mockResolvedValue(fakeSyncResult(survey.id, true));

    await runSync();

    const record = await surveyPersistence.getSurvey(survey.id);
    expect(record!.syncStatus).toBe("synced");
    expect(record!.retryCount).toBe(0);
  });

  it("handles a resync of an existing UUID (200, created: false) the same way", async () => {
    const survey = makeLocalSurvey();
    await surveyPersistence.saveSurvey(survey);
    vi.mocked(surveyApi.syncSurvey).mockResolvedValue(fakeSyncResult(survey.id, false));

    await runSync();

    expect((await surveyPersistence.getSurvey(survey.id))!.syncStatus).toBe("synced");
  });

  it("sends the correct UUID, image Blob, and all mapped fields", async () => {
    const survey = makeLocalSurvey({
      name: "Fire Hydrant 7",
      description: "Corner lot",
      latitude: 1.111,
      longitude: 2.222,
      accuracy: 3.5,
      attributes: { Color: "Red" },
    });
    await surveyPersistence.saveSurvey(survey);
    vi.mocked(surveyApi.syncSurvey).mockResolvedValue(fakeSyncResult(survey.id, true));

    await runSync();

    expect(surveyApi.syncSurvey).toHaveBeenCalledTimes(1);
    const payload = vi.mocked(surveyApi.syncSurvey).mock.calls[0][0];
    expect(payload.id).toBe(survey.id);
    expect(payload.name).toBe("Fire Hydrant 7");
    expect(payload.description).toBe("Corner lot");
    expect(payload.latitude).toBe(1.111);
    expect(payload.longitude).toBe(2.222);
    expect(payload.accuracy).toBe(3.5);
    expect(payload.attributes).toEqual({ Color: "Red" });
    expect(payload.image).toBeInstanceOf(File);
    expect(payload.image.size).toBe(survey.imageBlob.size);
    expect(payload.image.type).toBe("image/jpeg");
  });

  it("sends the original capture time, not the time the sync happens", async () => {
    // The bug this fixes: a survey captured offline days earlier was recorded
    // by the server as having happened whenever it finally synced.
    const capturedAt = "2026-08-18T10:00:00.000Z";
    const survey = makeLocalSurvey({ createdAt: capturedAt });
    await surveyPersistence.saveSurvey(survey);
    vi.mocked(surveyApi.syncSurvey).mockResolvedValue(fakeSyncResult(survey.id, true));

    await runSync();

    const payload = vi.mocked(surveyApi.syncSurvey).mock.calls[0][0];
    expect(payload.capturedAt).toBe(capturedAt);
  });

  it("does not lose the survey on a network failure, and leaves it pending", async () => {
    const survey = makeLocalSurvey();
    await surveyPersistence.saveSurvey(survey);
    vi.mocked(surveyApi.syncSurvey).mockRejectedValue(new TypeError("Failed to fetch"));

    await runSync();

    const record = await surveyPersistence.getSurvey(survey.id);
    expect(record).toBeDefined();
    expect(record!.syncStatus).toBe("pending");
    expect(record!.retryCount).toBe(0);
  });

  it("marks a genuine server error as failed and increments retryCount", async () => {
    const survey = makeLocalSurvey();
    await surveyPersistence.saveSurvey(survey);
    vi.mocked(surveyApi.syncSurvey).mockRejectedValue(new ApiError(400, { name: ["This field is required."] }));

    await runSync();

    const record = await surveyPersistence.getSurvey(survey.id);
    expect(record!.syncStatus).toBe("failed");
    expect(record!.retryCount).toBe(1);
  });

  it("increments retryCount across repeated failed runs, without retrying automatically", async () => {
    const survey = makeLocalSurvey();
    await surveyPersistence.saveSurvey(survey);
    vi.mocked(surveyApi.syncSurvey).mockRejectedValue(new ApiError(500, null));

    await runSync();
    expect(surveyApi.syncSurvey).toHaveBeenCalledTimes(1);
    await runSync();
    expect(surveyApi.syncSurvey).toHaveBeenCalledTimes(2);

    const record = await surveyPersistence.getSurvey(survey.id);
    expect(record!.syncStatus).toBe("failed");
    expect(record!.retryCount).toBe(2);
  });

  it("handles 409 Conflict safely: marks failed, preserves the survey and its image", async () => {
    const survey = makeLocalSurvey();
    await surveyPersistence.saveSurvey(survey);
    vi.mocked(surveyApi.syncSurvey).mockRejectedValue(
      new ApiError(409, { detail: "This survey id is already associated with a different account." }),
    );

    await runSync();

    const record = await surveyPersistence.getSurvey(survey.id);
    expect(record!.syncStatus).toBe("failed");
    expect(record!.retryCount).toBe(1);
    expect(record!.imageBlob.size).toBeGreaterThan(0);
    expect(await record!.imageBlob.text()).toBe("fake-jpeg-bytes");
  });

  it("does not mark synced when the session cannot be restored (401), and does not penalize retryCount", async () => {
    const survey = makeLocalSurvey();
    await surveyPersistence.saveSurvey(survey);
    vi.mocked(surveyApi.syncSurvey).mockRejectedValue(new ApiError(401, { detail: "Unauthorized" }));

    await runSync();

    const record = await surveyPersistence.getSurvey(survey.id);
    expect(record!.syncStatus).toBe("pending");
    expect(record!.retryCount).toBe(0);
  });

  it("reverts to failed (not pending) if a previously-failed record hits a network error on retry", async () => {
    const survey = makeLocalSurvey();
    await surveyPersistence.saveSurvey(survey);
    await surveyPersistence.updateSyncState(survey.id, { syncStatus: "failed", retryCount: 1 });
    vi.mocked(surveyApi.syncSurvey).mockRejectedValue(new TypeError("Failed to fetch"));

    await runSync();

    const record = await surveyPersistence.getSurvey(survey.id);
    expect(record!.syncStatus).toBe("failed");
    expect(record!.retryCount).toBe(1);
  });

  it("does not start a second queue processor when triggered concurrently", async () => {
    const survey = makeLocalSurvey();
    await surveyPersistence.saveSurvey(survey);
    let resolveSync: ((value: SurveySyncResult) => void) | undefined;
    vi.mocked(surveyApi.syncSurvey).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSync = resolve;
        }),
    );

    const first = runSync();
    const second = runSync();
    expect(first).toBe(second);

    // runSync() awaits a real updateSyncState("syncing") write before it
    // ever calls syncSurvey(), so resolveSync isn't captured synchronously -
    // wait for the mock to actually be invoked before resolving it.
    await vi.waitFor(() => {
      if (!resolveSync) throw new Error("syncSurvey not called yet");
    });
    resolveSync!(fakeSyncResult(survey.id, true));
    await Promise.all([first, second]);

    expect(surveyApi.syncSurvey).toHaveBeenCalledTimes(1);
  });

  it("attempts to sync even when navigator.onLine reports false", async () => {
    // navigator.onLine is well documented as unreliable on iOS Safari - it
    // can report false (and the "online" event can fail to fire) even when
    // the device is genuinely connected. runSync() must not use it as a
    // pre-check that silently skips the whole queue; the record's own
    // fetch() is the real source of truth (a genuine network failure is
    // covered separately below, by "does not lose the survey on a network
    // failure").
    setOnline(false);
    const survey = makeLocalSurvey();
    await surveyPersistence.saveSurvey(survey);
    vi.mocked(surveyApi.syncSurvey).mockResolvedValue(fakeSyncResult(survey.id, true));

    await runSync();

    expect(surveyApi.syncSurvey).toHaveBeenCalledTimes(1);
    const record = await surveyPersistence.getSurvey(survey.id);
    expect(record!.syncStatus).toBe("synced");
  });

  it("notifies subscribers as records settle", async () => {
    const survey = makeLocalSurvey();
    await surveyPersistence.saveSurvey(survey);
    vi.mocked(surveyApi.syncSurvey).mockResolvedValue(fakeSyncResult(survey.id, true));
    const listener = vi.fn();
    const unsubscribe = subscribe(listener);

    await runSync();
    unsubscribe();

    expect(listener).toHaveBeenCalled();
  });

  it("reports each record's transition, then one run-finished carrying the synced count", async () => {
    const first = makeLocalSurvey({ name: "First" });
    const second = makeLocalSurvey({ name: "Second" });
    await surveyPersistence.saveSurvey(first);
    await surveyPersistence.saveSurvey(second);
    vi.mocked(surveyApi.syncSurvey).mockImplementation((payload) =>
      Promise.resolve(fakeSyncResult(payload.id!, true)),
    );
    const events: SyncEvent[] = [];
    const unsubscribe = subscribe((event) => events.push(event));

    await runSync();
    unsubscribe();

    // syncing + synced per record, then exactly one run-finished.
    expect(events.filter((e) => e.type === "record-changed")).toHaveLength(4);
    const finished = events.filter((e) => e.type === "run-finished");
    expect(finished).toHaveLength(1);
    expect(finished[0]).toEqual({ type: "run-finished", syncedCount: 2 });
    expect(events[events.length - 1].type).toBe("run-finished");
  });

  it("reports syncedCount 0 when a run rejects every record, so nothing landed server-side", async () => {
    const survey = makeLocalSurvey();
    await surveyPersistence.saveSurvey(survey);
    vi.mocked(surveyApi.syncSurvey).mockRejectedValue(new ApiError(400, { name: ["Required."] }));
    const events: SyncEvent[] = [];
    const unsubscribe = subscribe((event) => events.push(event));

    await runSync();
    unsubscribe();

    expect(events.at(-1)).toEqual({ type: "run-finished", syncedCount: 0 });
  });

  it("never picks up a record that is currently syncing", async () => {
    // The guard that makes the recovery below safe: a run must not grab a
    // record whose request is genuinely in flight.
    const survey = makeLocalSurvey();
    await surveyPersistence.saveSurvey(survey);
    await surveyPersistence.updateSyncState(survey.id, { syncStatus: "syncing" });

    await runSync();

    expect(surveyApi.syncSurvey).not.toHaveBeenCalled();
  });
});

describe("syncEngine handling of transient server failures", () => {
  it("does not mark a survey failed when the server is temporarily unavailable", async () => {
    // The observed case: a 503 from the tunnel in front of the server, for a
    // survey that synced perfectly on the very next attempt. Treating that as
    // a rejection told the surveyor their survey was broken when it wasn't.
    const survey = makeLocalSurvey();
    await surveyPersistence.saveSurvey(survey);
    vi.mocked(surveyApi.syncSurvey).mockRejectedValue(new ApiError(503, null));

    await runSync();

    const record = await surveyPersistence.getSurvey(survey.id);
    expect(record!.syncStatus).toBe("pending");
    expect(record!.retryCount).toBe(0);
  });

  it("still marks a survey failed when the server rejects it with a 4xx", async () => {
    const survey = makeLocalSurvey();
    await surveyPersistence.saveSurvey(survey);
    vi.mocked(surveyApi.syncSurvey).mockRejectedValue(
      new ApiError(400, { name: ["This field is required."] }),
    );

    await runSync();

    const record = await surveyPersistence.getSurvey(survey.id);
    expect(record!.syncStatus).toBe("failed");
    expect(record!.retryCount).toBe(1);
  });

  it("still marks a survey failed on a 500, which may be caused by this payload", async () => {
    // Kept distinct from 502/503/504 on purpose: silently re-sending a
    // request that makes the application error out would hammer the server
    // on every trigger with no way for the surveyor to see it happening.
    const survey = makeLocalSurvey();
    await surveyPersistence.saveSurvey(survey);
    vi.mocked(surveyApi.syncSurvey).mockRejectedValue(new ApiError(500, null));

    await runSync();

    const record = await surveyPersistence.getSurvey(survey.id);
    expect(record!.syncStatus).toBe("failed");
    expect(record!.retryCount).toBe(1);
  });

  it("retries a transient failure automatically on the next run", async () => {
    const survey = makeLocalSurvey();
    await surveyPersistence.saveSurvey(survey);
    vi.mocked(surveyApi.syncSurvey)
      .mockRejectedValueOnce(new ApiError(503, null))
      .mockResolvedValue(fakeSyncResult(survey.id, true));

    await runSync();
    expect((await surveyPersistence.getSurvey(survey.id))!.syncStatus).toBe("pending");

    await runSync();

    expect((await surveyPersistence.getSurvey(survey.id))!.syncStatus).toBe("synced");
  });
});

describe("syncEngine handling of unusable images", () => {
  it("fails a survey with an empty image without wasting an upload", async () => {
    const survey = makeLocalSurvey();
    await surveyPersistence.saveSurvey(survey);
    // Bypasses saveSurvey's own guard to simulate a record whose bytes were
    // already lost by an older build before that guard existed.
    vi.spyOn(surveyPersistence, "listPendingSync").mockResolvedValue([
      {
        ...survey,
        imageBlob: new Blob([], { type: "image/jpeg" }),
        syncStatus: "pending",
        retryCount: 0,
      },
    ]);

    await runSync();

    expect(surveyApi.syncSurvey).not.toHaveBeenCalled();
    const record = await surveyPersistence.getSurvey(survey.id);
    expect(record!.syncStatus).toBe("failed");
    expect(record!.lastError).toMatch(/recapture/i);
    vi.mocked(surveyPersistence.listPendingSync).mockRestore();
  });

  it("records the server's reason on a validation rejection", async () => {
    const survey = makeLocalSurvey();
    await surveyPersistence.saveSurvey(survey);
    vi.mocked(surveyApi.syncSurvey).mockRejectedValue(
      new ApiError(400, { image: ["The submitted file is empty."] }),
    );

    await runSync();

    const record = await surveyPersistence.getSurvey(survey.id);
    expect(record!.syncStatus).toBe("failed");
    expect(record!.lastError).toBe("image: The submitted file is empty.");
  });

  it("clears a stale lastError once the survey finally syncs", async () => {
    const survey = makeLocalSurvey();
    await surveyPersistence.saveSurvey(survey);
    await surveyPersistence.updateSyncState(survey.id, {
      syncStatus: "failed",
      retryCount: 1,
      lastError: "image: The submitted file is empty.",
    });
    vi.mocked(surveyApi.syncSurvey).mockResolvedValue(fakeSyncResult(survey.id, true));

    await runSync();

    const record = await surveyPersistence.getSurvey(survey.id);
    expect(record!.syncStatus).toBe("synced");
    expect(record!.lastError).toBeUndefined();
  });
});

describe("syncEngine recovery of interrupted syncs", () => {
  it("returns a record stranded in 'syncing' to the queue so it can sync again", async () => {
    // Reproduces the observed field failure: a survey left in "syncing" by an
    // interrupted session (reload/tab close/stalled request) was invisible to
    // listPendingSync forever, so it showed "syncing" indefinitely and the
    // Retry button silently did nothing.
    const survey = makeLocalSurvey();
    await surveyPersistence.saveSurvey(survey);
    await surveyPersistence.updateSyncState(survey.id, { syncStatus: "syncing" });
    vi.mocked(surveyApi.syncSurvey).mockResolvedValue(fakeSyncResult(survey.id, true));

    // Before recovery the record is unreachable by any trigger.
    await runSync();
    expect(surveyApi.syncSurvey).not.toHaveBeenCalled();

    await recoverInterruptedSyncs();
    expect((await surveyPersistence.getSurvey(survey.id))!.syncStatus).toBe("pending");

    await runSync();

    expect(surveyApi.syncSurvey).toHaveBeenCalledTimes(1);
    expect((await surveyPersistence.getSurvey(survey.id))!.syncStatus).toBe("synced");
  });

  it("does not charge retryCount for an attempt that never completed", async () => {
    const survey = makeLocalSurvey();
    await surveyPersistence.saveSurvey(survey);
    await surveyPersistence.updateSyncState(survey.id, { syncStatus: "syncing", retryCount: 2 });

    await recoverInterruptedSyncs();

    const record = await surveyPersistence.getSurvey(survey.id);
    expect(record!.syncStatus).toBe("pending");
    expect(record!.retryCount).toBe(2);
  });

  it("leaves pending, failed and synced records untouched", async () => {
    const pending = makeLocalSurvey({ name: "Pending" });
    const failed = makeLocalSurvey({ name: "Failed" });
    const synced = makeLocalSurvey({ name: "Synced" });
    await surveyPersistence.saveSurvey(pending);
    await surveyPersistence.saveSurvey(failed);
    await surveyPersistence.saveSurvey(synced);
    await surveyPersistence.updateSyncState(failed.id, { syncStatus: "failed", retryCount: 1 });
    await surveyPersistence.updateSyncState(synced.id, { syncStatus: "synced", retryCount: 0 });

    await recoverInterruptedSyncs();

    expect((await surveyPersistence.getSurvey(pending.id))!.syncStatus).toBe("pending");
    expect((await surveyPersistence.getSurvey(failed.id))!.syncStatus).toBe("failed");
    expect((await surveyPersistence.getSurvey(synced.id))!.syncStatus).toBe("synced");
  });

  it("notifies subscribers so the dashboard reflects the recovered state", async () => {
    const survey = makeLocalSurvey();
    await surveyPersistence.saveSurvey(survey);
    await surveyPersistence.updateSyncState(survey.id, { syncStatus: "syncing" });
    const listener = vi.fn();
    const unsubscribe = subscribe(listener);

    await recoverInterruptedSyncs();
    unsubscribe();

    expect(listener).toHaveBeenCalled();
  });

  it("does nothing when there is nothing stranded", async () => {
    const listener = vi.fn();
    const unsubscribe = subscribe(listener);

    await recoverInterruptedSyncs();
    unsubscribe();

    expect(listener).not.toHaveBeenCalled();
  });
});
