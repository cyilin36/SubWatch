import { Suspense } from 'react';
import { Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { FullPageSpinner } from '../ui';
import { AmbientBackground } from './AmbientBackground';
import { NightNav } from './NightNav';
import { useAuth } from '../../providers/AuthProvider';

/**
 * Authenticated shell: a fixed ambient light layer, the 72px night nav and one
 * centered content column capped at the design's 1280px page width.
 */
export function AppLayout() {
  const { t } = useTranslation();
  const { appName } = useAuth();

  return (
    <div className="relative min-h-screen text-ink">
      <AmbientBackground />
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[90] focus:rounded-full focus:border focus:border-ink/20 focus:bg-night-steel focus:px-5 focus:py-2 focus:text-sm focus:font-medium focus:text-ink"
      >
        {t('nav.skipToContent')}
      </a>
      <NightNav appName={appName} />
      <main id="main" className="relative mx-auto w-full max-w-[1280px] px-4 pb-16 pt-8 sm:px-6 sm:pt-10 lg:px-8 lg:pt-12">
        <Suspense fallback={<FullPageSpinner />}>
          <Outlet />
        </Suspense>
      </main>
      <footer className="relative mx-auto w-full max-w-[1280px] px-4 pb-8 text-center text-[11px] tracking-[0.14em] text-moonlight uppercase sm:px-6 lg:px-8">
        {t('app.name')} · {t('app.tagline')}
      </footer>
    </div>
  );
}
