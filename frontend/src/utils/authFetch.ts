// Shared bearer-token storage and fetch wrapper.
//
// The token is held in module-scope so non-React modules (e.g. handlers
// invoked from streaming callbacks) can read it without going through React
// context. AuthContext is the source of truth and pushes updates here via
// setAuthToken().

const STORAGE_KEY = "claude-code-webui-auth-token";

let currentToken: string | null = readStoredToken();
let onUnauthorized: (() => void) | null = null;

function readStoredToken(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function getAuthToken(): string | null {
  return currentToken;
}

export function setAuthToken(token: string | null): void {
  currentToken = token;
  try {
    if (token) {
      localStorage.setItem(STORAGE_KEY, token);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // localStorage might be unavailable (private mode etc.) — keep in-memory state.
  }
}

export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

/**
 * fetch wrapper that injects `Authorization: Bearer <token>` when a token is
 * present, and invokes the registered 401 handler so the app can clear state
 * and redirect to /login.
 */
export async function authFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
): Promise<Response> {
  const headers = new Headers(init.headers);
  if (currentToken && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${currentToken}`);
  }

  const response = await fetch(input, { ...init, headers });

  if (response.status === 401 && onUnauthorized) {
    onUnauthorized();
  }

  return response;
}
