import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { en, type MessageKey } from './en.js';
import { id } from './id.js';

/** Extensible: add a dictionary here (and a `<lang>.ts` typed as Record<MessageKey,string>) to support another language. */
export const DICTIONARIES = { en, id } as const;
export type Locale = keyof typeof DICTIONARIES;
export const LOCALES: { code: Locale; label: string }[] = [
  { code: 'id', label: 'Bahasa Indonesia' },
  { code: 'en', label: 'English' },
];
export type { MessageKey };

type Params = Record<string, string | number | boolean | null | undefined>;
export function format(template: string, params?: Params): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, k: string) => (params[k] === undefined || params[k] === null ? `{${k}}` : String(params[k])));
}
export function translate(locale: Locale, key: string, params?: Params): string {
  const dict = DICTIONARIES[locale] as Record<string, string>;
  return format(dict[key] ?? (en as Record<string, string>)[key] ?? key, params);
}
export function hasKey(key: string): key is MessageKey {
  return key in en;
}

interface I18n {
  locale: Locale;
  setLocale: (l: Locale) => void;
  /** Typed keys for static text. */
  t: (key: MessageKey, params?: Params) => string;
  /** Dynamic keys (enum values coming from the API): falls back to the raw value, never throws. */
  td: (prefix: string, value: string | null | undefined, params?: Params) => string;
}
const Ctx = createContext<I18n | null>(null);
const STORE = 'avo.locale';

function initialLocale(): Locale {
  try {
    const s = localStorage.getItem(STORE);
    if (s === 'id' || s === 'en') return s;
  } catch {
    /* storage unavailable */
  }
  return typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('en') ? 'en' : 'id';
}

export function I18nProvider({ children, initial }: { children: ReactNode; initial?: Locale }) {
  const [locale, setLoc] = useState<Locale>(initial ?? initialLocale());
  const setLocale = useCallback((l: Locale) => {
    setLoc(l);
    try {
      localStorage.setItem(STORE, l);
    } catch {
      /* ignore */
    }
    document.documentElement.lang = l;
  }, []);
  const value = useMemo<I18n>(
    () => ({
      locale,
      setLocale,
      t: (key, params) => translate(locale, key, params),
      td: (prefix, value, params) => (value ? (hasKey(`${prefix}.${value}`) ? translate(locale, `${prefix}.${value}`, params) : value) : ''),
    }),
    [locale, setLocale],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export function useI18n(): I18n {
  const v = useContext(Ctx);
  if (!v) throw new Error('I18nProvider missing');
  return v;
}
