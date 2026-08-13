import { useEffect } from "react";
import { useAuth } from "../auth/AuthContext";
import { runSync } from "../services/syncEngine";

// Wired at the App level (see App.tsx) as a sibling of the page routes, not
// inside NewSurveyPage or any capture component - the capture flow never
// triggers this itself and stays independent of network/sync state.
//
// Syncing requires auth, so both triggers are scoped to isAuthenticated
// rather than firing on every app boot regardless of session state - an
// unauthenticated attempt would just immediately hit 401s for no benefit.
export function useSyncEngineLifecycle(): void {
  const { isAuthenticated } = useAuth();

  // Trigger A: application start/initialization - only if already online.
  useEffect(() => {
    if (!isAuthenticated) return;
    if (navigator.onLine) {
      void runSync();
    }
  }, [isAuthenticated]);

  // Trigger B: the browser regains connectivity.
  useEffect(() => {
    if (!isAuthenticated) return;

    function handleOnline() {
      void runSync();
    }

    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, [isAuthenticated]);
}
