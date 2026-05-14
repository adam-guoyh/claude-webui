export interface StreamResponse {
  type: "claude_json" | "error" | "done" | "aborted";
  data?: unknown; // SDKMessage object for claude_json type
  error?: string;
}

export interface ChatRequest {
  message: string;
  sessionId?: string;
  requestId: string;
  allowedTools?: string[];
  workingDirectory?: string;
  permissionMode?: "default" | "plan" | "acceptEdits";
}

export interface AbortRequest {
  requestId: string;
}

export interface ProjectInfo {
  path: string;
  encodedName: string;
}

export interface ProjectsResponse {
  projects: ProjectInfo[];
}

// Conversation history types
export interface ConversationSummary {
  sessionId: string;
  startTime: string;
  lastTime: string;
  messageCount: number;
  lastMessagePreview: string;
  /** User-defined display name set via the rename endpoint; absent if never set. */
  customTitle?: string;
  /**
   * Username of the recorded session owner. Absent for sessions created
   * before per-user ownership existed. Only included in the response for
   * admin callers — regular users only see their own sessions to begin with.
   */
  owner?: string;
}

export interface SessionTitleRequest {
  /** Trim/normalize on the server. Pass null or empty string to clear. */
  title: string | null;
}

/** PUT /api/projects/:encoded/sessions/:sessionId/owner — admin only. */
export interface SessionOwnerRequest {
  /** New owner username. Pass null to mark the session unowned. */
  owner: string | null;
}

export interface HistoryListResponse {
  conversations: ConversationSummary[];
}

// Conversation history types
// Note: messages are typed as unknown[] to avoid frontend/backend dependency issues
// Frontend should cast to TimestampedSDKMessage[] (defined in frontend/src/types.ts)
export interface ConversationHistory {
  sessionId: string;
  messages: unknown[]; // TimestampedSDKMessage[] in practice, but avoiding frontend type dependency
  metadata: {
    startTime: string;
    endTime: string;
    messageCount: number;
  };
}
