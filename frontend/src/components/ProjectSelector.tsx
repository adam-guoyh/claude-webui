import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  FolderIcon,
  FolderPlusIcon,
  MagnifyingGlassIcon,
  TrashIcon,
} from "@heroicons/react/24/outline";
import { useTranslation } from "react-i18next";
import type { ProjectsResponse, ProjectInfo } from "../types";
import { getApiUrl, getProjectsUrl } from "../config/api";
import { authFetch } from "../utils/authFetch";
import { useAuth } from "../hooks/useAuth";
import { SettingsButton } from "./SettingsButton";
import { SettingsModal } from "./SettingsModal";
import { UserMenu } from "./UserMenu";
import { DirectoryBrowser } from "./DirectoryBrowser";

export function ProjectSelector() {
  const { t } = useTranslation();
  const { role } = useAuth();
  const isAdmin = role === "admin";
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [newPath, setNewPath] = useState("");
  const [creating, setCreating] = useState(false);
  const [browserOpen, setBrowserOpen] = useState(false);
  const navigate = useNavigate();

  const loadProjects = useCallback(async () => {
    try {
      setLoading(true);
      const response = await authFetch(getProjectsUrl());
      if (!response.ok) {
        throw new Error(`${response.status} ${response.statusText}`);
      }
      const data: ProjectsResponse = await response.json();
      setProjects(data.projects);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("projects.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void loadProjects();
  }, [loadProjects]);

  const handleProjectSelect = (projectPath: string) => {
    const normalizedPath = projectPath.startsWith("/")
      ? projectPath
      : `/${projectPath}`;
    navigate(`/projects${normalizedPath}`);
  };

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
      navigate(`/projects${body.path}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create project");
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
      await loadProjects();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete project");
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-slate-600 dark:text-slate-400">
          {t("projects.loading")}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 transition-colors duration-300">
      <div className="max-w-4xl mx-auto p-6">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-slate-800 dark:text-slate-100 text-3xl font-bold tracking-tight">
            {t("projects.selectTitle")}
          </h1>
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

        {/* New project */}
        <form
          onSubmit={handleCreate}
          className="mb-6 p-4 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm"
        >
          <h2 className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-3 flex items-center gap-2">
            <FolderPlusIcon className="w-4 h-4" />
            {t("projects.newProject")}
          </h2>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={newPath}
              onChange={(e) => setNewPath(e.target.value)}
              placeholder={t("projectSwitcher.newPlaceholder")}
              className="flex-1 min-w-0 rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
              autoComplete="off"
            />
            <button
              type="button"
              onClick={() => setBrowserOpen(true)}
              className="p-2 rounded-md hover:bg-slate-100 dark:hover:bg-slate-700/60 text-slate-500 dark:text-slate-400"
              aria-label={t("projectSwitcher.browseAria")}
              title={t("projectSwitcher.browseAria")}
            >
              <MagnifyingGlassIcon className="w-5 h-5" />
            </button>
            <button
              type="submit"
              disabled={creating || !newPath.trim()}
              className="px-4 py-2 rounded-md bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {creating
                ? t("projectSwitcher.adding")
                : t("projectSwitcher.add")}
            </button>
          </div>
        </form>

        <div className="space-y-3">
          {projects.length > 0 ? (
            <>
              <h2 className="text-slate-700 dark:text-slate-300 text-lg font-medium mb-4">
                {t("projects.recent")}
              </h2>
              {projects.map((project) => (
                <div
                  key={project.path}
                  className="group flex items-center gap-3 p-4 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 rounded-lg transition-colors"
                >
                  <button
                    onClick={() => handleProjectSelect(project.path)}
                    className="flex-1 flex items-center gap-3 text-left min-w-0"
                  >
                    <FolderIcon className="h-5 w-5 text-slate-500 dark:text-slate-400 flex-shrink-0" />
                    <span className="text-slate-800 dark:text-slate-200 font-mono text-sm truncate">
                      {project.path}
                    </span>
                  </button>
                  {isAdmin && (
                    <button
                      onClick={() => void handleDelete(project)}
                      className="opacity-0 group-hover:opacity-100 p-2 rounded-md hover:bg-red-100 dark:hover:bg-red-900/40 text-red-600 dark:text-red-400 transition-opacity"
                      aria-label={t("projectSwitcher.deleteAria", {
                        path: project.path,
                      })}
                      title={t("projectSwitcher.deleteAria", {
                        path: project.path,
                      })}
                    >
                      <TrashIcon className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))}
            </>
          ) : (
            <div className="p-6 text-center text-sm text-slate-500 dark:text-slate-400 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
              {t("projectSwitcher.empty")}
            </div>
          )}
        </div>

        <SettingsModal
          isOpen={isSettingsOpen}
          onClose={() => setIsSettingsOpen(false)}
        />
        <DirectoryBrowser
          open={browserOpen}
          initialPath={newPath.trim() || null}
          onResolve={(picked) => {
            setBrowserOpen(false);
            if (picked) setNewPath(picked);
          }}
        />
      </div>
    </div>
  );
}
