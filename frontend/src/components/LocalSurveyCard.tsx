import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { RefreshCw } from "lucide-react";
import { SyncBadge } from "./SyncBadge";
import type { LocalSurveyRecord } from "../types/localSurveyRecord";

interface LocalSurveyCardProps {
  record: LocalSurveyRecord;
  onRetry?: () => void;
}

// Short, human capture time from the record's own createdAt - "9:12 AM" for
// today, a short date otherwise. No new field and no date library: this is a
// display format on data the record already carries.
function formatCaptureTime(iso: string): string {
  const date = new Date(iso);
  const isToday = date.toDateString() === new Date().toDateString();
  return isToday
    ? date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
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
    <div className="card overflow-hidden border border-base-300 bg-base-100">
      <Link to={`/surveys/${record.id}`} className="block">
        {imageUrl && (
          <img
            src={imageUrl}
            alt={record.name}
            loading="lazy"
            className="aspect-[4/3] w-full rounded-t-box object-cover"
          />
        )}
        <div className="flex flex-col gap-1 p-4">
          <h2 className="text-base font-semibold text-base-content">{record.name}</h2>
          <p className="line-clamp-1 text-sm text-base-content/70">{record.description || "No description"}</p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <SyncBadge status={record.syncStatus} />
            {record.syncStatus === "pending" && (
              <span className="text-xs text-base-content/60">{formatCaptureTime(record.createdAt)}</span>
            )}
            {record.syncStatus === "failed" && record.retryCount > 0 && (
              <span className="text-xs text-base-content/60">retried {record.retryCount}×</span>
            )}
          </div>
          {record.syncStatus === "failed" && record.lastError && (
            <p className="line-clamp-2 text-xs text-error">{record.lastError}</p>
          )}
        </div>
      </Link>
      {record.syncStatus === "failed" && onRetry && (
        <div className="px-4 pb-4">
          <button type="button" onClick={onRetry} className="btn btn-error btn-outline btn-sm min-h-11 w-full gap-1.5">
            <RefreshCw className="size-4" aria-hidden="true" />
            Retry
          </button>
        </div>
      )}
    </div>
  );
}
