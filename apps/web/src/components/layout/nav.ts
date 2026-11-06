import type { LucideIcon } from 'lucide-react';
import { BellRing, ListChecks, Send, Settings } from 'lucide-react';

export interface NavItem {
  to: string;
  labelKey: string;
  icon: LucideIcon;
  end?: boolean;
}

/** Four sidebar entries: the unified home, channels, notification log, settings. */
export const NAV_ITEMS: NavItem[] = [
  { to: '/', labelKey: 'nav.home', icon: ListChecks, end: true },
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
  if (pathname.startsWith('/channels')) return 'nav.channels';
  if (pathname.startsWith('/notifications')) return 'nav.notifications';
  if (pathname.startsWith('/settings')) return 'nav.settings';
  return 'nav.home';
}
