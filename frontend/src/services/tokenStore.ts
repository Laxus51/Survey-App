// Access token: memory only, never persisted — gone on reload by design.
// Refresh token: localStorage — lets the app restore a session after being
// closed/reopened (offline-first PWA usage pattern) without re-login.
// See Phase 5A discussion: this is the accepted trade-off of Bearer-token
// auth without cookie infrastructure. Do not add the access token to any
// persistent storage.

const REFRESH_TOKEN_KEY = "survey_app.refresh_token";

let accessToken: string | null = null;
let sessionExpiredHandler: (() => void) | null = null;

export function getAccessToken(): string | null {
  return accessToken;
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_TOKEN_KEY);
}

export function setRefreshToken(token: string | null): void {
  if (token) {
    localStorage.setItem(REFRESH_TOKEN_KEY, token);
  } else {
    localStorage.removeItem(REFRESH_TOKEN_KEY);
  }
}

export function clearTokens(): void {
  accessToken = null;
  setRefreshToken(null);
}

// Registered once by AuthContext so the low-level http client (which has no
// React dependency) can signal "the refresh token is no longer valid" up to
// application state without importing React itself.
export function onSessionExpired(handler: () => void): void {
  sessionExpiredHandler = handler;
}

export function notifySessionExpired(): void {
  clearTokens();
  sessionExpiredHandler?.();
}
