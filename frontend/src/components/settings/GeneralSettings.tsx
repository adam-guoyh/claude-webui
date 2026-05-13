import {
  SunIcon,
  MoonIcon,
  CommandLineIcon,
  LanguageIcon,
} from "@heroicons/react/24/outline";
import { useTranslation } from "react-i18next";
import { useSettings } from "../../hooks/useSettings";
import { SUPPORTED_LANGUAGES, setLanguage, type Language } from "../../i18n";

const LANGUAGE_LABELS: Record<Language, string> = {
  en: "English",
  zh: "简体中文",
};

export function GeneralSettings() {
  const { t, i18n } = useTranslation();
  const { theme, enterBehavior, toggleTheme, toggleEnterBehavior } =
    useSettings();

  const currentLang = (SUPPORTED_LANGUAGES as readonly string[]).includes(
    i18n.resolvedLanguage ?? "",
  )
    ? (i18n.resolvedLanguage as Language)
    : "en";

  return (
    <div className="space-y-6">
      <div aria-live="polite" className="sr-only" id="settings-announcements">
        {theme === "light"
          ? t("settings.theme.light")
          : t("settings.theme.dark")}
      </div>

      <div>
        <h3 className="text-lg font-medium text-slate-800 dark:text-slate-100 mb-4">
          {t("settings.general")}
        </h3>

        <div className="space-y-4">
          {/* Theme */}
          <div>
            <label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2 block">
              {t("settings.theme.label")}
            </label>
            <button
              onClick={toggleTheme}
              className="w-full flex items-center gap-3 px-4 py-3 bg-slate-50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-all duration-200 text-left"
              role="switch"
              aria-checked={theme === "dark"}
            >
              {theme === "light" ? (
                <SunIcon className="w-5 h-5 text-yellow-500" />
              ) : (
                <MoonIcon className="w-5 h-5 text-blue-400" />
              )}
              <div>
                <div className="text-sm font-medium text-slate-800 dark:text-slate-100">
                  {theme === "light"
                    ? t("settings.theme.light")
                    : t("settings.theme.dark")}
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  {t("settings.theme.switchTo", {
                    mode:
                      theme === "light"
                        ? t("settings.theme.modeDark")
                        : t("settings.theme.modeLight"),
                  })}
                </div>
              </div>
            </button>
          </div>

          {/* Enter behavior */}
          <div>
            <label className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2 block">
              {t("settings.enterBehavior.label")}
            </label>
            <button
              onClick={toggleEnterBehavior}
              className="w-full flex items-center gap-3 px-4 py-3 bg-slate-50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-700 transition-all duration-200 text-left"
              role="switch"
              aria-checked={enterBehavior === "send"}
            >
              <CommandLineIcon className="w-5 h-5 text-slate-600 dark:text-slate-400" />
              <div>
                <div className="text-sm font-medium text-slate-800 dark:text-slate-100">
                  {enterBehavior === "send"
                    ? t("settings.enterBehavior.send")
                    : t("settings.enterBehavior.newline")}
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  {enterBehavior === "send"
                    ? t("settings.enterBehavior.descSend")
                    : t("settings.enterBehavior.descNewline")}
                </div>
              </div>
            </button>
            <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              {t("settings.enterBehavior.hint")}
            </div>
          </div>

          {/* Language */}
          <div>
            <label
              htmlFor="language-select"
              className="text-sm font-medium text-slate-700 dark:text-slate-300 mb-2 block"
            >
              {t("settings.language.label")}
            </label>
            <div className="flex items-center gap-3 px-4 py-3 bg-slate-50 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 rounded-lg">
              <LanguageIcon className="w-5 h-5 text-slate-600 dark:text-slate-400" />
              <select
                id="language-select"
                value={currentLang}
                onChange={(e) => setLanguage(e.target.value as Language)}
                className="flex-1 bg-transparent text-sm font-medium text-slate-800 dark:text-slate-100 focus:outline-none"
              >
                {SUPPORTED_LANGUAGES.map((lng) => (
                  <option key={lng} value={lng}>
                    {LANGUAGE_LABELS[lng]}
                  </option>
                ))}
              </select>
            </div>
            <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
              {t("settings.language.hint")}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
