import { ArrowLeft } from "lucide-react";
import { useGoBack } from "../hooks/useGoBack";

interface MobileAppBarProps {
  title: string;
}

// Compact contextual app bar for secondary pages (New Survey, Survey
// Details) - DESIGN_SYSTEM.md §21. Mobile only; desktop keeps the global
// header and uses DesktopBackLink instead. Icon-only back control with no
// "Back"/"Back to Dashboard" text - the arrow alone is the affordance, like
// a native app's contextual back button rather than a page button.
export function MobileAppBar({ title }: MobileAppBarProps) {
  const goBack = useGoBack();

  return (
    <div className="flex h-14 items-center border-b border-base-300 md:hidden">
      <button
        type="button"
        onClick={goBack}
        aria-label="Back"
        className="flex h-11 w-11 shrink-0 items-center justify-center"
      >
        <ArrowLeft className="size-5" aria-hidden="true" />
      </button>
      <h1 className="text-lg font-semibold text-base-content">{title}</h1>
    </div>
  );
}
