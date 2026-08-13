import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDatabaseForTests } from "../services/indexedDbClient";
import { surveyPersistence } from "../services/surveyPersistence";

let mockIsAuthenticated = true;
vi.mock("../auth/AuthContext", () => ({
  useAuth: () => ({ isAuthenticated: mockIsAuthenticated }),
}));

// Real geolocation (navigator.geolocation.getCurrentPosition) and real
// camera/canvas compression aren't meaningfully testable in jsdom (no
// canvas 2D context) - this test is about the save -> sync-trigger wiring
// specifically, not a re-verification of capture/geolocation UI already
// covered elsewhere, so those pieces are mocked to a known-good state.
vi.mock("../hooks/useGeolocationCapture", () => ({
  useGeolocationCapture: () => ({
    status: "success",
    latitude: 33.6844,
    longitude: 73.0479,
    accuracy: 5,
    errorMessage: null,
    requestLocation: vi.fn(),
  }),
}));

vi.mock("../components/survey-capture/ImageCapture", () => ({
  ImageCapture: ({ onCaptured }: { onCaptured: (blob: Blob, previewUrl: string) => void }) => (
    <button
      type="button"
      onClick={() => onCaptured(new Blob(["fake-image-bytes"], { type: "image/jpeg" }), "blob:fake-preview")}
    >
      Fake Capture
    </button>
  ),
}));

const runSyncMock = vi.fn().mockResolvedValue(undefined);
vi.mock("../services/syncEngine", () => ({
  runSync: (...args: unknown[]) => runSyncMock(...args),
}));

// Imported after the mocks so the mocked modules are what actually get used.
import { NewSurveyPage } from "./NewSurveyPage";

function setOnline(value: boolean) {
  Object.defineProperty(navigator, "onLine", { value, configurable: true });
}

async function fillOutAndReachReview() {
  render(
    <MemoryRouter>
      <NewSurveyPage />
    </MemoryRouter>,
  );

  fireEvent.click(screen.getByText("Fake Capture"));
  fireEvent.change(screen.getByLabelText("Name"), { target: { value: "Test Survey" } });
  fireEvent.click(screen.getByRole("button", { name: "Review Survey" }));
  await screen.findByText("Review Survey");
}

beforeEach(async () => {
  await closeDatabaseForTests();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase("SurveyApp");
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });
  runSyncMock.mockClear();
  mockIsAuthenticated = true;
  setOnline(true);
  vi.restoreAllMocks();
});

afterEach(async () => {
  await closeDatabaseForTests();
});

describe("NewSurveyPage - save triggers sync", () => {
  it("(a) triggers runSync() after a successful local save while online and authenticated", async () => {
    await fillOutAndReachReview();

    fireEvent.click(screen.getByRole("button", { name: "Save Survey" }));

    await screen.findByText("Survey saved");
    expect(runSyncMock).toHaveBeenCalledTimes(1);
  });

  it("(b) does not attempt a sync when offline", async () => {
    setOnline(false);
    await fillOutAndReachReview();

    fireEvent.click(screen.getByRole("button", { name: "Save Survey" }));

    await screen.findByText("Survey saved");
    expect(runSyncMock).not.toHaveBeenCalled();
  });

  it("does not trigger sync when not authenticated", async () => {
    mockIsAuthenticated = false;
    await fillOutAndReachReview();

    fireEvent.click(screen.getByRole("button", { name: "Save Survey" }));

    await screen.findByText("Survey saved");
    expect(runSyncMock).not.toHaveBeenCalled();
  });

  it("(c) persists the survey to IndexedDB before triggering sync", async () => {
    let recordCountAtTriggerTime = -1;
    runSyncMock.mockImplementationOnce(async () => {
      const records = await surveyPersistence.listSurveys();
      recordCountAtTriggerTime = records.length;
    });

    await fillOutAndReachReview();
    fireEvent.click(screen.getByRole("button", { name: "Save Survey" }));
    await screen.findByText("Survey saved");

    await waitFor(() => expect(recordCountAtTriggerTime).toBe(1));
  });

  it("(d) does not trigger sync when the local IndexedDB save itself fails", async () => {
    vi.spyOn(surveyPersistence, "saveSurvey").mockRejectedValueOnce(new Error("disk full"));

    await fillOutAndReachReview();
    fireEvent.click(screen.getByRole("button", { name: "Save Survey" }));

    await screen.findByText(/could not save/i);
    expect(runSyncMock).not.toHaveBeenCalled();
    expect(await surveyPersistence.listSurveys()).toHaveLength(0);
  });
});

describe("NewSurveyPage - image preview URL cleanup", () => {
  it("revokes the captured photo's object URL if the page unmounts without saving", () => {
    const revokeSpy = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});

    const { unmount } = render(
      <MemoryRouter>
        <NewSurveyPage />
      </MemoryRouter>,
    );
    fireEvent.click(screen.getByText("Fake Capture"));

    unmount();

    expect(revokeSpy).toHaveBeenCalledWith("blob:fake-preview");
  });
});
