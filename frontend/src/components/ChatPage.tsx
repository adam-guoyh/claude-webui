import { useEffect, useCallback, useState, useRef } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Bars3Icon, ArrowPathIcon } from "@heroicons/react/24/outline";
import { useTranslation } from "react-i18next";
import type {
  ChatRequest,
  ChatMessage,
  ProjectInfo,
  PermissionMode,
} from "../types";
import type { AttachedImage } from "../../../shared/types";
import { useClaudeStreaming } from "../hooks/useClaudeStreaming";
import { useChatState } from "../hooks/chat/useChatState";
import { usePermissions } from "../hooks/chat/usePermissions";
import { usePermissionMode } from "../hooks/chat/usePermissionMode";
import { useModel } from "../hooks/useSettings";
import { useAbortController } from "../hooks/chat/useAbortController";
import {
  invalidateHistoryCache,
  useAutoHistoryLoader,
} from "../hooks/useHistoryLoader";
import { SettingsButton } from "./SettingsButton";
import { SettingsModal } from "./SettingsModal";
import { UserMenu } from "./UserMenu";
import { ChatInput } from "./chat/ChatInput";
import { ChatMessages } from "./chat/ChatMessages";
import { SessionSidebar } from "./chat/SessionSidebar";
import { getChatUrl, getHistoriesUrl, getProjectsUrl } from "../config/api";
import { authFetch } from "../utils/authFetch";
import { KEYBOARD_SHORTCUTS } from "../utils/constants";
import { normalizeWindowsPath } from "../utils/pathUtils";
import type { StreamingContext } from "../hooks/streaming/useMessageProcessor";

