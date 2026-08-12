import { useEffect, useState } from "react";
import type { StorageQuotaInfo } from "../services/storageQuota";
import { getStorageQuotaInfo, STORAGE_BLOCK_THRESHOLD, STORAGE_WARNING_THRESHOLD } from "../services/storageQuota";

export type StorageQuotaStatus = "checking" | "ok" | "warning" | "blocked" | "unsupported";

export function useStorageQuota(): { status: StorageQuotaStatus; info: StorageQuotaInfo | null } {
  const [status, setStatus] = useState<StorageQuotaStatus>("checking");
  const [info, setInfo] = useState<StorageQuotaInfo | null>(null);

  useEffect(() => {
    let cancelled = false;

    getStorageQuotaInfo().then((result) => {
      if (cancelled) return;
      setInfo(result);
      if (!result.supported) {
        setStatus("unsupported");
      } else if (result.usageRatio >= STORAGE_BLOCK_THRESHOLD) {
        setStatus("blocked");
      } else if (result.usageRatio >= STORAGE_WARNING_THRESHOLD) {
        setStatus("warning");
      } else {
        setStatus("ok");
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return { status, info };
}
