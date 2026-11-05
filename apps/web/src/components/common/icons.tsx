import {
  BookOpen,
  Cloud,
  Film,
  Gamepad2,
  Globe,
  Mail,
  MessageCircle,
  Music,
  Package,
  Rocket,
  Server,
  ShoppingBag,
  Sparkles,
  Tv,
  Webhook,
  Wifi,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '../../lib/utils';

const TEMPLATE_ICONS: Record<string, LucideIcon> = {
  server: Server,
  vps: Server,
  cpu: Server,
  globe: Globe,
  domain: Globe,
  cloud: Cloud,
  chat: MessageCircle,
  message: MessageCircle,
  chatgpt: Sparkles,
  openai: Sparkles,
  sparkles: Sparkles,
  claude: Sparkles,
  film: Film,
  movie: Film,
  netflix: Tv,
  tv: Tv,
  music: Music,
  spotify: Music,
  package: Package,
  box: Package,
  icloud: Cloud,
  shop: ShoppingBag,
  book: BookOpen,
  game: Gamepad2,
  wifi: Wifi,
  rocket: Rocket,
};

const HEX_COLOR_RE = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

export function safeColor(color: string | null | undefined, fallback = 'var(--brand)'): string {
  if (color && HEX_COLOR_RE.test(color.trim())) return color.trim();
  return fallback;
}

const EMOJI_RE = /[\p{Extended_Pictographic}]/u;

/** Render a template icon: emoji when supplied, otherwise a known lucide icon. */
export function TemplateIcon({
  icon,
  color,
  className,
}: {
  icon?: string | null;
  color?: string | null;
  className?: string;
}) {
  const value = (icon ?? '').trim();
  if (value && EMOJI_RE.test(value)) {
    return (
      <span className={cn('text-xl leading-none', className)} style={{ color: safeColor(color) }}>
        {value}
      </span>
    );
  }
  const Icon = TEMPLATE_ICONS[value.toLowerCase()] ?? Package;
  return <Icon className={cn('h-5 w-5', className)} style={{ color: safeColor(color) }} />;
}

export function ChannelIcon({ type, className }: { type: string; className?: string }) {
  if (type === 'webhook') return <Webhook className={cn('h-5 w-5', className)} />;
  return <Mail className={cn('h-5 w-5', className)} />;
}
