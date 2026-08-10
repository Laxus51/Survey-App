import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import * as authApi from "../services/authApi";
import * as tokenStore from "../services/tokenStore";
import type { User } from "../types/auth";

interface AuthContextValue {
  user: User | null;
  isAuthenticated: boolean;
  isInitializing: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);

  // Lets the low-level http client (no React dependency) signal "the
  // refresh token is no longer valid" up into application state.
  useEffect(() => {
    tokenStore.onSessionExpired(() => setUser(null));
  }, []);

  // Session restore on app open: redeem the persisted refresh token for a
  // fresh access token, silently, before rendering protected routes.
  useEffect(() => {
    let cancelled = false;

    async function restoreSession() {
      const refreshToken = tokenStore.getRefreshToken();
      if (!refreshToken) {
        setIsInitializing(false);
        return;
      }
      try {
        const tokens = await authApi.refresh(refreshToken);
        tokenStore.setAccessToken(tokens.access);
        tokenStore.setRefreshToken(tokens.refresh);
        const currentUser = await authApi.me();
        if (!cancelled) setUser(currentUser);
      } catch {
        tokenStore.clearTokens();
      } finally {
        if (!cancelled) setIsInitializing(false);
      }
    }

    restoreSession();
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    const tokens = await authApi.login(username, password);
    tokenStore.setAccessToken(tokens.access);
    tokenStore.setRefreshToken(tokens.refresh);
    const currentUser = await authApi.me();
    setUser(currentUser);
  }, []);

  const logout = useCallback(async () => {
    const refreshToken = tokenStore.getRefreshToken();
    try {
      if (refreshToken) await authApi.logout(refreshToken);
    } catch {
      // Best-effort: still clear local state even if the request failed
      // (e.g. offline, or the token was already invalid).
    } finally {
      tokenStore.clearTokens();
      setUser(null);
    }
  }, []);

  const value: AuthContextValue = {
    user,
    isAuthenticated: user !== null,
    isInitializing,
    login,
    logout,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
