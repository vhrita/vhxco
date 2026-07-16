// Supported locales. The `ui` object is consumed structurally by
// getLangFromUrl (src/i18n/utils.ts) to detect the URL locale prefix.
// Live translation strings live in src/lib/i18n/ (getT + locales/*.json).
export const defaultLang = "pt";

export const ui = {
  en: {},
  pt: {},
} as const;
