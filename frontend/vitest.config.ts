import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
    // Enables @testing-library/react's automatic unmount-after-each-test
    // cleanup; test files still use explicit `import { describe, it, ... }`
    // rather than relying on these as ambient globals.
    globals: true,
    // Default "threads" (worker_threads) pool hangs indefinitely on
    // fake-indexeddb's Blob read-back (confirmed: identical code works
    // fine in a plain Node script). "forks" (child_process) doesn't have
    // whatever worker_threads-specific incompatibility causes that.
    pool: "forks",
  },
});
