import { render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDatabaseForTests } from "../services/indexedDbClient";
import { surveyPersistence } from "../services/surveyPersistence";
import type { LocalSurvey } from "../types/localSurvey";
import { generateUuid } from "../utils/uuid";
import { DashboardPage } from "./DashboardPage";

vi.mock("../auth/AuthContext", () => ({
  useAuth: () => ({ user: { username: "surveyor1" }, logout: vi.fn() }),
}));

vi.mock("../services/surveyApi", () => ({
  listSurveys: vi.fn().mockResolvedValue({ count: 0, next: null, previous: null, results: [] }),
}));

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
  // DashboardPage imports the persistence singleton directly (no
  // resetModules here, unlike surveyPersistence.test.ts), so its IndexedDB
  // connection stays open across tests in this file unless explicitly
  // closed - otherwise deleteDatabase below just blocks (onblocked) without
  // actually clearing data, leaking the previous test's records forward.
  await closeDatabaseForTests();
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase("SurveyApp");
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () => resolve();
  });
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
});
