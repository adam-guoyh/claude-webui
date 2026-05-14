import { useCallback, useEffect, useState } from "react";
import { TrashIcon, UserPlusIcon } from "@heroicons/react/24/outline";
import { useTranslation } from "react-i18next";
import { useAuth } from "../../hooks/useAuth";
import { getApiUrl } from "../../config/api";
import { authFetch } from "../../utils/authFetch";
import type { UserRole } from "../../contexts/AuthContextTypes";

interface ListedUser {
  username: string;
  role: UserRole;
}

/**
 * Admin-only user management panel. Hides itself entirely for non-admins —
 * the SettingsModal renders <UsersPanel /> unconditionally; it knows when to
 * render nothing.
 */
export function UsersPanel() {
  const { t } = useTranslation();
  const { role, username: currentUser } = useAuth();
  const [users, setUsers] = useState<ListedUser[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<UserRole>("user");
  const [creating, setCreating] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authFetch(getApiUrl("/api/users"));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { users: ListedUser[] };
      setUsers(body.users);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load users");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (role === "admin") void refresh();
  }, [role, refresh]);

  if (role !== "admin") return null;

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newUsername.trim() || !newPassword) return;
    setCreating(true);
    setError(null);
    try {
      const res = await authFetch(getApiUrl("/api/users"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: newUsername.trim(),
          password: newPassword,
          role: newRole,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
          code?: string;
        };
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      setNewUsername("");
      setNewPassword("");
      setNewRole("user");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create user");
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (username: string) => {
    if (!confirm(t("usersPanel.confirmDelete", { username }))) return;
    try {
      const res = await authFetch(
        getApiUrl(`/api/users/${encodeURIComponent(username)}`),
        { method: "DELETE" },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete user");
    }
  };

  return (
    <div className="pt-4 border-t border-slate-200 dark:border-slate-700 space-y-3">
      <h3 className="text-lg font-medium text-slate-800 dark:text-slate-100">
        {t("usersPanel.title")}
      </h3>

      {error && (
        <div className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-md px-3 py-2">
          {error}
        </div>
      )}

      <form
        onSubmit={handleCreate}
        className="flex flex-col gap-2 p-3 bg-slate-50 dark:bg-slate-900/40 rounded-lg border border-slate-200 dark:border-slate-700"
      >
        <div className="flex gap-2">
          <input
            type="text"
            value={newUsername}
            onChange={(e) => setNewUsername(e.target.value)}
            placeholder={t("auth.usernameLabel")}
            className="flex-1 min-w-0 rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            autoComplete="off"
          />
          <select
            value={newRole}
            onChange={(e) => setNewRole(e.target.value as UserRole)}
            className="rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="user">{t("usersPanel.roleUser")}</option>
            <option value="admin">{t("usersPanel.roleAdmin")}</option>
          </select>
        </div>
        <div className="flex gap-2">
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder={t("auth.passwordLabel")}
            className="flex-1 min-w-0 rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            autoComplete="new-password"
          />
          <button
            type="submit"
            disabled={creating || !newUsername.trim() || !newPassword}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <UserPlusIcon className="w-4 h-4" />
            {t("usersPanel.addUser")}
          </button>
        </div>
      </form>

      <div className="space-y-1">
        {loading ? (
          <div className="text-xs text-slate-500 dark:text-slate-400 px-2 py-3">
            {t("common.loading")}
          </div>
        ) : users.length === 0 ? (
          <div className="text-xs text-slate-500 dark:text-slate-400 px-2 py-3">
            {t("usersPanel.empty")}
          </div>
        ) : (
          users.map((u) => (
            <div
              key={u.username}
              className="flex items-center justify-between gap-2 px-3 py-2 rounded-md hover:bg-slate-50 dark:hover:bg-slate-700/40"
            >
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-medium text-slate-800 dark:text-slate-100 truncate">
                  {u.username}
                </span>
                {u.role === "admin" && (
                  <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300">
                    {t("usersPanel.roleAdmin")}
                  </span>
                )}
                {u.username === currentUser && (
                  <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
                    {t("usersPanel.you")}
                  </span>
                )}
              </div>
              <button
                onClick={() => void handleDelete(u.username)}
                disabled={u.username === currentUser}
                className="p-1.5 rounded hover:bg-red-100 dark:hover:bg-red-900/40 text-red-600 dark:text-red-400 disabled:opacity-40 disabled:cursor-not-allowed"
                aria-label={t("usersPanel.removeAria", {
                  username: u.username,
                })}
                title={t("usersPanel.removeAria", { username: u.username })}
              >
                <TrashIcon className="w-4 h-4" />
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
