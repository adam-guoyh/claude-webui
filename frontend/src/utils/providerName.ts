import type { TFunction } from "i18next";

/**
 * Localized name for an integration provider. Falls back to the backend's
 * `displayName` (English, opinionated like "Feishu / Lark") when the i18n
 * key isn't defined. Adding a new provider only needs an
 * `integrations.providerName.<id>` entry in each locale.
 */
export function providerLabel(
  t: TFunction,
  id: string,
  fallback: string,
): string {
  const key = `integrations.providerName.${id}`;
  const localized = t(key, { defaultValue: "" });
  return localized && localized !== key ? localized : fallback;
}
