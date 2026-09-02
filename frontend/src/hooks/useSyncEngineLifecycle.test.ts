import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const runSyncMock = vi.fn().mockResolvedValue(undefined);
vi.mock("../services/syncEngine", () => ({
  runSync: (...args: unknown[]) => runSyncMock(...args),
}));

let mockIsAuthenticated = true;
vi.mock("../auth/AuthContext", () => ({
  useAuth: () => ({ isAuthenticated: mockIsAuthenticated }),
}));

// Imported after the mocks so the mocked modules are what actually get used.
import { useSyncEngineLifecycle } from "./useSyncEngineLifecycle";

function setOnline(value: boolean) {
  Object.defineProperty(navigator, "onLine", { value, configurable: true });
}

beforeEach(() => {
  runSyncMock.mockClear();
  mockIsAuthenticated = true;
  setOnline(true);
});

describe("useSyncEngineLifecycle", () => {
  it("attempts sync on mount when authenticated and online (trigger A)", () => {
    setOnline(true);
    renderHook(() => useSyncEngineLifecycle());

    expect(runSyncMock).toHaveBeenCalledTimes(1);
  });

  it("still attempts sync on mount when navigator.onLine reports false", () => {
    // navigator.onLine is unreliable on iOS Safari - it can report false
    // even when the device is genuinely online. This trigger must not use it
    // as a pre-check that silently skips the attempt (runSync() itself
    // handles a genuine network failure safely).
    setOnline(false);
    renderHook(() => useSyncEngineLifecycle());

    expect(runSyncMock).toHaveBeenCalledTimes(1);
  });

  it("does not attempt sync on mount when not authenticated", () => {
    mockIsAuthenticated = false;
    setOnline(true);
    renderHook(() => useSyncEngineLifecycle());

    expect(runSyncMock).not.toHaveBeenCalled();
  });

  it("triggers sync when the browser comes back online (trigger B)", () => {
    setOnline(true);
    renderHook(() => useSyncEngineLifecycle());
    runSyncMock.mockClear();

    window.dispatchEvent(new Event("online"));

    expect(runSyncMock).toHaveBeenCalledTimes(1);
  });

  it("does not attach the online listener's effect when not authenticated", () => {
    mockIsAuthenticated = false;
    renderHook(() => useSyncEngineLifecycle());
    runSyncMock.mockClear();

    window.dispatchEvent(new Event("online"));

    expect(runSyncMock).not.toHaveBeenCalled();
  });

  it("triggers sync when the page becomes visible again (trigger C)", () => {
    // The actual fix for the case trigger B misses: iOS Safari can fail to
    // fire "online" at all after some reconnects, but visibilitychange
    // fires reliably whenever the surveyor returns to the app.
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    renderHook(() => useSyncEngineLifecycle());
    runSyncMock.mockClear();

    document.dispatchEvent(new Event("visibilitychange"));

    expect(runSyncMock).toHaveBeenCalledTimes(1);
  });

  it("does not trigger sync when the page becomes hidden", () => {
    Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
    renderHook(() => useSyncEngineLifecycle());
    runSyncMock.mockClear();

    document.dispatchEvent(new Event("visibilitychange"));

    expect(runSyncMock).not.toHaveBeenCalled();
  });

  it("does not attach the visibilitychange listener's effect when not authenticated", () => {
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    mockIsAuthenticated = false;
    renderHook(() => useSyncEngineLifecycle());
    runSyncMock.mockClear();

    document.dispatchEvent(new Event("visibilitychange"));

    expect(runSyncMock).not.toHaveBeenCalled();
  });
});
