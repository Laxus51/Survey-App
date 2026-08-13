import { registerSW } from "virtual:pwa-register";

// Registers the Workbox service worker vite-plugin-pwa generates at build
// time (dist/sw.js), which precaches the app shell (built JS/CSS/HTML,
// manifest, icons - see vite.config.ts) so the app can still load with no
// network. `registerType: 'autoUpdate'` (vite.config.ts) means a new
// version activates and takes over automatically; no update-prompt UI is
// implemented here, only lifecycle logging.
//
// In `npm run dev`, vite-plugin-pwa resolves `virtual:pwa-register` to a
// no-op stub (devOptions.enabled is not set, so no service worker exists to
// register in dev) - calling this is always safe.
//
// This registers the app shell only. It does not, and must not, cache or
// intercept `/api/*` requests - see vite.config.ts / dist/sw.js for the
// precache manifest. IndexedDB + the sync engine remain the only source of
// truth for offline survey data.
export function registerServiceWorker(): void {
  registerSW({
    onRegisteredSW(swScriptUrl) {
      console.info(`Service worker registered: ${swScriptUrl}`);
    },
    onOfflineReady() {
      console.info("App shell cached - the app can now load offline.");
    },
    onNeedRefresh() {
      console.info("A new version was found and will be applied automatically.");
    },
    onRegisterError(error) {
      console.error("Service worker registration failed.", error);
    },
  });
}
