import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import type { Locale } from '@subwatch/shared';
import zhCN from './zh-CN';
import en from './en';

export const LANGUAGE_STORAGE_KEY = 'subwatch-language';

export function isLocale(value: string): value is Locale {
  return value === 'zh-CN' || value === 'en';
}

/** Browser language: `zh*` -> zh-CN, everything else -> en. */
export function detectBrowserLocale(): Locale {
  if (typeof navigator === 'undefined') return 'zh-CN';
  const language = navigator.language || '';
  return language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en';
}

export function detectLocale(): Locale {
  try {
    const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (stored && isLocale(stored)) return stored;
  } catch {
    // Ignore storage errors.
  }
  return detectBrowserLocale();
}

export function persistLocale(locale: Locale): void {
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, locale);
  } catch {
    // Ignore storage errors.
  }
}

void i18n.use(initReactI18next).init({
  resources: {
    'zh-CN': { translation: zhCN },
    en: { translation: en },
  },
  lng: detectLocale(),
  fallbackLng: 'zh-CN',
  supportedLngs: ['zh-CN', 'en'],
  nonExplicitSupportedLngs: false,
  interpolation: { escapeValue: false },
  returnNull: false,
  react: { useSuspense: false },
});

export default i18n;
