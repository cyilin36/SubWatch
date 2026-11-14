import type { Theme } from '@subwatch/shared';

/** Stored appearance preference: light, dark, or follow the operating system. */
export const THEME_STORAGE_KEY = 'subwatch-theme';

/** Day glass is the default appearance; night glass is one click away. */
export const DEFAULT_THEME: Theme = 'light';

export function getStoredTheme(): Theme {
  try {
    const value = localStorage.getItem(THEME_STORAGE_KEY);
    if (value === 'light' || value === 'dark' || value === 'system') return value;
  } catch {
    // localStorage is unavailable in some privacy modes; fall through.
  }
  return DEFAULT_THEME;
}

export function storeTheme(theme: Theme): void {
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Ignore storage failures; the in-memory preference still applies.
  }
}

export function prefersDark(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  );
}

export function resolveTheme(theme: Theme): 'light' | 'dark' {
  if (theme === 'system') return prefersDark() ? 'dark' : 'light';
  return theme;
}

/**
 * Stamp the resolved appearance on <html>. Every token in styles.css is scoped by
 * `data-theme`, so this single attribute repaints the whole interface.
 */
export function applyTheme(theme: Theme): 'light' | 'dark' {
  const resolved = resolveTheme(theme);
  const root = document.documentElement;
  root.dataset.theme = resolved;
  root.classList.toggle('dark', resolved === 'dark');
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', resolved === 'dark' ? '#060a13' : '#ffffff');
  return resolved;
}