export function ChatPage() {
  const { t } = useTranslation();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [projects, setProjects] = useState<ProjectInfo[]>([]);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  // Bumped after every finished chat turn so the sidebar refetches and shows
  // the new conversation entry / updated message count.
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);
  const [attachedImages, setAttachedImages] = useState<AttachedImage[]>([]);

  // Extract and normalize working directory from URL
  const workingDirectory = (() => {
    const rawPath = location.pathname.replace("/projects", "");
    if (!rawPath) return undefined;
    const decodedPath = decodeURIComponent(rawPath);
    return normalizeWindowsPath(decodedPath);
  })();

  const sessionId = searchParams.get("sessionId");

  // Human-friendly label for the current session. Custom title (admin
  // renamed it in the sidebar) wins; otherwise the first user-message
  // preview from the conversation list. Refetched whenever the
  // sidebar refresh-key bumps so renames flow into the breadcrumb live.
  const [sessionLabel, setSessionLabel] = useState<string>("");

  // Reflect the current project in the browser tab so a user with
  // multiple Claude windows open can find the right one. Reset to the
  // app title on unmount.
  useEffect(() => {
    const base = "Claude Code Web UI";
    const projectName = workingDirectory
      ? workingDirectory.replace(/\/+$/, "").split("/").pop() || ""
      : "";
    const parts = [projectName, sessionLabel].filter(Boolean);
    document.title = parts.length ? `${parts.join(" › ")} · ${base}` : base;
    return () => {
      document.title = base;
    };
  }, [workingDirectory, sessionLabel]);

  const { processStreamLine } = useClaudeStreaming();
  const { abortRequest, createAbortHandler } = useAbortController();

  // Permission mode state management
  const { permissionMode, setPermissionMode } = usePermissionMode();
  // Model choice (persisted setting). "default" means: send no `model` field
  // so the backend follows whatever the `claude` CLI default is.
  const { model: modelChoice } = useModel();

  // Get encoded name for current working directory
  const getEncodedName = useCallback(() => {
    if (!workingDirectory || !projects.length) {
      return null;
    }

    const project = projects.find((p) => p.path === workingDirectory);

    const normalizedWorking = normalizeWindowsPath(workingDirectory);
    const normalizedProject = projects.find(
      (p) => normalizeWindowsPath(p.path) === normalizedWorking,
    );

    const finalProject = project || normalizedProject;

    return finalProject?.encodedName || null;
  }, [workingDirectory, projects]);

  // Load conversation history if sessionId is provided
  const {
    messages: historyMessages,
    loading: historyLoading,
    error: historyError,
    sessionId: loadedSessionId,
    loadHistory,
    hasMoreMessages,
    loadMoreHistory,
  } = useAutoHistoryLoader(
    getEncodedName() || undefined,
    sessionId || undefined,
  );

  // Store encoded name for use in callbacks
  const encodedProjectName = getEncodedName();

  // Stable identity so ChatMessages doesn't see a new onLoadMore prop on
  // every render (would defeat React.memo if it's ever added, and keeps the
  // dep arrays in ChatMessages predictable).
  const handleLoadMore = useCallback(async () => {
    if (encodedProjectName && sessionId) {
      await loadMoreHistory(encodedProjectName, sessionId);
    }
  }, [encodedProjectName, sessionId, loadMoreHistory]);

  // Resolve session label from the histories list. Cheap GET that the
  // sidebar already makes; we duplicate the request here so the
  // breadcrumb is independent of sidebar mount state. Refetches when
  // sessionId / project changes, or when the sidebar bumps the refresh
  // key (e.g. a rename).
  useEffect(() => {
    const enc = getEncodedName();
    if (!enc || !sessionId) {
      setSessionLabel("");
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const res = await authFetch(getHistoriesUrl(enc));
        if (!res.ok) return;
        const body = (await res.json()) as {
          conversations: Array<{
            sessionId: string;
            customTitle?: string;
            lastMessagePreview?: string;
          }>;
        };
        if (cancelled) return;
        const hit = body.conversations.find((c) => c.sessionId === sessionId);
        const label =
          hit?.customTitle ||
          (hit?.lastMessagePreview
            ? hit.lastMessagePreview.replace(/\s+/g, " ").slice(0, 60)
            : "");
        setSessionLabel(label);
      } catch {
        // Best-effort — the breadcrumb just falls back to project-only.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [getEncodedName, sessionId, historyRefreshKey]);

  // Initialize chat state with loaded history
  const {
    messages,
    input,
    isLoading,
    currentSessionId,
    currentRequestId,
    hasShownInitMessage,
    currentAssistantMessage,
    setInput,
    setCurrentSessionId,
    setHasShownInitMessage,
    setHasReceivedInit,
    setCurrentAssistantMessage,
    addMessage,
    updateLastMessage,
    clearInput,
    generateRequestId,
    resetRequestState,
    startRequest,
    setMessages,
  } = useChatState({
    initialMessages: historyMessages,
    initialSessionId: loadedSessionId || undefined,
  });

  // Sync the loader's history into the chat-state `messages`. Two refs
  // because we have to distinguish three cases that all show up as a
  // `historyMessages` reference change:
  //   * `loadedSessionId` is different → user switched sessions; adopt
  //     the new history wholesale (the previous chat's messages must go).
  //   * Same session, history grew → pagination loaded older messages;
  //     prepend just the new prefix so we keep any new chat turns the
  //     user added on top.
  //   * Same session, history empty or shrank → loader cleared; let
  //     the next batch be treated as a fresh initial load.
  const prevSessionRef = useRef<string | null>(null);
  const prevHistoryCountRef = useRef(0);

  useEffect(() => {
    if (historyMessages.length === 0) {
      prevHistoryCountRef.current = 0;
      return;
    }

    // Session change OR history shrank (refresh button resets to 30) →
    // adopt the new history wholesale.
    if (
      prevSessionRef.current !== loadedSessionId ||
      historyMessages.length < prevHistoryCountRef.current
    ) {
      setMessages(historyMessages);
      prevSessionRef.current = loadedSessionId;
      prevHistoryCountRef.current = historyMessages.length;
      return;
    }

    if (historyMessages.length > prevHistoryCountRef.current) {
      const newCount = historyMessages.length - prevHistoryCountRef.current;
      setMessages((prev) => [...historyMessages.slice(0, newCount), ...prev]);
      prevHistoryCountRef.current = historyMessages.length;
    }
  }, [historyMessages, loadedSessionId, setMessages]);

  const {
    allowedTools,
    permissionRequest,
    showPermissionRequest,
    closePermissionRequest,
    allowToolTemporary,
    allowToolPermanent,
    isPermissionMode,
    planModeRequest,
    showPlanModeRequest,
    closePlanModeRequest,
    updatePermissionMode,
  } = usePermissions({
    onPermissionModeChange: setPermissionMode,
  });

  const handlePermissionError = useCallback(
    (toolName: string, patterns: string[], toolUseId: string) => {
      if (patterns.includes("ExitPlanMode")) {
        showPlanModeRequest("");
      } else {
        showPermissionRequest(toolName, patterns, toolUseId);
      }
    },
    [showPermissionRequest, showPlanModeRequest],
  );

  const sendMessage = useCallback(
    async (
      messageContent?: string,
      tools?: string[],
      hideUserMessage = false,
      overridePermissionMode?: PermissionMode,
    ) => {
      const content = messageContent || input.trim();
      if ((!content && !attachedImages.length) || isLoading) return;

      const requestId = generateRequestId();

      if (!hideUserMessage) {
        const userMessage: ChatMessage = {
          type: "chat",
          role: "user",
          content: content,
          timestamp: Date.now(),
        };
        addMessage(userMessage);
      }

      if (!messageContent) clearInput();
      startRequest();

      try {
        const response = await authFetch(getChatUrl(), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: content,
            requestId,
            ...(currentSessionId ? { sessionId: currentSessionId } : {}),
            allowedTools: tools || allowedTools,
            ...(workingDirectory ? { workingDirectory } : {}),
            permissionMode: overridePermissionMode || permissionMode,
            // Only send when the user picked a non-default — keeps the
            // backend free to follow whatever the CLI's own default is.
            ...(modelChoice && modelChoice !== "default"
              ? { model: modelChoice }
              : {}),
            ...(attachedImages.length ? { images: attachedImages } : {}),
          } as ChatRequest),
        });

        if (!response.body) throw new Error("No response body");

        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        let localHasReceivedInit = false;
        let shouldAbort = false;
        // Latch the first session_id we see for this turn so we ignore later
        // overwrites from sidechain / sub-agent assistant messages — those
        // can ship their own session_id and would otherwise repoint us at
        // the wrong on-disk JSONL on the next turn. Mirrors the backend's
        // `taggedSessionId` guard in handlers/chat.ts.
        let sessionIdLatched = false;

        const streamingContext: StreamingContext = {
          currentAssistantMessage,
          setCurrentAssistantMessage,
          addMessage,
          updateLastMessage,
          onSessionId: (sid: string) => {
            if (sessionIdLatched) return;
            sessionIdLatched = true;
            setCurrentSessionId(sid);
          },
          shouldShowInitMessage: () => !hasShownInitMessage,
          onInitMessageShown: () => setHasShownInitMessage(true),
          get hasReceivedInit() {
            return localHasReceivedInit;
          },
          setHasReceivedInit: (received: boolean) => {
            localHasReceivedInit = received;
            setHasReceivedInit(received);
          },
          onPermissionError: handlePermissionError,
          onAbortRequest: async () => {
            shouldAbort = true;
            await createAbortHandler(requestId)();
          },
        };

        while (true) {
          const { done, value } = await reader.read();
          if (done || shouldAbort) break;

          const chunk = decoder.decode(value);
          const lines = chunk.split("\n").filter((line) => line.trim());

          for (const line of lines) {
            if (shouldAbort) break;
            processStreamLine(line, streamingContext);
          }

          if (shouldAbort) break;
        }
      } catch (error) {
        console.error("Failed to send message:", error);
        addMessage({
          type: "chat",
          role: "assistant",
          content: t("chat.fetchFailed"),
          timestamp: Date.now(),
        });
      } finally {
        resetRequestState();
        setAttachedImages([]);
        // Invalidate the loader's in-memory cache for *this* session so a
        // back-and-forth navigation re-fetches with the appended messages
        // instead of replaying the stale snapshot.
        const enc = getEncodedName();
        if (enc && currentSessionId) {
          invalidateHistoryCache(enc, currentSessionId);
        }
        // Trigger sidebar refresh — a new session may have appeared or an
        // existing one's message count just changed on disk.
        setHistoryRefreshKey((k) => k + 1);
      }
    },
    [
      input,
      isLoading,
      currentSessionId,
      allowedTools,
      hasShownInitMessage,
      currentAssistantMessage,
      workingDirectory,
      permissionMode,
      modelChoice,
      generateRequestId,
      clearInput,
      startRequest,
      addMessage,
      updateLastMessage,
      setCurrentSessionId,
      setHasShownInitMessage,
      setHasReceivedInit,
      setCurrentAssistantMessage,
      resetRequestState,
      processStreamLine,
      handlePermissionError,
      createAbortHandler,
      t,
    ],
  );

  const handleAbort = useCallback(() => {
    abortRequest(currentRequestId, isLoading, resetRequestState);
  }, [abortRequest, currentRequestId, isLoading, resetRequestState]);

  const handlePermissionAllow = useCallback(() => {
    if (!permissionRequest) return;

    let updatedAllowedTools = allowedTools;
    permissionRequest.patterns.forEach((pattern) => {
      updatedAllowedTools = allowToolTemporary(pattern, updatedAllowedTools);
    });

    closePermissionRequest();

    if (currentSessionId) {
      sendMessage("continue", updatedAllowedTools, true);
    }
  }, [
    permissionRequest,
    currentSessionId,
    sendMessage,
    allowedTools,
    allowToolTemporary,
    closePermissionRequest,
  ]);

  const handlePermissionAllowPermanent = useCallback(() => {
    if (!permissionRequest) return;

    let updatedAllowedTools = allowedTools;
    permissionRequest.patterns.forEach((pattern) => {
      updatedAllowedTools = allowToolPermanent(pattern, updatedAllowedTools);
    });

    closePermissionRequest();

    if (currentSessionId) {
      sendMessage("continue", updatedAllowedTools, true);
    }
  }, [
    permissionRequest,
    currentSessionId,
    sendMessage,
    allowedTools,
    allowToolPermanent,
    closePermissionRequest,
  ]);

  const handlePermissionDeny = useCallback(() => {
    closePermissionRequest();
  }, [closePermissionRequest]);

  const handlePlanAcceptWithEdits = useCallback(() => {
    updatePermissionMode("acceptEdits");
    closePlanModeRequest();
    if (currentSessionId) {
      sendMessage("accept", allowedTools, true, "acceptEdits");
    }
  }, [
    updatePermissionMode,
    closePlanModeRequest,
    currentSessionId,
    sendMessage,
    allowedTools,
  ]);

  const handlePlanAcceptDefault = useCallback(() => {
    updatePermissionMode("default");
    closePlanModeRequest();
    if (currentSessionId) {
      sendMessage("accept", allowedTools, true, "default");
    }
  }, [
    updatePermissionMode,
    closePlanModeRequest,
    currentSessionId,
    sendMessage,
    allowedTools,
  ]);

  const handlePlanKeepPlanning = useCallback(() => {
    updatePermissionMode("plan");
    closePlanModeRequest();
  }, [updatePermissionMode, closePlanModeRequest]);

  const permissionData = permissionRequest
    ? {
        patterns: permissionRequest.patterns,
        onAllow: handlePermissionAllow,
        onAllowPermanent: handlePermissionAllowPermanent,
        onDeny: handlePermissionDeny,
      }
    : undefined;

  const planPermissionData = planModeRequest
    ? {
        onAcceptWithEdits: handlePlanAcceptWithEdits,
        onAcceptDefault: handlePlanAcceptDefault,
        onKeepPlanning: handlePlanKeepPlanning,
      }
    : undefined;

  const handleSettingsClick = useCallback(() => setIsSettingsOpen(true), []);
  const handleSettingsClose = useCallback(() => setIsSettingsOpen(false), []);

  useEffect(() => {
    const loadProjects = async () => {
      try {
        const response = await authFetch(getProjectsUrl());
        if (response.ok) {
          const data = await response.json();
          setProjects(data.projects || []);
        }
      } catch (error) {
        console.error("Failed to load projects:", error);
      }
    };
    loadProjects();
  }, []);

  const handleBackToProjects = useCallback(() => navigate("/"), [navigate]);

  const handleSelectSession = useCallback(
    (id: string) => {
      const params = new URLSearchParams();
      params.set("sessionId", id);
      navigate({ search: params.toString() });
    },
    [navigate],
  );

  const handleNewChat = useCallback(() => {
    navigate({ search: "" });
  }, [navigate]);

  useEffect(() => {
    const handleGlobalKeyDown = (e: KeyboardEvent) => {
      if (e.key === KEYBOARD_SHORTCUTS.ABORT && isLoading && currentRequestId) {
        e.preventDefault();
        handleAbort();
      }
    };

    document.addEventListener("keydown", handleGlobalKeyDown);
    return () => document.removeEventListener("keydown", handleGlobalKeyDown);
  }, [isLoading, currentRequestId, handleAbort]);

  const encodedName = getEncodedName();

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 transition-colors duration-300">
      <div className="h-screen flex">
        {/* Desktop sidebar */}
        <div className="hidden md:flex">
          <SessionSidebar
            encodedName={encodedName}
            currentSessionId={sessionId}
            currentProjectPath={workingDirectory ?? null}
            refreshKey={historyRefreshKey}
            onSelectSession={handleSelectSession}
            onNewChat={handleNewChat}
          />
        </div>

        {/* Main column */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="w-full p-3 sm:p-6 flex-1 flex flex-col min-h-0">
            {/* Header */}
            <div className="flex items-center justify-between mb-4 sm:mb-8 flex-shrink-0">
              <div className="flex items-center gap-2 sm:gap-4 min-w-0">
                <button
                  onClick={() => setIsMobileSidebarOpen(true)}
                  className="md:hidden p-2 rounded-lg bg-white/80 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 hover:bg-white dark:hover:bg-slate-800 transition-all duration-200 backdrop-blur-sm shadow-sm hover:shadow-md"
                  aria-label={t("chat.ariaOpenSessions")}
                >
                  <Bars3Icon className="w-5 h-5 text-slate-600 dark:text-slate-400" />
                </button>
                <div className="min-w-0">
                  <nav
                    aria-label="Breadcrumb"
                    className="flex items-baseline gap-2 min-w-0"
                  >
                    <button
                      onClick={handleBackToProjects}
                      className="text-slate-800 dark:text-slate-100 text-lg sm:text-3xl font-bold tracking-tight hover:text-blue-600 dark:hover:text-blue-400 transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-slate-900 rounded-md px-1 -mx-1 truncate"
                      aria-label={t("chat.ariaBackToProjects")}
                      title={workingDirectory || t("app.title")}
                    >
                      {workingDirectory
                        ? workingDirectory
                            .replace(/\/+$/, "")
                            .split("/")
                            .pop() || workingDirectory
                        : t("app.title")}
                    </button>
                    {sessionLabel && (
                      <>
                        <span
                          className="text-slate-400 dark:text-slate-500 text-lg sm:text-2xl shrink-0"
                          aria-hidden
                        >
                          ›
                        </span>
                        <span
                          className="text-slate-700 dark:text-slate-200 text-base sm:text-2xl font-medium tracking-tight truncate"
                          title={sessionLabel}
                        >
                          {sessionLabel}
                        </span>
                      </>
                    )}
                  </nav>
                  {workingDirectory && (
                    <div className="flex items-center text-sm font-mono mt-1 truncate">
                      <span className="text-slate-600 dark:text-slate-400 truncate">
                        {workingDirectory}
                      </span>
                      {sessionId && (
                        <span className="ml-2 text-xs text-slate-500 dark:text-slate-400 shrink-0">
                          • {sessionId.substring(0, 8)}…
                        </span>
                      )}
                    </div>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {sessionId && getEncodedName() && (
                  <button
                    onClick={() => {
                      const enc = getEncodedName();
                      if (enc && sessionId) {
                        invalidateHistoryCache(enc, sessionId);
                        void loadHistory(enc, sessionId);
                      }
                      // Also bump the sidebar so its session list refetches —
                      // the underlying JSONL may have grown server-side.
                      setHistoryRefreshKey((k) => k + 1);
                    }}
                    disabled={historyLoading}
                    className="p-3 rounded-xl bg-white/80 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 hover:bg-white dark:hover:bg-slate-800 transition-all duration-200 backdrop-blur-sm shadow-sm hover:shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
                    aria-label={t("chat.refreshAria")}
                    title={t("chat.refreshAria")}
                  >
                    <ArrowPathIcon
                      className={`w-5 h-5 text-slate-600 dark:text-slate-400 ${historyLoading ? "animate-spin" : ""}`}
                    />
                  </button>
                )}
                <UserMenu />
                <SettingsButton onClick={handleSettingsClick} />
              </div>
            </div>

            {/* Main Content */}
            {historyLoading ? (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center">
                  <div className="w-8 h-8 border-2 border-slate-300 border-t-slate-600 rounded-full animate-spin mx-auto mb-4"></div>
                  <p className="text-slate-600 dark:text-slate-400">
                    {t("chat.loadingHistory")}
                  </p>
                </div>
              </div>
            ) : historyError ? (
              <div className="flex-1 flex items-center justify-center">
                <div className="text-center max-w-md">
                  <div className="w-16 h-16 mx-auto mb-4 bg-red-100 dark:bg-red-900/20 rounded-full flex items-center justify-center">
                    <svg
                      className="w-8 h-8 text-red-500"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                      />
                    </svg>
                  </div>
                  <h2 className="text-slate-800 dark:text-slate-100 text-xl font-semibold mb-2">
                    {t("chat.errorTitle")}
                  </h2>
                  <p className="text-slate-600 dark:text-slate-400 text-sm mb-4">
                    {historyError}
                  </p>
                  <button
                    onClick={handleNewChat}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                  >
                    {t("chat.startNew")}
                  </button>
                </div>
              </div>
            ) : (
              <>
                <ChatMessages
                  messages={messages}
                  isLoading={isLoading}
                  hasMoreMessages={!!(hasMoreMessages && sessionId)}
                  onLoadMore={sessionId && encodedProjectName ? handleLoadMore : undefined}
                />
                <ChatInput
                  input={input}
                  isLoading={isLoading}
                  currentRequestId={currentRequestId}
                  onInputChange={setInput}
                  onSubmit={() => sendMessage()}
                  onAbort={handleAbort}
                  permissionMode={permissionMode}
                  onPermissionModeChange={setPermissionMode}
                  showPermissions={isPermissionMode}
                  permissionData={permissionData}
                  planPermissionData={planPermissionData}
                  images={attachedImages}
                  onImagesChange={setAttachedImages}
                />
              </>
            )}
          </div>
        </div>

        {/* Mobile sidebar drawer */}
        {isMobileSidebarOpen && (
          <div className="md:hidden fixed inset-0 z-40 flex">
            <SessionSidebar
              encodedName={encodedName}
              currentSessionId={sessionId}
              currentProjectPath={workingDirectory ?? null}
              refreshKey={historyRefreshKey}
              onSelectSession={handleSelectSession}
              onNewChat={handleNewChat}
              drawerMode
              onClose={() => setIsMobileSidebarOpen(false)}
            />
            <div
              className="flex-1 bg-black/40"
              onClick={() => setIsMobileSidebarOpen(false)}
              aria-hidden
            />
          </div>
        )}

        <SettingsModal isOpen={isSettingsOpen} onClose={handleSettingsClose} />
      </div>
    </div>
  );
}
