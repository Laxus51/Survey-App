import { Link } from "react-router-dom";

export function NewSurveyPage() {
  return (
    <div className="page">
      <Link to="/">&larr; Back to dashboard</Link>
      <h1>New Survey</h1>
      <p className="muted">
        Survey capture (camera, GPS, and custom attributes) will be implemented in a later phase.
      </p>
    </div>
  );
}
