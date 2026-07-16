export const locales = ['pt', 'en'] as const;
export type Locale = (typeof locales)[number];

export const defaultLocale: Locale = 'pt';

/**
 * Extracts the locale from a URL pathname.
 * e.g. "/en/about" → "en", "/sobre" → "pt" (default)
 */
export function getLocaleFromPath(pathname: string): Locale {
  const [, first] = pathname.split('/');
  if ((locales as readonly string[]).includes(first)) {
    return first as Locale;
  }
  return defaultLocale;
}

/**
 * Returns the alternate URL for a given locale.
 * e.g. getAlternateUrl("/en/about", "pt") → "/about"
 *      getAlternateUrl("/about", "en") → "/en/about"
 */
export function getAlternateUrl(pathname: string, targetLocale: Locale): string {
  const currentLocale = getLocaleFromPath(pathname);

  // Strip current locale prefix if present
  let strippedPath = pathname;
  if (currentLocale !== defaultLocale) {
    strippedPath = pathname.replace(`/${currentLocale}`, '') || '/';
  }

  if (targetLocale === defaultLocale) {
    return strippedPath;
  }

  // Add target locale prefix
  return `/${targetLocale}${strippedPath === '/' ? '' : strippedPath}`;
}
