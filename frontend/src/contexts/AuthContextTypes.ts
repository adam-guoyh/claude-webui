import { createContext } from "react";

export type AuthStatus =
  | "loading"
  | "public"
  | "authenticated"
  | "unauthenticated";

export interface AuthContextType {
  status: AuthStatus;
  /**
   * Validate the given token against the server and, on success, persist it
   * and transition to `authenticated`. Returns an error string when the
   * token is rejected so the login form can display it.
   */
  login: (token: string) => Promise<string | null>;
  logout: () => void;
}

export const AuthContext = createContext<AuthContextType | null>(null);
