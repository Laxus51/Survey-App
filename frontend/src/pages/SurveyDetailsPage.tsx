import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { AlertCircle, LoaderCircle, Trash2 } from "lucide-react";
import { AttributeTable } from "../components/AttributeTable";
import { DesktopBackLink } from "../components/DesktopBackLink";
import { DetailRow } from "../components/DetailRow";
import { MobileAppBar } from "../components/MobileAppBar";
import { SyncBadge } from "../components/SyncBadge";
import { ApiError } from "../services/httpClient";
import * as surveyApi from "../services/surveyApi";
import { surveyPersistence } from "../services/surveyPersistence";
import type { LocalSurveyRecord } from "../types/localSurveyRecord";
import type { Survey } from "../types/survey";

type DetailsState =
  | { kind: "loading" }
  | { kind: "local"; record: LocalSurveyRecord; imageUrl: string }
  | { kind: "remote"; survey: Survey }
  | { kind: "not-found" }
  | { kind: "error"; message: string };

// Seconds add noise, not information, for a field-capture timestamp - hour
// and minute are all a surveyor needs to place when this happened.
function formatCapturedAt(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { dateStyle: "short", timeStyle: "short" });
}

// Rounds to at most 1 decimal place, but drops a trailing ".0" for whole
// numbers (105, not 105.0) - toFixed(1) alone always pads one on, even when
// the reading happens to be exact.
function formatAccuracy(accuracy: number): string {
  return Number(accuracy.toFixed(1)).toString();
}

