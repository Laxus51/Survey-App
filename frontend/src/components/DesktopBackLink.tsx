import { ArrowLeft } from "lucide-react";
import { useGoBack } from "../hooks/useGoBack";

// Desktop equivalent of MobileAppBar (DESIGN_SYSTEM.md §21) - a plain
// textual back affordance inline with page content, not the compact mobile
// bar. Fixed label: both secondary pages lead back to the same place, so
// there's nothing page-specific to parameterize.
export function DesktopBackLink() {
  const goBack = useGoBack();

  return (
    <button
      type="button"
      onClick={goBack}
      className="mb-4 hidden items-center gap-1.5 text-sm text-base-content/70 hover:text-base-content md:inline-flex"
    >
      <ArrowLeft className="size-4" aria-hidden="true" />
      Back to Surveys
    </button>
  );
}
