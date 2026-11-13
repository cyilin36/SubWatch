import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft } from 'lucide-react';
import { AmbientBackground } from '../components/layout/AmbientBackground';
import { BrandMark } from '../components/layout/BrandMark';

/**
 * Standalone 404: the layout has no nav here, so the page paints its own
 * ambient light and the "back home" link is the only champagne action.
 */
export function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-center px-5 py-16 text-center text-white">
      <AmbientBackground />
      <main className="glass glass-panel relative w-full max-w-lg p-8 sm:p-10">
        <BrandMark className="mx-auto h-12 w-12 rounded-[18px]" />
        <p
          className="mt-6 text-display text-white/15 select-none"
          aria-hidden
        >
          404
        </p>
        <h1 className="mt-2 text-balance text-subheading text-white">{t('notFound.title')}</h1>
        <p className="mx-auto mt-2 max-w-sm text-balance text-body text-moonlight">
          {t('notFound.description')}
        </p>
        <div className="mt-8 flex justify-center">
          <Link
            to="/"
            className="cta inline-flex h-11 items-center justify-center gap-2 px-6 text-sm font-medium"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            {t('notFound.goHome')}
          </Link>
        </div>
      </main>
    </div>
  );
}
