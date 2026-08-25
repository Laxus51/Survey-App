import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDatabaseForTests } from "../services/indexedDbClient";
import { surveyPersistence } from "../services/surveyPersistence";
import type { LocalSurvey } from "../types/localSurvey";
import type { Survey } from "../types/survey";
import { generateUuid } from "../utils/uuid";
import { SurveyDetailsPage } from "./SurveyDetailsPage";

vi.mock("../services/surveyApi", () => ({
  getSurvey: vi.fn().mockRejectedValue(new Error("server API should not be called for a local-only survey")),
  deleteSurvey: vi.fn(),
}));

import * as surveyApi from "../services/surveyApi";

function renderAtSurvey(id: string) {
  return render(
    <MemoryRouter initialEntries={[`/surveys/${id}`]}>
      <Routes>
        <Route path="/surveys/:id" element={<SurveyDetailsPage />} />
        <Route path="/" element={<div>Dashboard Home</div>} />
      </Routes>
    </MemoryRouter>,
  );
}

// Delete is now a two-step flow (per DESIGN_SYSTEM.md §13: destructive
// actions get a real confirmation modal, replacing the old native
// window.confirm()) - "Delete Survey" opens the modal, "Delete" inside it
// actually triggers handleDelete.
function clickDeleteAndConfirm() {
  fireEvent.click(screen.getByRole("button", { name: "Delete Survey" }));
  fireEvent.click(screen.getByRole("button", { name: "Delete" }));
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
    attributes: { Note: "test" },
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

beforeEach(async () => {
  await closeDatabaseForTests();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase("SurveyApp");
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });
  vi.mocked(surveyApi.deleteSurvey).mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "onLine", { value: true, configurable: true });
});

afterEach(async () => {
  await closeDatabaseForTests();
  vi.restoreAllMocks();
});

describe("SurveyDetailsPage", () => {
  it("renders a locally-stored survey by UUID without calling the server API", async () => {
    const survey = makeLocalSurvey({ name: "Local Only Survey" });
    await surveyPersistence.saveSurvey(survey);

    render(
      <MemoryRouter initialEntries={[`/surveys/${survey.id}`]}>
        <Routes>
          <Route path="/surveys/:id" element={<SurveyDetailsPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText("Local Only Survey")).toBeInTheDocument();
    expect(screen.getByText("pending")).toBeInTheDocument();
    expect(screen.getByText("Note")).toBeInTheDocument();
  });

  it("deletes a local pending survey without calling the server, then returns to the dashboard", async () => {
    const survey = makeLocalSurvey({ name: "Never Synced" });
    await surveyPersistence.saveSurvey(survey);

    renderAtSurvey(survey.id);
    await screen.findByText("Never Synced");

    clickDeleteAndConfirm();

    await screen.findByText("Dashboard Home");
    expect(surveyApi.deleteSurvey).not.toHaveBeenCalled();
    expect(await surveyPersistence.getSurvey(survey.id)).toBeUndefined();
  });

  it("deletes a locally-known-synced survey via the server API and removes the local copy", async () => {
    const survey = makeLocalSurvey({ name: "Already Synced" });
    await surveyPersistence.saveSurvey(survey);
    await surveyPersistence.updateSyncState(survey.id, { syncStatus: "synced", retryCount: 0 });

    renderAtSurvey(survey.id);
    await screen.findByText("Already Synced");

    clickDeleteAndConfirm();

    await screen.findByText("Dashboard Home");
    expect(surveyApi.deleteSurvey).toHaveBeenCalledWith(survey.id);
    expect(await surveyPersistence.getSurvey(survey.id)).toBeUndefined();
  });

  it("does not delete anything and shows an error when offline and the survey is already synced", async () => {
    const survey = makeLocalSurvey({ name: "Offline Synced" });
    await surveyPersistence.saveSurvey(survey);
    await surveyPersistence.updateSyncState(survey.id, { syncStatus: "synced", retryCount: 0 });
    Object.defineProperty(navigator, "onLine", { value: false, configurable: true });

    renderAtSurvey(survey.id);
    await screen.findByText("Offline Synced");

    clickDeleteAndConfirm();

    expect(await screen.findByRole("alert")).toHaveTextContent(/you're offline/i);
    expect(surveyApi.deleteSurvey).not.toHaveBeenCalled();
    expect(await surveyPersistence.getSurvey(survey.id)).toBeDefined();
  });

  it("disables the Delete button while the survey is mid-sync", async () => {
    const survey = makeLocalSurvey({ name: "Mid Sync" });
    await surveyPersistence.saveSurvey(survey);
    await surveyPersistence.updateSyncState(survey.id, { syncStatus: "syncing" });

    renderAtSurvey(survey.id);
    await screen.findByText("Mid Sync");

    expect(screen.getByRole("button", { name: "Delete Survey" })).toBeDisabled();
  });
});

describe("SurveyDetailsPage capture timestamp", () => {
  const CAPTURED_AT = "2026-08-18T10:00:00.000Z";
  const CREATED_AT = "2026-08-21T15:00:00.000Z";

  function serverSurvey(overrides: Partial<Survey> = {}): Survey {
    return {
      id: generateUuid(),
      user: 1,
      name: "Server Survey",
      description: "",
      image: "http://example.com/i.jpg",
      latitude: 31.5,
      longitude: 74.3,
      accuracy: 10,
      attributes: {},
      sync_status: "synced",
      retry_count: 0,
      captured_at: CAPTURED_AT,
      created_at: CREATED_AT,
      updated_at: CREATED_AT,
      ...overrides,
    };
  }

  it("shows when the survey was captured, not when it reached the server", async () => {
    const survey = serverSurvey();
    vi.mocked(surveyApi.getSurvey).mockResolvedValueOnce(survey);

    renderAtSurvey(survey.id);
    await screen.findByText("Server Survey");

    const expected = new Date(CAPTURED_AT).toLocaleString();
    expect(screen.getByText(expected)).toBeInTheDocument();
    expect(screen.queryByText(new Date(CREATED_AT).toLocaleString())).not.toBeInTheDocument();
  });

  it("falls back to created_at for records stored before capture time existed", async () => {
    // Legacy rows have captured_at = NULL; without the fallback this rendered
    // "Invalid Date".
    const survey = serverSurvey({ captured_at: null });
    vi.mocked(surveyApi.getSurvey).mockResolvedValueOnce(survey);

    renderAtSurvey(survey.id);
    await screen.findByText("Server Survey");

    expect(screen.getByText(new Date(CREATED_AT).toLocaleString())).toBeInTheDocument();
    expect(screen.queryByText(/invalid date/i)).not.toBeInTheDocument();
  });

  it("shows a local record's own capture time, which needs no fallback", async () => {
    const survey = makeLocalSurvey({ name: "Local Capture", createdAt: CAPTURED_AT });
    await surveyPersistence.saveSurvey(survey);

    renderAtSurvey(survey.id);
    await screen.findByText("Local Capture");

    expect(screen.getByText(new Date(CAPTURED_AT).toLocaleString())).toBeInTheDocument();
  });
});
