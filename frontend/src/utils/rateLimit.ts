/**
 * Detect Anthropic's session/usage-limit errors in streamed assistant text and
 * parse the reset time when present.
 *
 * Anthropic surfaces these as human-readable English strings, e.g.
 *   "You've hit your session limit · resets 1:10pm (Asia/Shanghai)"
 *
 * Everything in here is best-effort — if the wording changes upstream we'll
 * miss the dialog (the message still shows in chat as usual). Keep the
 * heuristics in one place so a wording change is a one-spot update.
 */

import type {
  ModelChoice,
  SessionModelEntry,
  SessionModelOverride,
} from "../types/settings";

/** Read the active model from a stored entry, regardless of shape
 *  (plain ModelChoice or override object). */
export function resolveSessionModel(
  entry: SessionModelEntry | undefined,
): ModelChoice | undefined {
  if (!entry) return undefined;
  return typeof entry === "string" ? entry : entry.current;
}

/** Return the override object form, or null when there's no active override. */
export function resolveOverride(
  entry: SessionModelEntry | undefined,
): SessionModelOverride | null {
  if (!entry || typeof entry === "string") return null;
  return entry;
}

const RATE_LIMIT_PATTERNS: RegExp[] = [
  /you'?ve hit (?:the |your )?(?:session|usage|rate|message|context|account) limit/i,
  /(?:session|usage|rate|message|account) limit (?:reached|exceeded|hit)/i,
  /rate[- ]?limited?\b/i,
  /quota (?:exceeded|reached)/i,
];

// Matches "resets HH:MM am/pm (TZ)" and the no-minutes shorthand
// "resets Ham/pm (TZ)" (the form Anthropic actually uses for whole-hour
// resets, e.g. "resets 2pm (Asia/Shanghai)"). The minutes group is
// optional and defaults to 0 when absent.
const RESET_PATTERN =
  /resets?\s+(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*\(([^)]+)\)/i;

/** Models we cycle through when the active one is rate-limited. The user
 *  can still pick anything via the selector — this is only the auto-step. */
export const FALLBACK_CHAIN: ModelChoice[] = ["opus", "sonnet", "haiku"];

export function nextFallbackModel(
  current: ModelChoice,
): ModelChoice | null {
  const i = FALLBACK_CHAIN.indexOf(current);
  // "default" or anything not in the chain → start from opus' successor so
  // the user has something to step to.
  if (i < 0) return "sonnet";
  if (i >= FALLBACK_CHAIN.length - 1) return null;
  return FALLBACK_CHAIN[i + 1];
}

export function looksLikeRateLimit(text: string | undefined | null): boolean {
  if (!text) return false;
  return RATE_LIMIT_PATTERNS.some((re) => re.test(text));
}

/**
 * Parse "resets 1:10pm (Asia/Shanghai)" → Unix ms. Returns undefined when
 * we can't make sense of the text — caller should treat that as "no
 * auto-restore" rather than guessing a time.
 *
 * The captured wall-clock is interpreted as the next occurrence in the
 * captured TZ. If today's slot has already passed in that TZ we roll to
 * tomorrow.
 */
export function parseResetAt(text: string): number | undefined {
  const m = text.match(RESET_PATTERN);
  if (!m) return undefined;
  let hour = Number(m[1]);
  // Minutes are optional in upstream wording — "resets 2pm" gets no `:00`.
  const minute = m[2] ? Number(m[2]) : 0;
  const ampm = m[3]?.toLowerCase();
  const tz = m[4];
  if (Number.isNaN(hour) || Number.isNaN(minute)) return undefined;
  if (ampm === "pm" && hour < 12) hour += 12;
  if (ampm === "am" && hour === 12) hour = 0;

  try {
    const nowMs = Date.now();
    // Current wall-clock in tz.
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
    const parts = fmt.formatToParts(new Date(nowMs));
    const get = (t: string) =>
      Number(parts.find((p) => p.type === t)?.value);
    const todayY = get("year");
    const todayM = get("month");
    const todayD = get("day");
    const nowH = get("hour");
    const nowMin = get("minute");
    const targetIsTomorrow =
      hour < nowH || (hour === nowH && minute <= nowMin);
    const dayUtc = new Date(Date.UTC(todayY, todayM - 1, todayD));
    if (targetIsTomorrow) dayUtc.setUTCDate(dayUtc.getUTCDate() + 1);
    const dateStr = `${dayUtc.getUTCFullYear()}-${String(dayUtc.getUTCMonth() + 1).padStart(2, "0")}-${String(dayUtc.getUTCDate()).padStart(2, "0")}`;

    // Compute the Unix ms for `<dateStr>T<hour>:<minute>` interpreted in `tz`.
    // Trick: build a naive UTC parse, then look at what wall-clock that
    // instant has in tz, and shift by the difference. Single iteration is
    // accurate up to DST transition seconds — fine here.
    const naiveUtcMs = Date.parse(
      `${dateStr}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00Z`,
    );
    if (Number.isNaN(naiveUtcMs)) return undefined;
    const tzParts = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).formatToParts(new Date(naiveUtcMs));
    const tzGet = (t: string) =>
      Number(tzParts.find((p) => p.type === t)?.value);
    const asTzUtcMs = Date.UTC(
      tzGet("year"),
      tzGet("month") - 1,
      tzGet("day"),
      tzGet("hour"),
      tzGet("minute"),
    );
    const offsetMs = asTzUtcMs - naiveUtcMs;
    return naiveUtcMs - offsetMs;
  } catch {
    return undefined;
  }
}

/** Human-readable form for the dialog footer / status, in the user's locale. */
export function formatResetAt(resetAt: number): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      hour: "numeric",
      minute: "2-digit",
      timeZoneName: "short",
    }).format(new Date(resetAt));
  } catch {
    return new Date(resetAt).toLocaleString();
  }
}
