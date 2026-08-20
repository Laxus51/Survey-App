import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../services/httpClient";
import * as tokenStore from "../services/tokenStore";
import type { User } from "../types/auth";

vi.mock("../services/authApi", () => ({
  refresh: vi.fn(),
  me: vi.fn(),
  login: vi.fn(),
  logout: vi.fn(),
}));

import * as authApi from "../services/authApi";
import { AuthProvider, useAuth } from "./AuthContext";

const USER: User = {
  id: 7,
  username: "surveyor",
  email: "surveyor@example.com",
  first_name: "",
  last_name: "",
  date_joined: "2026-01-01T00:00:00Z",
};

function Probe() {
  const { user, isInitializing, isSessionPersistent, login } = useAuth();
  if (isInitializing) return <p>initializing</p>;
  return (
    <div>
      <p>{user ? `signed in: ${user.username}` : "signed out"}</p>
      <p>{isSessionPersistent ? "session persistent" : "session memory-only"}</p>
      <button type="button" onClick={() => void login("surveyor", "pw").catch(() => {})}>
        do login
      </button>
    </div>
  );
}

function renderApp() {
  return render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
}

beforeEach(() => {
  localStorage.clear();
  vi.mocked(authApi.refresh).mockReset();
  vi.mocked(authApi.me).mockReset();
  vi.mocked(authApi.login).mockReset();
});

afterEach(() => {
  localStorage.clear();
});

describe("AuthProvider session restore", () => {
  it("keeps the surveyor signed in when the refresh call fails from being offline", async () => {
    // The real field scenario: reopening the app with no signal. Previously
    // a bare catch cleared the refresh token here, signing the surveyor out
    // and - since login needs the network - locking them out of the offline
    // data already on their device.
    tokenStore.setRefreshToken("valid-refresh-token");
    tokenStore.setCachedUser(USER);
    vi.mocked(authApi.refresh).mockRejectedValue(new TypeError("Failed to fetch"));

    renderApp();

    expect(await screen.findByText("signed in: surveyor")).toBeInTheDocument();
    // The still-valid token must survive so it can be redeemed once back online.
    expect(tokenStore.getRefreshToken()).toBe("valid-refresh-token");
  });

  it("signs the surveyor out when the server actually rejects the refresh token", async () => {
    tokenStore.setRefreshToken("expired-refresh-token");
    tokenStore.setCachedUser(USER);
    vi.mocked(authApi.refresh).mockRejectedValue(new ApiError(401, { detail: "token invalid" }));

    renderApp();

    expect(await screen.findByText("signed out")).toBeInTheDocument();
    expect(tokenStore.getRefreshToken()).toBeNull();
    expect(tokenStore.getCachedUser()).toBeNull();
  });

  it("stays signed out offline when there is no cached profile to restore", async () => {
    tokenStore.setRefreshToken("valid-refresh-token");
    vi.mocked(authApi.refresh).mockRejectedValue(new TypeError("Failed to fetch"));

    renderApp();

    expect(await screen.findByText("signed out")).toBeInTheDocument();
    // Still not destroyed - a later online start can redeem it.
    expect(tokenStore.getRefreshToken()).toBe("valid-refresh-token");
  });

  it("still signs in when the browser refuses to persist the session", async () => {
    // Matches the observed phone failure: the server returns 200 for
    // /api/auth/login, but localStorage.setItem throws (private browsing /
    // blocked site data / full quota), which used to abort login() before it
    // ever called /api/auth/me - surfacing as a bare "Something went wrong".
    vi.mocked(authApi.refresh).mockRejectedValue(new TypeError("no token"));
    vi.mocked(authApi.login).mockResolvedValue({ access: "a", refresh: "r" });
    vi.mocked(authApi.me).mockResolvedValue(USER);
    const setItem = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("exceeded the quota", "QuotaExceededError");
    });

    renderApp();
    await screen.findByText("signed out");
    screen.getByRole("button", { name: "do login" }).click();

    expect(await screen.findByText("signed in: surveyor")).toBeInTheDocument();
    expect(screen.getByText("session memory-only")).toBeInTheDocument();
    setItem.mockRestore();
  });

  it("reports a persistent session when storage works", async () => {
    vi.mocked(authApi.refresh).mockRejectedValue(new TypeError("no token"));
    vi.mocked(authApi.login).mockResolvedValue({ access: "a", refresh: "r" });
    vi.mocked(authApi.me).mockResolvedValue(USER);

    renderApp();
    await screen.findByText("signed out");
    screen.getByRole("button", { name: "do login" }).click();

    expect(await screen.findByText("signed in: surveyor")).toBeInTheDocument();
    expect(screen.getByText("session persistent")).toBeInTheDocument();
  });

  it("restores normally and refreshes the cached profile when online", async () => {
    tokenStore.setRefreshToken("valid-refresh-token");
    vi.mocked(authApi.refresh).mockResolvedValue({ access: "a", refresh: "r2" });
    vi.mocked(authApi.me).mockResolvedValue(USER);

    renderApp();

    expect(await screen.findByText("signed in: surveyor")).toBeInTheDocument();
    await waitFor(() => expect(tokenStore.getRefreshToken()).toBe("r2"));
    expect(tokenStore.getCachedUser()?.username).toBe("surveyor");
  });
});
