// Central place to read build-time environment configuration.
// Actual API client construction happens in src/services (Phase 5).
//
// Falls back to the page's own origin when VITE_API_BASE_URL isn't set
// (empty string counts as unset - the committed .env.production ships it
// blank on purpose). This is what lets one single build work correctly both
// from localhost and through an ngrok tunnel: Vite's dev/preview proxy
// (vite.config.ts) forwards /api/* and /media/* to Django from either
// origin, so resolving relative to "wherever this page is being viewed from"
// keeps every request same-origin - no CORS, and no need to hardcode a
// specific tunnel URL that has to be swapped every time you switch between
// testing locally and over the tunnel. A real deploy (frontend and backend
// on genuinely different domains, e.g. Vercel + Render) still works exactly
// as before by setting VITE_API_BASE_URL explicitly at build time, which
// takes priority over this fallback.
const configured = import.meta.env.VITE_API_BASE_URL as string;
export const API_BASE_URL = configured || window.location.origin;
