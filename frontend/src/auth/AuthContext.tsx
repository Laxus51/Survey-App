import { createContext, useCallback, useContext, useEffect, useState } from "react";
import type { ReactNode } from "react";
import * as authApi from "../services/authApi";
import { ApiError } from "../services/httpClient";
import * as tokenStore from "../services/tokenStore";
import type { User } from "../types/auth";

interface AuthContextValue {
  user: User | null;
  isAuthenticated: boolean;
  isInitializing: boolean;
  // False when the browser refused to persist the session (private browsing,
  // blocked site data, full quota). The session still works for as long as
  // the page stays open; it just won't survive a reload.
  isSessionPersistent: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isInitializing, setIsInitializing] = useState(true);
  const [isSessionPersistent, setIsSessionPersistent] = useState(true);

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
        tokenStore.setCachedUser(currentUser);
        if (!cancelled) setUser(currentUser);
      } catch (error) {
        // Only the server actually rejecting the token ends the session. A
        // network failure means we simply couldn't ask - the normal case when
        // a surveyor reopens the app in the field with no signal - and must
        // not destroy a still-valid refresh token, which would lock them out
        // of the offline data on their own device until they find coverage.
        if (error instanceof ApiError) {
          tokenStore.clearTokens();
          if (!cancelled) setUser(null);
        } else {
          // Offline: trust the cached profile so local capture and the
          // pending-sync list stay usable. No access token is restored, so
          // the first call once back online 401s and transparently refreshes.
          const cachedUser = tokenStore.getCachedUser();
          if (!cancelled && cachedUser) setUser(cachedUser);
        }
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

    // Persisting is best-effort. A browser that won't store anything must not
    // block sign-in outright - the surveyor can still work this session, and
    // capture/IndexedDB are unaffected. Previously an unwritable localStorage
    // threw straight out of login() and surfaced as a generic
    // "Something went wrong", with the server showing a perfectly good 200.
    let persisted = true;
    try {
      tokenStore.setRefreshToken(tokens.refresh);
    } catch (error) {
      if (!(error instanceof tokenStore.StorageUnavailableError)) throw error;
      persisted = false;
    }

    const currentUser = await authApi.me();
    try {
      tokenStore.setCachedUser(currentUser);
    } catch (error) {
      if (!(error instanceof tokenStore.StorageUnavailableError)) throw error;
      persisted = false;
    }

    setIsSessionPersistent(persisted);
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
    isSessionPersistent,
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
