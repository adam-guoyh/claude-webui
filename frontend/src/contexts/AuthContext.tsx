import { useCallback, useEffect, useMemo, useState } from "react";
import { getApiUrl, getAuthCheckUrl, getAuthStatusUrl } from "../config/api";
import {
  authFetch,
  getAuthToken,
  setAuthToken,
  setUnauthorizedHandler,
} from "../utils/authFetch";
import {
  AuthContext,
  type AuthMode,
  type AuthStatus,
  type LoginError,
} from "./AuthContextTypes";

const USERNAME_STORAGE_KEY = "claude-code-webui-username";

function readStoredUsername(): string | null {
  try {
    return localStorage.getItem(USERNAME_STORAGE_KEY);
  } catch {
    return null;
  }
}

function persistUsername(name: string | null): void {
  try {
    if (name) localStorage.setItem(USERNAME_STORAGE_KEY, name);
    else localStorage.removeItem(USERNAME_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [mode, setMode] = useState<AuthMode>("none");
  const [username, setUsername] = useState<string | null>(readStoredUsername);

  // Bootstrap: ask the server about its auth configuration, then verify any
  // stored token. A stale token from a previous server config sends the user
  // back to /login.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(getAuthStatusUrl());
        if (!res.ok) throw new Error(`status ${res.status}`);
        const data = (await res.json()) as {
          authRequired: boolean;
          multiUser?: boolean;
        };

        if (cancelled) return;

        const resolvedMode: AuthMode = !data.authRequired
          ? "none"
          : data.multiUser
            ? "multi-user"
            : "shared-token";
        setMode(resolvedMode);

        if (resolvedMode === "none") {
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
          // Pick up the server-reported username if multi-user; this lets us
          // reconcile a localStorage cache against the real session owner.
          try {
            const body = (await check.json()) as { user?: string | null };
            if (body.user) {
              setUsername(body.user);
              persistUsername(body.user);
            }
          } catch {
            /* check response without body — fine */
          }
          setStatus("authenticated");
        } else {
          setAuthToken(null);
          persistUsername(null);
          setUsername(null);
          setStatus("unauthenticated");
        }
      } catch {
        // Network/parse error: behave as if auth is disabled rather than
        // trapping the user on /login against an unreachable backend.
        if (!cancelled) {
          setMode("none");
          setStatus("public");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  // Global 401 handler — any protected fetch can transition the app back to
  // the login screen without each call site having to know.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setAuthToken(null);
      persistUsername(null);
      setUsername(null);
      setStatus("unauthenticated");
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  // Shared-token login: only valid in shared-token mode.
  const login = useCallback(
    async (token: string): Promise<LoginError | null> => {
      const trimmed = token.trim();
      if (!trimmed) return { key: "auth.errorEmpty" };

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

  // Multi-user login: exchanges username+password for a session token via
  // POST /api/auth/login.
  const loginWithPassword = useCallback(
    async (
      usernameInput: string,
      password: string,
    ): Promise<LoginError | null> => {
      const u = usernameInput.trim();
      if (!u || !password) return { key: "auth.errorEmpty" };
      const res = await fetch(getApiUrl("/api/auth/login"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: u, password }),
      });
      if (res.ok) {
        const body = (await res.json()) as {
          token: string;
          username: string;
        };
        setAuthToken(body.token);
        setUsername(body.username);
        persistUsername(body.username);
        setStatus("authenticated");
        return null;
      }
      return res.status === 401
        ? { key: "auth.errorInvalid" }
        : { key: "auth.errorOther", params: { status: res.status } };
    },
    [],
  );

  const logout = useCallback(() => {
    // Best-effort server-side revocation; we always clear local state.
    void fetch(getApiUrl("/api/auth/logout"), {
      method: "POST",
      headers: { Authorization: `Bearer ${getAuthToken() ?? ""}` },
    }).catch(() => {});
    setAuthToken(null);
    persistUsername(null);
    setUsername(null);
    setStatus("unauthenticated");
  }, []);

  const value = useMemo(
    () => ({ status, mode, username, login, loginWithPassword, logout }),
    [status, mode, username, login, loginWithPassword, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}
