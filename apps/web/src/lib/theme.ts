import type { Theme } from '@subwatch/shared';

/**
 * The web client ships a single night-glass appearance. The theme preference is
 * kept in the settings payload for API compatibility, but the UI always renders
 * dark: glass only reads correctly when there is light to bend behind it.
 */
export const THEME_STORAGE_KEY = 'subwatch-theme';

export const FIXED_THEME: Theme = 'dark';

export function getStoredTheme(): Theme {
  return FIXED_THEME;
}

export function storeTheme(): void {
  // Retained for API compatibility; the appearance is fixed.
}

export function resolveTheme(): 'dark' {
  return 'dark';
}

/** Stamp the dark appearance on <html> before the first paint. */
export function applyTheme(): 'dark' {
  const root = document.documentElement;
  root.classList.add('dark');
  root.dataset.theme = 'dark';
  return 'dark';
}
