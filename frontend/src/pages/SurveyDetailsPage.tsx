import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ApiError } from "../services/httpClient";
import * as surveyApi from "../services/surveyApi";
import type { Survey } from "../types/survey";

export function SurveyDetailsPage() {
  const { id } = useParams<{ id: string }>();
  const [survey, setSurvey] = useState<Survey | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;

    setIsLoading(true);
    setError(null);
    surveyApi
      .getSurvey(id)
      .then((data) => {
        if (!cancelled) setSurvey(data);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof ApiError && err.status === 404 ? "Survey not found." : "Failed to load survey.");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [id]);

  return (
    <div className="page">
      <Link to="/">&larr; Back to dashboard</Link>

      {isLoading && <p>Loading…</p>}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}

      {survey && (
        <div className="survey-detail">
          <img src={survey.image} alt={survey.name} />
          <h1>{survey.name}</h1>
          <p>{survey.description || "No description"}</p>

          <dl>
            <dt>Location</dt>
            <dd>
              {survey.latitude.toFixed(6)}, {survey.longitude.toFixed(6)} (±{survey.accuracy}m)
            </dd>
            <dt>Status</dt>
            <dd>{survey.sync_status}</dd>
            <dt>Captured</dt>
            <dd>{new Date(survey.created_at).toLocaleString()}</dd>
          </dl>

          {Object.keys(survey.attributes).length > 0 && (
            <>
              <h2>Attributes</h2>
              <dl>
                {Object.entries(survey.attributes).map(([key, value]) => (
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
