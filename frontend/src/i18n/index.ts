import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import en from "./locales/en.json";
import zh from "./locales/zh.json";

export const SUPPORTED_LANGUAGES = ["en", "zh"] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];

// Storage key used by the language detector and the Settings UI alike.
// Kept distinct from `claude-code-webui-settings` so changes here don't fight
// with the existing settings migration logic.
export const LANGUAGE_STORAGE_KEY = "claude-code-webui-language";

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: {
      en: { translation: en },
      zh: { translation: zh },
    },
    fallbackLng: "en",
    supportedLngs: SUPPORTED_LANGUAGES,
    nonExplicitSupportedLngs: true, // map "zh-CN" → "zh"
    interpolation: { escapeValue: false }, // React already escapes
    detection: {
      order: ["localStorage", "navigator"],
      lookupLocalStorage: LANGUAGE_STORAGE_KEY,
      caches: ["localStorage"],
    },
  });

export function setLanguage(lng: Language) {
  void i18n.changeLanguage(lng);
}

export default i18n;
