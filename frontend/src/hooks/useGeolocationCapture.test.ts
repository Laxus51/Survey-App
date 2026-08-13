import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { useGeolocationCapture } from "./useGeolocationCapture";

type SuccessCallback = (position: GeolocationPosition) => void;
type ErrorCallback = (error: GeolocationPositionError) => void;
type GetCurrentPosition = (success: SuccessCallback, error?: ErrorCallback) => void;

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

beforeEach(() => {
  removeGeolocation();
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

  it("reports geolocation as unsupported when absent from navigator", () => {
    removeGeolocation();
    const { result } = renderHook(() => useGeolocationCapture());

    act(() => result.current.requestLocation());

    expect(result.current.status).toBe("error");
    expect(result.current.errorMessage).toMatch(/not supported/i);
  });

  it("retries after an error: transitions back into locating, then can succeed", async () => {
    let attempt = 0;
    let resolveSecondAttempt: (() => void) | undefined;
    stubGeolocation((success, error) => {
      attempt += 1;
      if (attempt === 1) {
        error!(makeError(3));
        return;
      }
      // Resolved asynchronously (not immediately, unlike the first attempt)
      // so the intermediate "locating" state is actually observable, rather
      // than "locating" and "success" landing in the same batch.
      resolveSecondAttempt = () => success(makePosition(1.5, 2.5, 8));
    });

    const { result } = renderHook(() => useGeolocationCapture());
    act(() => result.current.requestLocation());
    await waitFor(() => expect(result.current.status).toBe("error"));

    act(() => result.current.requestLocation());
    await waitFor(() => expect(result.current.status).toBe("locating"));
    expect(result.current.errorMessage).toBeNull();

    act(() => resolveSecondAttempt!());
    await waitFor(() => expect(result.current.status).toBe("success"));
    expect(result.current.latitude).toBe(1.5);
    expect(result.current.longitude).toBe(2.5);
    expect(result.current.accuracy).toBe(8);
  });
});
