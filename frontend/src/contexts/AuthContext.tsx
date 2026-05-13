import { useCallback, useEffect, useMemo, useState } from "react";
import { getAuthCheckUrl, getAuthStatusUrl } from "../config/api";
import {
  authFetch,
  getAuthToken,
  setAuthToken,
  setUnauthorizedHandler,
} from "../utils/authFetch";
import {
  AuthContext,
  type AuthStatus,
  type LoginError,
} from "./AuthContextTypes";

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");

  // Bootstrap: ask the server whether auth is required, then verify any
  // stored token. We don't trust the cached token alone — a stale token from
  // a previous server config should send the user back to /login.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(getAuthStatusUrl());
        if (!res.ok) throw new Error(`status ${res.status}`);
        const data = (await res.json()) as { authRequired: boolean };

        if (cancelled) return;

        if (!data.authRequired) {
          setStatus("public");
          return;
        }

        const stored = getAuthToken();
        if (!stored) {
          setStatus("unauthenticated");
          return;
        }

        const check = await authFetch(getAuthCheckUrl());
        if (cancelled) return;
        if (check.ok) {
          setStatus("authenticated");
        } else {
          setAuthToken(null);
          setStatus("unauthenticated");
        }
      } catch {
        // Network/parse error: behave as if auth is disabled so the user
        // isn't trapped on a login screen against an unreachable backend.
        // Real protected requests will surface the underlying error.
        if (!cancelled) setStatus("public");
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Register a global 401 handler so any protected fetch can transition the
  // app back to the login screen without each call site having to know.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setAuthToken(null);
      setStatus("unauthenticated");
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  const login = useCallback(
    async (token: string): Promise<LoginError | null> => {
      const trimmed = token.trim();
      if (!trimmed) return { key: "auth.errorEmpty" };

      // Tentatively set the token so authFetch picks it up for the check call.
      setAuthToken(trimmed);
      const res = await authFetch(getAuthCheckUrl());
      if (res.ok) {
        setStatus("authenticated");
        return null;
      }
      setAuthToken(null);
      return res.status === 401
        ? { key: "auth.errorInvalid" }
        : { key: "auth.errorOther", params: { status: res.status } };
    },
    [],
  );

  const logout = useCallback(() => {
    setAuthToken(null);
    setStatus("unauthenticated");
  }, []);

  const value = useMemo(
    () => ({ status, login, logout }),
    [status, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
