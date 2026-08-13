import { useCallback, useState } from "react";

export type GeolocationCaptureStatus = "idle" | "locating" | "success" | "error";

export interface GeolocationCaptureState {
  status: GeolocationCaptureStatus;
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  errorMessage: string | null;
  requestLocation: () => void;
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

  const requestLocation = useCallback(() => {
    if (!("geolocation" in navigator)) {
      setStatus("error");
      setErrorMessage("Geolocation is not supported on this device or browser.");
      return;
    }

    setStatus("locating");
    setErrorMessage(null);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLatitude(position.coords.latitude);
        setLongitude(position.coords.longitude);
        setAccuracy(position.coords.accuracy);
        setStatus("success");
      },
      (error) => {
        setStatus("error");
        setErrorMessage(describeGeolocationError(error));
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  }, []);

  return { status, latitude, longitude, accuracy, errorMessage, requestLocation };
}
