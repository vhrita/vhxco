/**
 * t.ts — typed translation helper
 *
 * Loads pt.json / en.json from locales/ and returns a typed getter function.
 * Usage (Astro component):
 *
 *   import { getT } from '@/lib/i18n/t';
 *   const t = getT(locale); // locale: 'pt' | 'en'
 *   t('core.eyebrow')       // → "Capítulo 01 / O Núcleo"
 *
 * For keys that contain HTML markup (e.g. core.headline) use t() with
 * set:html / Fragment in Astro, or dangerouslySetInnerHTML in React.
 *
 * Falls back to 'pt' when a key is missing in the requested locale.
 */

import type { Locale } from './config';

// Static imports — Vite/Astro bundles these as JSON modules at build time.
// Tree-shaken per locale at the page level.
import ptRaw from './locales/pt.json';
import enRaw from './locales/en.json';

type DeepRecord = { [k: string]: string | DeepRecord };

const dicts: Record<Locale, DeepRecord> = {
  pt: ptRaw as DeepRecord,
  en: enRaw as DeepRecord,
};

/**
 * Resolve a dot-separated key path in a nested object.
 * e.g. resolve({core:{eyebrow:'X'}}, 'core.eyebrow') → 'X'
 */
function resolve(obj: DeepRecord, path: string): string | undefined {
  const parts = path.split('.');
  let cur: string | DeepRecord = obj;
  for (const part of parts) {
    if (typeof cur !== 'object' || cur === null) return undefined;
    cur = (cur as DeepRecord)[part];
  }
  return typeof cur === 'string' ? cur : undefined;
}

/**
 * Returns a t() function for the given locale.
 * Falls back to 'pt' when key is missing in the requested locale.
 */
export function getT(locale: Locale) {
  return function t(key: string): string {
    return (
      resolve(dicts[locale], key) ??
      resolve(dicts['pt'], key) ??
      key // last resort: return the key itself
    );
  };
}
