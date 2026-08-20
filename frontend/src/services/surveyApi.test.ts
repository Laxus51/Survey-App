import { afterEach, describe, expect, it, vi } from "vitest";

// surveyApi builds URLs through the http client, and VITE_API_BASE_URL is
// unset in the test environment.
vi.mock("../config/env", () => ({ API_BASE_URL: "http://localhost:8000" }));

import { syncSurvey } from "./surveyApi";
import * as tokenStore from "./tokenStore";
import type { SurveyWritePayload } from "../types/survey";

function basePayload(overrides: Partial<SurveyWritePayload> = {}): SurveyWritePayload {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Utility Pole 12",
    description: "Near the intersection",
    image: new File(["bytes"], "survey.jpg", { type: "image/jpeg" }),
    latitude: 33.6844,
    longitude: 73.0479,
    accuracy: 5.5,
    attributes: {},
    ...overrides,
  };
}

function captureFormData() {
  const sent: FormData[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation((_input, init) => {
    sent.push(init?.body as FormData);
    return Promise.resolve(
      new Response(JSON.stringify({}), { status: 201, headers: { "Content-Type": "application/json" } }),
    );
  });
  return sent;
}

afterEach(() => {
  vi.restoreAllMocks();
  tokenStore.setAccessToken(null);
  localStorage.clear();
});

describe("buildSurveyFormData capture time", () => {
  it("includes captured_at when the payload carries one", async () => {
    tokenStore.setAccessToken("token");
    const sent = captureFormData();

    await syncSurvey(basePayload({ capturedAt: "2026-08-18T10:00:00.000Z" }));

    expect(sent[0].get("captured_at")).toBe("2026-08-18T10:00:00.000Z");
  });

  it("omits captured_at entirely when there is none, rather than sending a blank value", async () => {
    // An empty string would be a malformed datetime and get the whole survey
    // rejected; the field is optional server-side, so absence is correct.
    tokenStore.setAccessToken("token");
    const sent = captureFormData();

    await syncSurvey(basePayload());

    expect(sent[0].has("captured_at")).toBe(false);
  });

  it("still sends the other survey fields unchanged", async () => {
    tokenStore.setAccessToken("token");
    const sent = captureFormData();

    await syncSurvey(basePayload({ capturedAt: "2026-08-18T10:00:00.000Z" }));

    const form = sent[0];
    expect(form.get("name")).toBe("Utility Pole 12");
    expect(form.get("latitude")).toBe("33.6844");
    expect(form.get("longitude")).toBe("73.0479");
    expect(form.get("accuracy")).toBe("5.5");
    // Only presence is asserted: jsdom's FormData does not preserve the Node
    // File instance the test setup shims in (see src/test/setup.ts), and the
    // image's identity/bytes are already covered by the syncEngine tests.
    expect(form.has("image")).toBe(true);
  });
});
