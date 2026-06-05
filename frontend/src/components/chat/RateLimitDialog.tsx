import type { ModelChoice } from "../../types/settings";
import { formatResetAt } from "../../utils/rateLimit";

const MODEL_LABEL: Record<ModelChoice, string> = {
  default: "Default",
  opus: "Opus 4.7",
  sonnet: "Sonnet 4.6",
  haiku: "Haiku 4.5",
};

export interface RateLimitDialogData {
  /** The model that just failed (and that we'd auto-restore to). */
  currentModel: ModelChoice;
  /** Next rung of the fallback chain. null = nothing left to fall back to. */
  fallbackModel: ModelChoice | null;
  /** Best-effort Unix ms when the quota resets. undefined if we couldn't
   *  parse it from the upstream message — the dialog hides the auto-restore
   *  note in that case. */
  resetAt?: number;
  /** Raw upstream error text — shown verbatim so the user sees what
   *  actually happened, regex coverage notwithstanding. */
  message: string;
  /** The user-typed message that triggered this rate-limited turn. Set when
   *  available so the parent can offer an auto-resume at `resetAt`. */
  failedUserMessage?: string;
}

export function RateLimitDialog({
  data,
  onSwitch,
  onCancel,
  onAutoResume,
}: {
  data: RateLimitDialogData;
  onSwitch: () => void;
  onCancel: () => void;
  /** Optional: only renders the "wait and auto-resume" button when both this
   *  handler and a parsed resetAt are present. */
  onAutoResume?: () => void;
}) {
  const { currentModel, fallbackModel, resetAt, message, failedUserMessage } =
    data;
  const canAutoResume =
    !!onAutoResume && resetAt !== undefined && !!failedUserMessage;
  return (
    <div
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-sm p-4"
    >
      <div className="max-w-md w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-2xl shadow-xl p-5">
        <h2 className="text-base font-semibold text-slate-800 dark:text-slate-100 mb-2">
          {MODEL_LABEL[currentModel]} 撞限额了
        </h2>
        <p className="text-sm text-slate-600 dark:text-slate-400 mb-3 whitespace-pre-wrap break-words">
          {message.trim()}
        </p>
        {resetAt !== undefined && (
          <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
            预计 <span className="font-mono">{formatResetAt(resetAt)}</span>{" "}
            恢复后自动切回 {MODEL_LABEL[currentModel]}。
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1.5 text-sm rounded-lg border border-slate-300 dark:border-slate-600 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors"
          >
            取消
          </button>
          {canAutoResume && (
            <button
              type="button"
              onClick={onAutoResume}
              className="px-3 py-1.5 text-sm rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white transition-colors"
              title="到点会自动重新发送你刚才那条消息"
            >
              等 {formatResetAt(resetAt as number)} 自动重发
            </button>
          )}
          {fallbackModel ? (
            <button
              type="button"
              onClick={onSwitch}
              className="px-3 py-1.5 text-sm rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition-colors"
            >
              切到 {MODEL_LABEL[fallbackModel]}
            </button>
          ) : (
            !canAutoResume && (
              <span className="px-3 py-1.5 text-sm text-slate-500 dark:text-slate-400">
                已是最低档,无可降级
              </span>
            )
          )}
        </div>
      </div>
    </div>
  );
}
