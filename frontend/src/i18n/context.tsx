import { FluentBundle, FluentResource, type FluentVariable } from '@fluent/bundle';
import { createContext, useContext, createSignal, type JSX } from 'solid-js';

// ── FTL imports (Vite ?raw) ────────────────────────────────────────────────

import ptCommon    from '../locales/pt-BR/common.ftl?raw';
import ptVault     from '../locales/pt-BR/vault.ftl?raw';
import ptContacts  from '../locales/pt-BR/contacts.ftl?raw';
import ptWorkspace from '../locales/pt-BR/workspace.ftl?raw';
import ptSettings  from '../locales/pt-BR/settings.ftl?raw';
import ptNotes     from '../locales/pt-BR/notes.ftl?raw';

import enCommon    from '../locales/en-US/common.ftl?raw';
import enVault     from '../locales/en-US/vault.ftl?raw';
import enContacts  from '../locales/en-US/contacts.ftl?raw';
import enWorkspace from '../locales/en-US/workspace.ftl?raw';
import enSettings  from '../locales/en-US/settings.ftl?raw';
import enNotes     from '../locales/en-US/notes.ftl?raw';

// ── Types ──────────────────────────────────────────────────────────────────

export type Locale = 'pt-BR' | 'en-US';
export type FluentArgs = Record<string, FluentVariable>;
export type TranslateFn = (id: string, args?: FluentArgs) => string;

interface I18nContextValue {
  t: TranslateFn;
  locale: () => Locale;
  setLocale: (l: Locale) => void;
}

// ── Bundle factory ─────────────────────────────────────────────────────────

function buildBundle(locale: string, ftlStrings: string[]): FluentBundle {
  // useIsolating: false removes Unicode bidi isolation marks (cleaner output)
  const bundle = new FluentBundle(locale, { useIsolating: false });
  for (const ftl of ftlStrings) {
    bundle.addResource(new FluentResource(ftl));
  }
  return bundle;
}

const BUNDLES: Record<Locale, FluentBundle> = {
  'pt-BR': buildBundle('pt-BR', [ptCommon, ptVault, ptContacts, ptWorkspace, ptSettings, ptNotes]),
  'en-US': buildBundle('en-US', [enCommon, enVault, enContacts, enWorkspace, enSettings, enNotes]),
};

// ── Context ────────────────────────────────────────────────────────────────

const I18nContext = createContext<I18nContextValue>();

export function I18nProvider(props: { locale?: Locale; children: JSX.Element }) {
  const [locale, setLocale] = createSignal<Locale>(props.locale ?? 'pt-BR');

  // Reads locale() signal — SolidJS tracks this in any reactive context,
  // so JSX that calls t() will re-render automatically when locale changes.
  const t: TranslateFn = (id, args) => {
    const bundle = BUNDLES[locale()];
    const msg = bundle.getMessage(id);
    if (!msg?.value) {
      if (import.meta.env.DEV) {
        console.warn(`[i18n] Missing message: "${id}" for locale "${locale()}"`);
      }
      return id;
    }
    const errors: Error[] = [];
    const result = bundle.formatPattern(msg.value, args ?? null, errors);
    if (import.meta.env.DEV && errors.length > 0) {
      console.warn(`[i18n] Format errors for "${id}":`, errors);
    }
    return result;
  };

  return (
    <I18nContext.Provider value={{ t, locale, setLocale }}>
      {props.children}
    </I18nContext.Provider>
  );
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be called inside <I18nProvider>');
  return ctx;
}
