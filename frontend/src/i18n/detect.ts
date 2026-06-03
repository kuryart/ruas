import type { Locale } from './context';

const SUPPORTED: Locale[] = ['pt-BR', 'en-US'];
const DEFAULT: Locale = 'pt-BR';

export function detectLocale(): Locale {
  const languages: readonly string[] =
    typeof navigator !== 'undefined'
      ? (navigator.languages?.length ? navigator.languages : [navigator.language])
      : [DEFAULT];

  for (const lang of languages) {
    // Exact match (e.g. "pt-BR")
    if (SUPPORTED.includes(lang as Locale)) return lang as Locale;
    // Base-language match (e.g. "pt" → "pt-BR")
    const base = lang.split('-')[0];
    const match = SUPPORTED.find(l => l.startsWith(base));
    if (match) return match;
  }
  return DEFAULT;
}