export function SurveyDetailsPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [state, setState] = useState<DetailsState>({ kind: "loading" });
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    let objectUrl: string | null = null;

    async function load() {
      setState({ kind: "loading" });

      // Local-first: a locally-captured survey may not exist on the server
      // at all yet, and shouldn't need it to be viewable.
      try {
        const localRecord = await surveyPersistence.getSurvey(id!);
        if (localRecord) {
          objectUrl = URL.createObjectURL(localRecord.imageBlob);
          if (!cancelled) setState({ kind: "local", record: localRecord, imageUrl: objectUrl });
          return;
        }
      } catch {
        // Local lookup failed - fall through and try the server rather than
        // hard-failing on what may just be a local storage hiccup.
      }

      try {
        const survey = await surveyApi.getSurvey(id!);
        if (!cancelled) setState({ kind: "remote", survey });
      } catch (err) {
        if (cancelled) return;
        setState(
          err instanceof ApiError && err.status === 404
            ? { kind: "not-found" }
            : { kind: "error", message: "Failed to load survey." },
        );
      }
    }

    void load();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [id]);

  // A record only exists on the server once it's "synced" (or is being
  // viewed straight from the server, i.e. never had a local copy at all) -
  // those cases need the server-side soft-delete; a still-local
  // pending/failed record has nothing to delete server-side. "syncing" is
  // deliberately excluded (button disabled below) to avoid racing the sync
  // engine's in-flight upload of this same record.
  const needsServerDelete = state.kind === "remote" || (state.kind === "local" && state.record.syncStatus === "synced");
  const canDelete = state.kind === "remote" || (state.kind === "local" && state.record.syncStatus !== "syncing");

  async function handleDelete() {
    if (!id || !canDelete) return;

    setDeleteError(null);
    setIsDeleting(true);
    try {
      if (needsServerDelete) {
        if (!navigator.onLine) {
          throw new Error("You're offline. Connect to the internet to delete a survey that's already synced.");
        }
        await surveyApi.deleteSurvey(id);
      }
      if (state.kind === "local") {
        // Best-effort: the server copy (if any) is already gone at this
        // point, so a failure here just leaves a stale local record the
        // surveyor can delete again on next visit, rather than undoing the
        // delete that already succeeded.
        await surveyPersistence.deleteSurvey(id).catch(() => {});
      }
      navigate("/");
    } catch (err) {
      setDeleteError(
        err instanceof ApiError
          ? `Failed to delete survey (${err.status}).`
          : err instanceof Error
            ? err.message
            : "Failed to delete survey. Please try again.",
      );
      setIsDeleting(false);
    }
  }

  return (
    <div className="min-h-svh bg-base-100">
      <MobileAppBar title="Survey Details" />
      <div className="mx-auto max-w-[1280px] px-4 py-6 sm:px-6 lg:px-8">
        <div className="max-w-xl">
          <DesktopBackLink />

          {state.kind === "loading" && (
            <p className="mt-4 flex items-center gap-2 text-sm text-base-content/70">
              <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
              Loading…
            </p>
          )}
          {state.kind === "not-found" && (
            <div className="alert alert-error mt-4" role="alert">
              <AlertCircle className="size-5 shrink-0" aria-hidden="true" />
              <span>Survey not found.</span>
            </div>
          )}
          {state.kind === "error" && (
            <div className="alert alert-error mt-4" role="alert">
              <AlertCircle className="size-5 shrink-0" aria-hidden="true" />
              <span>{state.message}</span>
            </div>
          )}

          {state.kind === "local" && (
            <div className="mt-4 flex flex-col gap-4">
              <img
                src={state.imageUrl}
                alt={state.record.name}
                className="max-h-[60vh] max-w-full self-center rounded-box border border-base-300"
              />
              <div>
                <h1 className="text-2xl font-bold text-base-content">{state.record.name}</h1>
                <p className="text-sm text-base-content/70">{state.record.description || "No description"}</p>
              </div>

              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
                <DetailRow label="Location">
                  {state.record.latitude.toFixed(6)}, {state.record.longitude.toFixed(6)} (±
                  {formatAccuracy(state.record.accuracy)}m)
                </DetailRow>
                <DetailRow label="Status">
                  <SyncBadge status={state.record.syncStatus} />
                  {state.record.retryCount > 0 && (
                    <span className="ml-1 text-xs text-base-content/60">(retried {state.record.retryCount}×)</span>
                  )}
                </DetailRow>
                <DetailRow label="Captured">{formatCapturedAt(state.record.createdAt)}</DetailRow>
              </dl>

              {Object.keys(state.record.attributes).length > 0 && (
                <div>
                  <h2 className="mb-2 text-sm font-semibold text-base-content">Attributes</h2>
                  <AttributeTable attributes={state.record.attributes} />
                </div>
              )}
            </div>
          )}

          {state.kind === "remote" && (
            <div className="mt-4 flex flex-col gap-4">
              <img
                src={state.survey.image}
                alt={state.survey.name}
                className="max-h-[60vh] max-w-full self-center rounded-box border border-base-300"
              />
              <div>
                <h1 className="text-2xl font-bold text-base-content">{state.survey.name}</h1>
                <p className="text-sm text-base-content/70">{state.survey.description || "No description"}</p>
              </div>

              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
                <DetailRow label="Location">
                  {state.survey.latitude.toFixed(6)}, {state.survey.longitude.toFixed(6)} (±
                  {formatAccuracy(state.survey.accuracy)}m)
                </DetailRow>
                <DetailRow label="Status">
                  <SyncBadge status={state.survey.sync_status} />
                </DetailRow>
                {/* Falls back to created_at for records stored before capture
                    time was recorded, which would otherwise render "Invalid
                    Date". The local branch above needs no fallback: its
                    createdAt is the capture time by construction. */}
                <DetailRow label="Captured">
                  {formatCapturedAt(state.survey.captured_at ?? state.survey.created_at)}
                </DetailRow>
              </dl>

              {Object.keys(state.survey.attributes).length > 0 && (
                <div>
                  <h2 className="mb-2 text-sm font-semibold text-base-content">Attributes</h2>
                  <AttributeTable attributes={state.survey.attributes} />
                </div>
              )}
            </div>
          )}

          {(state.kind === "local" || state.kind === "remote") && (
            <div className="mt-6 flex items-center gap-3">
              <button
                type="button"
                onClick={() => setIsConfirmOpen(true)}
                disabled={isDeleting || !canDelete}
                className="btn btn-error btn-outline min-h-11 gap-2"
              >
                {isDeleting ? (
                  <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                ) : (
                  <Trash2 className="size-4" aria-hidden="true" />
                )}
                {isDeleting ? "Deleting…" : "Delete Survey"}
              </button>
              {state.kind === "local" && state.record.syncStatus === "syncing" && (
                <span className="text-sm text-base-content/60">Wait for sync to finish before deleting.</span>
              )}
            </div>
          )}
          {deleteError && (
            <div className="alert alert-error mt-4" role="alert">
              <AlertCircle className="size-5 shrink-0" aria-hidden="true" />
              <span>{deleteError}</span>
            </div>
          )}
        </div>
      </div>

      {isConfirmOpen && (
        <div className="modal modal-open" role="dialog" aria-modal="true">
          <div className="modal-box">
            <h3 className="text-lg font-semibold text-base-content">Delete this survey?</h3>
            <p className="py-2 text-sm text-base-content/70">This cannot be undone.</p>
            <div className="modal-action">
              <button type="button" onClick={() => setIsConfirmOpen(false)} className="btn min-h-11">
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsConfirmOpen(false);
                  void handleDelete();
                }}
                className="btn btn-error min-h-11"
              >
                Delete
              </button>
            </div>
          </div>
          <div className="modal-backdrop" onClick={() => setIsConfirmOpen(false)} />
        </div>
      )}
    </div>
  );
}
