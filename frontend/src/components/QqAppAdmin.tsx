import { useCallback, useEffect, useState } from "react";
import { TrashIcon, PlusIcon } from "@heroicons/react/24/outline";
import { useTranslation } from "react-i18next";
import { authFetch } from "../utils/authFetch";
import { getApiUrl } from "../config/api";
import type {
  LarkSettingsResponse,
  QqAppCreateRequest,
  QqAppPublic,
  QqAppsResponse,
} from "../../../shared/types";

interface Props {
  onChange?: () => void;
}

interface FormState extends Omit<QqAppCreateRequest, "owner" | "sandbox"> {
  sandbox: boolean;
  owner: string;
}

/**
 * QQ app management card on the Integrations page. Mirrors LarkAppAdmin —
 * future cleanup is to extract a generic ProviderAppAdmin once the second
 * provider's shape is stable.
 */
export function QqAppAdmin({ onChange }: Props) {
  const { t } = useTranslation();
  const [apps, setApps] = useState<QqAppPublic[]>([]);
  const [settings, setSettings] = useState<LarkSettingsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [form, setForm] = useState<FormState>({
    appId: "",
    appSecret: "",
    sandbox: false,
    displayName: "",
    owner: "",
  });
  const [submitting, setSubmitting] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // Settings endpoint is shared across providers (it returns the
      // caller's role + global "can-manage" hint). For per-provider gating
      // the actual add/remove handlers consult the user's `manageApps`
      // allowlist.
      const [appsRes, settingsRes] = await Promise.all([
        authFetch(getApiUrl("/api/integrations/qq/apps")),
        authFetch(getApiUrl("/api/integrations/lark/settings")),
      ]);
      if (appsRes.status === 404 || settingsRes.status === 404) {
        setApps([]);
        setSettings(null);
        return;
      }
      if (!appsRes.ok) throw new Error(`HTTP ${appsRes.status}`);
      if (!settingsRes.ok) throw new Error(`HTTP ${settingsRes.status}`);
      const appsBody = (await appsRes.json()) as QqAppsResponse;
      const settingsBody =
        (await settingsRes.json()) as LarkSettingsResponse;
      setApps(appsBody.apps);
      setSettings(settingsBody);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : t("integrations.appsLoadFailed"),
      );
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const isAdmin = settings?.role === "admin" || settings?.role === "open";
  // For QQ the form is visible if the user is admin OR if at least one
  // owned QQ app is already on the list — we don't have a per-provider
  // capability endpoint yet, so we fall back to "let the server 403" if
  // a non-permitted user clicks add.
  const canManage =
    isAdmin || apps.some((a) => a.canManage && a.owner === undefined === false);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.appId.trim() || !form.appSecret.trim()) return;
    setSubmitting(true);
    setError(null);
    try {
      const body: QqAppCreateRequest = {
        appId: form.appId.trim(),
        appSecret: form.appSecret.trim(),
        sandbox: form.sandbox,
        displayName: form.displayName?.trim() || undefined,
      };
      if (isAdmin) body.owner = form.owner.trim() || null;
      const res = await authFetch(getApiUrl("/api/integrations/qq/apps"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const errBody = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(errBody.error || `HTTP ${res.status}`);
      }
      setForm({
        appId: "",
        appSecret: "",
        sandbox: false,
        displayName: "",
        owner: "",
      });
      await refresh();
      onChange?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("integrations.appAddFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  const handleRemove = async (app: QqAppPublic) => {
    if (!confirm(t("integrations.appConfirmRemove", { appId: app.appId })))
      return;
    setError(null);
    try {
      const res = await authFetch(
        getApiUrl(`/api/integrations/qq/apps/${encodeURIComponent(app.id)}`),
        { method: "DELETE" },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      await refresh();
      onChange?.();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : t("integrations.appRemoveFailed"),
      );
    }
  };

  if (!loading && settings === null && apps.length === 0 && !error) {
    return null;
  }

  return (
    <div className="mb-4 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">
        <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">
          {t("integrations.qqAppsTitle")}
        </div>
        <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
          {t("integrations.qqAppsSubtitle")}
        </div>
      </div>

      {error && (
        <div className="px-4 py-2 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20">
          {error}
        </div>
      )}

      {canManage && (
        <form
          onSubmit={handleAdd}
          className="px-4 py-3 grid sm:grid-cols-[1fr_1fr_auto_auto] gap-2 items-center border-b border-slate-200 dark:border-slate-700"
        >
          <input
            type="text"
            value={form.appId}
            onChange={(e) =>
              setForm((f) => ({ ...f, appId: e.target.value }))
            }
            placeholder={t("integrations.qqAppIdPlaceholder")}
            className="rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            autoComplete="off"
          />
          <input
            type="password"
            value={form.appSecret}
            onChange={(e) =>
              setForm((f) => ({ ...f, appSecret: e.target.value }))
            }
            placeholder={t("integrations.appSecretPlaceholder")}
            className="rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            autoComplete="off"
          />
          <label className="flex items-center gap-1 text-xs text-slate-600 dark:text-slate-300 px-2 py-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={form.sandbox}
              onChange={(e) =>
                setForm((f) => ({ ...f, sandbox: e.target.checked }))
              }
              className="rounded border-slate-300 dark:border-slate-600 text-blue-600 focus:ring-blue-500"
            />
            <span>{t("integrations.qqSandboxLabel")}</span>
          </label>
          <button
            type="submit"
            disabled={
              submitting || !form.appId.trim() || !form.appSecret.trim()
            }
            className="inline-flex items-center gap-1 px-3 py-2 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            <PlusIcon className="w-4 h-4" />
            {submitting ? t("integrations.appAdding") : t("integrations.appAdd")}
          </button>
          <input
            type="text"
            value={form.displayName ?? ""}
            onChange={(e) =>
              setForm((f) => ({ ...f, displayName: e.target.value }))
            }
            placeholder={t("integrations.appDisplayNamePlaceholder")}
            className={`${isAdmin ? "sm:col-span-2" : "sm:col-span-4"} rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500`}
            autoComplete="off"
          />
          {isAdmin && (
            <input
              type="text"
              value={form.owner}
              onChange={(e) =>
                setForm((f) => ({ ...f, owner: e.target.value }))
              }
              placeholder={t("integrations.appOwnerPlaceholder")}
              className="sm:col-span-2 rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              autoComplete="off"
              title={t("integrations.appOwnerHint")}
            />
          )}
        </form>
      )}

      <div className="px-4 py-3">
        {loading ? (
          <div className="text-sm text-slate-500 dark:text-slate-400">
            {t("common.loading")}
          </div>
        ) : apps.length === 0 ? (
          <div className="text-sm text-slate-500 dark:text-slate-400">
            {t("integrations.appsEmpty")}
          </div>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-700/60">
            {apps.map((app) => (
              <li
                key={app.id}
                className="flex items-center justify-between gap-3 py-2"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-sm font-medium text-slate-800 dark:text-slate-100">
                      {app.displayName || app.appId}
                    </span>
                    <span
                      className={`text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded ${
                        app.running
                          ? "bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300"
                          : "bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300"
                      }`}
                    >
                      {app.running
                        ? t("integrations.appStatusRunning")
                        : t("integrations.appStatusStopped")}
                    </span>
                    <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
                      {app.sandbox
                        ? t("integrations.qqSandboxLabel")
                        : t("integrations.qqProductionLabel")}
                    </span>
                    <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
                      {app.owner
                        ? t("integrations.appOwnerOf", { name: app.owner })
                        : t("integrations.appOwnerShared")}
                    </span>
                  </div>
                  {app.displayName && (
                    <div className="text-xs font-mono text-slate-500 dark:text-slate-400 truncate">
                      {app.appId}
                    </div>
                  )}
                </div>
                {app.canManage && (
                  <button
                    onClick={() => void handleRemove(app)}
                    className="p-1.5 rounded hover:bg-red-100 dark:hover:bg-red-900/40 text-red-600 dark:text-red-400"
                    aria-label={t("integrations.appRemove")}
                    title={t("integrations.appRemove")}
                  >
                    <TrashIcon className="w-4 h-4" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
