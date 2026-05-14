import { useState } from "react";
import { Navigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "../hooks/useAuth";
import type { LoginError } from "../contexts/AuthContextTypes";

export function Login() {
  const { t } = useTranslation();
  const { status, mode, login, loginWithPassword } = useAuth();
  const [token, setToken] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<LoginError | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900">
        <div className="w-8 h-8 border-2 border-slate-300 border-t-slate-600 rounded-full animate-spin" />
      </div>
    );
  }

  if (status === "public" || status === "authenticated") {
    return <Navigate to="/" replace />;
  }

  const isMulti = mode === "multi-user";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const result = isMulti
      ? await loginWithPassword(username, password)
      : await login(token);
    setSubmitting(false);
    if (result) setError(result);
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 dark:bg-slate-900 p-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm bg-white dark:bg-slate-800 rounded-xl shadow-sm border border-slate-200 dark:border-slate-700 p-6 space-y-4"
      >
        <div>
          <h1 className="text-slate-800 dark:text-slate-100 text-2xl font-bold tracking-tight">
            {t("app.title")}
          </h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
            {isMulti ? t("auth.subtitleMulti") : t("auth.subtitle")}
          </p>
        </div>

        {isMulti ? (
          <>
            <label className="block">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                {t("auth.usernameLabel")}
              </span>
              <input
                type="text"
                autoComplete="username"
                autoFocus
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                className="mt-1 block w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </label>
            <label className="block">
              <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
                {t("auth.passwordLabel")}
              </span>
              <input
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 block w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </label>
          </>
        ) : (
          <label className="block">
            <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
              {t("auth.tokenLabel")}
            </span>
            <input
              type="password"
              autoComplete="current-password"
              autoFocus
              value={token}
              onChange={(e) => setToken(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder={t("auth.tokenPlaceholder")}
            />
          </label>
        )}

        {error && (
          <div
            role="alert"
            className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-md px-3 py-2"
          >
            {"params" in error ? t(error.key, error.params) : t(error.key)}
          </div>
        )}

        <button
          type="submit"
          disabled={submitting}
          className="w-full px-4 py-2 rounded-lg bg-blue-600 text-white font-medium hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
        >
          {submitting ? t("auth.verifying") : t("auth.signIn")}
        </button>
      </form>
    </div>
  );
}
