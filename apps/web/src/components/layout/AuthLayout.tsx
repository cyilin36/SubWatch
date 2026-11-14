import type { ReactNode } from 'react';
import { AmbientBackground } from './AmbientBackground';
import { LanguageMenu, LayoutBrand } from './Controls';
import { ThemeMenu } from './ThemeMenu';
import { useAuth } from '../../providers/AuthProvider';

/** Centered glass layout used by /login and /setup. */
export function AuthLayout({ children }: { children: ReactNode }) {
  const { appName } = useAuth();
  return (
    <div className="relative flex min-h-screen flex-col text-ink">
      <AmbientBackground />
      <header className="relative flex items-center justify-between gap-4 px-4 py-5 sm:px-8">
        <LayoutBrand appName={appName} />
        <div className="flex items-center gap-1">
          <ThemeMenu />
          <LanguageMenu />
        </div>
      </header>
      <div className="relative flex flex-1 items-center justify-center px-4 pb-24">
        <div className="w-full max-w-[27rem]">{children}</div>
      </div>
      <p className="relative pb-8 text-center text-[11px] tracking-[0.14em] text-moonlight uppercase">
        {appName}
      </p>
    </div>
  );
}
