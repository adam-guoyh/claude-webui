import { useEffect, useRef, useState } from "react";
import { ChevronDownIcon, CheckIcon } from "@heroicons/react/24/outline";
import { useTranslation } from "react-i18next";
import { providerLabel } from "../utils/providerName";

export interface ProviderInfo {
  id: string;
  displayName: string;
}

interface Props {
  providers: ProviderInfo[];
  /** Provider ids the user is currently granted. */
  granted: string[];
  /** Visually-grant-all + disable the popover (used for admin rows). */
  forcedAll?: boolean;
  /** Called when the user toggles a single provider. */
  onToggle: (providerId: string, next: boolean) => void;
}

/**
 * Compact per-row dropdown for granting app-management permissions. Renders
 * as a single button showing the granted-count summary (e.g. "2 / 4
 * providers"); clicking opens a small popover with one checkbox per
 * registered provider. Scales to 10+ providers without crowding the row.
 *
 * Admin rows pass `forcedAll` so the menu shows "all" and the popover
 * stays closed — admins implicitly have every provider.
 */
export function ProviderPermissionMenu({
  providers,
  granted,
  forcedAll = false,
  onToggle,
}: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  if (providers.length === 0) return null;

  const grantedSet = new Set(granted);
  const summary = forcedAll
    ? t("usersPanel.manageAppsAll")
    : grantedSet.size === 0
      ? t("usersPanel.manageAppsNone")
      : t("usersPanel.manageAppsCount", {
          count: grantedSet.size,
          total: providers.length,
          first: providerLabel(
            t,
            providers.find((p) => grantedSet.has(p.id))?.id ?? "",
            providers.find((p) => grantedSet.has(p.id))?.displayName ?? "",
          ),
        });

  return (
    <div ref={wrapperRef} className="relative">
      <button
        type="button"
        onClick={() => !forcedAll && setOpen((v) => !v)}
        disabled={forcedAll}
        title={t("usersPanel.manageAppsHint")}
        className={`inline-flex items-center gap-1 px-2 py-1 rounded border text-xs ${
          forcedAll
            ? "border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-400 dark:text-slate-500 cursor-not-allowed"
            : "border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800"
        }`}
      >
        <span className="truncate max-w-[10rem]">{summary}</span>
        {!forcedAll && (
          <ChevronDownIcon
            className={`w-3.5 h-3.5 transition-transform ${
              open ? "rotate-180" : ""
            }`}
          />
        )}
      </button>

      {open && !forcedAll && (
        <div
          role="menu"
          className="absolute right-0 mt-1 w-56 rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-lg z-20 overflow-hidden"
        >
          <div className="px-3 py-2 border-b border-slate-200 dark:border-slate-700 text-[10px] uppercase tracking-wide text-slate-500 dark:text-slate-400">
            {t("usersPanel.manageAppsLabel")}
          </div>
          <ul className="max-h-60 overflow-y-auto">
            {providers.map((p) => {
              const checked = grantedSet.has(p.id);
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    onClick={() => onToggle(p.id, !checked)}
                    className="w-full flex items-center justify-between gap-2 px-3 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/40"
                  >
                    <span className="truncate">
                      {providerLabel(t, p.id, p.displayName)}
                    </span>
                    {checked && (
                      <CheckIcon className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0" />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
