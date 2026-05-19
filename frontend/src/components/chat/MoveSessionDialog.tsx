import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { authFetch } from "../../utils/authFetch";
import { getApiUrl } from "../../config/api";

interface ListedUser {
  username: string;
  role: "admin" | "user";
}

interface MoveSessionDialogProps {
  /** Modal is rendered only when this is true. */
  open: boolean;
  /** Owner displayed as the current value (highlighted in the list). */
  currentOwner: string | null;
  /** Called when the user confirms; `username === null` clears ownership. */
  onConfirm: (username: string | null) => void | Promise<void>;
  onClose: () => void;
}

/**
 * Admin-only dialog for reassigning a session's owner.
 *
 * Loads the real users list from /api/users so the operator can only pick a
 * valid account; the input above filters the list as you type. "Clear owner"
 * is an explicit second action — empty input alone doesn't dispatch.
 */
export function MoveSessionDialog({
  open,
  currentOwner,
  onConfirm,
  onClose,
}: MoveSessionDialogProps) {
  const { t } = useTranslation();
  const [users, setUsers] = useState<ListedUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Load the users list each time the dialog opens so any newly added user
  // shows up without a hard refresh.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      setFilter("");
      setSelected(currentOwner);
      try {
        const res = await authFetch(getApiUrl("/api/users"));
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as { users: ListedUser[] };
        if (cancelled) return;
        setUsers(body.users);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to load users");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, currentOwner]);

  // Focus the filter input when the modal mounts.
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return users;
    return users.filter((u) => u.username.toLowerCase().includes(q));
  }, [users, filter]);

  if (!open) return null;

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      onClick={handleBackdropClick}
    >
      <div className="w-full max-w-sm bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-700">
          <div className="text-sm font-medium text-slate-800 dark:text-slate-100">
            {t("sidebar.moveDialogTitle")}
          </div>
          {currentOwner && (
            <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              {t("sidebar.moveCurrentOwner", { username: currentOwner })}
            </div>
          )}
        </div>

        <div className="p-3 space-y-2">
          <input
            ref={inputRef}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder={t("sidebar.moveSearchPlaceholder")}
            className="w-full rounded-md border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            onKeyDown={(e) => {
              if (e.key === "Enter" && selected) {
                e.preventDefault();
                void onConfirm(selected);
              } else if (e.key === "Escape") {
                e.preventDefault();
                onClose();
              }
            }}
          />

          {error && (
            <div className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded px-2 py-1">
              {error}
            </div>
          )}

          <div className="max-h-60 overflow-y-auto rounded-md border border-slate-200 dark:border-slate-700">
            {loading ? (
              <div className="text-xs text-slate-500 dark:text-slate-400 px-3 py-2">
                {t("common.loading")}
              </div>
            ) : filtered.length === 0 ? (
              <div className="text-xs text-slate-500 dark:text-slate-400 px-3 py-2">
                {t("sidebar.moveNoMatches")}
              </div>
            ) : (
              filtered.map((u) => {
                const isSelected = u.username === selected;
                return (
                  <button
                    key={u.username}
                    onClick={() => setSelected(u.username)}
                    onDoubleClick={() => void onConfirm(u.username)}
                    className={`w-full flex items-center justify-between gap-2 px-3 py-2 text-sm text-left transition-colors ${
                      isSelected
                        ? "bg-blue-100 dark:bg-blue-900/40 text-slate-900 dark:text-slate-100"
                        : "hover:bg-slate-100 dark:hover:bg-slate-700/60 text-slate-700 dark:text-slate-300"
                    }`}
                  >
                    <span className="truncate">{u.username}</span>
                    {u.role === "admin" && (
                      <span className="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
                        {t("usersPanel.roleAdmin")}
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 px-3 py-2 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40">
          <button
            onClick={() => void onConfirm(null)}
            className="text-xs text-slate-500 dark:text-slate-400 hover:underline"
            title={t("sidebar.moveClearTitle")}
          >
            {t("sidebar.moveClear")}
          </button>
          <div className="flex items-center gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1.5 rounded-md text-sm text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700"
            >
              {t("sidebar.renameCancel")}
            </button>
            <button
              onClick={() => selected && void onConfirm(selected)}
              disabled={!selected}
              className="px-3 py-1.5 rounded-md text-sm bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {t("sidebar.moveConfirm")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
