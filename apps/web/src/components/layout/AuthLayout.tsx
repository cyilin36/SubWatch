import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { BrandMark } from './Sidebar';
import { LanguageMenu, ThemeMenu } from './Controls';
import { useAuth } from '../../providers/AuthProvider';

/** Centered layout used by /login and /setup. */
export function AuthLayout({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { appName } = useAuth();
  return (
    <div className="flex min-h-screen flex-col bg-[var(--background)] text-[var(--foreground)]">
      <div className="flex items-center justify-between p-4">
        <div className="flex items-center gap-2.5">
          <BrandMark />
          <div>
            <p className="text-sm font-semibold leading-tight">{appName}</p>
            <p className="text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">
              {t('app.tagline')}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-0.5">
          <LanguageMenu />
          <ThemeMenu />
        </div>
      </div>
      <div className="flex flex-1 items-center justify-center px-4 pb-20">
        <div className="w-full max-w-sm">{children}</div>
      </div>
    </div>
  );
}
