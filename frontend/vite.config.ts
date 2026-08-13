import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    // Basic PWA scaffold only: precaches the built app shell so the app can
    // be opened offline after a first visit. Custom caching strategies,
    // background sync, and the IndexedDB-backed sync engine are later phases.
    VitePWA({
      registerType: 'autoUpdate',
      // We register the generated service worker ourselves via the
      // `virtual:pwa-register` module (src/registerServiceWorker.ts) so
      // registration is explicit, typed application code rather than an
      // opaque auto-injected <script> tag - this is vite-plugin-pwa's own
      // recommended "official virtual registration" approach.
      injectRegister: false,
      manifest: {
        name: 'Survey App',
        short_name: 'Survey App',
        description: 'Offline-capable field survey capture app',
        theme_color: '#ffffff',
        background_color: '#ffffff',
        display: 'standalone',
        start_url: '/',
        icons: [
          {
            src: 'icons.svg',
            sizes: 'any',
            type: 'image/svg+xml',
          },
        ],
      },
    }),
  ],
})
