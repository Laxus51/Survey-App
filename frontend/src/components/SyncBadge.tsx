import { AlertCircle, Check, Clock, LoaderCircle, type LucideIcon } from "lucide-react";
import type { SyncStatus } from "../types/survey";

// Color/icon vocabulary per DESIGN_SYSTEM.md §12 - kept in one place so
// LocalSurveyCard (pending/syncing/failed) and SyncedSurveyCard (synced)
// render the same badge instead of two independent implementations.
const BADGE_CONFIG: Record<SyncStatus, { className: string; icon: LucideIcon; spin?: boolean }> = {
  pending: { className: "badge-warning", icon: Clock },
  syncing: { className: "badge-info", icon: LoaderCircle, spin: true },
  synced: { className: "badge-success", icon: Check },
  failed: { className: "badge-error", icon: AlertCircle },
};

interface SyncBadgeProps {
  status: SyncStatus;
}

// Renders the raw status word as-is (not "Pending"/"Failed") and relies on
// `capitalize` for the visual case - DashboardPage's tests assert on the
// literal lowercase text ("pending", "failed", etc.), so the accessible/DOM
// text must stay exactly the status value.
export function SyncBadge({ status }: SyncBadgeProps) {
  const { className, icon: Icon, spin } = BADGE_CONFIG[status];
  return (
    <span className={`badge gap-1 capitalize ${className}`}>
      <Icon className={`size-3.5 ${spin ? "animate-spin" : ""}`} aria-hidden="true" />
      {status}
    </span>
  );
}
