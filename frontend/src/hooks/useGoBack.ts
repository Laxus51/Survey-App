import { useNavigate } from "react-router-dom";

// Real "back" semantics (DESIGN_SYSTEM.md §21): returns to wherever the
// surveyor actually came from, not a hardcoded route - except when there's
// nothing in this session's history to go back to (a reload, a deep link,
// a freshly opened tab). React Router's BrowserRouter stores the SPA's own
// navigation-stack position in history.state.idx; 0 means this page is the
// first entry for this session, so falling back to Dashboard is the only
// sane destination.
export function useGoBack(): () => void {
  const navigate = useNavigate();

  return function goBack() {
    const idx = (window.history.state as { idx?: number } | null)?.idx;
    if (typeof idx === "number" && idx > 0) {
      navigate(-1);
    } else {
      navigate("/", { replace: true });
    }
  };
}
