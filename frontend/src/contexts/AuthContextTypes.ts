import { createContext } from "react";

export type AuthStatus =
  | "loading"
  | "public"
  | "authenticated"
  | "unauthenticated";

/** Server-reported auth configuration, exposed to the login form. */
export type AuthMode = "none" | "shared-token" | "multi-user";

export type UserRole = "admin" | "user";

/**
 * Translation-key form of a login error so the login form can pick the right
 * locale. Pairs with the `auth.error*` keys in the i18n resources.
 */
export type LoginError =
  | { key: "auth.errorEmpty" }
  | { key: "auth.errorInvalid" }
  | { key: "auth.errorOther"; params: { status: number } };

export interface AuthContextType {
  status: AuthStatus;
  mode: AuthMode;
  /** Username when authenticated via multi-user login; null otherwise. */
  username: string | null;
  /** Role when authenticated via multi-user login; null otherwise. */
  role: UserRole | null;
  /**
   * Shared-token login: pass the token. Returns a LoginError when rejected.
   */
  login: (token: string) => Promise<LoginError | null>;
  /**
   * Multi-user login: exchanges username+password for a session token.
   */
  loginWithPassword: (
    username: string,
    password: string,
  ) => Promise<LoginError | null>;
  logout: () => void;
}

export const AuthContext = createContext<AuthContextType | null>(null);
