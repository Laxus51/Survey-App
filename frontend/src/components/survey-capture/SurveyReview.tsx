interface SurveyReviewProps {
  imagePreviewUrl: string | null;
  name: string;
  description: string;
  latitude: number | null;
  longitude: number | null;
  accuracy: number | null;
  attributes: Record<string, string>;
}

export function SurveyReview({
  imagePreviewUrl,
  name,
  description,
  latitude,
  longitude,
  accuracy,
  attributes,
}: SurveyReviewProps) {
  return (
    <div className="survey-review">
      {imagePreviewUrl && <img src={imagePreviewUrl} alt={name} />}
      <h2>{name}</h2>
      <p>{description || "No description"}</p>

      <dl>
        <dt>Location</dt>
        <dd>
          {latitude?.toFixed(6)}, {longitude?.toFixed(6)} (±{accuracy?.toFixed(0)}m)
        </dd>
      </dl>

      {Object.keys(attributes).length > 0 && (
        <>
          <h3>Custom fields</h3>
          <dl>
            {Object.entries(attributes).map(([key, value]) => (
              <div key={key} className="attribute-row">
                <dt>{key}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
        </>
      )}
    </div>
  );
}
