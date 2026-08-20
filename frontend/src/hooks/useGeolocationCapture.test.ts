import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useGeolocationCapture } from "./useGeolocationCapture";

type SuccessCallback = (position: GeolocationPosition) => void;
type ErrorCallback = (error: GeolocationPositionError) => void;
type GetCurrentPosition = (
  success: SuccessCallback,
  error?: ErrorCallback,
  options?: PositionOptions,
) => void;

function makePosition(latitude: number, longitude: number, accuracy: number): GeolocationPosition {
  return {
    coords: {
      latitude,
      longitude,
      accuracy,
      altitude: null,
      altitudeAccuracy: null,
      heading: null,
      speed: null,
    },
    timestamp: Date.now(),
  } as GeolocationPosition;
}

function makeError(code: number): GeolocationPositionError {
  return {
    code,
    message: "",
    PERMISSION_DENIED: 1,
    POSITION_UNAVAILABLE: 2,
    TIMEOUT: 3,
  } as GeolocationPositionError;
}

function stubGeolocation(getCurrentPosition: GetCurrentPosition) {
  Object.defineProperty(navigator, "geolocation", {
    value: { getCurrentPosition },
    configurable: true,
  });
}

// Removes the property entirely (not just sets it to undefined) so
// `"geolocation" in navigator` - what the hook actually checks - is false.
function removeGeolocation() {
  delete (navigator as { geolocation?: unknown }).geolocation;
}

function stubPermissions(state: PermissionState | null) {
  if (state === null) {
    delete (navigator as { permissions?: unknown }).permissions;
    return;
  }
  Object.defineProperty(navigator, "permissions", {
    value: { query: () => Promise.resolve({ state }) },
    configurable: true,
  });
}

