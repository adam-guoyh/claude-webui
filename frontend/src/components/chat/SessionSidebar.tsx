import { useCallback, useEffect, useRef, useState } from "react";
import {
  PlusIcon,
  ChatBubbleLeftRightIcon,
  XMarkIcon,
  PencilSquareIcon,
  TrashIcon,
  ArrowRightOnRectangleIcon,
} from "@heroicons/react/24/outline";
import dayjs from "dayjs";
import { useTranslation } from "react-i18next";
import type { ConversationSummary } from "../../../../shared/types";
import {
  getApiUrl,
  getHistoriesUrl,
  getSessionTitleUrl,
} from "../../config/api";
import { authFetch } from "../../utils/authFetch";
import { useAuth } from "../../hooks/useAuth";
// Side-effect: extends dayjs with the relativeTime plugin used below.
import "../../utils/time";

interface SessionSidebarProps {
  encodedName: string | null;
  currentSessionId: string | null;
  /** Bumped from the parent on events that may have changed the history file
   *  (e.g. a finished chat turn) to trigger a refetch. */
  refreshKey?: number;
  onSelectSession: (sessionId: string) => void;
  onNewChat: () => void;
  /** When true, render in mobile drawer mode (overlay + close affordance). */
  drawerMode?: boolean;
  onClose?: () => void;
}

function displayName(c: ConversationSummary): string {
  return (
    c.customTitle ||
    c.lastMessagePreview ||
    `Session ${c.sessionId.slice(0, 8)}`
  );
}

