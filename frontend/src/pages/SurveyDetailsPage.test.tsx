import { render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { closeDatabaseForTests } from "../services/indexedDbClient";
import { surveyPersistence } from "../services/surveyPersistence";
import type { LocalSurvey } from "../types/localSurvey";
import { generateUuid } from "../utils/uuid";
import { SurveyDetailsPage } from "./SurveyDetailsPage";

vi.mock("../services/surveyApi", () => ({
  getSurvey: vi.fn().mockRejectedValue(new Error("server API should not be called for a local-only survey")),
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
});

afterEach(async () => {
  await closeDatabaseForTests();
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
});
