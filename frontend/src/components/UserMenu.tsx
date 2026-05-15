import { useEffect, useRef, useState } from "react";
import {
  ArrowRightOnRectangleIcon,
  LinkIcon,
  UserCircleIcon,
  UsersIcon,
} from "@heroicons/react/24/outline";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useAuth } from "../hooks/useAuth";

/**
 * Tiny header-side menu that surfaces the signed-in user and a sign-out
 * action. Renders nothing in "public" mode (no auth). In legacy shared-token
 * mode it still shows up (no username, just a sign-out affordance) so users
 * aren't stranded.
 */
export function UserMenu() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { status, mode, username, role, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Close on outside click.
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

  if (status !== "authenticated") return null;

  const displayName = username ?? t("auth.tokenLabel");
  const initial = username ? username[0]?.toUpperCase() : "•";

  return (
    <div ref={wrapperRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 px-2 py-2 rounded-xl bg-white/80 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700 hover:bg-white dark:hover:bg-slate-800 transition-all duration-200 backdrop-blur-sm shadow-sm hover:shadow-md"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t("userMenu.ariaOpen")}
      >
        {username ? (
          <span className="w-6 h-6 rounded-full bg-blue-600 text-white text-xs font-semibold flex items-center justify-center">
            {initial}
          </span>
        ) : (
          <UserCircleIcon className="w-5 h-5 text-slate-600 dark:text-slate-400" />
        )}
        <span className="hidden sm:inline text-sm font-medium text-slate-700 dark:text-slate-200 max-w-[8rem] truncate">
          {displayName}
        </span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-2 w-56 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 shadow-lg z-30 overflow-hidden"
        >
          <div className="px-3 py-2 border-b border-slate-200 dark:border-slate-700">
            <div className="text-sm font-medium text-slate-800 dark:text-slate-100 truncate">
              {displayName}
            </div>
            {mode === "multi-user" && role && (
              <div className="text-xs text-slate-500 dark:text-slate-400">
                {role === "admin"
                  ? t("usersPanel.roleAdmin")
                  : t("usersPanel.roleUser")}
              </div>
            )}
          </div>
          {role === "admin" && (
            <button
              onClick={() => {
                setOpen(false);
                navigate("/admin/users");
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/40 transition-colors"
            >
              <UsersIcon className="w-4 h-4" />
              {t("userMenu.manageUsers")}
            </button>
          )}
          {mode === "multi-user" && (
            <button
              onClick={() => {
                setOpen(false);
                navigate("/integrations");
              }}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/40 transition-colors"
            >
              <LinkIcon className="w-4 h-4" />
              {t("userMenu.integrations")}
            </button>
          )}
          <button
            onClick={() => {
              setOpen(false);
              logout();
            }}
            className="w-full flex items-center gap-2 px-3 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
          >
            <ArrowRightOnRectangleIcon className="w-4 h-4" />
            {t("auth.signOut")}
          </button>
        </div>
      )}
    </div>
  );
}
