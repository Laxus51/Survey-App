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
  const response = await fetch(buildUrl(path, options.query), init);
  return parseResponse<T>(response);
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
      .catch(() => {
        tokenStore.notifySessionExpired();
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
  const accessToken = tokenStore.getAccessToken();
  const headers = new Headers(init.headers);
  if (accessToken) headers.set("Authorization", `Bearer ${accessToken}`);

  let response = await fetch(buildUrl(path, options.query), { ...init, headers });

  if (response.status === 401) {
    const refreshed = await ensureFreshAccessToken();
    if (refreshed) {
      const retryHeaders = new Headers(init.headers);
      retryHeaders.set("Authorization", `Bearer ${tokenStore.getAccessToken()}`);
      response = await fetch(buildUrl(path, options.query), { ...init, headers: retryHeaders });
    }
  }

  return parseResponse<T>(response);
}
