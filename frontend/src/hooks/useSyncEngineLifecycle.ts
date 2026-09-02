import { useEffect } from "react";
import { useAuth } from "../auth/AuthContext";
import { recoverInterruptedSyncs, runSync } from "../services/syncEngine";

// Wired at the App level (see App.tsx) as a sibling of the page routes, not
// inside NewSurveyPage or any capture component - the capture flow never
// triggers this itself and stays independent of network/sync state.
//
// Syncing requires auth, so all triggers are scoped to isAuthenticated
// rather than firing on every app boot regardless of session state - an
// unauthenticated attempt would just immediately hit 401s for no benefit.
export function useSyncEngineLifecycle(): void {
  const { isAuthenticated } = useAuth();

  // Trigger A: application start/initialization.
  //
  // Recovery runs first: a survey stranded in "syncing" by an interrupted
  // previous session is invisible to every sync trigger until it's reset, so
  // it must be put back in the queue before this start-up run reads it.
  //
  // Not gated on navigator.onLine (previously was): the property is well
  // documented as unreliable on iOS Safari - it can report false even when
  // the device is genuinely online, especially right after a network
  // change - which silently skipped this trigger with no way to recover
  // short of clearing site data. runSync() itself is safe to call
  // unconditionally: a real network failure reverts each record without
  // charging a retry (see syncEngine.ts), so there's no correctness reason
  // to pre-check here, only a (broken, on iOS) optimization.
  useEffect(() => {
    if (!isAuthenticated) return;

    void (async () => {
      try {
        await recoverInterruptedSyncs();
      } catch {
        // Recovery is best-effort - never block the sync run behind it.
      }
      await runSync();
    })();
  }, [isAuthenticated]);

  // Trigger B: the browser reports regaining connectivity.
  useEffect(() => {
    if (!isAuthenticated) return;

    function handleOnline() {
      void runSync();
    }

    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, [isAuthenticated]);

  // Trigger C: the page becomes visible again (foregrounded, unlocked, or
  // switched back to). This is what actually recovers the case Trigger B
  // misses: iOS Safari can fail to fire "online" at all after some
  // reconnects, but visibilitychange fires reliably whenever the surveyor
  // returns to the app - exactly when a missed sync needs retrying. Safe to
  // fire redundantly alongside Trigger B: runSync() already de-dupes
  // concurrent calls into a single in-flight run.
  useEffect(() => {
    if (!isAuthenticated) return;

    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        void runSync();
      }
    }

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [isAuthenticated]);
}
