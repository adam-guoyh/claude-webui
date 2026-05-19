import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ChevronLeftIcon,
  ArrowPathIcon,
  ClipboardDocumentIcon,
  CheckIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";
import { useTranslation } from "react-i18next";
import { authFetch } from "../utils/authFetch";
import { getApiUrl } from "../config/api";
import { providerLabel } from "../utils/providerName";
import { useAuth } from "../hooks/useAuth";
import { LarkAppAdmin } from "./LarkAppAdmin";
import { QqAppAdmin } from "./QqAppAdmin";
import { SettingsButton } from "./SettingsButton";
import { SettingsModal } from "./SettingsModal";
import { UserMenu } from "./UserMenu";
import type {
  IntegrationBinding,
  IntegrationCodeResponse,
  IntegrationProvider,
  IntegrationsListResponse,
} from "../../../shared/types";

interface ActiveCode {
  code: string;
  expiresAt: string;
  ttlSeconds: number;
}

/**
 * Per-user "Integrations" page. Lets a signed-in webui user pair their account
 * with an IM provider (currently Feishu/Lark; designed to grow to WeChat/QQ
 * later). Pairing flow: generate a one-time code here, then DM the bot
 * `/link <code>` — see the README's bot section for the chat side.
 */
export function IntegrationsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { role } = useAuth();
  const isAdmin = role === "admin";
  const [providers, setProviders] = useState<IntegrationProvider[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  /** Active pending code per provider id. */
  const [codes, setCodes] = useState<Record<string, ActiveCode>>({});
  const [issuing, setIssuing] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authFetch(getApiUrl("/api/integrations"));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as IntegrationsListResponse;
      setProviders(body.providers);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("integrations.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const base = "Claude Code Web UI";
    document.title = `${t("integrations.title")} · ${base}`;
    return () => {
      document.title = base;
    };
  }, [t]);

  const handleGenerateCode = async (providerId: string) => {
    setIssuing(providerId);
    setError(null);
    try {
      const res = await authFetch(
        getApiUrl(`/api/integrations/${encodeURIComponent(providerId)}/code`),
        { method: "POST" },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const body = (await res.json()) as IntegrationCodeResponse;
      setCodes((prev) => ({ ...prev, [providerId]: body }));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("integrations.codeFailed"));
    } finally {
      setIssuing(null);
    }
  };

  const handleUnlink = async (
    providerId: string,
    binding: IntegrationBinding,
  ) => {
    if (!confirm(t("integrations.confirmUnlink"))) return;
    setError(null);
    try {
      const res = await authFetch(
        getApiUrl(
          `/api/integrations/${encodeURIComponent(providerId)}/bindings/${encodeURIComponent(binding.externalId)}`,
        ),
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
      setError(e instanceof Error ? e.message : t("integrations.unlinkFailed"));
    }
  };

  const copyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      // Best-effort; some browsers may block clipboard without secure context.
    }
    setCopied(code);
    setTimeout(() => setCopied((cur) => (cur === code ? null : cur)), 1500);
  };

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 transition-colors duration-300">
      <div className="max-w-3xl mx-auto p-6">
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate("/")}
              className="p-2 rounded-lg bg-white/80 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 hover:bg-white dark:hover:bg-slate-800 transition-colors"
              aria-label={t("integrations.backAria")}
            >
              <ChevronLeftIcon className="w-5 h-5 text-slate-600 dark:text-slate-400" />
            </button>
            <h1 className="text-slate-800 dark:text-slate-100 text-2xl sm:text-3xl font-bold tracking-tight">
              {t("integrations.title")}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => void refresh()}
              className="p-2 rounded-lg bg-white/80 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 hover:bg-white dark:hover:bg-slate-800 transition-colors"
              aria-label={t("integrations.refresh")}
              title={t("integrations.refresh")}
            >
              <ArrowPathIcon className="w-5 h-5 text-slate-600 dark:text-slate-400" />
            </button>
            <UserMenu />
            <SettingsButton onClick={() => setIsSettingsOpen(true)} />
          </div>
        </div>

        <p className="mb-6 text-sm text-slate-600 dark:text-slate-400">
          {t("integrations.subtitle")}
        </p>

        {error && (
          <div className="mb-4 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-md px-3 py-2">
            {error}
          </div>
        )}

        {/* Each provider admin card self-decides what to show based on
            caller role + per-user permission; safe to mount
            unconditionally. */}
        <LarkAppAdmin onChange={() => void refresh()} />
        <QqAppAdmin onChange={() => void refresh()} />
        {/* keep isAdmin available for future admin-specific UI hooks */}
        {isAdmin ? null : null}

        {loading ? (
          <div className="px-4 py-3 text-sm text-slate-500 dark:text-slate-400">
            {t("common.loading")}
          </div>
        ) : providers.length === 0 ? (
          <div className="px-4 py-6 text-sm text-slate-500 dark:text-slate-400 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
            {t("integrations.empty")}
          </div>
        ) : (
          <div className="space-y-4">
            {providers.map((p) => (
              <ProviderCard
                key={p.id}
                provider={p}
                activeCode={codes[p.id]}
                copied={copied}
                issuing={issuing === p.id}
                onGenerate={() => void handleGenerateCode(p.id)}
                onUnlink={(b) => void handleUnlink(p.id, b)}
                onCopy={(code) => void copyCode(code)}
              />
            ))}
          </div>
        )}

        <SettingsModal
          isOpen={isSettingsOpen}
          onClose={() => setIsSettingsOpen(false)}
        />
      </div>
    </div>
  );
}

