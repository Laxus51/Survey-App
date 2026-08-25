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

    window.addEventListener("offline", handleOffline);
    window.addEventListener("online", handleOnline);
    return () => {
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("online", handleOnline);
      clearTimeout(reconnectTimeout);
    };
  }, []);

  return state;
}
