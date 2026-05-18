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

/**
 * Per-provider binding visible to the logged-in user. `externalId` is opaque
 * (e.g. Feishu open_id) — the UI shows it truncated. `cwd`/`sessionId` come
 * from whichever bot owns the binding store.
 */
export interface IntegrationBinding {
  externalId: string;
  cwd: string;
  sessionId?: string;
}

export interface IntegrationProvider {
  id: string;
  displayName: string;
  /** True when the backend has credentials configured for this provider. */
  enabled: boolean;
  /** Bindings owned by the calling user, possibly empty. */
  bindings: IntegrationBinding[];
}

export interface IntegrationsListResponse {
  providers: IntegrationProvider[];
}

export interface IntegrationCodeResponse {
  code: string;
  /** ISO timestamp the code expires at. */
  expiresAt: string;
  /** TTL in seconds, mirrored for convenience. */
  ttlSeconds: number;
}

/**
 * Public listing payload for a registered Feishu / Lark app. `appSecret`
 * is never sent — operators who need it should look at the file directly.
 * `owner` is undefined for shared (admin-managed) apps.
 */
export interface LarkAppPublic {
  id: string;
  appId: string;
  domain: "feishu" | "lark";
  displayName?: string;
  owner?: string;
  createdAt: string;
  /** True when the WSClient for this app is currently active. */
  running: boolean;
  /** Whether the calling user is allowed to remove this app. */
  canManage: boolean;
}

export interface LarkAppsResponse {
  apps: LarkAppPublic[];
}

export interface LarkAppCreateRequest {
  appId: string;
  appSecret: string;
  domain?: "feishu" | "lark";
  displayName?: string;
  /** Only honored for admins; users always get owner=self. */
  owner?: string | null;
}

export interface QqAppPublic {
  id: string;
  appId: string;
  sandbox: boolean;
  displayName?: string;
  owner?: string;
  createdAt: string;
  running: boolean;
  canManage: boolean;
}

export interface QqAppsResponse {
  apps: QqAppPublic[];
}

export interface QqAppCreateRequest {
  appId: string;
  appSecret: string;
  sandbox?: boolean;
  displayName?: string;
  owner?: string | null;
}

export interface LarkSettingsResponse {
  /** True when the calling user can add/remove their own Lark apps. Derived
   *  server-side from role + per-user permission. */
  canManageApps: boolean;
  role: "admin" | "user" | "open";
}

/** Generic per-caller view of which integration providers they may manage. */
export interface IntegrationPermissionsResponse {
  role: "admin" | "user" | "open";
  /** Provider ids the calling user is allowed to register / remove own apps
   *  for. Admins and "open" callers get every registered provider. */
  manageApps: string[];
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
