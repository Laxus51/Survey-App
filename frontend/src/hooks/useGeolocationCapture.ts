import { useCallback, useRef, useState } from "react";

export type GeolocationCaptureStatus = "idle" | "locating" | "success" | "error";

// Two-stage capture. Stage 1 asks for a true GPS fix; stage 2 (below) drops
// enableHighAccuracy and accepts a recent cached position, which lets the
// device fall back to Wi-Fi/cell-tower positioning.
//
// Both stages are needed because the two matter differently per device: a
// laptop has no GPS chip, so it ignores enableHighAccuracy and resolves via
// Wi-Fi in seconds - while a phone honours it, waits on satellites, and
// indoors (or with a poor sky view) never gets a fix at all. Stage 1 alone
// is therefore precisely the configuration that works on a laptop and hangs
// on the phone this app is actually built for.
//
// A fallback fix is genuinely useful here rather than a silent downgrade:
// its (much larger) accuracy radius is captured in the survey's own
// `accuracy` field and shown in the UI, so the reading stays honest - and a
// ±500m survey the surveyor can actually save beats a ±5m one they can't.
const PRIMARY_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  timeout: 10000,
  maximumAge: 0,
};

const FALLBACK_OPTIONS: PositionOptions = {
  enableHighAccuracy: false,
  timeout: 12000,
  // Accept a fix up to 5 minutes old: the surveyor hasn't meaningfully moved
  // while standing at the feature they're photographing, and reusing the
  // device's last fix is usually instant where a fresh one may be impossible.
  maximumAge: 300000,
};

// Safety net covering BOTH stages (10s + 12s, plus slack): some mobile
// browsers don't reliably honor PositionOptions.timeout when
// enableHighAccuracy can't get a GPS fix - a known source of a permanently
// stuck "Getting your location..." with no way out, since the UI only
// offers Retry once status is "error".
const WATCHDOG_TIMEOUT_MS = 30000;

export interface GeolocationCaptureState {
  status: GeolocationCaptureStatus;
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  errorMessage: string | null;
  // True once the high-accuracy attempt has failed and the less precise
  // fallback is in flight, so the UI can explain the extra wait.
  isUsingFallback: boolean;
  // True while the browser is (or may be) showing its permission prompt, so
  // the UI can tell the surveyor to answer it rather than just spin.
  isAwaitingPermission: boolean;
  requestLocation: () => void;
}

// getCurrentPosition gives no signal at all while its permission prompt sits
// unanswered - and per spec the PositionOptions.timeout clock doesn't even
// start until permission is granted, so a dismissed/suppressed prompt hangs
// the request indefinitely with neither callback ever firing. The
// Permissions API is the only way to see that state up front. It's advisory:
// not every browser exposes "geolocation" through it, so a missing or
// failing query must never block the actual request.
async function queryPermissionState(): Promise<PermissionState | null> {
  try {
    const permissions = navigator.permissions;
    if (!permissions?.query) return null;
    const result = await permissions.query({ name: "geolocation" as PermissionName });
    return result.state;
  } catch {
    return null;
  }
}

function describeGeolocationError(error: GeolocationPositionError): string {
  switch (error.code) {
    case error.PERMISSION_DENIED:
      return "Location permission was denied. Enable location access for this site and try again.";
    case error.POSITION_UNAVAILABLE:
      return "Your device could not determine its current location. This can happen regardless of internet connectivity - try again, or try a different spot.";
    case error.TIMEOUT:
      return "Getting your location took too long. This can happen regardless of internet connectivity - try again, or try a different spot.";
    default:
      return "Could not get your location.";
  }
}