interface ProviderCardProps {
  provider: IntegrationProvider;
  activeCode?: ActiveCode;
  copied: string | null;
  issuing: boolean;
  onGenerate: () => void;
  onUnlink: (binding: IntegrationBinding) => void;
  onCopy: (code: string) => void;
}

function ProviderCard({
  provider,
  activeCode,
  copied,
  issuing,
  onGenerate,
  onUnlink,
  onCopy,
}: ProviderCardProps) {
  const { t } = useTranslation();
  const minutes = activeCode ? Math.round(activeCode.ttlSeconds / 60) : 10;
  const expiresAt = activeCode
    ? new Date(activeCode.expiresAt).toLocaleTimeString()
    : "";

  return (
    <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700 flex items-center justify-between">
        <div>
          <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">
            {providerLabel(t, provider.id, provider.displayName)}
          </div>
          {!provider.enabled && (
            <div className="mt-1 text-xs text-amber-700 dark:text-amber-400">
              {t("integrations.notEnabled")}
            </div>
          )}
        </div>
        {provider.enabled && (
          <button
            onClick={onGenerate}
            disabled={issuing}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {issuing
              ? t("integrations.generating")
              : activeCode
                ? t("integrations.regenerate")
                : t("integrations.generateCode")}
          </button>
        )}
      </div>

      {activeCode && provider.enabled && (
        <div className="px-4 py-3 bg-blue-50 dark:bg-blue-900/20 border-b border-slate-200 dark:border-slate-700">
          <div className="text-xs text-slate-600 dark:text-slate-300 mb-2">
            {t("integrations.codeInstructions", {
              provider: providerLabel(t, provider.id, provider.displayName),
              minutes,
            })}
          </div>
          <div className="flex items-center gap-2">
            <code className="font-mono text-lg px-2 py-1 bg-white dark:bg-slate-900 rounded border border-slate-200 dark:border-slate-700 text-slate-900 dark:text-slate-100 tracking-widest select-all">
              /link {activeCode.code}
            </code>
            <button
              onClick={() => onCopy(activeCode.code)}
              className="p-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-700/50 text-slate-600 dark:text-slate-300"
              aria-label={t("integrations.copyAria")}
              title={t("integrations.copyAria")}
            >
              {copied === activeCode.code ? (
                <CheckIcon className="w-4 h-4 text-green-600 dark:text-green-400" />
              ) : (
                <ClipboardDocumentIcon className="w-4 h-4" />
              )}
            </button>
          </div>
          <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            {t("integrations.codeExpiresAt", { time: expiresAt })}
          </div>
          <div className="mt-1 text-xs text-amber-700 dark:text-amber-400">
            {t("integrations.codeOnceWarning")}
          </div>
        </div>
      )}

      <div className="px-4 py-3">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400 mb-2">
          {t("integrations.bindingsHeader")}
        </div>
        {provider.bindings.length === 0 ? (
          <div className="text-sm text-slate-500 dark:text-slate-400">
            {t("integrations.bindingsEmpty")}
          </div>
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-700/60">
            {provider.bindings.map((b) => (
              <li
                key={b.externalId}
                className="flex items-center justify-between gap-3 py-2"
              >
                <div className="min-w-0">
                  <div className="text-sm font-mono text-slate-800 dark:text-slate-100 truncate">
                    {b.externalId}
                  </div>
                  <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
                    {t("integrations.cwdLabel")}: {b.cwd}
                    {b.sessionId && (
                      <>
                        {" · "}
                        {t("integrations.sessionLabel")}:{" "}
                        {b.sessionId.slice(0, 8)}…
                      </>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => onUnlink(b)}
                  className="p-1.5 rounded hover:bg-red-100 dark:hover:bg-red-900/40 text-red-600 dark:text-red-400"
                  aria-label={t("integrations.unlink")}
                  title={t("integrations.unlink")}
                >
                  <TrashIcon className="w-4 h-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
