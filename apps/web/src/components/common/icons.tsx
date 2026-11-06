import { Mail, Webhook } from 'lucide-react';
import { cn } from '../../lib/utils';

/** Icon for a notification channel type. */
export function ChannelIcon({ type, className }: { type: string; className?: string }) {
  if (type === 'webhook') return <Webhook className={cn('h-5 w-5', className)} />;
  return <Mail className={cn('h-5 w-5', className)} />;
}
