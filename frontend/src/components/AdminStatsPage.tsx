import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { authFetch } from "../utils/authFetch";

interface StatsData {
  total: number;
  recent: number;
  window: string;
  byUser: Record<string, number>;
  byModel: Record<string, number>;
  totalTokens?: number;
  recentTokens?: number;
}

export function AdminStatsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [stats, setStats] = useState<StatsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [timeWindow, setTimeWindow] = useState<number>(300); // 5 hours in minutes

  useEffect(() => {
    const fetchStats = async () => {
      try {
        setLoading(true);
        const url = timeWindow
          ? `/api/stats?minutes=${timeWindow}`
          : "/api/stats";
        const response = await authFetch(url);

        if (!response.ok) {
          throw new Error(`Failed to fetch stats: ${response.statusText}`);
        }

        const data = await response.json();
        if (data.success) {
          setStats(data.data);
          setError(null);
        } else {
          setError(data.error || "Failed to fetch statistics");
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unknown error");
      } finally {
        setLoading(false);
      }
    };

    fetchStats();
  }, [timeWindow]);

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-900 p-6">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <button
            onClick={() => navigate("/admin/users")}
            className="text-blue-600 dark:text-blue-400 hover:underline mb-4"
          >
            ← {t("admin.backToUsers") || "Back to Admin"}
          </button>
          <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-100 mb-2">
            {t("admin.stats.title") || "API Usage Statistics"}
          </h1>
          <p className="text-slate-600 dark:text-slate-400">
            {t("admin.stats.desc") ||
              "Monitor Claude API calls and usage limits (5 hours / 225 calls limit)"}
          </p>
        </div>

        {/* Time Window Selector */}
        <div className="mb-8 flex gap-2">
          {[
            { label: "All Time", value: 0 },
            { label: "Last 5 Hours", value: 300 },
            { label: "Last Hour", value: 60 },
            { label: "Last 30 min", value: 30 },
          ].map((option) => (
            <button
              key={option.value}
              onClick={() => setTimeWindow(option.value)}
              className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                timeWindow === option.value
                  ? "bg-blue-600 text-white"
                  : "bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>

        {/* Loading State */}
        {loading && (
          <div className="flex items-center justify-center py-12">
            <div className="w-8 h-8 border-2 border-slate-300 border-t-slate-600 rounded-full animate-spin"></div>
          </div>
        )}

        {/* Error State */}
        {error && (
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 mb-8 text-red-700 dark:text-red-400">
            {error}
          </div>
        )}

        {/* Stats Display */}
        {stats && !loading && (
          <div className="space-y-6">
            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {/* Total Calls */}
              <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6">
                <div className="text-slate-600 dark:text-slate-400 text-sm font-medium mb-2">
                  Total Calls (All Time)
                </div>
                <div className="text-4xl font-bold text-slate-900 dark:text-slate-100">
                  {stats.total}
                </div>
              </div>

              {/* Recent Calls */}
              <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6">
                <div className="text-slate-600 dark:text-slate-400 text-sm font-medium mb-2">
                  Calls ({stats.window})
                </div>
                <div className="text-4xl font-bold text-slate-900 dark:text-slate-100">
                  {stats.recent}
                </div>
                {stats.window.includes("hour") && (
                  <div className="text-xs text-slate-500 dark:text-slate-400 mt-2">
                    Limit: 225 calls / 5 hours
                  </div>
                )}
              </div>

              {/* Remaining Capacity */}
              {stats.window === "5 minutes" && (
                <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6">
                  <div className="text-slate-600 dark:text-slate-400 text-sm font-medium mb-2">
                    Remaining (5h limit)
                  </div>
                  <div className="text-4xl font-bold text-slate-900 dark:text-slate-100">
                    {Math.max(0, 225 - stats.recent)}
                  </div>
                </div>
              )}
            </div>

            {/* By User */}
            <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-4">
                Calls by User
              </h2>
              <div className="space-y-2">
                {Object.entries(stats.byUser).length === 0 ? (
                  <p className="text-slate-500 dark:text-slate-400">No data</p>
                ) : (
                  Object.entries(stats.byUser)
                    .sort((a, b) => b[1] - a[1])
                    .map(([user, count]) => (
                      <div
                        key={user}
                        className="flex items-center justify-between py-2 border-b border-slate-100 dark:border-slate-700 last:border-0"
                      >
                        <span className="text-slate-700 dark:text-slate-300">
                          {user}
                        </span>
                        <span className="font-semibold text-slate-900 dark:text-slate-100">
                          {count}
                        </span>
                      </div>
                    ))
                )}
              </div>
            </div>

            {/* By Model */}
            <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6">
              <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-4">
                Calls by Model
              </h2>
              <div className="space-y-2">
                {Object.entries(stats.byModel).length === 0 ? (
                  <p className="text-slate-500 dark:text-slate-400">No data</p>
                ) : (
                  Object.entries(stats.byModel)
                    .sort((a, b) => b[1] - a[1])
                    .map(([model, count]) => {
                      const modelLabel =
                        {
                          default: "Default",
                          haiku: "Haiku 4.5",
                          sonnet: "Sonnet 4.6",
                          opus: "Opus 4.7",
                          "claude-haiku-4-5-20251001": "Haiku 4.5",
                          "claude-sonnet-4-6": "Sonnet 4.6",
                          "claude-opus-4-7": "Opus 4.7",
                        }[model] || model;

                      return (
                        <div
                          key={model}
                          className="flex items-center justify-between py-2 border-b border-slate-100 dark:border-slate-700 last:border-0"
                        >
                          <span className="text-slate-700 dark:text-slate-300">
                            {modelLabel}
                          </span>
                          <span className="font-semibold text-slate-900 dark:text-slate-100">
                            {count}
                          </span>
                        </div>
                      );
                    })
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
