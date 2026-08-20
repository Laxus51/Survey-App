import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { LocalSurveyCard } from "../components/LocalSurveyCard";
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

  return (
    <div className="page">
      <header className="page-header">
        <h1>Surveys</h1>
        <div className="page-header-actions">
          <span className="muted">{user?.username}</span>
          <button type="button" onClick={() => void logout()}>
            Log out
          </button>
        </div>
      </header>

      {!isSessionPersistent && (
        <p className="quota-warning" role="alert">
          This browser wouldn't let the app save your session, so you'll need to sign in again after a
          reload. Surveys you capture are still saved on this device. Check that site data is allowed for
          this site and that you're not in private browsing.
        </p>
      )}

      <Link to="/surveys/new" className="button-link">
        + New Survey
      </Link>

      {isLoadingLocal && (
        <section>
          <h2>Pending Sync</h2>
          <p>Loading…</p>
        </section>
      )}
      {!isLoadingLocal && !localError && localSurveys.length > 0 && (
        <section>
          <h2>Pending Sync</h2>
          <div className="survey-grid">
            {visibleLocalSurveys.map((record) => (
              <LocalSurveyCard record={record} key={record.id} onRetry={handleRetry} />
            ))}
          </div>
          {hiddenLocalCount > 0 && (
            <div className="load-more">
              <button
                type="button"
                onClick={() => setVisibleLocalCount((count) => count + PENDING_PAGE_SIZE)}
              >
                Load more ({hiddenLocalCount} not shown)
              </button>
            </div>
          )}
        </section>
      )}
      {localError && (
        <p className="form-error" role="alert">
          {localError}
        </p>
      )}

      <section>
        <h2>Synced Surveys</h2>

        {isLoading && <p>Loading…</p>}
        {error && (
          <div className="button-row">
            <p className="form-error" role="alert">
              {error}
            </p>
            <button type="button" onClick={() => void loadSurveys(page)} disabled={isLoading}>
              Retry
            </button>
          </div>
        )}
        {!isLoading && !error && surveys.length === 0 && <p className="muted">No synced surveys yet.</p>}

        <div className="survey-grid">
          {surveys.map((survey) => (
            <Link to={`/surveys/${survey.id}`} key={survey.id} className="survey-card">
              <img src={survey.image} alt={survey.name} loading="lazy" />
              <div className="survey-card-body">
                <h2>{survey.name}</h2>
                <p className="muted">{survey.description || "No description"}</p>
                <span className={`sync-badge sync-badge--${survey.sync_status}`}>
                  {survey.sync_status}
                </span>
              </div>
            </Link>
          ))}
        </div>

        <div className="pagination">
          <button type="button" disabled={!hasPrevious || isLoading} onClick={() => setPage((p) => p - 1)}>
            Previous
          </button>
          <span>Page {page}</span>
          <button type="button" disabled={!hasNext || isLoading} onClick={() => setPage((p) => p + 1)}>
            Next
          </button>
        </div>
      </section>
    </div>
  );
}
