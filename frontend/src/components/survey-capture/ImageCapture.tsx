import { useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { compressImage } from "../../services/imageCompression";

interface ImageCaptureProps {
  previewUrl: string | null;
  onCaptured: (blob: Blob, previewUrl: string) => void;
  onCleared: () => void;
  disabled?: boolean;
}

// Native file/camera input rather than a MediaDevices/getUserMedia stream:
// lighter, delegates camera UI (and its failure handling) to the OS, and
// `capture="environment"` opens the rear camera directly on phones while
// degrading gracefully to a plain file picker on desktop.
export function ImageCapture({ previewUrl, onCaptured, onCleared, disabled }: ImageCaptureProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function openCamera() {
    setError(null);
    inputRef.current?.click();
  }

  async function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    // Reset so selecting the same file again (e.g. after a retake) still fires onChange.
    event.target.value = "";
    if (!file) return; // user cancelled the camera/picker - not an error

    if (!file.type.startsWith("image/")) {
      setError("That file isn't a supported image. Please choose or capture a photo.");
      return;
    }

    setIsProcessing(true);
    setError(null);
    try {
      const { blob } = await compressImage(file);
      const url = URL.createObjectURL(blob);
      onCaptured(blob, url);
    } catch {
      setError("Could not process that photo. Please try again.");
    } finally {
      setIsProcessing(false);
    }
  }

  function handleRetake() {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    onCleared();
    setError(null);
    openCamera();
  }

  return (
    <div className="capture-field">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={(event) => void handleChange(event)}
        hidden
        disabled={disabled}
      />

      {!previewUrl && (
        <button type="button" className="capture-button" onClick={openCamera} disabled={disabled || isProcessing}>
          {isProcessing ? "Processing photo…" : "Take Photo"}
        </button>
      )}

      {previewUrl && (
        <div className="image-preview">
          <img src={previewUrl} alt="Captured survey" />
          <button type="button" onClick={handleRetake} disabled={disabled || isProcessing}>
            Retake Photo
          </button>
        </div>
      )}

      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
