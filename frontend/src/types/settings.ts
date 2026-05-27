export type Theme = "light" | "dark";
export type EnterBehavior = "send" | "newline";

/**
 * Claude model preference for new chat turns.
 * "default" means: send no `model` field — the backend falls back to whatever
 * the `claude` CLI's own default is. The others map to the CLI's short
 * aliases and pass through to the SDK as-is.
 */
export type ModelChoice = "default" | "haiku" | "sonnet" | "opus";

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
