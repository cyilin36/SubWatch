import type { LucideIcon } from 'lucide-react';
import { BellRing, GitBranch, LayoutTemplate, ListChecks, Send, Settings } from 'lucide-react';

export interface NavItem {
  to: string;
  labelKey: string;
  icon: LucideIcon;
  end?: boolean;
}

/** Top navigation entries: the unified home, templates, channels, log, settings. */
export const NAV_ITEMS: NavItem[] = [
  { to: '/', labelKey: 'nav.home', icon: ListChecks, end: true },
  { to: '/templates', labelKey: 'nav.templates', icon: LayoutTemplate },
  { to: '/template-sources', labelKey: 'nav.templateSources', icon: GitBranch },
  { to: '/channels', labelKey: 'nav.channels', icon: Send },
  { to: '/notifications', labelKey: 'nav.notifications', icon: BellRing },
  { to: '/settings', labelKey: 'nav.settings', icon: Settings },
];

/**
 * Routes that own a champagne action themselves (full-page forms, editors and
 * detail pages with inline editing). The nav create action hides there so a
 * screen never shows two primary accents at once.
 */
export function isEditorRoute(pathname: string): boolean {
  if (pathname === '/subscriptions/new' || pathname === '/monitors/new') return true;
  if (pathname === '/settings') return true;
  if (pathname === '/templates/new') return true;
  if (pathname.endsWith('/edit')) return true;
  // /templates/:id is the template editor; /templates alone is the index.
  if (/^\/templates\/[^/]+$/.test(pathname)) return true;
  // Detail pages carry an inline edit mode with its own save action.
  if (/^\/(subscriptions|monitors)\/[^/]+$/.test(pathname)) return true;
  return false;
}

/** Resolve the contextual label for the current pathname. */
export function navLabelKey(pathname: string): string {
  if (pathname === '/') return 'nav.home';
  if (pathname === '/subscriptions/new') return 'subscriptions.newSubscription';
  if (pathname.startsWith('/subscriptions')) return 'nav.subscriptions';
  if (pathname === '/monitors/new') return 'monitors.newMonitor';
  if (pathname.endsWith('/edit')) return 'monitors.editMonitor';
  if (pathname.startsWith('/monitors')) return 'nav.monitors';
  if (pathname.startsWith('/template-sources')) return 'nav.templateSources';
  if (pathname === '/templates/new') return 'templates.newTemplate';
  if (pathname === '/templates') return 'nav.templates';
  if (pathname.startsWith('/templates')) return 'templates.editTemplate';
  if (pathname.startsWith('/channels')) return 'nav.channels';
  if (pathname.startsWith('/notifications')) return 'nav.notifications';
  if (pathname.startsWith('/settings')) return 'nav.settings';
  return 'nav.home';
}
