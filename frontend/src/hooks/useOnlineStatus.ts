import { useEffect, useState } from "react";

export type ConnectivityState = "online" | "offline" | "reconnected";

// Tracks browser connectivity purely for display. Deliberately separate from
// the sync engine's own online handling (services/syncEngine.ts,
// hooks/useSyncEngineLifecycle.ts) - this hook doesn't trigger a sync, it
// just reflects state, so the engine's triggers stay untouched.
//
// "reconnected" is a short-lived third state (not just online/offline) so
// the Dashboard can show a brief "Back online" confirmation instead of the
// offline banner vanishing with no acknowledgement. A fixed timeout clears
// it rather than waiting on a specific sync event, so the banner still
// resolves even when nothing was queued to sync in the first place.
export function useOnlineStatus(): ConnectivityState {
  const [state, setState] = useState<ConnectivityState>(() => (navigator.onLine ? "online" : "offline"));

  useEffect(() => {
    let reconnectTimeout: ReturnType<typeof setTimeout> | undefined;

    function handleOffline() {
      clearTimeout(reconnectTimeout);
      setState("offline");
    }

    function handleOnline() {
      setState("reconnected");
      reconnectTimeout = setTimeout(() => setState("online"), 4000);
    }

    // Best-effort self-heal for the iOS Safari case where "online"/"offline"
    // silently fail to fire after some reconnects: visibilitychange fires
    // reliably when the surveyor returns to the app, so re-reading
    // navigator.onLine here can catch a banner stuck showing "Offline" even
    // though the underlying property has since corrected itself. Not a full
    // fix - the property itself can still be wrong - but this is
    // display-only now (nothing functional depends on it; see
    // useSyncEngineLifecycle.ts), so a best-effort correction is the right
    // amount of engineering for it.
    function handleVisibilityChange() {
      if (document.visibilityState !== "visible" || !navigator.onLine) return;
      setState((current) => {
        if (current !== "offline") return current;
        reconnectTimeout = setTimeout(() => setState("online"), 4000);
        return "reconnected";
      });
    }

    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      clearTimeout(reconnectTimeout);
    };
  }, []);

  return state;
}
