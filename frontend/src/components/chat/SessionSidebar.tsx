import { useCallback, useEffect, useState } from "react";
import {
  PlusIcon,
  ChatBubbleLeftRightIcon,
  XMarkIcon,
} from "@heroicons/react/24/outline";
import dayjs from "dayjs";
import type { ConversationSummary } from "../../../../shared/types";
import { getHistoriesUrl } from "../../config/api";
import { authFetch } from "../../utils/authFetch";
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

export function SessionSidebar({
  encodedName,
  currentSessionId,
  refreshKey = 0,
  onSelectSession,
  onNewChat,
  drawerMode = false,
  onClose,
}: SessionSidebarProps) {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!encodedName) {
      // Project lookup still in flight; keep current state.
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

  const handleSelect = useCallback(
    (sessionId: string) => {
      onSelectSession(sessionId);
      if (drawerMode) onClose?.();
    },
    [onSelectSession, drawerMode, onClose],
  );

  const handleNew = useCallback(() => {
    onNewChat();
    if (drawerMode) onClose?.();
  }, [onNewChat, drawerMode, onClose]);

  return (
    <aside
      aria-label="Conversation sessions"
      className="flex flex-col h-full w-64 shrink-0 bg-white/60 dark:bg-slate-800/60 border-r border-slate-200 dark:border-slate-700 backdrop-blur-sm"
    >
      <div className="p-3 border-b border-slate-200 dark:border-slate-700 flex items-center gap-2">
        <button
          onClick={handleNew}
          className="flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 transition-colors"
        >
          <PlusIcon className="w-4 h-4" />
          New chat
        </button>
        {drawerMode && onClose && (
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
            aria-label="Close sessions panel"
          >
            <XMarkIcon className="w-5 h-5 text-slate-500 dark:text-slate-400" />
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-1">
        {loading && conversations.length === 0 ? (
          <div className="text-xs text-slate-500 dark:text-slate-400 px-2 py-3">
            Loading sessions…
          </div>
        ) : error ? (
          <div className="text-xs text-red-600 dark:text-red-400 px-2 py-3">
            {error}
          </div>
        ) : conversations.length === 0 ? (
          <div className="text-xs text-slate-500 dark:text-slate-400 px-2 py-3 flex flex-col items-center gap-2 text-center">
            <ChatBubbleLeftRightIcon className="w-6 h-6 opacity-50" />
            No conversations yet
          </div>
        ) : (
          conversations.map((c) => {
            const isActive = c.sessionId === currentSessionId;
            return (
              <button
                key={c.sessionId}
                onClick={() => handleSelect(c.sessionId)}
                className={`w-full text-left px-3 py-2 rounded-md text-sm transition-colors ${
                  isActive
                    ? "bg-blue-100 dark:bg-blue-900/40 text-slate-900 dark:text-slate-100"
                    : "hover:bg-slate-100 dark:hover:bg-slate-700/60 text-slate-700 dark:text-slate-300"
                }`}
                title={c.lastMessagePreview}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium">
                    {c.lastMessagePreview ||
                      `Session ${c.sessionId.slice(0, 8)}`}
                  </span>
                  <span className="text-[10px] text-slate-500 dark:text-slate-400 shrink-0">
                    {dayjs(c.lastTime).fromNow(true)}
                  </span>
                </div>
                <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                  {c.messageCount} msg
                </div>
              </button>
            );
          })
        )}
      </div>
    </aside>
  );
}
