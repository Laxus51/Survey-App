import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../services/httpClient";
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
    captured_at: null,
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

// Descending timestamps so index 0 sorts first under listSurveys' newest-first
// ordering, keeping "Pole NN" positions predictable in the tests below.
function isoAt(index: number): string {
  return new Date(Date.UTC(2026, 0, 1, 0, 0, 0) - index * 60_000).toISOString();
}

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
    // The local (IndexedDB) load and the server load are independent - wait
    // for the local one to settle too, rather than assuming it's already
    // done just because the (separately mocked, near-instant) server load is.
    await waitFor(() => expect(screen.queryByText("Pending Sync")).not.toBeInTheDocument());
  });

  it("shows a loading indicator in Pending Sync while local surveys are being read", async () => {
    let resolveList: ((records: Awaited<ReturnType<typeof surveyPersistence.listSurveys>>) => void) | undefined;
    const listSpy = vi.spyOn(surveyPersistence, "listSurveys").mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveList = resolve;
        }),
    );

    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    );

    await screen.findByText("Pending Sync");
    expect(screen.getAllByText("Loading…").length).toBeGreaterThan(0);

    resolveList?.([]);
    await waitFor(() => expect(screen.queryByText("Pending Sync")).not.toBeInTheDocument());

    listSpy.mockRestore();
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

  it("refreshes the server list once per sync run, not once per record", async () => {
    // The behaviour this guards: a run over many surveys emits ~2 events per
    // record, and answering each with a server refetch turned one sync into
    // hundreds of requests. Local badges still update per record; the server
    // list is re-read once, at the end.
    const surveys = [
      makeLocalSurvey({ name: "One" }),
      makeLocalSurvey({ name: "Two" }),
      makeLocalSurvey({ name: "Three" }),
    ];
    for (const survey of surveys) await surveyPersistence.saveSurvey(survey);
    vi.mocked(surveyApi.syncSurvey).mockImplementation((payload) =>
      Promise.resolve(fakeSyncResult(payload.id!, true)),
    );

    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    );
    await screen.findByText("One");

    const callsBeforeSync = vi.mocked(surveyApi.listSurveys).mock.calls.length;
    await runSync();
    await waitFor(() => expect(screen.queryByText("Pending Sync")).not.toBeInTheDocument());

    const serverRefreshes = vi.mocked(surveyApi.listSurveys).mock.calls.length - callsBeforeSync;
    expect(serverRefreshes).toBe(1);
  });

  it("updates badges during a run without re-reading IndexedDB for every event", async () => {
    // The cost this guards: each record-changed event used to trigger a full
    // listSurveys(), which re-reads every record and rebuilds each image Blob
    // from its stored bytes - ~200 complete scans over a 100-survey run.
    const survey = makeLocalSurvey({ name: "Watched" });
    await surveyPersistence.saveSurvey(survey);
    let releaseSync: ((value: SurveySyncResult) => void) | undefined;
    vi.mocked(surveyApi.syncSurvey).mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseSync = resolve;
        }),
    );

    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    );
    await screen.findByText("Watched");

    const listSpy = vi.spyOn(surveyPersistence, "listSurveys");
    const syncPromise = runSync();

    // The badge still goes live mid-run...
    await waitFor(() => expect(screen.getByText("syncing")).toBeInTheDocument());
    // ...without any local re-read behind it.
    expect(listSpy).not.toHaveBeenCalled();

    releaseSync?.(fakeSyncResult(survey.id, true));
    await syncPromise;
    listSpy.mockRestore();
  });

  it("keeps the same image Blob instance while a record's status changes", async () => {
    // A re-read would hand back a newly constructed Blob, and the card's
    // effect keys on that identity - so every status change would revoke and
    // recreate the object URL, reloading the image twice per record.
    const survey = makeLocalSurvey({ name: "Stable Image" });
    await surveyPersistence.saveSurvey(survey);
    vi.mocked(surveyApi.syncSurvey).mockRejectedValue(new ApiError(400, { name: ["Required."] }));
    const createObjectUrlSpy = vi.spyOn(URL, "createObjectURL");

    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    );
    await screen.findByText("Stable Image");
    const urlsAfterInitialRender = createObjectUrlSpy.mock.calls.length;

    await runSync();
    await waitFor(() => expect(screen.getByText("failed")).toBeInTheDocument());

    // pending -> syncing -> failed produced no new object URL.
    expect(createObjectUrlSpy.mock.calls.length).toBe(urlsAfterInitialRender);
    createObjectUrlSpy.mockRestore();
  });

  it("leaves unrelated pending records untouched when one record changes", async () => {
    const target = makeLocalSurvey({ name: "Target" });
    const bystander = makeLocalSurvey({ name: "Bystander" });
    await surveyPersistence.saveSurvey(target);
    await surveyPersistence.saveSurvey(bystander);
    // Only the bystander is left pending after the run: the target fails.
    vi.mocked(surveyApi.syncSurvey).mockImplementation((payload) =>
      payload.id === target.id
        ? Promise.reject(new ApiError(400, { name: ["Required."] }))
        : Promise.resolve(fakeSyncResult(payload.id!, true)),
    );

    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    );
    await screen.findByText("Target");

    await runSync();

    await waitFor(() => expect(screen.getByText("failed")).toBeInTheDocument());
    // The synced one left Pending Sync; the failed one stayed, intact.
    expect(screen.getByText("Target")).toBeInTheDocument();
    expect(screen.queryByText("Bystander")).not.toBeInTheDocument();
  });

  it("shows the retry count and reason carried by the event, without a re-read", async () => {
    const survey = makeLocalSurvey({ name: "Rejected Twice" });
    await surveyPersistence.saveSurvey(survey);
    await surveyPersistence.updateSyncState(survey.id, { syncStatus: "failed", retryCount: 1 });
    vi.mocked(surveyApi.syncSurvey).mockRejectedValue(
      new ApiError(400, { image: ["The submitted file is empty."] }),
    );

    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    );
    await screen.findByText("Rejected Twice");

    const listSpy = vi.spyOn(surveyPersistence, "listSurveys");
    await runSync();

    // retryCount advanced 1 -> 2 and the server's reason is shown, both from
    // the event alone.
    await waitFor(() => expect(screen.getByText(/retried 2×/)).toBeInTheDocument());
    expect(screen.getByText(/submitted file is empty/i)).toBeInTheDocument();
    expect(listSpy).not.toHaveBeenCalled();
    listSpy.mockRestore();
  });

  it("marks pending card images as lazily loaded", async () => {
    // Paired with the render cap: the cards that are mounted still shouldn't
    // force every photo to decode before it scrolls into view.
    await surveyPersistence.saveSurvey(makeLocalSurvey({ name: "Lazy Pole" }));

    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    );

    const image = await screen.findByAltText("Lazy Pole");
    expect(image).toHaveAttribute("loading", "lazy");
  });

  it("renders every pending record when the queue fits within one page", async () => {
    for (let i = 0; i < 20; i += 1) {
      // Descending createdAt keeps the order deterministic and matches how
      // listSurveys sorts, so "Pole 00" is first.
      await surveyPersistence.saveSurvey(
        makeLocalSurvey({ name: `Pole ${String(i).padStart(2, "0")}`, createdAt: isoAt(i) }),
      );
    }

    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText("Pole 00")).toBeInTheDocument();
    expect(screen.getByText("Pole 19")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /load more/i })).not.toBeInTheDocument();
  });

  it("mounts only the first 20 cards when more are queued, and reveals the rest in batches", async () => {
    // The cost this guards: every mounted card holds a live object URL for a
    // full-size photo, so an offline backlog of 100+ would decode them all at
    // once on a phone.
    for (let i = 0; i < 45; i += 1) {
      await surveyPersistence.saveSurvey(
        makeLocalSurvey({ name: `Pole ${String(i).padStart(2, "0")}`, createdAt: isoAt(i) }),
      );
    }

    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    );
    await screen.findByText("Pole 00");

    expect(screen.getByText("Pole 19")).toBeInTheDocument();
    expect(screen.queryByText("Pole 20")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /25 not shown/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /load more/i }));
    expect(screen.getByText("Pole 20")).toBeInTheDocument();
    expect(screen.getByText("Pole 39")).toBeInTheDocument();
    expect(screen.queryByText("Pole 40")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /load more/i }));
    expect(screen.getByText("Pole 44")).toBeInTheDocument();
    // Everything is revealed, so the control retires.
    expect(screen.queryByRole("button", { name: /load more/i })).not.toBeInTheDocument();
  });

  it("keeps unrendered records queued and syncs them even while hidden", async () => {
    // Slicing limits what is mounted, not what exists: the engine reads
    // IndexedDB directly and must be unaffected by what is on screen.
    for (let i = 0; i < 25; i += 1) {
      await surveyPersistence.saveSurvey(
        makeLocalSurvey({ name: `Pole ${String(i).padStart(2, "0")}`, createdAt: isoAt(i) }),
      );
    }
    vi.mocked(surveyApi.syncSurvey).mockImplementation((payload) =>
      Promise.resolve(fakeSyncResult(payload.id!, true)),
    );

    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    );
    await screen.findByText("Pole 00");
    expect(screen.queryByText("Pole 24")).not.toBeInTheDocument();

    await runSync();

    expect(surveyApi.syncSurvey).toHaveBeenCalledTimes(25);
    await waitFor(() => expect(screen.queryByText("Pending Sync")).not.toBeInTheDocument());
  });

  it("promotes previously hidden records as synced ones leave the list", async () => {
    for (let i = 0; i < 25; i += 1) {
      await surveyPersistence.saveSurvey(
        makeLocalSurvey({ name: `Pole ${String(i).padStart(2, "0")}`, createdAt: isoAt(i) }),
      );
    }
    // Only the five oldest-shown records sync; the rest are rejected and stay.
    vi.mocked(surveyApi.syncSurvey).mockImplementation((payload) => {
      const index = Number(payload.name.split(" ")[1]);
      return index < 5
        ? Promise.resolve(fakeSyncResult(payload.id!, true))
        : Promise.reject(new ApiError(400, { name: ["Required."] }));
    });

    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    );
    await screen.findByText("Pole 00");
    expect(screen.queryByText("Pole 20")).not.toBeInTheDocument();

    await runSync();

    // Five left the list, so five formerly-hidden records take their place
    // without the visible count resetting or a gap appearing.
    await waitFor(() => expect(screen.queryByText("Pole 00")).not.toBeInTheDocument());
    expect(screen.getByText("Pole 24")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /load more/i })).not.toBeInTheDocument();
  });

  it("still loads local surveys from IndexedDB on initial mount", async () => {
    const survey = makeLocalSurvey({ name: "From Storage" });
    await surveyPersistence.saveSurvey(survey);
    const listSpy = vi.spyOn(surveyPersistence, "listSurveys");

    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    );

    expect(await screen.findByText("From Storage")).toBeInTheDocument();
    expect(listSpy).toHaveBeenCalled();
    listSpy.mockRestore();
  });

  it("does not refresh the server list when a run syncs nothing", async () => {
    const survey = makeLocalSurvey({ name: "Rejected" });
    await surveyPersistence.saveSurvey(survey);
    vi.mocked(surveyApi.syncSurvey).mockRejectedValue(new ApiError(400, { name: ["Required."] }));

    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    );
    await screen.findByText("Rejected");

    const callsBeforeSync = vi.mocked(surveyApi.listSurveys).mock.calls.length;
    await runSync();
    // The local badge still updates from IndexedDB alone.
    await waitFor(() => expect(screen.getByText("failed")).toBeInTheDocument());

    expect(vi.mocked(surveyApi.listSurveys).mock.calls.length).toBe(callsBeforeSync);
  });

  it("retries the server list when the browser regains connectivity", async () => {
    // Reproduces the reported failure: after a sync run, the follow-up
    // listSurveys() call can fail at the transport layer (observed on iOS
    // Safari after a network change) with no server-side trace at all.
    // Nothing previously re-attempted it - not a record-changed event (local
    // only), not another run-finished (nothing left to sync) - so the only
    // path back was the browser's own `online` event.
    vi.mocked(surveyApi.listSurveys).mockRejectedValueOnce(new TypeError("Failed to fetch"));

    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    );
    await screen.findByText("Failed to load surveys.");

    vi.mocked(surveyApi.listSurveys).mockResolvedValue(EMPTY_PAGE);
    window.dispatchEvent(new Event("online"));

    await waitFor(() => expect(screen.getByText("No synced surveys yet.")).toBeInTheDocument());
    expect(screen.queryByText("Failed to load surveys.")).not.toBeInTheDocument();
  });

  it("offers a manual Retry button for a failed server list load", async () => {
    vi.mocked(surveyApi.listSurveys).mockRejectedValueOnce(new TypeError("Failed to fetch"));

    render(
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>,
    );
    await screen.findByText("Failed to load surveys.");

    vi.mocked(surveyApi.listSurveys).mockResolvedValue(EMPTY_PAGE);
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    await waitFor(() => expect(screen.getByText("No synced surveys yet.")).toBeInTheDocument());
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
            captured_at: survey.createdAt,
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
