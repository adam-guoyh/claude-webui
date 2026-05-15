import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
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
 * Compact per-row dropdown for granting app-management permissions. The
 * popover is rendered through a React portal directly on `document.body`
 * with fixed coordinates anchored to the trigger button — this lets it
 * escape parents that use `overflow: hidden` (e.g. the user-list card)
 * which would otherwise clip it.
 *
 * Admin rows pass `forcedAll` so the menu reads "all" and the popover
 * stays closed.
 */
export function ProviderPermissionMenu({
  providers,
  granted,
  forcedAll = false,
  onToggle,
}: Props) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{
    top: number;
    left: number;
  } | null>(null);

  // Recompute popover anchor whenever it opens, the window resizes, or
  // scroll happens. The simple "close on scroll" approach would also work
  // but staying open feels nicer for short scroll movements.
  useLayoutEffect(() => {
    if (!open) {
      setPosition(null);
      return;
    }
    const reposition = () => {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      // Popover is 224px (w-56). Right-align with the button.
      const width = 224;
      setPosition({ top: rect.bottom + 4, left: rect.right - width });
    };
    reposition();
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open]);

  // Close on outside click and Escape.
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (
        buttonRef.current?.contains(t) ||
        popoverRef.current?.contains(t)
      ) {
        return;
      }
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (providers.length === 0) return null;

  const grantedSet = new Set(granted);
  const firstGranted = providers.find((p) => grantedSet.has(p.id));
  const summary = forcedAll
    ? t("usersPanel.manageAppsAll")
    : grantedSet.size === 0
      ? t("usersPanel.manageAppsNone")
      : t("usersPanel.manageAppsCount", {
          count: grantedSet.size,
          total: providers.length,
          first: firstGranted
            ? providerLabel(t, firstGranted.id, firstGranted.displayName)
            : "",
        });

  return (
    <>
      <button
        ref={buttonRef}
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

      {open &&
        !forcedAll &&
        position &&
        createPortal(
          <div
            ref={popoverRef}
            role="menu"
            style={{
              position: "fixed",
              top: position.top,
              left: position.left,
              width: 224,
            }}
            className="rounded-md border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-lg overflow-hidden z-50"
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
          </div>,
          document.body,
        )}
    </>
  );
}
