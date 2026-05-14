import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  ChevronDownIcon,
  FolderIcon,
  FolderPlusIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";
import { useTranslation } from "react-i18next";
import type { ProjectInfo } from "../../types";
import { getApiUrl, getProjectsUrl } from "../../config/api";
import { authFetch } from "../../utils/authFetch";
import { useAuth } from "../../hooks/useAuth";

interface ProjectSwitcherProps {
  /** Path of the currently active project, e.g. "/Users/me/foo". */
  currentPath: string | null;
}

/**
 * Top-of-sidebar dropdown for switching/creating/deleting projects.
 *
 * Loads the project list lazily on first open and again whenever it changes
 * (create/delete). The current project is shown as a pill; clicking opens a
 * popover with the full list, an inline "New project" form, and (for admins)
 * a trash icon per row.
 */
export function ProjectSwitcher({ currentPath }: ProjectSwitcherProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { role } = useAuth();
  const isAdmin = role === "admin";

  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newPath, setNewPath] = useState("");
  const wrapperRef = useRef<HTMLDivElement>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await authFetch(getProjectsUrl());
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = (await res.json()) as { projects: ProjectInfo[] };
      setProjects(body.projects);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load projects");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const sorted = useMemo(
    () => [...projects].sort((a, b) => a.path.localeCompare(b.path)),
    [projects],
  );

  const handleSwitch = useCallback(
    (project: ProjectInfo) => {
      setOpen(false);
      navigate(`/projects${project.path}`);
    },
    [navigate],
  );

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newPath.trim();
    if (!trimmed) return;
    setCreating(true);
    setError(null);
    try {
      const res = await authFetch(getApiUrl("/api/projects"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ path: trimmed }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      const body = (await res.json()) as ProjectInfo;
      setNewPath("");
      await refresh();
      setOpen(false);
      navigate(`/projects${body.path}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create project");
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (project: ProjectInfo) => {
    if (!confirm(t("projectSwitcher.confirmDelete", { path: project.path }))) {
      return;
    }
    try {
      const res = await authFetch(
        getApiUrl(`/api/projects/${project.encodedName}`),
        { method: "DELETE" },
      );
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: string;
        };
        throw new Error(body.error || `HTTP ${res.status}`);
      }
      await refresh();
      if (project.path === currentPath) navigate("/");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete project");
    }
  };

  const displayPath = currentPath ?? t("projectSwitcher.noneSelected");

  return (
    <div ref={wrapperRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 rounded-lg bg-white/80 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 hover:bg-white dark:hover:bg-slate-800 transition-colors text-left"
        aria-haspopup="menu"
        aria-expanded={open}
        title={displayPath}
      >
        <FolderIcon className="w-4 h-4 text-slate-500 dark:text-slate-400 shrink-0" />
        <span className="flex-1 min-w-0 truncate text-xs font-mono text-slate-700 dark:text-slate-200">
          {displayPath}
        </span>
        <ChevronDownIcon className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400 shrink-0" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute left-0 right-0 mt-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-lg z-30 overflow-hidden"
        >
          <div className="max-h-72 overflow-y-auto">
            {loading && projects.length === 0 ? (
              <div className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">
                {t("common.loading")}
              </div>
            ) : sorted.length === 0 ? (
              <div className="px-3 py-2 text-xs text-slate-500 dark:text-slate-400">
                {t("projectSwitcher.empty")}
              </div>
            ) : (
              sorted.map((p) => {
                const isActive = p.path === currentPath;
                return (
                  <div
                    key={p.encodedName}
                    className={`group flex items-center gap-2 px-3 py-2 text-xs ${
                      isActive
                        ? "bg-blue-50 dark:bg-blue-900/30"
                        : "hover:bg-slate-50 dark:hover:bg-slate-700/40"
                    }`}
                  >
                    <button
                      onClick={() => handleSwitch(p)}
                      className="flex-1 min-w-0 text-left truncate font-mono text-slate-700 dark:text-slate-200"
                      title={p.path}
                    >
                      {p.path}
                    </button>
                    {isAdmin && (
                      <button
                        onClick={() => void handleDelete(p)}
                        className="opacity-0 group-hover:opacity-100 p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/40 text-red-600 dark:text-red-400 transition-opacity"
                        aria-label={t("projectSwitcher.deleteAria", {
                          path: p.path,
                        })}
                        title={t("projectSwitcher.deleteAria", {
                          path: p.path,
                        })}
                      >
                        <TrashIcon className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                );
              })
            )}
          </div>

          <form
            onSubmit={handleCreate}
            className="flex items-center gap-1 px-2 py-2 border-t border-slate-200 dark:border-slate-700"
          >
            <FolderPlusIcon className="w-4 h-4 text-slate-500 dark:text-slate-400 shrink-0" />
            <input
              type="text"
              value={newPath}
              onChange={(e) => setNewPath(e.target.value)}
              placeholder={t("projectSwitcher.newPlaceholder")}
              className="flex-1 min-w-0 bg-transparent px-2 py-1 text-xs font-mono text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-blue-500 rounded"
              autoComplete="off"
            />
            <button
              type="submit"
              disabled={creating || !newPath.trim()}
              className="px-2 py-1 rounded-md bg-blue-600 text-white text-xs font-medium hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {creating
                ? t("projectSwitcher.adding")
                : t("projectSwitcher.add")}
            </button>
          </form>

          {error && (
            <div className="px-3 py-2 text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20">
              {error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
