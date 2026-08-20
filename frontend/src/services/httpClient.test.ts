import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Other suites mock surveyApi, so httpClient's URL building never runs under
// test; here it does, and VITE_API_BASE_URL is unset in the test environment.
vi.mock("../config/env", () => ({ API_BASE_URL: "http://localhost:8000" }));

import { authorizedRequest } from "./httpClient";
import * as tokenStore from "./tokenStore";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  localStorage.clear();
  tokenStore.setAccessToken(null);
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  tokenStore.setAccessToken(null);
});

describe("authorizedRequest token handling", () => {
  it("refreshes before sending when no access token is held, instead of uploading to a guaranteed 401", async () => {
    // The access token is memory-only, so this is the state after every
    // reload. Previously the request went out unauthenticated, so a survey
    // upload sent the whole photo just to be told to authenticate - then sent
    // it all over again after refreshing.
    tokenStore.setRefreshToken("valid-refresh");
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (url.includes("/api/auth/refresh")) {
        return Promise.resolve(jsonResponse(200, { access: "fresh-access", refresh: "rotated" }));
      }
      return Promise.resolve(jsonResponse(201, { ok: true }));
    });

    await authorizedRequest("/api/surveys/sync/", { method: "POST", body: new FormData() });

    const calls = fetchSpy.mock.calls.map((c) => String(c[0]));
    expect(calls[0]).toContain("/api/auth/refresh");
    // Exactly one upload, and it carried the freshly obtained token.
    const uploads = calls.filter((u) => u.includes("/api/surveys/sync/"));
    expect(uploads).toHaveLength(1);
    const uploadInit = fetchSpy.mock.calls.find((c) => String(c[0]).includes("sync"))![1]!;
    expect(new Headers(uploadInit.headers).get("Authorization")).toBe("Bearer fresh-access");
  });

  it("sends straight away when an access token is already held", async () => {
    tokenStore.setRefreshToken("valid-refresh");
    tokenStore.setAccessToken("current-access");
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse(200, { ok: true }));

    await authorizedRequest("/api/surveys/");

    const calls = fetchSpy.mock.calls.map((c) => String(c[0]));
    expect(calls).toHaveLength(1);
    expect(calls[0]).not.toContain("/api/auth/refresh");
  });

  it("does not attempt a refresh when there is no refresh token either", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse(401, { detail: "no credentials" }));

    await expect(authorizedRequest("/api/surveys/")).rejects.toThrow();

    const calls = fetchSpy.mock.calls.map((c) => String(c[0]));
    expect(calls.some((u) => u.includes("/api/auth/refresh"))).toBe(false);
  });

  it("still refreshes and retries once when a held token turns out to be expired", async () => {
    tokenStore.setRefreshToken("valid-refresh");
    tokenStore.setAccessToken("stale-access");
    let syncCalls = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input);
      if (url.includes("/api/auth/refresh")) {
        return Promise.resolve(jsonResponse(200, { access: "fresh-access", refresh: "rotated" }));
      }
      syncCalls += 1;
      return Promise.resolve(syncCalls === 1 ? jsonResponse(401, {}) : jsonResponse(200, { ok: true }));
    });

    await authorizedRequest("/api/surveys/");

    expect(syncCalls).toBe(2);
  });
});