export function SessionSidebar({
  encodedName,
  currentSessionId,
  refreshKey = 0,
  onSelectSession,
  onNewChat,
  drawerMode = false,
  onClose,
}: SessionSidebarProps) {
  const { t } = useTranslation();
  const { role } = useAuth();
  const isAdmin = role === "admin";
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!encodedName) {
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const res = await authFetch(getHistoriesUrl(encodedName));
        if (!res.ok) {
          throw new Error(`Failed to load conversations: ${res.statusText}`);
        }
        const data = (await res.json()) as {
          conversations?: ConversationSummary[];
        };
        if (cancelled) return;
        setConversations(data.conversations ?? []);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to load");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [encodedName, refreshKey]);

  // Focus + select the rename input when entering edit mode.
  useEffect(() => {
    if (editingId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingId]);

  const handleSelect = useCallback(
    (sessionId: string) => {
      if (editingId) return; // don't navigate while renaming
      onSelectSession(sessionId);
      if (drawerMode) onClose?.();
    },
    [onSelectSession, drawerMode, onClose, editingId],
  );

  const handleNew = useCallback(() => {
    onNewChat();
    if (drawerMode) onClose?.();
  }, [onNewChat, drawerMode, onClose]);

  const beginRename = useCallback((c: ConversationSummary) => {
    setEditingId(c.sessionId);
    setDraft(c.customTitle ?? "");
  }, []);

  const cancelRename = useCallback(() => {
    setEditingId(null);
    setDraft("");
  }, []);

  const handleDelete = useCallback(
    async (sessionId: string) => {
      if (!encodedName) return;
      if (!confirm(t("sidebar.confirmDelete"))) return;
      try {
        const res = await authFetch(
          getApiUrl(
            `/api/projects/${encodedName}/sessions/${encodeURIComponent(sessionId)}`,
          ),
          { method: "DELETE" },
        );
        if (!res.ok) throw new Error(`Delete failed: ${res.statusText}`);
        setConversations((prev) =>
          prev.filter((c) => c.sessionId !== sessionId),
        );
        if (sessionId === currentSessionId) {
          // The currently-loaded conversation was just deleted — bounce back
          // to the new-chat state so we don't stay on a dead session.
          onNewChat();
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Delete failed");
      }
    },
    [encodedName, currentSessionId, onNewChat, t],
  );

  const handleMove = useCallback(
    async (sessionId: string) => {
      if (!encodedName) return;
      const newOwner = prompt(t("sidebar.movePrompt"));
      if (newOwner === null) return; // cancelled
      const trimmed = newOwner.trim();
      try {
        const res = await authFetch(
          getApiUrl(
            `/api/projects/${encodedName}/sessions/${encodeURIComponent(sessionId)}/owner`,
          ),
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ owner: trimmed === "" ? null : trimmed }),
          },
        );
        if (!res.ok) throw new Error(`Move failed: ${res.statusText}`);
        setConversations((prev) =>
          prev.map((c) =>
            c.sessionId === sessionId
              ? { ...c, owner: trimmed === "" ? undefined : trimmed }
              : c,
          ),
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : "Move failed");
      }
    },
    [encodedName, t],
  );

  const commitRename = useCallback(
    async (sessionId: string) => {
      if (!encodedName) return;
      // Empty draft clears the custom title back to the preview default.
      const title = draft.trim() === "" ? null : draft.trim();
      try {
        const res = await authFetch(
          getSessionTitleUrl(encodedName, sessionId),
          {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title }),
          },
        );
        if (!res.ok) {
          throw new Error(`Save failed: ${res.statusText}`);
        }
        // Optimistically merge the new title into local state — avoids
        // showing stale data until the next refetch.
        setConversations((prev) =>
          prev.map((c) =>
            c.sessionId === sessionId
              ? { ...c, customTitle: title ?? undefined }
              : c,
          ),
        );
      } catch (e) {
        // Surface failure as the inline list-level error banner.
        setError(e instanceof Error ? e.message : "Save failed");
      } finally {
        cancelRename();
      }
    },
    [encodedName, draft, cancelRename],
  );

  return (
    <aside
      aria-label={t("sidebar.ariaLabel")}
      className="flex flex-col h-full w-64 shrink-0 bg-white/60 dark:bg-slate-800/60 border-r border-slate-200 dark:border-slate-700 backdrop-blur-sm"
    >
      <div className="p-3 border-b border-slate-200 dark:border-slate-700 flex items-center gap-2">
        <button
          onClick={handleNew}
          className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors"
        >
          <PlusIcon className="w-4 h-4" />
          {t("sidebar.newChat")}
        </button>
        {drawerMode && onClose && (
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
            aria-label={t("sidebar.ariaClose")}
          >
            <XMarkIcon className="w-5 h-5 text-slate-500 dark:text-slate-400" />
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1">
        {loading && conversations.length === 0 ? (
          <div className="text-xs text-slate-500 dark:text-slate-400 px-2 py-3">
            {t("sidebar.loading")}
          </div>
        ) : error ? (
          <div className="text-xs text-red-600 dark:text-red-400 px-2 py-3">
            {error}
          </div>
        ) : conversations.length === 0 ? (
          <div className="text-xs text-slate-500 dark:text-slate-400 px-2 py-3 flex flex-col items-center gap-2 text-center">
            <ChatBubbleLeftRightIcon className="w-6 h-6 opacity-50" />
            {t("sidebar.empty")}
          </div>
        ) : (
          conversations.map((c) => {
            const isActive = c.sessionId === currentSessionId;
            const isEditing = editingId === c.sessionId;
            return (
              <div
                key={c.sessionId}
                className={`group px-3 py-2 rounded-md text-sm transition-colors ${
                  isActive
                    ? "bg-blue-100 dark:bg-blue-900/40 text-slate-900 dark:text-slate-100"
                    : "hover:bg-slate-100 dark:hover:bg-slate-700/60 text-slate-700 dark:text-slate-300"
                }`}
                title={c.customTitle ?? c.lastMessagePreview}
              >
                {isEditing ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void commitRename(c.sessionId);
                    }}
                    className="flex items-center gap-1"
                  >
                    <input
                      ref={inputRef}
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                      onBlur={() => void commitRename(c.sessionId)}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") {
                          e.preventDefault();
                          cancelRename();
                        }
                      }}
                      placeholder={t("sidebar.renamePlaceholder")}
                      className="flex-1 min-w-0 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-600 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                      maxLength={200}
                    />
                  </form>
                ) : (
                  <>
                    <div className="flex items-center justify-between gap-1">
                      <button
                        onClick={() => handleSelect(c.sessionId)}
                        className="flex-1 min-w-0 text-left truncate font-medium"
                      >
                        {displayName(c)}
                      </button>
                      <div className="flex items-center opacity-0 group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            beginRename(c);
                          }}
                          className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-600"
                          aria-label={t("sidebar.renameAria")}
                          title={t("sidebar.renameAria")}
                        >
                          <PencilSquareIcon className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
                        </button>
                        {isAdmin && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              void handleMove(c.sessionId);
                            }}
                            className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-600"
                            aria-label={t("sidebar.moveAria")}
                            title={t("sidebar.moveAria")}
                          >
                            <ArrowRightOnRectangleIcon className="w-3.5 h-3.5 text-slate-500 dark:text-slate-400" />
                          </button>
                        )}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleDelete(c.sessionId);
                          }}
                          className="p-1 rounded hover:bg-red-100 dark:hover:bg-red-900/40"
                          aria-label={t("sidebar.deleteAria")}
                          title={t("sidebar.deleteAria")}
                        >
                          <TrashIcon className="w-3.5 h-3.5 text-red-500" />
                        </button>
                      </div>
                    </div>
                    <button
                      onClick={() => handleSelect(c.sessionId)}
                      className="w-full text-left text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 flex items-center justify-between gap-2"
                    >
                      <span className="flex items-center gap-1.5">
                        {isAdmin && c.owner && (
                          <span className="px-1 rounded bg-slate-200 dark:bg-slate-700 text-[10px] uppercase tracking-wide">
                            {c.owner}
                          </span>
                        )}
                        {isAdmin && !c.owner && (
                          <span className="px-1 rounded bg-amber-100 dark:bg-amber-900/40 text-amber-700 dark:text-amber-300 text-[10px] uppercase tracking-wide">
                            {t("sidebar.unowned")}
                          </span>
                        )}
                        <span>
                          {t("sidebar.msgCount", { count: c.messageCount })}
                        </span>
                      </span>
                      <span>{dayjs(c.lastTime).fromNow(true)}</span>
                    </button>
                  </>
                )}
              </div>
            );
          })
        )}
      </div>
    </aside>
  );
}
