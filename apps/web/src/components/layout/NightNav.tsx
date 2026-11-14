import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, NavLink, useLocation } from 'react-router-dom';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { useTranslation } from 'react-i18next';
import { Activity, ChevronDown, CreditCard, LayoutTemplate, LogOut, Menu, Plus, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { BrandMark } from './BrandMark';
import { LanguageMenu } from './Controls';
import { ThemeMenu } from './ThemeMenu';
import { isEditorRoute, NAV_ITEMS } from './nav';
import { useAuth } from '../../providers/AuthProvider';

const CREATE_ITEMS = [
  { to: '/subscriptions/new', labelKey: 'nav.newSubscription', icon: CreditCard },
  { to: '/monitors/new', labelKey: 'nav.newMonitor', icon: Activity },
  { to: '/templates/new', labelKey: 'templates.newTemplate', icon: LayoutTemplate },
] as const;

/**
 * Night Nav: one 72px glass bar. Wordmark on the left, links in the middle and a
 * single accent action on the right. Form pages hide the action so their own
 * submit button stays the only accent on screen.
 */
export function NightNav({ appName }: { appName: string }) {
  const { t } = useTranslation();
  const { logout } = useAuth();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  const showCreate = !isEditorRoute(location.pathname);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileOpen(false);
    };
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', onKey);
    };
  }, [mobileOpen]);

  const drawer =
    mobileOpen && typeof document !== 'undefined'
      ? createPortal(
          <div className="fixed inset-0 z-[80] lg:hidden">
            <div
              className="absolute inset-0 bg-scrim backdrop-blur-sm"
              onClick={() => setMobileOpen(false)}
              aria-hidden
            />
            <div
              role="dialog"
              aria-modal="true"
              aria-label={t('nav.menu')}
              className="glass glass-panel absolute left-3 top-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] flex w-[min(20rem,calc(100vw-1.5rem))] flex-col overflow-hidden"
            >
              <div className="flex items-center gap-3 border-b border-ink/10 px-5 py-4">
                <BrandMark />
                <p className="min-w-0 flex-1 truncate text-[15px] font-medium">{appName}</p>
                <button
                  type="button"
                  onClick={() => setMobileOpen(false)}
                  aria-label={t('common.close')}
                  className="rounded-full p-2 text-moonlight transition-colors hover:bg-ink/10 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink/60"
                >
                  <X className="h-4 w-4" aria-hidden />
                </button>
              </div>
              <nav className="flex-1 overflow-y-auto p-3" aria-label={t('nav.mainNav')}>
                <ul className="flex flex-col gap-1">
                  {NAV_ITEMS.map((item) => {
                    const Icon = item.icon;
                    return (
                      <li key={item.to}>
                        <NavLink
                          to={item.to}
                          end={item.end}
                          className="nav-link flex items-center gap-3 px-4 py-2.5 text-sm font-medium"
                        >
                          <Icon className="h-4 w-4 shrink-0" aria-hidden />
                          <span className="truncate">{t(item.labelKey)}</span>
                        </NavLink>
                      </li>
                    );
                  })}
                </ul>
              </nav>
              <div className="flex flex-col gap-2 border-t border-ink/10 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
                {CREATE_ITEMS.map((item) => {
                  const Icon = item.icon;
                  return (
                    <Link
                      key={item.to}
                      to={item.to}
                      onClick={() => setMobileOpen(false)}
                      className="glass-flat flex items-center gap-3 rounded-btn px-4 py-2.5 text-sm font-medium text-ink transition-colors hover:bg-ink/10"
                    >
                      <Icon className="h-4 w-4 text-moonlight" aria-hidden />
                      {t(item.labelKey)}
                    </Link>
                  );
                })}
                <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1">
                    <ThemeMenu showLabel />
                    <LanguageMenu showLabel />
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setMobileOpen(false);
                      void logout();
                    }}
                    className="flex items-center gap-2 rounded-full px-3 py-2 text-sm text-moonlight transition-colors hover:bg-ink/10 hover:text-ink"
                  >
                    <LogOut className="h-4 w-4" aria-hidden />
                    {t('nav.logout')}
                  </button>
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <header className="night-nav sticky top-0 z-50" data-scrolled={scrolled}>
        <div className="mx-auto flex h-[72px] w-full max-w-[1280px] items-center gap-3 px-4 sm:px-6 lg:px-8">
          <Link
            to="/"
            className="flex min-w-0 shrink-0 items-center gap-3 rounded-full py-1 pr-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink/60"
          >
            <BrandMark />
            <span className="truncate text-body font-medium tracking-tight text-ink">{appName}</span>
          </Link>

          <nav className="mx-auto hidden items-center gap-1 lg:flex" aria-label={t('nav.mainNav')}>
            {NAV_ITEMS.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className="nav-link px-4 py-2 text-sm font-medium"
              >
                {t(item.labelKey)}
              </NavLink>
            ))}
          </nav>

          <div className="ml-auto flex shrink-0 items-center gap-1.5 lg:ml-0">
            <div className="flex items-center gap-1.5">
              <ThemeMenu />
              <LanguageMenu />
              <button
                type="button"
                onClick={() => {
                  void logout();
                }}
                title={t('nav.logout')}
                aria-label={t('nav.logout')}
                className="hidden h-10 w-10 items-center justify-center rounded-full text-moonlight transition-colors hover:bg-ink/10 hover:text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink/60 sm:inline-flex"
              >
                <LogOut className="h-4 w-4" aria-hidden />
              </button>
            </div>

            {showCreate ? (
              <DropdownMenu.Root>
                <DropdownMenu.Trigger asChild>
                  <button
                    type="button"
                    className="cta hidden h-10 items-center gap-2 px-5 text-sm sm:inline-flex"
                  >
                    <Plus className="h-4 w-4" aria-hidden />
                    {t('nav.create')}
                    <ChevronDown className="h-3.5 w-3.5 opacity-70" aria-hidden />
                  </button>
                </DropdownMenu.Trigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.Content
                    align="end"
                    sideOffset={10}
                    className="glass-popover z-[70] w-60 p-1.5"
                  >
                    {CREATE_ITEMS.map((item) => {
                      const Icon = item.icon;
                      return (
                        <DropdownMenu.Item key={item.to} asChild>
                          <Link
                            to={item.to}
                            className="flex cursor-pointer select-none items-center gap-3 rounded-btn px-3 py-2.5 text-sm text-ink/85 outline-none transition-colors data-[highlighted]:bg-ink/10 data-[highlighted]:text-ink"
                          >
                            <Icon className="h-4 w-4 text-moonlight" aria-hidden />
                            {t(item.labelKey)}
                          </Link>
                        </DropdownMenu.Item>
                      );
                    })}
                  </DropdownMenu.Content>
                </DropdownMenu.Portal>
              </DropdownMenu.Root>
            ) : null}

            <button
              type="button"
              onClick={() => setMobileOpen(true)}
              aria-label={t('nav.menu')}
              aria-expanded={mobileOpen}
              className={cn(
                'rounded-full p-2 text-moonlight transition-colors hover:bg-ink/10 hover:text-ink lg:hidden',
                'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink/60',
              )}
            >
              <Menu className="h-5 w-5" aria-hidden />
            </button>
          </div>
        </div>
      </header>
      {drawer}
    </>
  );
}
