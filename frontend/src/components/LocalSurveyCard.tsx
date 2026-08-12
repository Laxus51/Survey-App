import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { LocalSurveyRecord } from "../types/localSurveyRecord";

interface LocalSurveyCardProps {
  record: LocalSurveyRecord;
}

// Local records store a Blob, not a URL - each card manages its own object
// URL lifecycle (created on mount, revoked on unmount) rather than the
// Dashboard tracking a list of URLs to clean up centrally.
export function LocalSurveyCard({ record }: LocalSurveyCardProps) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  useEffect(() => {
    const url = URL.createObjectURL(record.imageBlob);
    setImageUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [record.imageBlob]);

  return (
    <Link to={`/surveys/${record.id}`} className="survey-card">
      {imageUrl && <img src={imageUrl} alt={record.name} />}
      <div className="survey-card-body">
        <h2>{record.name}</h2>
        <p className="muted">{record.description || "No description"}</p>
        <span className={`sync-badge sync-badge--${record.syncStatus}`}>{record.syncStatus}</span>
      </div>
    </Link>
  );
}
