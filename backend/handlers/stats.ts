import { Context } from "hono";
import { getUsageStats } from "../utils/usageStats.ts";

export async function handleStatsRequest(c: Context) {
  try {
    // Get query parameter for time window (in minutes)
    const minutesStr = c.req.query("minutes");
    const minutes = minutesStr ? parseInt(minutesStr, 10) : undefined;

    const stats = getUsageStats(minutes);

    return c.json({
      success: true,
      data: {
        total: stats.total,
        recent: stats.recentTotal,
        window: minutes ? `${minutes} minutes` : "all-time",
        byUser: stats.byUser,
        byModel: stats.byModel,
        totalTokens: stats.totalTokens,
        recentTokens: stats.recentTokens,
      },
    });
  } catch (error) {
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    );
  }
}
