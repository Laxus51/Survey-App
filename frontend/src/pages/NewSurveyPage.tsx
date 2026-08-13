import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { CustomAttributesEditor } from "../components/survey-capture/CustomAttributesEditor";
import { ImageCapture } from "../components/survey-capture/ImageCapture";
import { SurveyReview } from "../components/survey-capture/SurveyReview";
import { useGeolocationCapture } from "../hooks/useGeolocationCapture";
import { useStorageQuota } from "../hooks/useStorageQuota";
import { SurveyPersistenceError, surveyPersistence } from "../services/surveyPersistence";
import { runSync } from "../services/syncEngine";
import type { LocalSurvey } from "../types/localSurvey";
import type { AttributeRow } from "../utils/attributeRows";
import { attributeRowsAreValid, attributeRowsToRecord } from "../utils/attributeRows";
import { generateUuid } from "../utils/uuid";

type Mode = "edit" | "review" | "saved";

export function NewSurveyPage() {
  const { isAuthenticated } = useAuth();
  const [surveyId, setSurveyId] = useState(() => generateUuid());
  const [imageBlob, setImageBlob] = useState<Blob | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const location = useGeolocationCapture();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [attributeRows, setAttributeRows] = useState<AttributeRow[]>([]);
  const [mode, setMode] = useState<Mode>("edit");
  const [formErrors, setFormErrors] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const storageQuota = useStorageQuota();

  const attributes = useMemo(() => attributeRowsToRecord(attributeRows), [attributeRows]);

  const imagePreviewUrlRef = useRef<string | null>(null);
  imagePreviewUrlRef.current = imagePreviewUrl;

  // Guards against a leaked object URL if the surveyor captures a photo and
  // then navigates away (e.g. "Back to dashboard") without saving, retaking,
  // or starting a new survey - those paths already revoke it themselves.
  useEffect(() => {
    return () => {
      if (imagePreviewUrlRef.current) URL.revokeObjectURL(imagePreviewUrlRef.current);
    };
  }, []);

  function handleImageCaptured(blob: Blob, previewUrl: string) {
    setImageBlob(blob);
    setImagePreviewUrl(previewUrl);
    // Immediately, per the capture workflow - not a manual "refresh" the
    // surveyor can trigger again once it succeeds.
    location.requestLocation();
  }

  function handleImageCleared() {
    setImageBlob(null);
    setImagePreviewUrl(null);
  }

  function handleContinueToReview() {
    const errors: string[] = [];
    if (!imageBlob) errors.push("Capture a photo before continuing.");
    if (location.status !== "success") {
      errors.push("Wait for your location to be captured before continuing.");
    }
    if (!name.trim()) errors.push("Enter a name for this survey.");
    if (!attributeRowsAreValid(attributeRows)) errors.push("Fix the custom fields below before continuing.");

    if (errors.length > 0) {
      setFormErrors(errors);
      return;
    }
    setFormErrors([]);
    setMode("review");
  }

  async function handleSave() {
    if (!imageBlob || location.latitude === null || location.longitude === null || location.accuracy === null) {
      // Shouldn't happen (handleContinueToReview already guards this), but
      // keeps this safe if state changed unexpectedly while reviewing.
      setMode("edit");
      return;
    }

    setIsSaving(true);
    setSaveError(null);
    try {
      const now = new Date().toISOString();
      const localSurvey: LocalSurvey = {
        id: surveyId,
        name: name.trim(),
        description: description.trim(),
        imageBlob,
        imageMimeType: imageBlob.type,
        imageFileName: `survey-${surveyId}.jpg`,
        latitude: location.latitude,
        longitude: location.longitude,
        accuracy: location.accuracy,
        attributes,
        createdAt: now,
        updatedAt: now,
      };
      await surveyPersistence.saveSurvey(localSurvey);
      // The survey is already durably in IndexedDB by this point - this is
      // just an opportunistic nudge to the existing sync engine, not part
      // of the save transaction. Fire-and-forget (not awaited): if it's
      // offline or unauthenticated, or fails for any reason, the survey
      // stays correctly "pending" and the existing app-start/online-event/
      // manual-retry triggers still cover it later.
      if (navigator.onLine && isAuthenticated) {
        void runSync();
      }
      setMode("saved");
    } catch (error) {
      setSaveError(
        error instanceof SurveyPersistenceError ? error.message : "Could not save the survey. Please try again.",
      );
    } finally {
      setIsSaving(false);
    }
  }

  function handleStartNewSurvey() {
    if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
    setSurveyId(generateUuid());
    setImageBlob(null);
    setImagePreviewUrl(null);
    setName("");
    setDescription("");
    setAttributeRows([]);
    setFormErrors([]);
    setSaveError(null);
    setMode("edit");
  }

  if (mode === "saved") {
    return (
      <div className="page">
        <h1>Survey saved</h1>
        <p>Your survey was saved on this device and is pending synchronization.</p>
        <div className="button-row">
          <button type="button" onClick={handleStartNewSurvey}>
            Add another survey
          </button>
          <Link to="/">Back to dashboard</Link>
        </div>
      </div>
    );
  }

  if (mode === "review") {
    return (
      <div className="page">
        <h1>Review Survey</h1>
        <SurveyReview
          imagePreviewUrl={imagePreviewUrl}
          name={name}
          description={description}
          latitude={location.latitude}
          longitude={location.longitude}
          accuracy={location.accuracy}
          attributes={attributes}
        />
        {saveError && (
          <p className="form-error" role="alert">
            {saveError}
          </p>
        )}
        <div className="button-row">
          <button type="button" onClick={() => setMode("edit")} disabled={isSaving}>
            Edit
          </button>
          <button type="button" onClick={() => void handleSave()} disabled={isSaving}>
            {isSaving ? "Saving…" : "Save Survey"}
          </button>
        </div>
      </div>
    );
  }

  if (storageQuota.status === "blocked") {
    return (
      <div className="page">
        <Link to="/">&larr; Back to dashboard</Link>
        <h1>New Survey</h1>
        <p className="form-error" role="alert">
          Local storage on this device is nearly full. Sync or free up space before capturing new surveys.
        </p>
      </div>
    );
  }

  return (
    <div className="page">
      <Link to="/">&larr; Back to dashboard</Link>
      <h1>New Survey</h1>

      {storageQuota.status === "warning" && (
        <p className="quota-warning" role="alert">
          Local storage on this device is getting full. Sync existing surveys soon to free up space.
        </p>
      )}

      <ImageCapture
        previewUrl={imagePreviewUrl}
        onCaptured={handleImageCaptured}
        onCleared={handleImageCleared}
      />

      {imageBlob && (
        <div className="location-status">
          {location.status === "locating" && <p>Getting your location…</p>}
          {location.status === "success" && (
            <p>
              Location: {location.latitude?.toFixed(6)}, {location.longitude?.toFixed(6)} (±
              {location.accuracy?.toFixed(0)}m)
            </p>
          )}
          {location.status === "error" && (
            <div>
              <p className="form-error" role="alert">
                {location.errorMessage}
              </p>
              <button type="button" onClick={location.requestLocation}>
                Retry Location
              </button>
            </div>
          )}
        </div>
      )}

      <div className="field">
        <label htmlFor="survey-name">Name</label>
        <input id="survey-name" value={name} onChange={(event) => setName(event.target.value)} required />
      </div>

      <div className="field">
        <label htmlFor="survey-description">Description</label>
        <textarea
          id="survey-description"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
          rows={3}
        />
      </div>

      <CustomAttributesEditor rows={attributeRows} onChange={setAttributeRows} />

      {formErrors.length > 0 && (
        <ul className="form-error-list">
          {formErrors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      )}

      <button type="button" className="capture-button" onClick={handleContinueToReview}>
        Review Survey
      </button>
    </div>
  );
}
