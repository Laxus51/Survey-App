import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDatabaseForTests } from "../services/indexedDbClient";
import { surveyPersistence } from "../services/surveyPersistence";
import type { LocalSurvey } from "../types/localSurvey";
import type { SurveySyncResult } from "../types/survey";
import { generateUuid } from "../utils/uuid";
import { DashboardPage } from "./DashboardPage";

// Only `id`/`created` matter to anything under test here.
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

vi.mock("../auth/AuthContext", () => ({
  useAuth: () => ({ user: { username: "surveyor1" }, logout: vi.fn() }),
}));

vi.mock("../services/surveyApi", () => ({
  listSurveys: vi.fn(),
  syncSurvey: vi.fn(),
}));

// Imported after the mock declarations (vi.mock is hoisted regardless of
// position); using the real syncEngine + real IndexedDB-backed persistence
// against a mocked surveyApi is what makes these genuine integration tests
// of the Dashboard/sync-engine wiring, not just of each piece in isolation.
import * as surveyApi from "../services/surveyApi";
import { runSync } from "../services/syncEngine";

const EMPTY_PAGE = { count: 0, next: null, previous: null, results: [] };

function makeLocalSurvey(overrides: Partial<LocalSurvey> = {}): LocalSurvey {
  const now = new Date().toISOString();
  return {
    id: generateUuid(),
    name: "Offline Pole",
    description: "Captured offline",
    imageBlob: new Blob(["fake-bytes"], { type: "image/jpeg" }),
    imageMimeType: "image/jpeg",
    imageFileName: "survey.jpg",
    latitude: 33.6844,
    longitude: 73.0479,
    accuracy: 5,
    attributes: {},
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

beforeEach(async () => {
  // DashboardPage (and syncEngine) import the persistence singleton
  // directly (no resetModules here), so its IndexedDB connection stays open
  // across tests in this file unless explicitly closed - otherwise
  // deleteDatabase below just blocks (onblocked) without actually clearing
  // data, leaking the previous test's records forward.
  await closeDatabaseForTests();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase("SurveyApp");
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });
  vi.mocked(surveyApi.listSurveys).mockReset().mockResolvedValue(EMPTY_PAGE);
  vi.mocked(surveyApi.syncSurvey).mockReset();
  Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
});

afterEach(async () => {
  await closeDatabaseForTests();
});

describe("DashboardPage", () => {
  it("shows a locally pending survey (real IndexedDB record) in its own section", async () => {
    await surveyPersistence.saveSurvey(makeLocalSurvey({ name: "Offline Pole 1" }));

    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Offline Pole 1")).toBeInTheDocument();
    expect(screen.getByText("Pending Sync")).toBeInTheDocument();
    expect(screen.getByText("pending")).toBeInTheDocument();
  });

  it("hides the Pending Sync section when there are no local surveys", async () => {
    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByText("No synced surveys yet.")).toBeInTheDocument());
    expect(screen.queryByText("Pending Sync")).not.toBeInTheDocument();
  });

  it("shows the syncing state live while a sync attempt is in progress", async () => {
    const survey = makeLocalSurvey({ name: "Mid Sync Pole" });
    await surveyPersistence.saveSurvey(survey);
    let resolveSync: ((value: SurveySyncResult) => void) | undefined;
    vi.mocked(surveyApi.syncSurvey).mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSync = resolve;
        }),
    );

    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    );
    await screen.findByText("Mid Sync Pole");

    const syncPromise = runSync();
    await waitFor(() => expect(screen.getByText("syncing")).toBeInTheDocument());

    resolveSync?.(fakeSyncResult(survey.id, true));
    await syncPromise;
  });

  it("shows the failed state with retry count, and Retry re-attempts synchronization", async () => {
    const survey = makeLocalSurvey({ name: "Broken Pole" });
    await surveyPersistence.saveSurvey(survey);
    await surveyPersistence.updateSyncState(survey.id, { syncStatus: "failed", retryCount: 2 });
    vi.mocked(surveyApi.syncSurvey).mockResolvedValue(fakeSyncResult(survey.id, true));

    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    );

    await screen.findByText("Broken Pole");
    expect(screen.getByText("failed")).toBeInTheDocument();
    expect(screen.getByText(/retried 2×/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(async () => {
      const record = await surveyPersistence.getSurvey(survey.id);
      expect(record!.syncStatus).toBe("synced");
    });
  });

  it("moves a survey from Pending Sync into Synced Surveys once the sync engine confirms it", async () => {
    const survey = makeLocalSurvey({ name: "Now Synced Pole" });
    await surveyPersistence.saveSurvey(survey);
    vi.mocked(surveyApi.syncSurvey).mockResolvedValue(fakeSyncResult(survey.id, true));
    // The server list only reflects the survey *after* the sync engine has
    // confirmed it - the initial load (before sync) still has nothing.
    vi.mocked(surveyApi.listSurveys)
      .mockReset()
      .mockResolvedValueOnce(EMPTY_PAGE)
      .mockResolvedValue({
        count: 1,
        next: null,
        previous: null,
        results: [
          {
            id: survey.id,
            user: 1,
            name: "Now Synced Pole",
            description: "",
            image: "http://example.com/image.jpg",
            latitude: survey.latitude,
            longitude: survey.longitude,
            accuracy: survey.accuracy,
            attributes: {},
            sync_status: "synced",
            retry_count: 0,
            created_at: survey.createdAt,
            updated_at: survey.updatedAt,
          },
        ],
      });

    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    );

    await screen.findByText("Now Synced Pole");
    expect(screen.getByText("Pending Sync")).toBeInTheDocument();

    await runSync();

    await waitFor(() => expect(screen.queryByText("Pending Sync")).not.toBeInTheDocument());
    expect(screen.getAllByText("Now Synced Pole")).toHaveLength(1);
    expect(screen.getByText("synced")).toBeInTheDocument();
  });
});
