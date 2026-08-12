// Thresholds explicitly chosen for this implementation (not a system-design
// mandate - flagged in the Phase 6A report): 80% of the browser's storage
// quota warns the surveyor, 90% blocks new captures. Surveys carry image
// Blobs, so this stays conservative rather than waiting until storage is
// actually exhausted (at which point a capture would fail mid-save).
export const STORAGE_WARNING_THRESHOLD = 0.8;
export const STORAGE_BLOCK_THRESHOLD = 0.9;

export interface StorageQuotaInfo {
  supported: boolean;
  usageBytes: number;
  quotaBytes: number;
  usageRatio: number;
}

export async function getStorageQuotaInfo(): Promise<StorageQuotaInfo> {
  if (!("storage" in navigator) || typeof navigator.storage.estimate !== "function") {
    return { supported: false, usageBytes: 0, quotaBytes: 0, usageRatio: 0 };
  }

  const { usage = 0, quota = 0 } = await navigator.storage.estimate();
  return {
    supported: true,
    usageBytes: usage,
    quotaBytes: quota,
    usageRatio: quota > 0 ? usage / quota : 0,
  };
}
