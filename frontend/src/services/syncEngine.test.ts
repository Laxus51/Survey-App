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
import { runSync, subscribe } from "./syncEngine";

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

  it("does not attempt to sync when offline", async () => {
    setOnline(false);
    const survey = makeLocalSurvey();
    await surveyPersistence.saveSurvey(survey);

    await runSync();

    expect(surveyApi.syncSurvey).not.toHaveBeenCalled();
    const record = await surveyPersistence.getSurvey(survey.id);
    expect(record!.syncStatus).toBe("pending");
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
});
