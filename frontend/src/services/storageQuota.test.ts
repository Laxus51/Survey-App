import { afterEach, describe, expect, it, vi } from "vitest";
import { getStorageQuotaInfo, STORAGE_BLOCK_THRESHOLD, STORAGE_WARNING_THRESHOLD } from "./storageQuota";

describe("getStorageQuotaInfo", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reports unsupported when navigator.storage.estimate is unavailable", async () => {
    const result = await getStorageQuotaInfo();
    // jsdom does not implement the StorageManager API.
    expect(result.supported).toBe(false);
  });

  it("computes the usage ratio from a mocked StorageManager estimate", async () => {
    vi.stubGlobal("navigator", {
      ...navigator,
      storage: { estimate: vi.fn().mockResolvedValue({ usage: 800, quota: 1000 }) },
    });

    const result = await getStorageQuotaInfo();

    expect(result.supported).toBe(true);
    expect(result.usageRatio).toBeCloseTo(0.8);
  });

  it("documents the chosen warning/block thresholds", () => {
    expect(STORAGE_WARNING_THRESHOLD).toBe(0.8);
    expect(STORAGE_BLOCK_THRESHOLD).toBe(0.9);
  });
});
