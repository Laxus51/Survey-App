import { DetailRow } from "../DetailRow";

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
    <div className="flex flex-col gap-4">
      {imagePreviewUrl && (
        <img
          src={imagePreviewUrl}
          alt={name}
          className="max-h-[60vh] w-full rounded-box border border-base-300 object-contain"
        />
      )}
      <div>
        <h2 className="text-lg font-semibold text-base-content">{name}</h2>
        <p className="text-sm text-base-content/70">{description || "No description"}</p>
      </div>

      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
        <DetailRow label="Location">
          {latitude?.toFixed(6)}, {longitude?.toFixed(6)} (±{accuracy?.toFixed(0)}m)
        </DetailRow>
      </dl>

      {Object.keys(attributes).length > 0 && (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-base-content">Custom fields</h3>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
            {Object.entries(attributes).map(([key, value]) => (
              <DetailRow key={key} label={key}>
                {value}
              </DetailRow>
            ))}
          </dl>
        </div>
      )}
    </div>
  );
}
