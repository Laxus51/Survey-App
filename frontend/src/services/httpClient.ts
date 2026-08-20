import { API_BASE_URL } from "../config/env";
import * as tokenStore from "./tokenStore";
import type { TokenPair } from "../types/auth";

export class ApiError extends Error {
  status: number;
  data: unknown;

  constructor(status: number, data: unknown) {
    super(`Request failed with status ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.data = data;
  }
}

interface RequestOptions {
  method?: string;
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  // Aborts the request after this many ms. fetch() has no timeout of its own,
  // so a stalled connection (common on mobile right as connectivity returns)
  // hangs forever - which strands the sync engine's in-flight lock and
  // silently disables every later sync trigger.
  timeoutMs?: number;
}

// AbortController + setTimeout rather than AbortSignal.timeout(): the latter
// is unavailable on the older mobile browsers this app targets.
function withTimeout(timeoutMs: number | undefined): {
  signal: AbortSignal | undefined;
  done: () => void;
} {
  if (!timeoutMs) return { signal: undefined, done: () => {} };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return { signal: controller.signal, done: () => clearTimeout(timer) };
}

function buildUrl(path: string, query?: RequestOptions["query"]): string {
  const url = new URL(path, API_BASE_URL);
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
  }
  return url.toString();
}

function buildRequestInit(options: RequestOptions): RequestInit {
  if (options.body === undefined) {
    return { method: options.method ?? "GET" };
  }
  if (options.body instanceof FormData) {
    return { method: options.method ?? "POST", body: options.body };
  }
  return {
    method: options.method ?? "POST",
    body: JSON.stringify(options.body),
    headers: { "Content-Type": "application/json" },
  };
}

async function parseResponse<T>(response: Response): Promise<T> {
  if (!response.ok) {
    let data: unknown = null;
    try {
      data = await response.json();
    } catch {
      // Response body wasn't JSON (or was empty) - fall through with null data.
    }
    throw new ApiError(response.status, data);
  }
  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

// No auth header, no refresh-retry. Used for the auth endpoints themselves
// (login/refresh/logout) to avoid the obvious infinite-loop risk of a 401
// from the refresh call itself triggering another refresh attempt.
export async function rawRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const init = buildRequestInit(options);
  const { signal, done } = withTimeout(options.timeoutMs);
  try {
    const response = await fetch(buildUrl(path, options.query), { ...init, signal });
    return await parseResponse<T>(response);
  } finally {
    done();
  }
}

// Concurrent 401s must not each fire their own refresh call: with
// ROTATE_REFRESH_TOKENS + BLACKLIST_AFTER_ROTATION on the backend, a second
// parallel refresh using the now-already-rotated-out token would itself
// fail. All callers share the one in-flight refresh instead.
let refreshPromise: Promise<boolean> | null = null;

async function ensureFreshAccessToken(): Promise<boolean> {
  const refreshToken = tokenStore.getRefreshToken();
  if (!refreshToken) return false;

  if (!refreshPromise) {
    refreshPromise = rawRequest<TokenPair>("/api/auth/refresh", {
      method: "POST",
      body: { refresh: refreshToken },
    })
      .then((tokens) => {
        tokenStore.setAccessToken(tokens.access);
        tokenStore.setRefreshToken(tokens.refresh);
        return true;
      })
      .catch((error: unknown) => {
        // Only end the session when the server actually rejected the token.
        // A network failure (fetch threw) means the request never arrived -
        // discarding a still-valid refresh token there would sign a surveyor
        // out mid-field the moment they lost signal. The caller still gets
        // `false`, so the request fails normally and the sync engine
        // classifies it as a network error rather than an auth failure.
        if (error instanceof ApiError) {
          tokenStore.notifySessionExpired();
        }
        return false;
      })
      .finally(() => {
        refreshPromise = null;
      });
  }
  return refreshPromise;
}

// Attaches the Authorization header and, on a 401, refreshes once and
// retries the original request exactly one time.
export async function authorizedRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const init = buildRequestInit(options);

  // The access token lives in memory only, so after every reload there isn't
  // one until a refresh runs. Sending the request regardless means a
  // guaranteed 401 - and on the sync endpoint that means uploading the whole
  // photo just to be told to authenticate, then uploading it a second time.
  // Besides doubling a field surveyor's mobile data, the server answers that
  // first 401 without reading the upload body, which is a well-known way to
  // leave the connection unusable and make the immediate retry fail outright.
  // Redeeming the refresh token first (only when we hold nothing to present)
  // avoids both.
  if (!tokenStore.getAccessToken() && tokenStore.getRefreshToken()) {
    await ensureFreshAccessToken();
  }

  const accessToken = tokenStore.getAccessToken();
  const headers = new Headers(init.headers);
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);

  // Each attempt gets its own timer, so the retry below is not cut short by
  // time the first attempt already spent.
  const first = withTimeout(options.timeoutMs);
  let response: Response;
  try {
    response = await fetch(buildUrl(path, options.query), { ...init, headers, signal: first.signal });
  } finally {
    first.done();
  }

  if (response.status === 401) {
    const refreshed = await ensureFreshAccessToken();
    if (refreshed) {
      const retryHeaders = new Headers(init.headers);
      retryHeaders.set("Authorization", `Bearer ${tokenStore.getAccessToken()}`);
      const retry = withTimeout(options.timeoutMs);
      try {
        response = await fetch(buildUrl(path, options.query), {
          ...init,
          headers: retryHeaders,
          signal: retry.signal,
        });
      } finally {
        retry.done();
      }
    }
  }

  return parseResponse<T>(response);
}
