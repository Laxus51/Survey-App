import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AlertCircle, ArrowLeft, Check, LoaderCircle, MapPin, RefreshCw } from "lucide-react";
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

  // Moves keyboard/screen-reader focus to the error summary the moment it
  // appears, per the "focusable error summary" pattern - a surveyor who
  // taps "Review Survey" and gets rejected shouldn't have to hunt for why.
  const errorSummaryRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (formErrors.length > 0) errorSummaryRef.current?.focus();
  }, [formErrors]);

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
      <div className="min-h-svh bg-base-100">
        <div className="mx-auto max-w-[1280px] px-4 py-6 sm:px-6 lg:px-8">
          <div className="max-w-xl">
            <div className="flex flex-col items-center gap-3 py-12 text-center">
              <Check className="size-8 text-success" aria-hidden="true" />
              <h1 className="text-xl font-bold text-base-content">Survey saved</h1>
              <p className="text-sm text-base-content/70">
                Your survey was saved on this device and is pending synchronization.
              </p>
              <div className="mt-2 flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
                <button
                  type="button"
                  onClick={handleStartNewSurvey}
                  className="btn btn-outline min-h-11 w-full sm:w-auto"
                >
                  Add another survey
                </button>
                <Link to="/" className="btn btn-primary min-h-11 w-full sm:w-auto">
                  Back to dashboard
                </Link>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (mode === "review") {
    return (
      <div className="min-h-svh bg-base-100">
        <div className="mx-auto max-w-[1280px] px-4 py-6 sm:px-6 lg:px-8">
          <div className="max-w-xl">
            <h1 className="text-2xl font-bold text-base-content">Review Survey</h1>
            <div className="mt-4">
              <SurveyReview
                imagePreviewUrl={imagePreviewUrl}
                name={name}
                description={description}
                latitude={location.latitude}
                longitude={location.longitude}
                accuracy={location.accuracy}
                attributes={attributes}
              />
            </div>
            {saveError && (
              <div className="alert alert-error mt-4" role="alert">
                <AlertCircle className="size-5 shrink-0" aria-hidden="true" />
                <span>{saveError}</span>
              </div>
            )}
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <button
                type="button"
                onClick={() => setMode("edit")}
                disabled={isSaving}
                className="btn btn-outline min-h-11 w-full sm:w-auto"
              >
                Edit
              </button>
              <button
                type="button"
                onClick={() => void handleSave()}
                disabled={isSaving}
                className="btn btn-primary min-h-11 w-full gap-2 sm:w-auto"
              >
                {isSaving && <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />}
                {isSaving ? "Saving…" : "Save Survey"}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (storageQuota.status === "blocked") {
    return (
      <div className="min-h-svh bg-base-100">
        <div className="mx-auto max-w-[1280px] px-4 py-6 sm:px-6 lg:px-8">
          <div className="max-w-xl">
            <Link to="/" className="btn btn-ghost btn-sm min-h-11 gap-1.5">
              <ArrowLeft className="size-4" aria-hidden="true" />
              Back to dashboard
            </Link>
            <h1 className="mt-2 text-2xl font-bold text-base-content">New Survey</h1>
            <div className="alert alert-warning mt-4" role="alert">
              <AlertCircle className="size-5 shrink-0" aria-hidden="true" />
              <span>
                Local storage on this device is nearly full. Sync or free up space before capturing new surveys.
              </span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-svh bg-base-100">
      <div className="mx-auto max-w-[1280px] px-4 py-6 sm:px-6 lg:px-8">
        <div className="max-w-xl">
          <Link to="/" className="btn btn-ghost btn-sm min-h-11 gap-1.5">
            <ArrowLeft className="size-4" aria-hidden="true" />
            Back to dashboard
          </Link>
          <h1 className="mt-2 text-2xl font-bold text-base-content">New Survey</h1>
          <p className="mt-1 text-sm text-base-content/60">Step 1 of 3 · Capture</p>

          {storageQuota.status === "warning" && (
            <div className="alert alert-warning mt-4" role="alert">
              <AlertCircle className="size-5 shrink-0" aria-hidden="true" />
              <span>Local storage on this device is getting full. Sync existing surveys soon to free up space.</span>
            </div>
          )}

          {formErrors.length > 0 && (
            <div
              ref={errorSummaryRef}
              tabIndex={-1}
              className="alert alert-error mt-4 flex-col items-start gap-2"
              role="alert"
            >
              <div className="flex items-center gap-2 font-semibold">
                <AlertCircle className="size-5 shrink-0" aria-hidden="true" />
                Fix these before continuing
              </div>
              <ul className="ml-7 list-disc text-sm">
                {formErrors.map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="mt-4">
            <ImageCapture
              previewUrl={imagePreviewUrl}
              onCaptured={handleImageCaptured}
              onCleared={handleImageCleared}
            />
          </div>

          {imageBlob && (
            <div className="mt-4">
              {location.status === "locating" &&
                (location.isAwaitingPermission ? (
                  <p className="flex items-center gap-2 text-sm text-base-content/70">
                    <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                    Waiting for location permission - tap “Allow” on your browser's prompt.
                  </p>
                ) : location.isUsingFallback ? (
                  <p className="flex items-center gap-2 text-sm text-base-content/70">
                    <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                    Couldn't get a precise GPS fix - trying a less precise method…
                  </p>
                ) : (
                  <p className="flex items-center gap-2 text-sm text-base-content/70">
                    <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
                    Getting your location…
                  </p>
                ))}
              {location.status === "success" && (
                <p className="flex items-center gap-2 text-sm text-base-content/70">
                  <MapPin className="size-4 shrink-0" aria-hidden="true" />
                  Location: {location.latitude?.toFixed(6)}, {location.longitude?.toFixed(6)} (±
                  {location.accuracy?.toFixed(0)}m)
                </p>
              )}
              {location.status === "error" && (
                <div className="flex flex-col gap-2">
                  <div className="alert alert-error" role="alert">
                    <AlertCircle className="size-5 shrink-0" aria-hidden="true" />
                    <span>{location.errorMessage}</span>
                  </div>
                  <button
                    type="button"
                    onClick={location.requestLocation}
                    className="btn btn-outline btn-sm min-h-11 self-start gap-1.5"
                  >
                    <RefreshCw className="size-4" aria-hidden="true" />
                    Retry Location
                  </button>
                </div>
              )}
            </div>
          )}

          <div className="mt-4 flex flex-col gap-1">
            <label htmlFor="survey-name" className="text-sm font-medium text-base-content">
              Name
            </label>
            <input
              id="survey-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              required
              className="input min-h-11 w-full"
            />
          </div>

          <div className="mt-4 flex flex-col gap-1">
            <label htmlFor="survey-description" className="text-sm font-medium text-base-content">
              Description
            </label>
            <textarea
              id="survey-description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={3}
              className="textarea w-full"
            />
          </div>

          <div className="mt-4">
            <CustomAttributesEditor rows={attributeRows} onChange={setAttributeRows} />
          </div>

          <button type="button" onClick={handleContinueToReview} className="btn btn-primary mt-6 min-h-11 w-full">
            Review Survey
          </button>
        </div>
      </div>
    </div>
  );
}
