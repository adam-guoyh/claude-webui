import { useState, useEffect, useCallback, useRef } from "react";
import type { AllMessage, TimestampedSDKMessage } from "../types";
import type { ConversationHistory } from "../../../shared/types";
import { getConversationUrl } from "../config/api";
import { authFetch } from "../utils/authFetch";
import { useMessageConverter } from "./useMessageConverter";

interface HistoryLoaderState {
  messages: AllMessage[];
  loading: boolean;
  error: string | null;
  sessionId: string | null;
  totalMessageCount?: number;
  hasMoreMessages?: boolean;
}

interface HistoryLoaderResult extends HistoryLoaderState {
  loadHistory: (projectPath: string, sessionId: string) => Promise<void>;
  clearHistory: () => void;
  loadMoreHistory: (projectPath: string, sessionId: string) => Promise<void>;
}

/**
 * Tiny in-memory LRU keyed by `${encodedProject}/${sessionId}`. Session JSONL
 * files only grow by append, so cached results are valid as long as the
 * sessionId hasn't changed — back-and-forth between two sessions is then
 * instant after the first load. We invalidate on chat-turn completion so the
 * new message doesn't get hidden behind stale cache.
 */
const HISTORY_CACHE_MAX = 8;
const historyCache = new Map<string, ConversationHistory>();

function cacheGet(key: string): ConversationHistory | undefined {
  const hit = historyCache.get(key);
  if (hit) {
    // Refresh LRU position.
    historyCache.delete(key);
    historyCache.set(key, hit);
  }
  return hit;
}

function cachePut(key: string, value: ConversationHistory): void {
  if (historyCache.size >= HISTORY_CACHE_MAX) {
    const oldest = historyCache.keys().next().value;
    if (oldest !== undefined) historyCache.delete(oldest);
  }
  historyCache.set(key, value);
}

/** Drop one session's cache. Called when we know the server-side file
 *  has changed — e.g. right after a chat turn appends new messages. */
export function invalidateHistoryCache(
  encodedProjectName: string,
  sessionId: string,
): void {
  historyCache.delete(`${encodedProjectName}/${sessionId}`);
}

// Type guard to check if a message is a TimestampedSDKMessage
function isTimestampedSDKMessage(
  message: unknown,
): message is TimestampedSDKMessage {
  return (
    typeof message === "object" &&
    message !== null &&
    "type" in message &&
    "timestamp" in message &&
    typeof (message as { timestamp: unknown }).timestamp === "string"
  );
}

/**
 * Hook for loading and converting conversation history from the backend
 */