// Exposes a single imperative requestLocation() rather than fetching on
// mount: the capture flow must trigger this itself, immediately after (and
// only after) an image has been captured - not before, and not repeatedly.
export function useGeolocationCapture(): GeolocationCaptureState {
  const [status, setStatus] = useState<GeolocationCaptureStatus>("idle");
  const [latitude, setLatitude] = useState<number | null>(null);
  const [longitude, setLongitude] = useState<number | null>(null);
  const [accuracy, setAccuracy] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isUsingFallback, setIsUsingFallback] = useState(false);
  const [isAwaitingPermission, setIsAwaitingPermission] = useState(false);
  // Incremented on every requestLocation() call so a watchdog or geolocation
  // callback from a superseded request (e.g. the browser's own timeout never
  // fired, then the surveyor hit Retry) can't clobber a newer one's state.
  const requestIdRef = useRef(0);
  // Read by the watchdog to explain the right cause: an unanswered permission
  // prompt and a silent GPS look identical from getCurrentPosition's side.
  const awaitingPermissionRef = useRef(false);

  const requestLocation = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setStatus("error");
      setErrorMessage("Geolocation is not supported on this device or browser.");
      return;
    }

    const requestId = ++requestIdRef.current;
    setStatus("locating");
    setErrorMessage(null);
    setIsUsingFallback(false);
    setIsAwaitingPermission(false);
    awaitingPermissionRef.current = false;

    const isStale = () => requestIdRef.current !== requestId;

    const watchdog = setTimeout(() => {
      if (isStale()) return;
      // Bump the generation so a late success/error from a getCurrentPosition
      // call still in flight (there is no cancel API) can't silently
      // overwrite the error already shown - only a fresh requestLocation()
      // call (i.e. the surveyor hitting Retry) should be able to do that.
      requestIdRef.current += 1;
      setStatus("error");
      setErrorMessage(
        awaitingPermissionRef.current
          ? "Still waiting for location permission. Look for your browser's location prompt and tap Allow - if you don't see one, location may be blocked for this site in your browser settings."
          : "Getting your location is taking much longer than expected. This can happen regardless of internet connectivity - try again, or try a different spot.",
      );
    }, WATCHDOG_TIMEOUT_MS);

    const settle = () => {
      clearTimeout(watchdog);
      setIsAwaitingPermission(false);
      awaitingPermissionRef.current = false;
    };

    const handleSuccess = (position: GeolocationPosition) => {
      if (isStale()) return;
      settle();
      setLatitude(position.coords.latitude);
      setLongitude(position.coords.longitude);
      setAccuracy(position.coords.accuracy);
      setStatus("success");
    };

    const handleFinalError = (error: GeolocationPositionError) => {
      if (isStale()) return;
      settle();
      setStatus("error");
      setErrorMessage(describeGeolocationError(error));
    };

    const handlePrimaryError = (error: GeolocationPositionError) => {
      if (isStale()) return;
      // A denied permission is a decision, not a precision problem - the
      // fallback would fail identically while re-prompting the surveyor.
      if (error.code === error.PERMISSION_DENIED) {
        handleFinalError(error);
        return;
      }
      setIsUsingFallback(true);
      navigator.geolocation.getCurrentPosition(handleSuccess, handleFinalError, FALLBACK_OPTIONS);
    };

    const startCapture = () => {
      navigator.geolocation.getCurrentPosition(handleSuccess, handlePrimaryError, PRIMARY_OPTIONS);
    };

    // Fire the permission check and the position request together rather than
    // awaiting the former: the check is advisory, and delaying the actual
    // request behind it would cost every surveyor a round-trip on the common
    // path where permission is already granted.
    startCapture();

    void queryPermissionState().then((state) => {
      if (isStale() || state === null) return;
      if (state === "denied") {
        // getCurrentPosition should reject with PERMISSION_DENIED here, but
        // on some mobile browsers a blocked-and-suppressed prompt means it
        // never calls back at all - this turns that 30s hang into an
        // immediate, actionable message.
        settle();
        setStatus("error");
        setErrorMessage(
          "Location is blocked for this site in your browser settings. Allow location for this site, then try again.",
        );
        return;
      }
      if (state === "prompt") {
        setIsAwaitingPermission(true);
        awaitingPermissionRef.current = true;
      }
    });
  }, []);

  return {
    status,
    latitude,
    longitude,
    accuracy,
    errorMessage,
    isUsingFallback,
    isAwaitingPermission,
    requestLocation,
  };
}
