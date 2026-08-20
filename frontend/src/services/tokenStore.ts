// Access token: memory only, never persisted — gone on reload by design.
// Refresh token: localStorage — lets the app restore a session after being
// closed/reopened (offline-first PWA usage pattern) without re-login.
// See Phase 5A discussion: this is the accepted trade-off of Bearer-token
// auth without cookie infrastructure. Do not add the access token to any
// persistent storage.

import type { User } from "../types/auth";

const REFRESH_TOKEN_KEY = "survey_app.refresh_token";
// The signed-in user's own profile (id/username/email - no credential), kept
// alongside the refresh token so the app can restore a session on an offline
// reload, where /api/auth/me is unreachable by definition. Without it a
// surveyor who reopens the app with no signal is shown the login screen and
// locked out of the offline data sitting on their own device.
const USER_PROFILE_KEY = "survey_app.user_profile";

let accessToken: string | null = null;
let sessionExpiredHandler: (() => void) | null = null;

// localStorage is not guaranteed to work: private browsing, blocked site
// data, and a full quota all make setItem throw, and on some mobile browsers
// even reading throws. Every access here is guarded so a storage failure
// degrades the session to memory-only (usable now, not restorable after a
// reload) instead of throwing out of the middle of login.
export class StorageUnavailableError extends Error {
  constructor(cause: unknown) {
    super("Browser storage is unavailable, so the session could not be saved.");
    this.name = "StorageUnavailableError";
    this.cause = cause;
  }
}

function readItem(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeItem(key: string, value: string | null): void {
  try {
    if (value === null) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, value);
    }
  } catch (error) {
    throw new StorageUnavailableError(error);
  }
}

export function getAccessToken(): string | null {
  return accessToken;
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getRefreshToken(): string | null {
  return readItem(REFRESH_TOKEN_KEY);
}

export function setRefreshToken(token: string | null): void {
  writeItem(REFRESH_TOKEN_KEY, token);
}

export function getCachedUser(): User | null {
  const raw = readItem(USER_PROFILE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as User;
  } catch {
    // Corrupt/unparseable entry - treat as absent rather than breaking startup.
    return null;
  }
}

export function setCachedUser(user: User | null): void {
  writeItem(USER_PROFILE_KEY, user ? JSON.stringify(user) : null);
}

// Never throws: clearing runs on logout and on session expiry, both of which
// must complete even if storage is unwritable. The in-memory access token is
// dropped first, so the session ends regardless of what localStorage does.
export function clearTokens(): void {
  accessToken = null;
  try {
    setRefreshToken(null);
  } catch {
    // Storage unavailable - nothing was persisted to begin with.
  }
  try {
    setCachedUser(null);
  } catch {
    // As above.
  }
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