beforeEach(() => {
  removeGeolocation();
  // Default to the "browser doesn't expose geolocation via the Permissions
  // API" case, so existing tests exercise the plain getCurrentPosition path.
  stubPermissions(null);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useGeolocationCapture", () => {
  it("passes latitude, longitude, and accuracy through unchanged on success", async () => {
    stubGeolocation((success) => success(makePosition(33.6844, 73.0479, 12.5)));

    const { result } = renderHook(() => useGeolocationCapture());
    act(() => result.current.requestLocation());

    await waitFor(() => expect(result.current.status).toBe("success"));
    expect(result.current.latitude).toBe(33.6844);
    expect(result.current.longitude).toBe(73.0479);
    expect(result.current.accuracy).toBe(12.5);
    expect(result.current.errorMessage).toBeNull();
  });

  it("reports TIMEOUT without implying internet connectivity is required", async () => {
    stubGeolocation((_success, error) => error!(makeError(3)));

    const { result } = renderHook(() => useGeolocationCapture());
    act(() => result.current.requestLocation());

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.errorMessage).toMatch(/took too long/i);
    // "Internet" may appear, but only to reassure the reader it ISN'T
    // required - the message must not suggest connectivity is needed.
    expect(result.current.errorMessage).not.toMatch(/reconnect|go online|check your (internet|wifi|connection)/i);
    expect(result.current.errorMessage).toMatch(/regardless of internet connectivity/i);
  });

  it("reports POSITION_UNAVAILABLE without claiming GPS specifically is unavailable", async () => {
    stubGeolocation((_success, error) => error!(makeError(2)));

    const { result } = renderHook(() => useGeolocationCapture());
    act(() => result.current.requestLocation());

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.errorMessage).toMatch(/could not determine/i);
    expect(result.current.errorMessage).not.toMatch(/\bgps\b/i);
    expect(result.current.errorMessage).toMatch(/regardless of internet connectivity/i);
  });

  it("reports PERMISSION_DENIED clearly", async () => {
    stubGeolocation((_success, error) => error!(makeError(1)));

    const { result } = renderHook(() => useGeolocationCapture());
    act(() => result.current.requestLocation());

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.errorMessage).toMatch(/permission/i);
  });

  it("falls back to a low-accuracy fix when the high-accuracy attempt fails", async () => {
    // Reproduces the real phone-vs-laptop failure: a device with GPS honours
    // enableHighAccuracy and never gets a satellite fix indoors, where a
    // laptop (no GPS chip) would have resolved via Wi-Fi immediately.
    const optionsSeen: PositionOptions[] = [];
    stubGeolocation((success, error, options) => {
      optionsSeen.push(options!);
      if (options!.enableHighAccuracy) {
        error!(makeError(3));
        return;
      }
      success(makePosition(31.5, 74.3, 850));
    });

    const { result } = renderHook(() => useGeolocationCapture());
    act(() => result.current.requestLocation());

    await waitFor(() => expect(result.current.status).toBe("success"));
    expect(optionsSeen).toHaveLength(2);
    expect(optionsSeen[0].enableHighAccuracy).toBe(true);
    expect(optionsSeen[0].maximumAge).toBe(0);
    expect(optionsSeen[1].enableHighAccuracy).toBe(false);
    // The fallback must accept a recent cached fix - refusing one is what
    // makes an indoor phone unable to resolve at all.
    expect(optionsSeen[1].maximumAge).toBeGreaterThan(0);
    // The degraded accuracy is reported honestly rather than hidden.
    expect(result.current.accuracy).toBe(850);
    expect(result.current.errorMessage).toBeNull();
  });

  it("flags the fallback attempt while it is in flight so the UI can explain the wait", async () => {
    let deliverFallbackSuccess: (() => void) | undefined;
    stubGeolocation((success, error, options) => {
      if (options!.enableHighAccuracy) {
        error!(makeError(2));
        return;
      }
      deliverFallbackSuccess = () => success(makePosition(1, 2, 400));
    });

    const { result } = renderHook(() => useGeolocationCapture());
    act(() => result.current.requestLocation());

    await waitFor(() => expect(result.current.isUsingFallback).toBe(true));
    expect(result.current.status).toBe("locating");

    act(() => deliverFallbackSuccess!());
    await waitFor(() => expect(result.current.status).toBe("success"));
  });

  it("does not attempt the fallback when permission was denied", async () => {
    let callCount = 0;
    stubGeolocation((_success, error) => {
      callCount += 1;
      error!(makeError(1));
    });

    const { result } = renderHook(() => useGeolocationCapture());
    act(() => result.current.requestLocation());

    await waitFor(() => expect(result.current.status).toBe("error"));
    // Retrying with different options cannot fix a denied permission, and
    // would only re-prompt the surveyor.
    expect(callCount).toBe(1);
    expect(result.current.isUsingFallback).toBe(false);
    expect(result.current.errorMessage).toMatch(/permission/i);
  });

  it("clears the fallback flag when a later request starts fresh", async () => {
    let attempt = 0;
    stubGeolocation((success, error, options) => {
      attempt += 1;
      if (attempt <= 2) {
        error!(makeError(3));
        return;
      }
      if (options!.enableHighAccuracy) success(makePosition(9, 9, 5));
    });

    const { result } = renderHook(() => useGeolocationCapture());
    act(() => result.current.requestLocation());
    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.isUsingFallback).toBe(true);

    act(() => result.current.requestLocation());

    await waitFor(() => expect(result.current.status).toBe("success"));
    expect(result.current.isUsingFallback).toBe(false);
  });

  it("reports blocked permission immediately instead of hanging until the watchdog", async () => {
    // The real phone failure: permission is blocked and the prompt is
    // suppressed, so getCurrentPosition never calls back at all - without
    // the Permissions API check this would spin for the full watchdog.
    stubPermissions("denied");
    stubGeolocation(() => {});

    const { result } = renderHook(() => useGeolocationCapture());
    act(() => result.current.requestLocation());

    await waitFor(() => expect(result.current.status).toBe("error"));
    expect(result.current.errorMessage).toMatch(/blocked for this site/i);
  });

  it("flags that it is waiting on the permission prompt", async () => {
    stubPermissions("prompt");
    stubGeolocation(() => {});

    const { result } = renderHook(() => useGeolocationCapture());
    act(() => result.current.requestLocation());

    await waitFor(() => expect(result.current.isAwaitingPermission).toBe(true));
    expect(result.current.status).toBe("locating");
  });

  it("explains an unanswered permission prompt when the watchdog fires", async () => {
    // Fake timers must be installed before requestLocation(), or the
    // watchdog's setTimeout is scheduled on the real clock and advancing
    // fake time never fires it.
    vi.useFakeTimers();
    stubPermissions("prompt");
    stubGeolocation(() => {});

    const { result } = renderHook(() => useGeolocationCapture());
    act(() => result.current.requestLocation());

    // Let the (async) permission query resolve so the prompt state is known.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.isAwaitingPermission).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30000);
    });

    expect(result.current.status).toBe("error");
    expect(result.current.errorMessage).toMatch(/waiting for location permission/i);
  });

  it("proceeds normally when permission is already granted", async () => {
    stubPermissions("granted");
    stubGeolocation((success) => success(makePosition(10, 20, 6)));

    const { result } = renderHook(() => useGeolocationCapture());
    act(() => result.current.requestLocation());

    await waitFor(() => expect(result.current.status).toBe("success"));
    expect(result.current.isAwaitingPermission).toBe(false);
    expect(result.current.accuracy).toBe(6);
  });

  it("still works when the Permissions API rejects or is unavailable", async () => {
    Object.defineProperty(navigator, "permissions", {
      value: { query: () => Promise.reject(new Error("unsupported name")) },
      configurable: true,
    });
    stubGeolocation((success) => success(makePosition(4, 5, 9)));

    const { result } = renderHook(() => useGeolocationCapture());
    act(() => result.current.requestLocation());

    await waitFor(() => expect(result.current.status).toBe("success"));
    expect(result.current.latitude).toBe(4);
  });

  it("reports geolocation as unsupported when absent from navigator", () => {
    removeGeolocation();
    const { result } = renderHook(() => useGeolocationCapture());

    act(() => result.current.requestLocation());

    expect(result.current.status).toBe("error");
    expect(result.current.errorMessage).toMatch(/not supported/i);
  });

  it("retries after an error: transitions back into locating, then can succeed", async () => {
    // A failed request now means BOTH stages failed (high accuracy, then the
    // fallback), so the surveyor's Retry starts a third attempt.
    let attempt = 0;
    let resolveRetry: (() => void) | undefined;
    stubGeolocation((success, error) => {
      attempt += 1;
      if (attempt <= 2) {
        error!(makeError(3));
        return;
      }
      // Resolved asynchronously (not immediately, unlike the failed attempts)
      // so the intermediate "locating" state is actually observable, rather
      // than "locating" and "success" landing in the same batch.
      resolveRetry = () => success(makePosition(1.5, 2.5, 8));
    });

    const { result } = renderHook(() => useGeolocationCapture());
    act(() => result.current.requestLocation());
    await waitFor(() => expect(result.current.status).toBe("error"));

    act(() => result.current.requestLocation());
    await waitFor(() => expect(result.current.status).toBe("locating"));
    expect(result.current.errorMessage).toBeNull();

    act(() => resolveRetry!());
    await waitFor(() => expect(result.current.status).toBe("success"));
    expect(result.current.latitude).toBe(1.5);
    expect(result.current.longitude).toBe(2.5);
    expect(result.current.accuracy).toBe(8);
  });

  it("falls back to an error after ~30s if the browser never calls back at all", async () => {
    vi.useFakeTimers();
    // Simulates a browser that doesn't honor PositionOptions.timeout when
    // enableHighAccuracy can't get a GPS fix - neither callback ever fires,
    // so neither stage can complete and only the watchdog can end the wait.
    stubGeolocation(() => {});

    const { result } = renderHook(() => useGeolocationCapture());
    act(() => result.current.requestLocation());
    expect(result.current.status).toBe("locating");

    // Still waiting after the first stage's own timeout would have elapsed.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20000);
    });
    expect(result.current.status).toBe("locating");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10000);
    });

    expect(result.current.status).toBe("error");
    expect(result.current.errorMessage).toMatch(/taking much longer than expected/i);
  });

  it("ignores a success that arrives after the watchdog has already timed it out", async () => {
    vi.useFakeTimers();
    let deliverSuccess: SuccessCallback | undefined;
    stubGeolocation((success) => {
      deliverSuccess = success;
    });

    const { result } = renderHook(() => useGeolocationCapture());
    act(() => result.current.requestLocation());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30000);
    });
    expect(result.current.status).toBe("error");

    act(() => deliverSuccess!(makePosition(1, 2, 3)));

    expect(result.current.status).toBe("error");
    expect(result.current.latitude).toBeNull();
  });

  it("does not fire the watchdog if the request already succeeded", async () => {
    vi.useFakeTimers();
    stubGeolocation((success) => success(makePosition(5, 6, 7)));

    const { result } = renderHook(() => useGeolocationCapture());
    act(() => result.current.requestLocation());
    expect(result.current.status).toBe("success");

    await act(async () => {
      await vi.advanceTimersByTimeAsync(30000);
    });

    expect(result.current.status).toBe("success");
    expect(result.current.errorMessage).toBeNull();
  });
});
