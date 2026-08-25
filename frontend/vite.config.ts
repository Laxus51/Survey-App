import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  // Dev-server only (does not affect `vite build` or `vite preview`): lets
  // the Vite dev server be reached through an ngrok HTTPS tunnel for
  // real-device testing. `host: true` binds beyond localhost; `allowedHosts`
  // whitelists ngrok's forwarded Host header (leading "." = any subdomain).
  //
  // `proxy` forwards /api/* and /media/* to the local Django server so only
  // ONE ngrok tunnel (the frontend) is needed - the phone's browser sees a single
  // HTTPS origin for both the page and the API (same-origin, no CORS), and
  // that single HTTPS origin is what makes navigator.geolocation work on
  // the phone (it requires a secure context; a plain LAN http:// origin
  // would silently block it). `changeOrigin` is deliberately left off (its
  // default is false): Django's SurveySerializer builds absolute image URLs
  // from the Host header it receives via request.build_absolute_uri(), so
  // that header must stay the real ngrok host the phone can reach, not be
  // rewritten to "localhost:8000" (which is meaningless off this machine) -
  // DJANGO_ALLOWED_HOSTS' ".ngrok-free.dev"/".ngrok-free.app" wildcards are
  // what let Django accept that real Host instead. ngrok's own
  // X-Forwarded-Proto header is left untouched so SECURE_PROXY_SSL_HEADER
  // still sees "https" for those same URLs.
  server: {
    host: true,
    allowedHosts: ['.ngrok-free.app', '.ngrok-free.dev', '.ngrok.app'],
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
      },
      // Survey images are served from here (SurveySerializer's absolute
      // image URLs point at MEDIA_URL="/media/") - without this, Vite's SPA
      // fallback serves index.html for any unmatched path, so survey photos
      // would silently render as the app shell instead of an image.
      '/media': {
        target: 'http://localhost:8000',
      },
    },
  },
  // `vite preview` needs its own copy of the above - it does not inherit
  // `server`. Preview is what serves the production build, and only the
  // production build has a real service worker (vite-plugin-pwa stubs
  // registration out in dev), so this is the only way to exercise genuine
  // offline behaviour - app-shell caching, reloading with no network, and
  // launching the installed PWA offline - on a real device.
  // Pinned to 5173 so the existing ngrok tunnel works unchanged; run it
  // instead of `npm run dev`, not alongside it.
  preview: {
    host: true,
    port: 5173,
    allowedHosts: ['.ngrok-free.app', '.ngrok-free.dev', '.ngrok.app'],
    proxy: {
      '/api': {
        target: 'http://localhost:8000',
      },
      '/media': {
        target: 'http://localhost:8000',
      },
    },
  },
  plugins: [
    react(),
    tailwindcss(),
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
