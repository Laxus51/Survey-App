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

  it("does not attempt sync on mount when offline", () => {
    setOnline(false);
    renderHook(() => useSyncEngineLifecycle());

    expect(runSyncMock).not.toHaveBeenCalled();
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
});
