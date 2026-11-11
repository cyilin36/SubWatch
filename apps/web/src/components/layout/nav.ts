import type { LucideIcon } from 'lucide-react';
import { BellRing, LayoutTemplate, ListChecks, Send, Settings } from 'lucide-react';

export interface NavItem {
  to: string;
  labelKey: string;
  icon: LucideIcon;
  end?: boolean;
}

/** Sidebar entries: the unified home, templates, channels, notification log, settings. */
export const NAV_ITEMS: NavItem[] = [
  { to: '/', labelKey: 'nav.home', icon: ListChecks, end: true },
  { to: '/templates', labelKey: 'nav.templates', icon: LayoutTemplate },
  { to: '/channels', labelKey: 'nav.channels', icon: Send },
  { to: '/notifications', labelKey: 'nav.notifications', icon: BellRing },
  { to: '/settings', labelKey: 'nav.settings', icon: Settings },
];

/** Resolve the topbar label for the current pathname. */
export function navLabelKey(pathname: string): string {
  if (pathname === '/') return 'nav.home';
  if (pathname === '/subscriptions/new') return 'subscriptions.newSubscription';
  if (pathname.startsWith('/subscriptions')) return 'nav.subscriptions';
  if (pathname === '/monitors/new') return 'monitors.newMonitor';
  if (pathname.endsWith('/edit')) return 'monitors.editMonitor';
  if (pathname.startsWith('/monitors')) return 'nav.monitors';
  if (pathname === '/templates/new') return 'templates.newTemplate';
  if (pathname === '/templates') return 'nav.templates';
  if (pathname.startsWith('/templates')) return 'templates.editTemplate';
  if (pathname.startsWith('/channels')) return 'nav.channels';
  if (pathname.startsWith('/notifications')) return 'nav.notifications';
  if (pathname.startsWith('/settings')) return 'nav.settings';
  return 'nav.home';
}
