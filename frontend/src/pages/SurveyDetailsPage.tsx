import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
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

export function SurveyDetailsPage() {
  const { id } = useParams<{ id: string }>();
  const [state, setState] = useState<DetailsState>({ kind: "loading" });

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

  return (
    <div className="page">
      <Link to="/">&larr; Back to dashboard</Link>

      {state.kind === "loading" && <p>Loading…</p>}
      {state.kind === "not-found" && (
        <p className="form-error" role="alert">
          Survey not found.
        </p>
      )}
      {state.kind === "error" && (
        <p className="form-error" role="alert">
          {state.message}
        </p>
      )}

      {state.kind === "local" && (
        <div className="survey-detail">
          <img src={state.imageUrl} alt={state.record.name} />
          <h1>{state.record.name}</h1>
          <p>{state.record.description || "No description"}</p>

          <dl>
            <dt>Location</dt>
            <dd>
              {state.record.latitude.toFixed(6)}, {state.record.longitude.toFixed(6)} (±
              {state.record.accuracy.toFixed(0)}m)
            </dd>
            <dt>Status</dt>
            <dd>
              <span className={`sync-badge sync-badge--${state.record.syncStatus}`}>
                {state.record.syncStatus}
              </span>
              {state.record.retryCount > 0 && ` (retried ${state.record.retryCount}×)`}
            </dd>
            <dt>Captured</dt>
            <dd>{new Date(state.record.createdAt).toLocaleString()}</dd>
          </dl>

          {Object.keys(state.record.attributes).length > 0 && (
            <>
              <h2>Attributes</h2>
              <dl>
                {Object.entries(state.record.attributes).map(([key, value]) => (
                  <div key={key} className="attribute-row">
                    <dt>{key}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            </>
          )}
        </div>
      )}

      {state.kind === "remote" && (
        <div className="survey-detail">
          <img src={state.survey.image} alt={state.survey.name} />
          <h1>{state.survey.name}</h1>
          <p>{state.survey.description || "No description"}</p>

          <dl>
            <dt>Location</dt>
            <dd>
              {state.survey.latitude.toFixed(6)}, {state.survey.longitude.toFixed(6)} (±
              {state.survey.accuracy}m)
            </dd>
            <dt>Status</dt>
            <dd>
              <span className={`sync-badge sync-badge--${state.survey.sync_status}`}>
                {state.survey.sync_status}
              </span>
            </dd>
            <dt>Captured</dt>
            <dd>{new Date(state.survey.created_at).toLocaleString()}</dd>
          </dl>

          {Object.keys(state.survey.attributes).length > 0 && (
            <>
              <h2>Attributes</h2>
              <dl>
                {Object.entries(state.survey.attributes).map(([key, value]) => (
                  <div key={key} className="attribute-row">
                    <dt>{key}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            </>
          )}
        </div>
      )}
    </div>
  );
}
