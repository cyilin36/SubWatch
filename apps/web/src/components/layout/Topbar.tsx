import { useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LogOut, Menu } from 'lucide-react';
import { Button } from '../ui';
import { LanguageMenu, ThemeMenu } from './Controls';
import { navLabelKey } from './nav';
import { useAuth } from '../../providers/AuthProvider';

export function Topbar({ onOpenMenu }: { onOpenMenu: () => void }) {
  const { t } = useTranslation();
  const { appName, logout } = useAuth();
  const location = useLocation();
  const title = t(navLabelKey(location.pathname));

  return (
    <header className="sticky top-0 z-20 border-b border-[var(--border)] bg-[var(--surface)]/85 backdrop-blur">
      <div className="flex h-14 items-center gap-2 px-3 sm:px-5">
        <Button
          variant="ghost"
          size="icon-sm"
          className="lg:hidden"
          onClick={onOpenMenu}
          aria-label={t('nav.menu')}
        >
          <Menu className="h-5 w-5" aria-hidden />
        </Button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-semibold">{title}</p>
          <p className="hidden truncate text-[11px] text-[var(--muted-foreground)] sm:block">
            {appName} · {t('app.tagline')}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-0.5">
          <LanguageMenu />
          <ThemeMenu />
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => {
              void logout();
            }}
            title={t('nav.logout')}
            aria-label={t('nav.logout')}
          >
            <LogOut className="h-4 w-4" aria-hidden />
          </Button>
        </div>
      </div>
    </header>
  );
}
