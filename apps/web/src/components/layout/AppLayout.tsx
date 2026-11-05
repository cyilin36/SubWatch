import { Suspense, useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { cn } from '../../lib/utils';
import { FullPageSpinner } from '../ui';
import { SidebarContent } from './Sidebar';
import { Topbar } from './Topbar';
import { useAuth } from '../../providers/AuthProvider';

const COLLAPSE_STORAGE_KEY = 'subwatch-sidebar-collapsed';

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function AppLayout() {
  const { t } = useTranslation();
  const { appName } = useAuth();
  const [collapsed, setCollapsed] = useState<boolean>(readCollapsed);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    document.title = appName ? `${appName} · SubWatch` : 'SubWatch';
  }, [appName]);

  // Close the mobile drawer when the viewport grows to desktop size.
  useEffect(() => {
    const media = window.matchMedia('(min-width: 1024px)');
    const handler = () => {
      if (media.matches) setMobileOpen(false);
    };
    media.addEventListener('change', handler);
    return () => media.removeEventListener('change', handler);
  }, []);

  const toggleCollapsed = () => {
    setCollapsed((current) => {
      const next = !current;
      try {
        localStorage.setItem(COLLAPSE_STORAGE_KEY, next ? '1' : '0');
      } catch {
        // Ignore storage errors.
      }
      return next;
    });
  };

  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      {/* Desktop sidebar */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-30 hidden border-r border-[var(--border)] bg-[var(--surface)] transition-[width] duration-200 lg:block',
          collapsed ? 'w-16' : 'w-60',
        )}
      >
        <SidebarContent collapsed={collapsed} onToggleCollapsed={toggleCollapsed} />
      </aside>

      {/* Mobile drawer */}
      {mobileOpen ? (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div
            className="absolute inset-0 bg-black/50 backdrop-blur-[1px]"
            onClick={() => setMobileOpen(false)}
            aria-hidden
          />
          <aside className="absolute inset-y-0 left-0 w-64 border-r border-[var(--border)] bg-[var(--surface)] shadow-xl">
            <SidebarContent onNavigate={() => setMobileOpen(false)} onClose={() => setMobileOpen(false)} />
          </aside>
        </div>
      ) : null}

      <div
        className={cn(
          'flex min-h-screen flex-col transition-[padding] duration-200',
          collapsed ? 'lg:pl-16' : 'lg:pl-60',
        )}
      >
        <Topbar onOpenMenu={() => setMobileOpen(true)} />
        <main className="mx-auto w-full max-w-7xl flex-1 px-3 py-4 sm:px-5 sm:py-6">
          <Suspense fallback={<FullPageSpinner />}>
            <Outlet />
          </Suspense>
        </main>
        <footer className="mx-auto w-full max-w-7xl px-4 pb-4 text-center text-[11px] text-[var(--muted-foreground)]">
          {t('app.name')} · {t('app.tagline')}
        </footer>
      </div>
    </div>
  );
}
