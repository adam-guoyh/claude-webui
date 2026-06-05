/**
 * In-memory setTimeout queue for pending retries. Source of truth is the
 * `store` (on disk); this just keeps live timers in sync.
 *
 *  - `boot(cliPath)` reads the store on startup, fires entries whose dueAt
 *    is in the past (within a sanity window), and schedules the rest.
 *  - `schedule(entry, cliPath)` adds one new entry's timer.
 *  - `cancel(id)` cancels the in-memory timer (use alongside store.removeEntry
 *    when the user explicitly cancels).
 *
 * No clustering: a single webui process owns the timers. If you run two
 * backends pointing at the same `~/.claude-webui/pending-retries.json`, both
 * will try to fire — for the local-tool use case that's not on the table.
 */

import type { PendingRetry } from "../../shared/types.ts";
import { loadAll, removeEntry } from "./store.ts";
import { fireRetry } from "./runner.ts";
import { logger } from "../utils/logger.ts";

/** If a stored entry's dueAt is more than this far in the past at boot we
 *  discard it as "you've been away too long" rather than firing surprisingly
 *  late. 24 h is generous — Anthropic quotas reset every few hours. */
const STALENESS_MS = 24 * 60 * 60 * 1000;

const timers = new Map<string, NodeJS.Timeout>();

function clear(id: string): void {
  const t = timers.get(id);
  if (t) {
    clearTimeout(t);
    timers.delete(id);
  }
}

async function fireAndCleanup(
  entry: PendingRetry,
  cliPath: string,
): Promise<void> {
  timers.delete(entry.id);
  try {
    await fireRetry(entry, cliPath);
  } finally {
    // Always remove from store on completion so the next boot doesn't re-fire.
    await removeEntry(entry.id).catch((error) => {
      logger.cli.warn(
        "Failed to remove fired pending retry {id}: {error}",
        { id: entry.id, error },
      );
    });
  }
}

export function schedule(entry: PendingRetry, cliPath: string): void {
  // Replace any existing timer for this id (shouldn't happen, but stays safe).
  clear(entry.id);
  const delay = Math.max(0, entry.dueAt - Date.now());
  const handle = setTimeout(() => {
    void fireAndCleanup(entry, cliPath);
  }, delay);
  timers.set(entry.id, handle);
  // Don't keep the process alive solely for a future retry — long horizons
  // (hours) shouldn't pin the event loop in dev. The webui as a whole stays
  // alive via the HTTP server.
  handle.unref?.();
}

export function cancel(id: string): void {
  clear(id);
}

export async function boot(cliPath: string): Promise<void> {
  const entries = await loadAll();
  if (entries.length === 0) return;
  const now = Date.now();
  const stale: string[] = [];
  let scheduled = 0;
  for (const entry of entries) {
    if (entry.dueAt < now - STALENESS_MS) {
      stale.push(entry.id);
      continue;
    }
    schedule(entry, cliPath);
    scheduled++;
  }
  for (const id of stale) {
    await removeEntry(id).catch(() => undefined);
  }
  logger.cli.info(
    "pending-retries: scheduled {scheduled}, discarded {stale} stale",
    { scheduled, stale: stale.length },
  );
}
