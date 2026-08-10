import { authorizedRequest, rawRequest } from "./httpClient";
import type { TokenPair, User } from "../types/auth";

export function login(username: string, password: string): Promise<TokenPair> {
  return rawRequest<TokenPair>("/api/auth/login", {
    method: "POST",
    body: { username, password },
  });
}

export function refresh(refreshToken: string): Promise<TokenPair> {
  return rawRequest<TokenPair>("/api/auth/refresh", {
    method: "POST",
    body: { refresh: refreshToken },
  });
}

export function logout(refreshToken: string): Promise<void> {
  return authorizedRequest<void>("/api/auth/logout", {
    method: "POST",
    body: { refresh: refreshToken },
  });
}

export function me(): Promise<User> {
  return authorizedRequest<User>("/api/auth/me");
}
