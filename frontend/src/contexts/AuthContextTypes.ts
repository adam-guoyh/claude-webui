import { createContext } from "react";

export type AuthStatus =
  | "loading"
  | "public"
  | "authenticated"
  | "unauthenticated";

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
  /**
   * Validate the given token against the server and, on success, persist it
   * and transition to `authenticated`. Returns a LoginError when the token is
   * rejected so the login form can render a localized message.
   */
  login: (token: string) => Promise<LoginError | null>;
  logout: () => void;
}

export const AuthContext = createContext<AuthContextType | null>(null);
