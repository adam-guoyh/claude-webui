import { readFileSync, writeFileSync } from "fs";
import { existsSync, mkdirSync } from "fs";
import { homedir } from "os";
import { join } from "path";

export interface UsageRecord {
  timestamp: number;
  user?: string;
  model: string;
  tokens?: number;
  inputTokens?: number;
  outputTokens?: number;
}

export interface UsageStats {
  total: number;
  byUser: Record<string, number>;
  byModel: Record<string, number>;
  records: UsageRecord[];
  lastUpdated: number;
}

const STATS_DIR = join(homedir(), ".claude-webui");
const STATS_FILE = join(STATS_DIR, "usage-stats.json");

function ensureStatsDir() {
  if (!existsSync(STATS_DIR)) {
    mkdirSync(STATS_DIR, { recursive: true });
  }
}

function loadStats(): UsageStats {
  ensureStatsDir();

  if (!existsSync(STATS_FILE)) {
    return {
      total: 0,
      byUser: {},
      byModel: {},
      records: [],
      lastUpdated: Date.now(),
    };
  }

  try {
    const content = readFileSync(STATS_FILE, "utf-8");
    return JSON.parse(content) as UsageStats;
  } catch {
    return {
      total: 0,
      byUser: {},
      byModel: {},
      records: [],
      lastUpdated: Date.now(),
    };
  }
}

function saveStats(stats: UsageStats) {
  ensureStatsDir();
  stats.lastUpdated = Date.now();
  writeFileSync(STATS_FILE, JSON.stringify(stats, null, 2));
}

export function recordUsage(
  model: string,
  user?: string,
  tokens?: number,
  inputTokens?: number,
  outputTokens?: number,
): void {
  const stats = loadStats();

  // Add record
  stats.records.push({
    timestamp: Date.now(),
    user,
    model,
    tokens,
    inputTokens,
    outputTokens,
  });

  // Update totals
  stats.total += 1;
  stats.byModel[model] = (stats.byModel[model] ?? 0) + 1;
  if (user) {
    stats.byUser[user] = (stats.byUser[user] ?? 0) + 1;
  }

  // Keep only last 1000 records to prevent file from growing too large
  if (stats.records.length > 1000) {
    stats.records = stats.records.slice(-1000);
  }

  saveStats(stats);
}

export function getUsageStats(
  minutesAgo?: number,
): {
  total: number;
  byUser: Record<string, number>;
  byModel: Record<string, number>;
  recentTotal: number;
  totalTokens: number;
  recentTokens: number;
} {
  const stats = loadStats();
  const now = Date.now();
  const cutoff = minutesAgo ? now - minutesAgo * 60 * 1000 : 0;

  const recentRecords = stats.records.filter((r) => r.timestamp > cutoff);
  const recentTotal = recentRecords.length;
  const recentByUser: Record<string, number> = {};
  const recentByModel: Record<string, number> = {};

  // Calculate token totals
  let totalTokens = 0;
  let recentTokens = 0;

  for (const record of stats.records) {
    const tokens = (record.inputTokens ?? 0) + (record.outputTokens ?? 0);
    totalTokens += tokens;
  }

  for (const record of recentRecords) {
    if (record.user) {
      recentByUser[record.user] = (recentByUser[record.user] ?? 0) + 1;
    }
    recentByModel[record.model] = (recentByModel[record.model] ?? 0) + 1;
    const tokens = (record.inputTokens ?? 0) + (record.outputTokens ?? 0);
    recentTokens += tokens;
  }

  return {
    total: stats.total,
    byUser: minutesAgo ? recentByUser : stats.byUser,
    byModel: minutesAgo ? recentByModel : stats.byModel,
    recentTotal,
    totalTokens,
    recentTokens,
  };
}

export function resetStats(): void {
  ensureStatsDir();
  const emptyStats: UsageStats = {
    total: 0,
    byUser: {},
    byModel: {},
    records: [],
    lastUpdated: Date.now(),
  };
  saveStats(emptyStats);
}
