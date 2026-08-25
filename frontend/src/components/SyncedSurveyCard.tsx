import { Link } from "react-router-dom";
import { SyncBadge } from "./SyncBadge";
import type { Survey } from "../types/survey";

interface SyncedSurveyCardProps {
  survey: Survey;
}

// Mirrors LocalSurveyCard's visual shape (image, name, description, badge)
// but with none of the local-only concerns: no object-URL lifecycle (image
// is already a server URL), no retry affordance (a synced survey can't
// fail). Extracted out of DashboardPage's previously-inline JSX so the two
// card kinds are each one component with one job, matching LocalSurveyCard's
// existing shape rather than leaving this one as inline markup.
export function SyncedSurveyCard({ survey }: SyncedSurveyCardProps) {
  return (
    <Link to={`/surveys/${survey.id}`} className="card block overflow-hidden border border-base-300 bg-base-100">
      <img
        src={survey.image}
        alt={survey.name}
        loading="lazy"
        className="aspect-[4/3] w-full rounded-t-box object-cover"
      />
      <div className="flex flex-col gap-1 p-4">
        <h2 className="text-base font-semibold text-base-content">{survey.name}</h2>
        <p className="line-clamp-1 text-sm text-base-content/70">{survey.description || "No description"}</p>
        <div className="mt-1">
          <SyncBadge status={survey.sync_status} />
        </div>
      </div>
    </Link>
  );
}
