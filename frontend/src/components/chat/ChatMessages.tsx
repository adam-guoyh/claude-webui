import { useRef, useEffect, useState, useLayoutEffect } from "react";
import type { AllMessage } from "../../types";
import {
  isChatMessage,
  isSystemMessage,
  isToolMessage,
  isToolResultMessage,
  isPlanMessage,
  isThinkingMessage,
  isTodoMessage,
} from "../../types";
import {
  ChatMessageComponent,
  SystemMessageComponent,
  ToolMessageComponent,
  ToolResultMessageComponent,
  PlanMessageComponent,
  ThinkingMessageComponent,
  TodoMessageComponent,
  LoadingComponent,
} from "../MessageComponents";
// import { UI_CONSTANTS } from "../../utils/constants"; // Unused for now

interface ChatMessagesProps {
  messages: AllMessage[];
  isLoading: boolean;
  hasMoreMessages?: boolean;
  onLoadMore?: () => Promise<void>;
}

export function ChatMessages({
  messages,
  isLoading,
  hasMoreMessages,
  onLoadMore,
}: ChatMessagesProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const wasLoadingRef = useRef(false);
  const prevMessageCountRef = useRef(0);
  // Records container.scrollHeight at the moment the user clicked "Load
  // earlier messages". Read in the layout effect after the new messages
  // commit to compute the scroll-top adjustment that keeps the user's
  // previously-visible content in place. null when no pagination is pending.
  const pendingPaginationRef = useRef<{ oldScrollHeight: number } | null>(null);
  // Whether we've already jumped to the bottom for the current mount. Entering
  // a session should land on the newest message, not the "Load earlier
  // messages" button at the top. ChatMessages remounts on each (uncached)
  // session load, so a per-mount ref resets naturally per session.
  const didInitialScrollRef = useRef(false);

  const scrollToBottom = () => {
    if (messagesEndRef.current && messagesEndRef.current.scrollIntoView) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  };

  // Auto-scroll to bottom when a chat turn finishes streaming.
  useEffect(() => {
    if (wasLoadingRef.current && !isLoading && !loadingMore) {
      scrollToBottom();
    }
    wasLoadingRef.current = isLoading;
  }, [isLoading, loadingMore]);

  // Preserve reading position when older messages are prepended via
  // pagination. Without this, the newly added content at the top pushes
  // the user's view downward and the message they were reading scrolls
  // out of frame. We capture scrollHeight at click time and offset
  // scrollTop by the delta after the commit — same visible content,
  // just with more rows now sitting above the viewport.
  useLayoutEffect(() => {
    const grew = messages.length > prevMessageCountRef.current;
    if (grew && pendingPaginationRef.current && messagesContainerRef.current) {
      // Pagination: re-anchor so previously-visible content stays put.
      const container = messagesContainerRef.current;
      const delta = container.scrollHeight - pendingPaginationRef.current.oldScrollHeight;
      if (delta > 0) {
        container.scrollTop += delta;
      }
      pendingPaginationRef.current = null;
    } else if (!didInitialScrollRef.current && messages.length > 0) {
      // Initial session load: land on the newest message. Jump instantly
      // (no smooth animation) so there's no visible scroll-from-top.
      didInitialScrollRef.current = true;
      messagesEndRef.current?.scrollIntoView({ behavior: "auto" });
    }
    prevMessageCountRef.current = messages.length;
  }, [messages.length]);

  const renderMessage = (message: AllMessage, index: number) => {
    // Use timestamp as key for stable rendering, fallback to index if needed
    const key = `${message.timestamp}-${index}`;

    if (isSystemMessage(message)) {
      return <SystemMessageComponent key={key} message={message} />;
    } else if (isToolMessage(message)) {
      return <ToolMessageComponent key={key} message={message} />;
    } else if (isToolResultMessage(message)) {
      return <ToolResultMessageComponent key={key} message={message} />;
    } else if (isPlanMessage(message)) {
      return <PlanMessageComponent key={key} message={message} />;
    } else if (isThinkingMessage(message)) {
      return <ThinkingMessageComponent key={key} message={message} />;
    } else if (isTodoMessage(message)) {
      return <TodoMessageComponent key={key} message={message} />;
    } else if (isChatMessage(message)) {
      return <ChatMessageComponent key={key} message={message} />;
    }
    return null;
  };

  return (
    <div
      ref={messagesContainerRef}
      className="flex-1 overflow-y-auto bg-white/70 dark:bg-slate-800/70 border border-slate-200/60 dark:border-slate-700/60 p-3 sm:p-6 mb-3 sm:mb-6 rounded-2xl shadow-sm backdrop-blur-sm flex flex-col"
    >
      {messages.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          {/* Spacer div to push messages to the bottom */}
          <div className="flex-1" aria-hidden="true"></div>
          {hasMoreMessages && (
            <button
              onClick={async () => {
                // Snapshot scrollHeight so the layout effect can re-anchor
                // the viewport after the new rows commit.
                if (messagesContainerRef.current) {
                  pendingPaginationRef.current = {
                    oldScrollHeight: messagesContainerRef.current.scrollHeight,
                  };
                }
                setLoadingMore(true);
                try {
                  await onLoadMore?.();
                } finally {
                  setLoadingMore(false);
                }
              }}
              disabled={loadingMore}
              className="self-center mb-4 px-4 py-2 text-sm text-slate-600 dark:text-slate-300 hover:text-slate-800 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loadingMore ? "Loading..." : "Load earlier messages"}
            </button>
          )}
          {messages.map(renderMessage)}
          {isLoading && <LoadingComponent />}
          <div ref={messagesEndRef} />
        </>
      )}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex-1 flex items-center justify-center text-center text-slate-500 dark:text-slate-400">
      <div>
        <div className="text-6xl mb-6 opacity-60">
          <span role="img" aria-label="chat icon">
            💬
          </span>
        </div>
        <p className="text-lg font-medium">Start a conversation with Claude</p>
        <p className="text-sm mt-2 opacity-80">
          Type your message below to begin
        </p>
      </div>
    </div>
  );
}
