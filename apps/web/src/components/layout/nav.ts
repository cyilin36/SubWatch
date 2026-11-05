import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  BellRing,
  CreditCard,
  LayoutDashboard,
  LayoutTemplate,
  Send,
  Settings,
} from 'lucide-react';

export interface NavItem {
  to: string;
  labelKey: string;
  icon: LucideIcon;
  end?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/', labelKey: 'nav.dashboard', icon: LayoutDashboard, end: true },
  { to: '/monitors', labelKey: 'nav.monitors', icon: Activity },
  { to: '/subscriptions', labelKey: 'nav.subscriptions', icon: CreditCard },
  { to: '/templates', labelKey: 'nav.templates', icon: LayoutTemplate },
  { to: '/channels', labelKey: 'nav.channels', icon: Send },
  { to: '/notifications', labelKey: 'nav.notifications', icon: BellRing },
  { to: '/settings', labelKey: 'nav.settings', icon: Settings },
];

/** Resolve the nav label for the current pathname (used by the topbar). */
export function navLabelKey(pathname: string): string {
  if (pathname === '/') return 'nav.dashboard';
  const match = NAV_ITEMS.find((item) => item.to !== '/' && pathname.startsWith(item.to));
  return match?.labelKey ?? 'nav.dashboard';
}
