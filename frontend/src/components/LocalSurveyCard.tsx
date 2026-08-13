import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { LocalSurveyRecord } from "../types/localSurveyRecord";

interface LocalSurveyCardProps {
  record: LocalSurveyRecord;
  onRetry?: () => void;
}

// Local records store a Blob, not a URL - each card manages its own object
// URL lifecycle (created on mount, revoked on unmount) rather than the
// Dashboard tracking a list of URLs to clean up centrally.
export function LocalSurveyCard({ record, onRetry }: LocalSurveyCardProps) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(record.imageBlob);
    setImageUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [record.imageBlob]);

  // The Retry button sits outside the Link (not nested inside it) to avoid
  // a button-inside-anchor structure and its click-handling ambiguity.
  return (
    <div className="survey-card">
      <Link to={`/surveys/${record.id}`} className="survey-card-link">
        {imageUrl && <img src={imageUrl} alt={record.name} />}
        <div className="survey-card-body">
          <h2>{record.name}</h2>
          <p className="muted">{record.description || "No description"}</p>
          <span className={`sync-badge sync-badge--${record.syncStatus}`}>{record.syncStatus}</span>
          {record.syncStatus === "failed" && record.retryCount > 0 && (
            <span className="muted"> · retried {record.retryCount}×</span>
          )}
        </div>
      </Link>
      {record.syncStatus === "failed" && onRetry && (
        <div className="survey-card-footer">
          <button type="button" onClick={onRetry}>
            Retry
          </button>
        </div>
      )}
    </div>
  );
}