export function useHistoryLoader(): HistoryLoaderResult {
  const [state, setState] = useState<HistoryLoaderState>({
    messages: [],
    loading: false,
    error: null,
    sessionId: null,
  });

  const { convertConversationHistory } = useMessageConverter();

  // Token of the latest in-flight fetch. Older fetches see a different token
  // when they resolve and self-discard, so a slow response from session A
  // can't overwrite a faster response from session B.
  const latestKeyRef = useRef<string>("");
  const inFlightRef = useRef<AbortController | null>(null);

  const currentOffsetRef = useRef<number>(0);

  const loadHistory = useCallback(
    async (encodedProjectName: string, sessionId: string, limit?: number, offset?: number) => {
      if (!encodedProjectName || !sessionId) {
        setState((prev) => ({
          ...prev,
          error: "Encoded project name and session ID are required",
        }));
        return;
      }

      const isInitialLoad = offset === undefined;
      const offsetValue = offset ?? 0;
      const limitValue = limit ?? 30;
      const requestId = `${encodedProjectName}/${sessionId}/${offsetValue}`;

      latestKeyRef.current = requestId;
      inFlightRef.current?.abort();
      const ac = new AbortController();
      inFlightRef.current = ac;

      // Cache only initial loads
      const cacheKey = isInitialLoad ? `${encodedProjectName}/${sessionId}` : null;
      const cached = cacheKey ? cacheGet(cacheKey) : null;
      if (cached) {
        const cachedTimestamped: TimestampedSDKMessage[] = [];
        for (const msg of cached.messages) {
          if (isTimestampedSDKMessage(msg)) cachedTimestamped.push(msg);
        }
        const convertedCached = convertConversationHistory(cachedTimestamped);
        // Recompute pagination metadata. The cache stores only the initial
        // batch, so totalMessageCount comes from the cached response and
        // `hasMore` is whether that batch covered everything. Omitting these
        // (as the original code did) left hasMoreMessages undefined on
        // re-entry, which hid the "Load earlier messages" button until a
        // manual refresh.
        const totalCount =
          cached.metadata?.totalMessageCount ?? cached.messages.length;
        setState({
          messages: convertedCached,
          loading: false,
          error: null,
          sessionId: cached.sessionId,
          totalMessageCount: totalCount,
          hasMoreMessages: cached.messages.length < totalCount,
        });
        if (isInitialLoad) {
          currentOffsetRef.current = limitValue;
        }
        return;
      }

      try {
        // Only flip the `loading` flag for INITIAL loads. The parent renders
        // a full-screen spinner that unmounts <ChatMessages> when `loading` is
        // true; doing that during pagination throws away scroll position,
        // `loadingMore` button state, and the prev-message-count ref. The
        // pagination button has its own local `loadingMore` state for feedback.
        if (isInitialLoad) {
          setState((prev) => ({
            ...prev,
            loading: true,
            error: null,
          }));
        } else {
          setState((prev) => ({
            ...prev,
            error: null,
          }));
        }

        let url = getConversationUrl(encodedProjectName, sessionId);
        const params = new URLSearchParams();
        params.append("limit", limitValue.toString());
        params.append("offset", offsetValue.toString());
        url += `?${params.toString()}`;

        const response = await authFetch(url, { signal: ac.signal });

        if (!response.ok) {
          throw new Error(`Failed to load conversation: ${response.status} ${response.statusText}`);
        }

        const conversationHistory: ConversationHistory = await response.json();

        if (!conversationHistory.messages || !Array.isArray(conversationHistory.messages)) {
          throw new Error("Invalid conversation history format");
        }

        if (latestKeyRef.current !== requestId) return;

        if (cacheKey) {
          cachePut(cacheKey, conversationHistory);
        }

        const convertedMessages = convertConversationHistory(conversationHistory.messages);
        const totalCount = conversationHistory.metadata?.totalMessageCount ?? conversationHistory.messages.length;
        const hasMore = offsetValue + limitValue < totalCount;

        setState((prev) => ({
          ...prev,
          messages: isInitialLoad ? convertedMessages : [...convertedMessages, ...prev.messages],
          loading: false,
          sessionId: conversationHistory.sessionId,
          totalMessageCount: totalCount,
          hasMoreMessages: hasMore,
        }));

        currentOffsetRef.current = offsetValue + limitValue;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        if (latestKeyRef.current !== requestId) return;
        console.error("Error loading conversation history:", error);

        setState((prev) => ({
          ...prev,
          loading: false,
          error: error instanceof Error ? error.message : "Failed to load conversation history",
        }));
      }
    },
    [convertConversationHistory],
  );

  const clearHistory = useCallback(() => {
    setState({
      messages: [],
      loading: false,
      error: null,
      sessionId: null,
    });
    currentOffsetRef.current = 0;
  }, []);

  const loadMoreHistory = useCallback(
    async (encodedProjectName: string, sessionId: string) => {
      await loadHistory(
        encodedProjectName,
        sessionId,
        30, // Load 30 more messages
        currentOffsetRef.current,
      );
    },
    [loadHistory],
  );

  return {
    ...state,
    loadHistory,
    loadMoreHistory,
    clearHistory,
  };
}

/**
 * Hook for loading conversation history on mount when sessionId is provided
 */
export function useAutoHistoryLoader(
  encodedProjectName?: string,
  sessionId?: string,
): HistoryLoaderResult {
  const historyLoader = useHistoryLoader();

  useEffect(() => {
    if (encodedProjectName && sessionId) {
      historyLoader.loadHistory(encodedProjectName, sessionId);
    } else if (!sessionId) {
      // Only clear if there's no sessionId - don't clear while waiting for encodedProjectName
      historyLoader.clearHistory();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [encodedProjectName, sessionId]);

  return historyLoader;
}
