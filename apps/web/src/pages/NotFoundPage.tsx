import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Compass } from 'lucide-react';
import { EmptyState } from '../components/ui';

export function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-screen items-center justify-center bg-[var(--background)] px-4">
      <EmptyState
        className="w-full max-w-md border-solid bg-[var(--surface)]"
        icon={<Compass className="h-8 w-8" aria-hidden />}
        title={t('notFound.title')}
        description={t('notFound.description')}
        action={
          <Link
            to="/"
            className="inline-flex h-9 items-center justify-center rounded-lg bg-[var(--brand)] px-4 text-sm font-medium text-[var(--brand-foreground)] hover:brightness-110"
          >
            {t('notFound.goHome')}
          </Link>
        }
      />
    </div>
  );
}
