import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertCircle, Camera, LoaderCircle, Plus, RefreshCw, Wifi, WifiOff } from "lucide-react";
import { useAuth } from "../auth/AuthContext";
import { LocalSurveyCard } from "../components/LocalSurveyCard";
import { SyncedSurveyCard } from "../components/SyncedSurveyCard";
import { useOnlineStatus } from "../hooks/useOnlineStatus";
import { ApiError } from "../services/httpClient";
import * as surveyApi from "../services/surveyApi";
import { surveyPersistence } from "../services/surveyPersistence";
import { runSync, subscribe as subscribeToSyncEngine } from "../services/syncEngine";
import type { LocalSurveyRecord } from "../types/localSurveyRecord";
import type { Survey } from "../types/survey";

// How many Pending Sync cards are mounted at once, and how many each "Load
// more" adds. A surveyor who has been offline can queue a hundred or more
// surveys, and every card holds a live object URL for a full-size photo -
// mounting them all at once is a real memory/decode load on the phones this
// app targets. Server-side surveys are already capped by their own
// pagination; this is the local equivalent.
const PENDING_PAGE_SIZE = 20;

export function DashboardPage() {
  const { user, logout, isSessionPersistent } = useAuth();
  const connectivity = useOnlineStatus();

  // Local (IndexedDB) and server surveys are loaded and displayed as two
  // separate sections rather than merged into one list. Now that the sync
  // engine can actually move a local record to "synced", the
  // syncStatus !== "synced" filter below is what keeps it from appearing in
  // both sections at once - a locally-known-synced record is already
  // covered by the server section, so it's excluded here rather than shown
  // twice.
  const [localSurveys, setLocalSurveys] = useState<LocalSurveyRecord[]>([]);
  const [localError, setLocalError] = useState<string | null>(null);
  const [isLoadingLocal, setIsLoadingLocal] = useState(true);
  const [visibleLocalCount, setVisibleLocalCount] = useState(PENDING_PAGE_SIZE);

  const [surveys, setSurveys] = useState<Survey[]>([]);
  const [page, setPage] = useState(1);
  const [hasNext, setHasNext] = useState(false);
  const [hasPrevious, setHasPrevious] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadLocalSurveys = useCallback(async () => {
    setIsLoadingLocal(true);
    setLocalError(null);
    try {
      const records = await surveyPersistence.listSurveys();
      setLocalSurveys(records.filter((record) => record.syncStatus !== "synced"));
      // Reset here rather than on record-changed events: this full read is
      // the only path that introduces records the list didn't already have,
      // so it's also the only point where an expanded view could silently
      // become an expanded view of a brand-new queue.
      setVisibleLocalCount(PENDING_PAGE_SIZE);
    } catch {
      setLocalError("Failed to load locally saved surveys.");
    } finally {
      setIsLoadingLocal(false);
    }
  }, []);

  const loadSurveys = useCallback(async (targetPage: number) => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await surveyApi.listSurveys(targetPage);
      setSurveys(response.results);
      setHasNext(response.next !== null);
      setHasPrevious(response.previous !== null);
    } catch (err) {
      setError(
        err instanceof ApiError ? `Failed to load surveys (${err.status}).` : "Failed to load surveys.",
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadLocalSurveys();
  }, [loadLocalSurveys]);

  useEffect(() => {
    void loadSurveys(page);
  }, [page, loadSurveys]);

  // Mirrors useSyncEngineLifecycle's own `online` listener, which already
  // re-triggers the sync run - this is the equivalent for the server list.
  // Needed because a failed loadSurveys() otherwise has no path back: it
  // isn't retried by a record-changed event (those only patch local state),
  // and a run-finished event only fires again if another sync run happens -
  // which won't, once the pending queue is empty. Observed in the field on
  // iOS Safari: after toggling network connectivity, fetch() to this origin
  // can keep failing at the transport layer (a known WebKit quirk with
  // reusing a stale connection across a network change) even though the
  // exact same origin's static assets load fine and a plain reload doesn't
  // help - only a genuinely new attempt, which the browser's own `online`
  // event is a reasonable signal to make.
  useEffect(() => {
    function handleOnline() {
      void loadSurveys(page);
    }
    window.addEventListener("online", handleOnline);
    return () => window.removeEventListener("online", handleOnline);
  }, [loadSurveys, page]);

  // Same problem, more reliable signal: iOS Safari can fail to fire "online"
  // at all after some reconnects (the flakiness the listener above doesn't
  // fully cover), which otherwise left this list stuck on a stale error with
  // no way to recover short of clearing site data. visibilitychange fires
  // reliably whenever the surveyor returns to the app, regardless of exactly
  // how connectivity came back.
  useEffect(() => {
    function handleVisibilityChange() {
      if (document.visibilityState === "visible") {
        void loadSurveys(page);
      }
    }
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [loadSurveys, page]);

  // Per-record events keep the badges live (pending -> syncing ->
  // synced/failed) by patching the record already in state, rather than
  // re-reading IndexedDB. A run over 100 surveys emits ~200 of these, and
  // answering each with a full listSurveys() meant ~200 complete scans that
  // rebuilt every image Blob from its stored bytes - and, because the reload
  // flipped isLoadingLocal, unmounted and remounted every card, so each
  // survey's object URL was revoked and its image reloaded ~200 times.
  //
  // The event carries what the sync engine just persisted, so this stays a
  // mirror of IndexedDB rather than a second source of truth; the next full
  // load (mount, or the run-finished server refresh) reconciles regardless.
  //
  // The server list is still refreshed once per run, and only when records
  // actually landed there.
  useEffect(() => {
    return subscribeToSyncEngine((event) => {
      if (event.type === "record-changed") {
        setLocalSurveys((current) => {
          const index = current.findIndex((record) => record.id === event.id);
          // Not in the pending list (already synced, saved in another tab, or
          // the initial load hasn't landed yet) - leave the list untouched.
          if (index === -1) return current;

          // Pending Sync deliberately excludes synced records, so a
          // confirmed one leaves this section; the run-finished refresh is
          // what brings it back under Synced Surveys.
          if (event.status === "synced") {
            return current.filter((record) => record.id !== event.id);
          }

          const next = [...current];
          next[index] = {
            ...next[index],
            syncStatus: event.status,
            retryCount: event.retryCount,
            lastError: event.lastError,
          };
          return next;
        });
        return;
      }
      if (event.syncedCount > 0) {
        void loadSurveys(page);
      }
    });
  }, [loadSurveys, page]);

  function handleRetry() {
    void runSync();
  }

  // Slicing (rather than trimming state) keeps every queued record in memory
  // and untouched - only the mounted cards are limited. Records beyond the
  // cut are still synced by the engine, which reads IndexedDB directly and
  // knows nothing about what's on screen.
  const visibleLocalSurveys = localSurveys.slice(0, visibleLocalCount);
  const hiddenLocalCount = localSurveys.length - visibleLocalSurveys.length;

  // The rich empty state (icon + CTA) only makes sense when there is
  // genuinely nothing on the whole page yet - a non-empty Pending Sync
  // section is still useful content, so a plain one-line message is enough
  // there instead of repeating the CTA that's already visible above.
  const showFullEmptyState =
    !isLoadingLocal && !localError && localSurveys.length === 0 && !isLoading && !error && surveys.length === 0;
  const showSyncedOnlyEmptyText = !showFullEmptyState && !isLoading && !error && surveys.length === 0;

  return (
    <div className="min-h-svh bg-base-100">
      <header className="border-b border-base-300">
        <div className="mx-auto flex max-w-[1280px] items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-8">
          <span className="font-semibold text-base-content">Survey App</span>
          <div className="flex items-center gap-3">
            <span className="max-w-[10rem] truncate text-sm text-base-content/60">{user?.username}</span>
            <button type="button" onClick={() => void logout()} className="btn btn-ghost btn-sm min-h-11">
              Log out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1280px] px-4 py-6 sm:px-6 lg:px-8">
        <h1 className="text-2xl font-bold text-base-content">Surveys</h1>
        <p className="mt-1 text-base-content/70">Manage and review your surveys</p>

        <Link to="/surveys/new" className="btn btn-primary mt-4 min-h-11 w-full gap-2 sm:w-auto">
          <Plus className="size-4" aria-hidden="true" />
          New Survey
        </Link>

        {!isSessionPersistent && (
          <div className="alert alert-warning mt-4" role="alert">
            <AlertCircle className="size-5 shrink-0" aria-hidden="true" />
            <span>
              This browser wouldn't let the app save your session, so you'll need to sign in again after a
              reload. Surveys you capture are still saved on this device. Check that site data is allowed
              for this site and that you're not in private browsing.
            </span>
          </div>
        )}

        {connectivity === "offline" && (
          <div className="alert alert-warning mt-4 py-2 text-sm" role="status">
            <WifiOff className="size-4 shrink-0" aria-hidden="true" />
            <span>Offline · New surveys are saved locally and sync when you're back online.</span>
          </div>
        )}
        {connectivity === "reconnected" && (
          <div className="alert alert-info mt-4 py-2 text-sm" role="status">
            <Wifi className="size-4 shrink-0" aria-hidden="true" />
            <span>Back online · Syncing surveys…</span>
          </div>
        )}

        {isLoadingLocal && (
          <section className="mt-8">
            <h2 className="text-lg font-semibold text-base-content">Pending Sync</h2>
            <p className="mt-2 flex items-center gap-2 text-sm text-base-content/70">
              <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
              Loading…
            </p>
          </section>
        )}
        {!isLoadingLocal && !localError && localSurveys.length > 0 && (
          <section className="mt-8">
            <h2 className="text-lg font-semibold text-base-content">Pending Sync</h2>
            <p className="mt-1 text-sm text-base-content/70">
              {localSurveys.length} survey{localSurveys.length === 1 ? "" : "s"} waiting to sync
            </p>
            <div className="mt-4 grid grid-cols-1 gap-4 sm:gap-6 md:grid-cols-2 lg:grid-cols-3">
              {visibleLocalSurveys.map((record) => (
                <LocalSurveyCard record={record} key={record.id} onRetry={handleRetry} />
              ))}
            </div>
            {hiddenLocalCount > 0 && (
              <div className="mt-4 flex justify-center">
                <button
                  type="button"
                  onClick={() => setVisibleLocalCount((count) => count + PENDING_PAGE_SIZE)}
                  className="btn btn-outline btn-sm min-h-11"
                >
                  Load more ({hiddenLocalCount} not shown)
                </button>
              </div>
            )}
          </section>
        )}
        {localError && (
          <div className="alert alert-error mt-4" role="alert">
            <AlertCircle className="size-5 shrink-0" aria-hidden="true" />
            <span>{localError}</span>
          </div>
        )}

        <section className="mt-8">
          <h2 className="text-lg font-semibold text-base-content">Synced Surveys</h2>

          {isLoading && (
            <p className="mt-2 flex items-center gap-2 text-sm text-base-content/70">
              <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
              Loading…
            </p>
          )}
          {error && (
            <div
              className="alert alert-error mt-4 flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between"
              role="alert"
            >
              <div className="flex items-center gap-2">
                <AlertCircle className="size-5 shrink-0" aria-hidden="true" />
                <span>{error}</span>
              </div>
              <button
                type="button"
                onClick={() => void loadSurveys(page)}
                disabled={isLoading}
                className="btn btn-error btn-outline btn-sm min-h-11"
              >
                <RefreshCw className="size-4" aria-hidden="true" />
                Retry
              </button>
            </div>
          )}
          {showSyncedOnlyEmptyText && <p className="mt-4 text-base-content/60">No synced surveys yet.</p>}
          {showFullEmptyState && (
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <Camera className="size-8 text-base-content/40" aria-hidden="true" />
              <p className="text-base font-medium text-base-content">No synced surveys yet.</p>
              <p className="text-sm text-base-content/60">Capture your first survey to get started.</p>
              <Link to="/surveys/new" className="btn btn-primary btn-sm min-h-11 mt-1 gap-1.5">
                <Plus className="size-4" aria-hidden="true" />
                New Survey
              </Link>
            </div>
          )}

          {surveys.length > 0 && (
            <div className="mt-4 grid grid-cols-1 gap-4 sm:gap-6 md:grid-cols-2 lg:grid-cols-3">
              {surveys.map((survey) => (
                <SyncedSurveyCard survey={survey} key={survey.id} />
              ))}
            </div>
          )}

          <div className="mt-6 flex items-center justify-center gap-3">
            <button
              type="button"
              disabled={!hasPrevious || isLoading}
              onClick={() => setPage((p) => p - 1)}
              className="btn btn-outline btn-sm min-h-11"
            >
              Previous
            </button>
            <span className="text-sm text-base-content/70">Page {page}</span>
            <button
              type="button"
              disabled={!hasNext || isLoading}
              onClick={() => setPage((p) => p + 1)}
              className="btn btn-outline btn-sm min-h-11"
            >
              Next
            </button>
          </div>
        </section>
      </main>
    </div>
  );
}
