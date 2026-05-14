import { useCallback, useEffect, useState } from "react";
import {
  ArrowUpIcon,
  FolderIcon,
  DocumentIcon,
  HomeIcon,
} from "@heroicons/react/24/outline";
import { useTranslation } from "react-i18next";
import { authFetch } from "../utils/authFetch";
import { getApiUrl } from "../config/api";

interface BrowseEntry {
  name: string;
  isDirectory: boolean;
}

interface BrowseResponse {
  path: string;
  parent: string | null;
  entries: BrowseEntry[];
}

interface DirectoryBrowserProps {
  open: boolean;
  /** Initial path to display; falls back to the server's $HOME. */
  initialPath?: string | null;
  /** Resolves with the absolute path the user picked, or null on cancel. */
  onResolve: (path: string | null) => void;
}

/**
 * Modal for navigating the server's filesystem and picking a directory.
 *
 * Used by the project switcher / project selector so the user can browse
 * instead of remembering an exact absolute path. Hits GET /api/fs/browse on
 * every navigation; results aren't cached because the underlying filesystem
 * is mutable. Hidden entries are off by default with a toggle.
 */
export function DirectoryBrowser({
  open,
  initialPath,
  onResolve,
}: DirectoryBrowserProps) {
  const { t } = useTranslation();
  const [path, setPath] = useState<string | null>(null);
  const [parent, setParent] = useState<string | null>(null);
  const [entries, setEntries] = useState<BrowseEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showHidden, setShowHidden] = useState(false);

  const load = useCallback(
    async (target: string | null) => {
      setLoading(true);
      setError(null);
      try {
        const url = new URL(getApiUrl("/api/fs/browse"), window.location.origin);
        if (target) url.searchParams.set("path", target);
        if (showHidden) url.searchParams.set("showHidden", "1");
        const res = await authFetch(url.pathname + url.search);
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: string;
          };
          throw new Error(body.error || `HTTP ${res.status}`);
        }
        const body = (await res.json()) as BrowseResponse;
        setPath(body.path);
        setParent(body.parent);
        setEntries(body.entries.filter((e) => e.isDirectory));
        // The picker only ever resolves a directory, so we hide files entirely
        // — keeping them in the list invites accidental clicks.
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to browse");
      } finally {
        setLoading(false);
      }
    },
    [showHidden],
  );

  useEffect(() => {
    if (open) void load(initialPath ?? null);
  }, [open, initialPath, load]);

  if (!open) return null;

  const handleBackdrop = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onResolve(null);
  };

  // Split path into segments for the breadcrumb.
  const segments = path
    ? path
        .replace(/\/+$/, "")
        .split("/")
        .filter((s) => s.length > 0)
    : [];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={handleBackdrop}
    >
      <div className="w-full max-w-lg bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">
          <div className="text-sm font-medium text-slate-800 dark:text-slate-100">
            {t("directoryBrowser.title")}
          </div>
        </div>

        {/* Breadcrumb */}
        <div className="px-3 py-2 border-b border-slate-200 dark:border-slate-700 flex items-center gap-1 flex-wrap text-xs">
          <button
            onClick={() => void load(null)}
            className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-700/60 text-slate-500 dark:text-slate-400"
            aria-label={t("directoryBrowser.home")}
            title={t("directoryBrowser.home")}
          >
            <HomeIcon className="w-4 h-4" />
          </button>
          <button
            onClick={() => void load("/")}
            className="px-1 py-0.5 rounded hover:bg-slate-100 dark:hover:bg-slate-700/60 text-slate-500 dark:text-slate-400 font-mono"
          >
            /
          </button>
          {segments.map((seg, idx) => {
            const full = "/" + segments.slice(0, idx + 1).join("/");
            const isLast = idx === segments.length - 1;
            return (
              <span key={full} className="flex items-center gap-0.5">
                <button
                  onClick={() => void load(full)}
                  className={`px-1 py-0.5 rounded font-mono ${
                    isLast
                      ? "text-slate-800 dark:text-slate-100 font-medium"
                      : "text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700/60"
                  }`}
                >
                  {seg}
                </button>
                {!isLast && (
                  <span className="text-slate-400 dark:text-slate-500">/</span>
                )}
              </span>
            );
          })}
        </div>

        {/* List */}
        <div className="max-h-80 overflow-y-auto">
          {parent && (
            <button
              onClick={() => void load(parent)}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-700/40 text-slate-600 dark:text-slate-300"
            >
              <ArrowUpIcon className="w-4 h-4" />
              <span>..</span>
            </button>
          )}
          {loading ? (
            <div className="px-3 py-3 text-xs text-slate-500 dark:text-slate-400">
              {t("common.loading")}
            </div>
          ) : error ? (
            <div className="px-3 py-3 text-xs text-red-600 dark:text-red-400">
              {error}
            </div>
          ) : entries.length === 0 ? (
            <div className="px-3 py-3 text-xs text-slate-500 dark:text-slate-400">
              {t("directoryBrowser.empty")}
            </div>
          ) : (
            entries.map((e) => (
              <button
                key={e.name}
                onClick={() => void load(path === "/" ? `/${e.name}` : `${path}/${e.name}`)}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50 dark:hover:bg-slate-700/40 text-slate-700 dark:text-slate-200"
              >
                {e.isDirectory ? (
                  <FolderIcon className="w-4 h-4 text-slate-500 dark:text-slate-400" />
                ) : (
                  <DocumentIcon className="w-4 h-4 text-slate-400 dark:text-slate-500" />
                )}
                <span className="truncate">{e.name}</span>
              </button>
            ))
          )}
        </div>

        <div className="flex items-center justify-between gap-2 px-3 py-2 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40">
          <label className="flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400 cursor-pointer">
            <input
              type="checkbox"
              checked={showHidden}
              onChange={(e) => setShowHidden(e.target.checked)}
              className="rounded"
            />
            {t("directoryBrowser.showHidden")}
          </label>
          <div className="flex items-center gap-2">
            <button
              onClick={() => onResolve(null)}
              className="px-3 py-1.5 rounded-md text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"
            >
              {t("sidebar.renameCancel")}
            </button>
            <button
              onClick={() => path && onResolve(path)}
              disabled={!path}
              className="px-3 py-1.5 rounded-md text-sm bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {t("directoryBrowser.select")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
