// Native canvas-based compression - no image-processing library. A single
// downscale + re-encode pass is well within what canvas.toBlob does natively
// and keeps this dependency-free. Output is always JPEG: canvas WebP
// encoding isn't reliably supported on older mobile browsers, and JPEG is
// already backend-accepted, so there's no compatibility reason to prefer it.
//
// Isolated here (not inline in a component) so the offline persistence/sync
// workflow (later phases) can reuse it before saving/uploading a survey.

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const DEFAULT_MAX_DIMENSION = 1920;
const QUALITY_STEPS = [0.8, 0.6, 0.45, 0.3];

export interface CompressedImage {
  blob: Blob;
  width: number;
  height: number;
}

export interface CompressImageOptions {
  maxDimension?: number;
}

export async function compressImage(
  source: File | Blob,
  options: CompressImageOptions = {},
): Promise<CompressedImage> {
  const maxDimension = options.maxDimension ?? DEFAULT_MAX_DIMENSION;

  const image = await loadImage(source);
  try {
    const { width, height } = scaleToFit(image.naturalWidth, image.naturalHeight, maxDimension);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;

    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error("Canvas 2D context is unavailable");
    }
    context.drawImage(image, 0, 0, width, height);

    let smallestBlob: Blob | null = null;
    for (const quality of QUALITY_STEPS) {
      const blob = await canvasToBlob(canvas, "image/jpeg", quality);
      // An empty Blob is truthy, so a `!blob` check alone lets a zero-byte
      // result through - and `0 <= MAX_UPLOAD_BYTES` then reports it as a
      // successful compression. Mobile browsers do return an empty (or null)
      // blob when canvas encoding fails under memory pressure, which large
      // phone-camera images can easily trigger; treating that as success is
      // what let a 0-byte "photo" reach IndexedDB and be permanently
      // rejected by the server ("The submitted file is empty.") long after
      // the capture screen was gone.
      if (!blob || blob.size === 0) continue;
      if (smallestBlob === null || blob.size < smallestBlob.size) {
        smallestBlob = blob;
      }
      if (blob.size <= MAX_UPLOAD_BYTES) {
        return { blob, width, height };
      }
    }

    if (smallestBlob) {
      const sizeMb = (smallestBlob.size / 1024 / 1024).toFixed(1);
      throw new Error(`Compressed image is still ${sizeMb}MB, over the 10MB limit`);
    }
    throw new Error("Image compression produced no output");
  } finally {
    URL.revokeObjectURL(image.src);
  }
}

function loadImage(source: File | Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(source);
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Unable to decode the selected file as an image"));
    };
    image.src = url;
  });
}

function scaleToFit(width: number, height: number, maxDimension: number): { width: number; height: number } {
  if (width <= maxDimension && height <= maxDimension) {
    return { width, height };
  }
  const scale = maxDimension / Math.max(width, height);
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}
