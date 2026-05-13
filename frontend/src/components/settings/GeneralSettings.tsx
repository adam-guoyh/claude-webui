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

interface SettingRowProps {
  label: string;
  description?: string;
  control: React.ReactNode;
}

function SettingRow({ label, description, control }: SettingRowProps) {
  return (
    <div className="flex items-start justify-between gap-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium text-slate-800 dark:text-slate-100">
          {label}
        </div>
        {description && (
          <div className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            {description}
          </div>
        )}
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  );
}

export function GeneralSettings() {
  const { t, i18n } = useTranslation();
  const { theme, enterBehavior, toggleTheme, toggleEnterBehavior } =
    useSettings();

  const currentLang = (SUPPORTED_LANGUAGES as readonly string[]).includes(
    i18n.resolvedLanguage ?? "",
  )
    ? (i18n.resolvedLanguage as Language)
    : "en";

  const controlClass =
    "inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-700/50 border border-slate-200 dark:border-slate-600 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors text-sm font-medium text-slate-800 dark:text-slate-100";

  return (
    <div className="space-y-1">
      <div aria-live="polite" className="sr-only" id="settings-announcements">
        {theme === "light"
          ? t("settings.theme.light")
          : t("settings.theme.dark")}
      </div>

      <h3 className="text-lg font-medium text-slate-800 dark:text-slate-100 mb-2">
        {t("settings.general")}
      </h3>

      <div className="divide-y divide-slate-200 dark:divide-slate-700">
        <SettingRow
          label={t("settings.theme.label")}
          description={t("settings.theme.switchTo", {
            mode:
              theme === "light"
                ? t("settings.theme.modeDark")
                : t("settings.theme.modeLight"),
          })}
          control={
            <button
              onClick={toggleTheme}
              className={controlClass}
              role="switch"
              aria-checked={theme === "dark"}
            >
              {theme === "light" ? (
                <SunIcon className="w-4 h-4 text-yellow-500" />
              ) : (
                <MoonIcon className="w-4 h-4 text-blue-400" />
              )}
              {theme === "light"
                ? t("settings.theme.light")
                : t("settings.theme.dark")}
            </button>
          }
        />

        <SettingRow
          label={t("settings.enterBehavior.label")}
          description={
            enterBehavior === "send"
              ? t("settings.enterBehavior.descSend")
              : t("settings.enterBehavior.descNewline")
          }
          control={
            <button
              onClick={toggleEnterBehavior}
              className={controlClass}
              role="switch"
              aria-checked={enterBehavior === "send"}
            >
              <CommandLineIcon className="w-4 h-4 text-slate-500 dark:text-slate-400" />
              {enterBehavior === "send"
                ? t("settings.enterBehavior.send")
                : t("settings.enterBehavior.newline")}
            </button>
          }
        />

        <SettingRow
          label={t("settings.language.label")}
          description={t("settings.language.hint")}
          control={
            <div className={controlClass + " pr-2"}>
              <LanguageIcon className="w-4 h-4 text-slate-500 dark:text-slate-400" />
              <select
                aria-label={t("settings.language.label")}
                value={currentLang}
                onChange={(e) => setLanguage(e.target.value as Language)}
                className="bg-transparent text-sm font-medium text-slate-800 dark:text-slate-100 focus:outline-none cursor-pointer"
              >
                {SUPPORTED_LANGUAGES.map((lng) => (
                  <option key={lng} value={lng}>
                    {LANGUAGE_LABELS[lng]}
                  </option>
                ))}
              </select>
            </div>
          }
        />
      </div>
    </div>
  );
}
