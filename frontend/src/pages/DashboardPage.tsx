import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { ApiError } from "../services/httpClient";
import * as surveyApi from "../services/surveyApi";
import type { Survey } from "../types/survey";

export function DashboardPage() {
  const { user, logout } = useAuth();
  const [surveys, setSurveys] = useState<Survey[]>([]);
  const [page, setPage] = useState(1);
  const [hasNext, setHasNext] = useState(false);
  const [hasPrevious, setHasPrevious] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
    void loadSurveys(page);
  }, [page, loadSurveys]);

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

      <Link to="/surveys/new" className="button-link">
        + New Survey
      </Link>

      {isLoading && <p>Loading…</p>}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {!isLoading && !error && surveys.length === 0 && <p className="muted">No surveys yet.</p>}

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
    </div>
  );
}
