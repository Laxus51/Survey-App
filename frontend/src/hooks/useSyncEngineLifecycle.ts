import { useEffect } from "react";
import { useAuth } from "../auth/AuthContext";
import { recoverInterruptedSyncs, runSync } from "../services/syncEngine";

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
  //
  // Recovery runs first, and runs whether online or not: a survey stranded in
  // "syncing" by an interrupted previous session is invisible to every sync
  // trigger until it's reset, so it must be put back in the queue before this
  // start-up run reads it - and while offline, so it's ready for the next one.
  useEffect(() => {
    if (!isAuthenticated) return;

    void (async () => {
      try {
        await recoverInterruptedSyncs();
      } catch {
        // Recovery is best-effort - never block the sync run behind it.
      }
      if (navigator.onLine) {
        await runSync();
      }
    })();
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
