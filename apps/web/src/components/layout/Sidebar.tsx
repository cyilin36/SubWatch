import { NavLink } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, LogOut, X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { Button, Tooltip } from '../ui';
import { useAuth } from '../../providers/AuthProvider';
import { NAV_ITEMS } from './nav';

export function BrandMark({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--brand)] text-[var(--brand-foreground)] shadow-sm',
        className,
      )}
      aria-hidden
    >
      <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5">
        <path
          d="M3 12h4l2.5-6 4 12L16 12h5"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

export interface SidebarContentProps {
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
  onNavigate?: () => void;
  onClose?: () => void;
}

export function SidebarContent({ collapsed = false, onToggleCollapsed, onNavigate, onClose }: SidebarContentProps) {
  const { t } = useTranslation();
  const { appName, logout } = useAuth();

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        className={cn(
          'flex h-14 shrink-0 items-center gap-2.5 border-b border-[var(--border)] px-3',
          collapsed && 'justify-center px-2',
        )}
      >
        <BrandMark />
        {!collapsed ? (
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold leading-tight">{appName}</p>
            <p className="truncate text-[10px] uppercase tracking-wider text-[var(--muted-foreground)]">
              {t('app.tagline')}
            </p>
          </div>
        ) : null}
        {onClose ? (
          <Button variant="ghost" size="icon-sm" className="lg:hidden" onClick={onClose} aria-label={t('nav.closeMenu')}>
            <X className="h-4 w-4" aria-hidden />
          </Button>
        ) : null}
      </div>

      <nav className="flex-1 space-y-1 overflow-y-auto p-2">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const link = (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              onClick={onNavigate}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
                  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]',
                  collapsed && 'justify-center px-2',
                  isActive
                    ? 'bg-[var(--brand)] text-[var(--brand-foreground)] shadow-sm'
                    : 'text-[var(--foreground)] hover:bg-[var(--surface-muted)]',
                )
              }
            >
              <Icon className="h-4.5 w-4.5 shrink-0" aria-hidden />
              {!collapsed ? <span className="truncate">{t(item.labelKey)}</span> : null}
            </NavLink>
          );
          return collapsed ? (
            <Tooltip key={item.to} content={t(item.labelKey)} side="right">
              {link}
            </Tooltip>
          ) : (
            link
          );
        })}
      </nav>

      <div className="shrink-0 space-y-1 border-t border-[var(--border)] p-2">
        <button
          type="button"
          onClick={() => {
            void logout();
          }}
          className={cn(
            'flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-[var(--foreground)] transition-colors hover:bg-[var(--surface-muted)]',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]',
            collapsed && 'justify-center px-2',
          )}
        >
          <LogOut className="h-4.5 w-4.5 shrink-0" aria-hidden />
          {!collapsed ? <span className="truncate">{t('nav.logout')}</span> : null}
        </button>
        {onToggleCollapsed ? (
          <button
            type="button"
            onClick={onToggleCollapsed}
            title={collapsed ? t('nav.expand') : t('nav.collapse')}
            className={cn(
              'hidden w-full items-center gap-3 rounded-lg px-3 py-2 text-sm text-[var(--muted-foreground)] transition-colors hover:bg-[var(--surface-muted)] lg:flex',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]',
              collapsed && 'justify-center px-2',
            )}
          >
            {collapsed ? (
              <ChevronRight className="h-4 w-4 shrink-0" aria-hidden />
            ) : (
              <>
                <ChevronLeft className="h-4 w-4 shrink-0" aria-hidden />
                <span className="truncate">{t('nav.collapse')}</span>
              </>
            )}
          </button>
        ) : null}
      </div>
    </div>
  );
}
