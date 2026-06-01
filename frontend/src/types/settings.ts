export type Theme = "light" | "dark";
export type EnterBehavior = "send" | "newline";

/**
 * Claude model preference for new chat turns.
 * "default" means: send no `model` field — the backend falls back to whatever
 * the `claude` CLI's own default is. The others map to the CLI's short
 * aliases and pass through to the SDK as-is.
 */
export type ModelChoice = "default" | "haiku" | "sonnet" | "opus";

/**
 * A session's stored model preference. The simple form (a bare ModelChoice) is
 * the legacy/typical case: "this session uses opus." The override form is set
 * when a rate-limit fallback fires — we remember what the user preferred
 * before the fallback, and when (in Unix ms) the quota resets so we can
 * auto-restore.
 */
export interface SessionModelOverride {
  current: ModelChoice;
  preferred?: ModelChoice;
  resetAt?: number;
}
export type SessionModelEntry = ModelChoice | SessionModelOverride;

export interface AppSettings {
  theme: Theme;
  enterBehavior: EnterBehavior;
  model: ModelChoice;
  version: number;
}

export interface LegacySettings {
  theme?: Theme;
  enterBehavior?: EnterBehavior;
}

export interface SettingsContextType {
  settings: AppSettings;
  theme: Theme;
  enterBehavior: EnterBehavior;
  model: ModelChoice;
  toggleTheme: () => void;
  toggleEnterBehavior: () => void;
  setModel: (model: ModelChoice) => void;
  updateSettings: (updates: Partial<AppSettings>) => void;
}

// Default settings
export const DEFAULT_SETTINGS: AppSettings = {
  theme: "light",
  enterBehavior: "send",
  model: "default",
  version: 1,
};

// Current settings version for migration
export const CURRENT_SETTINGS_VERSION = 1;
