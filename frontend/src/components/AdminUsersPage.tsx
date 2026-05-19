import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ChevronLeftIcon,
  TrashIcon,
  UserPlusIcon,
} from "@heroicons/react/24/outline";
import { useTranslation } from "react-i18next";
import { authFetch } from "../utils/authFetch";
import { getApiUrl } from "../config/api";
import { useAuth } from "../hooks/useAuth";
import { PasswordInput } from "./PasswordInput";
import { ProviderPermissionMenu } from "./ProviderPermissionMenu";
import { SettingsButton } from "./SettingsButton";
import { SettingsModal } from "./SettingsModal";
import { UserMenu } from "./UserMenu";
import type { UserRole } from "../contexts/AuthContextTypes";

interface UserPermissions {
  /** Provider ids the user is allowed to manage their own apps for. */
  manageApps?: string[];
}

interface ListedUser {
  username: string;
  role: UserRole;
  permissions: UserPermissions;
}

interface ProviderSummary {
  id: string;
  displayName: string;
}

/**
 * Full-page admin user management. Lives at /admin/users behind the
 * RequireAdmin guard. Previously this was a small panel inside the Settings
 * modal — that got cramped once the list grew, so it gets its own route now.
 */
export function AdminUsersPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { username: currentUser } = useAuth();
  const [users, setUsers] = useState<ListedUser[]>([]);
  const [providers, setProviders] = useState<ProviderSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [newRole, setNewRole] = useState<UserRole>("user");
  const [creating, setCreating] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [usersRes, intRes] = await Promise.all([
        authFetch(getApiUrl("/api/users")),
        authFetch(getApiUrl("/api/integrations")),
      ]);
      if (!usersRes.ok) throw new Error(`HTTP ${usersRes.status}`);
      const usersBody = (await usersRes.json()) as { users: ListedUser[] };
      setUsers(usersBody.users);
      // Providers list is best-effort — the admin page is still useful
      // even if it fails (we just won't render permission toggles).
      if (intRes.ok) {
        const intBody = (await intRes.json()) as {
          providers: ProviderSummary[];
        };
        setProviders(intBody.providers);
      } else {
        setProviders([]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load users");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const base = "Claude Code Web UI";
    document.title = `${t("adminUsers.title")} · ${base}`;
    return () => {
      document.title = base;
    };
  }, [t]);

  const filteredUsers = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => u.username.toLowerCase().includes(q));
  }, [users, filter]);

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

  const handleToggleProviderPerm = async (
    username: string,
    providerId: string,
    next: boolean,
  ): Promise<void> => {
    setError(null);
    const target = users.find((u) => u.username === username);
    const current = new Set(target?.permissions.manageApps ?? []);
    if (next) current.add(providerId);
    else current.delete(providerId);
    const nextList = Array.from(current);
    // Optimistic update so the checkbox doesn't lag the API round-trip.
    setUsers((prev) =>
      prev.map((u) =>
        u.username === username
          ? {
              ...u,
              permissions: { ...u.permissions, manageApps: nextList },
            }
          : u,
      ),
    );
    try {
      const res = await authFetch(
        getApiUrl(`/api/users/${encodeURIComponent(username)}/permissions`),
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ manageApps: nextList }),
        },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(body.error || `HTTP ${res.status}`);
      }
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Failed to update permission",
      );
      // Roll back optimistic update.
      await refresh();
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 transition-colors duration-300">
      <div className="max-w-3xl mx-auto p-6">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate("/")}
              className="p-2 rounded-lg bg-white/80 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 hover:bg-white dark:hover:bg-slate-800 transition-colors"
              aria-label={t("adminUsers.backAria")}
            >
              <ChevronLeftIcon className="w-5 h-5 text-slate-600 dark:text-slate-400" />
            </button>
            <h1 className="text-slate-800 dark:text-slate-100 text-2xl sm:text-3xl font-bold tracking-tight">
              {t("adminUsers.title")}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <UserMenu />
            <SettingsButton onClick={() => setIsSettingsOpen(true)} />
          </div>
        </div>

        {error && (
          <div className="mb-4 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-md px-3 py-2">
            {error}
          </div>
        )}

        <form
          onSubmit={handleCreate}
          className="mb-6 p-4 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm"
        >
          <h2 className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-3">
            {t("adminUsers.addSection")}
          </h2>
          <div className="grid sm:grid-cols-[1fr_1fr_auto_auto] gap-2">
            <input
              type="text"
              value={newUsername}
              onChange={(e) => setNewUsername(e.target.value)}
              placeholder={t("auth.usernameLabel")}
              className="rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              autoComplete="off"
            />
            <PasswordInput
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder={t("auth.passwordLabel")}
              className="rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-full"
              autoComplete="new-password"
            />
            <select
              value={newRole}
              onChange={(e) => setNewRole(e.target.value as UserRole)}
              className="rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="user">{t("usersPanel.roleUser")}</option>
              <option value="admin">{t("usersPanel.roleAdmin")}</option>
            </select>
            <button
              type="submit"
              disabled={creating || !newUsername.trim() || !newPassword}
              className="inline-flex items-center gap-1 px-3 py-2 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              <UserPlusIcon className="w-4 h-4" />
              {t("usersPanel.addUser")}
            </button>
          </div>
        </form>

        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">
            <input
              type="text"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder={t("adminUsers.filterPlaceholder")}
              className="w-full bg-transparent text-sm focus:outline-none text-slate-800 dark:text-slate-100"
            />
          </div>

          {loading ? (
            <div className="px-4 py-3 text-sm text-slate-500 dark:text-slate-400">
              {t("common.loading")}
            </div>
          ) : filteredUsers.length === 0 ? (
            <div className="px-4 py-3 text-sm text-slate-500 dark:text-slate-400">
              {t("usersPanel.empty")}
            </div>
          ) : (
            <ul className="divide-y divide-slate-200 dark:divide-slate-700">
              {filteredUsers.map((u) => (
                <li
                  key={u.username}
                  className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-slate-50 dark:hover:bg-slate-700/40"
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
                  <div className="flex items-center gap-3 shrink-0">
                    <ProviderPermissionMenu
                      providers={providers}
                      granted={u.permissions.manageApps ?? []}
                      forcedAll={u.role === "admin"}
                      onToggle={(providerId, next) =>
                        void handleToggleProviderPerm(
                          u.username,
                          providerId,
                          next,
                        )
                      }
                    />
                    <button
                      onClick={() => void handleDelete(u.username)}
                      disabled={u.username === currentUser}
                      className="p-1.5 rounded hover:bg-red-100 dark:hover:bg-red-900/40 text-red-600 dark:text-red-400 disabled:opacity-40 disabled:cursor-not-allowed"
                      aria-label={t("usersPanel.removeAria", {
                        username: u.username,
                      })}
                      title={t("usersPanel.removeAria", {
                        username: u.username,
                      })}
                    >
                      <TrashIcon className="w-4 h-4" />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <SettingsModal
          isOpen={isSettingsOpen}
          onClose={() => setIsSettingsOpen(false)}
        />
      </div>
    </div>
  );
}
