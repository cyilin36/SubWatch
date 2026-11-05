import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { AuthStatusDto, Locale, SettingsDto, Theme } from '@subwatch/shared';
import i18n, { persistLocale } from '../i18n';
import { api, type MonitorMetaDto } from '../lib/api';
import { errorMessage } from '../lib/utils';
import { applyTheme, getStoredTheme, resolveTheme, storeTheme, THEME_STORAGE_KEY } from '../lib/theme';

export interface AuthContextValue {
  status: AuthStatusDto | undefined;
  meta: MonitorMetaDto | undefined;
  settings: SettingsDto | undefined;
  settingsLoading: boolean;
  isLoading: boolean;
  error: unknown;
  authenticated: boolean;
  setupRequired: boolean;
  timezone: string;
  locale: Locale;
  theme: Theme;
  resolvedTheme: 'light' | 'dark';
  appName: string;
  baseUrl: string;
  login: (password: string) => Promise<void>;
  setup: (password: string) => Promise<void>;
  logout: () => Promise<void>;
  retry: () => void;
  setLanguage: (locale: Locale) => Promise<void>;
  setTheme: (theme: Theme) => void;
  syncSettings: (settings: SettingsDto) => void;
  reloadSettings: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function readStoredTheme(): string | null {
  try {
    return localStorage.getItem(THEME_STORAGE_KEY);
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const hasStoredThemeRef = useRef<boolean>(readStoredTheme() !== null);
  const adoptedThemeRef = useRef(false);
  const unauthorizedAtRef = useRef(0);

  const [theme, setThemeState] = useState<Theme>(() => getStoredTheme());
  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>(() => resolveTheme(getStoredTheme()));

  const statusQuery = useQuery<AuthStatusDto>({
    queryKey: ['auth', 'status'],
    queryFn: () => api.auth.status(),
    retry: false,
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });

  const authenticated = Boolean(statusQuery.data?.authenticated);

  const metaQuery = useQuery<MonitorMetaDto>({
    queryKey: ['meta'],
    queryFn: () => api.meta(),
    retry: false,
    staleTime: 60_000,
  });

  const settingsQuery = useQuery<SettingsDto>({
    queryKey: ['settings'],
    queryFn: () => api.settings.get(),
    enabled: authenticated,
    retry: false,
    staleTime: 30_000,
  });

  // Apply the resolved theme whenever the preference changes.
  useEffect(() => {
    setResolvedTheme(applyTheme(theme));
  }, [theme]);

  // Track OS theme changes while on "system".
  useEffect(() => {
    if (theme !== 'system') return;
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => setResolvedTheme(applyTheme('system'));
    media.addEventListener('change', handler);
    return () => media.removeEventListener('change', handler);
  }, [theme]);

  // Adopt the server-side theme once when the browser has no local preference.
  useEffect(() => {
    if (adoptedThemeRef.current || !settingsQuery.data) return;
    adoptedThemeRef.current = true;
    if (!hasStoredThemeRef.current) setThemeState(settingsQuery.data.general.theme);
  }, [settingsQuery.data]);

  // Keep <html lang> in sync with i18n.
  useEffect(() => {
    document.documentElement.lang = i18n.language;
    const handler = (language: string) => {
      document.documentElement.lang = language;
    };
    i18n.on('languageChanged', handler);
    return () => {
      i18n.off('languageChanged', handler);
    };
  }, []);

  // Global 401 handler: drop session state and let the router redirect to /login.
  useEffect(() => {
    const handler = () => {
      queryClient.setQueryData<AuthStatusDto>(['auth', 'status'], {
        setupRequired: false,
        authenticated: false,
      });
      queryClient.removeQueries({ queryKey: ['settings'] });
      adoptedThemeRef.current = false;
      const now = Date.now();
      if (now - unauthorizedAtRef.current > 4000) {
        unauthorizedAtRef.current = now;
        toast.error(i18n.t('auth.sessionExpired'));
      }
    };
    window.addEventListener('subwatch:unauthorized', handler);
    return () => window.removeEventListener('subwatch:unauthorized', handler);
  }, [queryClient]);

  const login = useCallback(
    async (password: string) => {
      const data = await api.auth.login(password);
      unauthorizedAtRef.current = 0;
      queryClient.setQueryData(['auth', 'status'], data);
      adoptedThemeRef.current = false;
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['settings'] }),
        queryClient.invalidateQueries({ queryKey: ['meta'] }),
      ]);
    },
    [queryClient],
  );

  const setup = useCallback(
    async (password: string) => {
      const data = await api.auth.setup(password);
      unauthorizedAtRef.current = 0;
      queryClient.setQueryData(['auth', 'status'], data);
      adoptedThemeRef.current = false;
      // Align the server notification language with the browser UI language.
      await api.settings
        .patch({ general: { locale: i18n.language as Locale } })
        .catch(() => undefined);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['settings'] }),
        queryClient.invalidateQueries({ queryKey: ['meta'] }),
      ]);
    },
    [queryClient],
  );

  const logout = useCallback(async () => {
    try {
      await api.auth.logout();
    } catch {
      // Logging out locally is still correct even when the request fails.
    }
    queryClient.setQueryData<AuthStatusDto>(['auth', 'status'], {
      setupRequired: false,
      authenticated: false,
    });
    queryClient.removeQueries({
      predicate: (query) => query.queryKey[0] !== 'meta' && query.queryKey[0] !== 'auth',
    });
    adoptedThemeRef.current = false;
    toast.success(i18n.t('auth.logoutSuccess'));
  }, [queryClient]);

  const setLanguage = useCallback(
    async (locale: Locale) => {
      if (locale === i18n.language) return;
      await i18n.changeLanguage(locale);
      persistLocale(locale);
      if (authenticated) {
        try {
          await api.settings.patch({ general: { locale } });
          await queryClient.invalidateQueries({ queryKey: ['settings'] });
          await queryClient.invalidateQueries({ queryKey: ['meta'] });
        } catch (error) {
          toast.error(errorMessage(error));
        }
      }
    },
    [authenticated, queryClient],
  );

  const setTheme = useCallback(
    (next: Theme) => {
      hasStoredThemeRef.current = true;
      setThemeState(next);
      storeTheme(next);
      if (authenticated) {
        api.settings
          .patch({ general: { theme: next } })
          .then(() => queryClient.invalidateQueries({ queryKey: ['settings'] }))
          .catch(() => undefined);
      }
    },
    [authenticated, queryClient],
  );

  const syncSettings = useCallback(
    (next: SettingsDto) => {
      queryClient.setQueryData(['settings'], next);
      const serverTheme = next.general.theme;
      hasStoredThemeRef.current = true;
      setThemeState(serverTheme);
      storeTheme(serverTheme);
      const serverLocale = next.general.locale;
      if (i18n.language !== serverLocale) {
        void i18n.changeLanguage(serverLocale);
        persistLocale(serverLocale);
      }
      void queryClient.invalidateQueries({ queryKey: ['meta'] });
    },
    [queryClient],
  );

  const reloadSettings = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ['settings'] });
  }, [queryClient]);

  const retry = useCallback(() => {
    void statusQuery.refetch();
    void metaQuery.refetch();
  }, [statusQuery, metaQuery]);

  const meta = metaQuery.data;
  const timezone = settingsQuery.data?.general.timezone ?? meta?.timezone ?? 'Asia/Shanghai';
  const locale = (i18n.language === 'en' ? 'en' : 'zh-CN') as Locale;

  const value = useMemo<AuthContextValue>(
    () => ({
      status: statusQuery.data,
      meta,
      settings: settingsQuery.data,
      settingsLoading: settingsQuery.isPending,
      isLoading: statusQuery.isPending,
      error: statusQuery.error,
      authenticated: statusQuery.data?.authenticated ?? false,
      setupRequired: statusQuery.data?.setupRequired ?? meta?.setupRequired ?? false,
      timezone,
      locale,
      theme,
      resolvedTheme,
      appName: meta?.appName ?? 'SubWatch',
      baseUrl: meta?.baseUrl ?? '',
      login,
      setup,
      logout,
      retry,
      setLanguage,
      setTheme,
      syncSettings,
      reloadSettings,
    }),
    [
      statusQuery.data,
      statusQuery.isPending,
      statusQuery.error,
      meta,
      settingsQuery.data,
      settingsQuery.isPending,
      timezone,
      locale,
      theme,
      resolvedTheme,
      login,
      setup,
      logout,
      retry,
      setLanguage,
      setTheme,
      syncSettings,
      reloadSettings,
    ],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}
