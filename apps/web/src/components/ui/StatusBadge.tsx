import { useTranslation } from 'react-i18next';
import { statusTone } from '../../lib/utils';
import { Badge } from './primitives';

/** Localized status pill for monitors, subscriptions and notifications. */
export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const { t } = useTranslation();
  return (
    <Badge tone={statusTone(status)} dot className={className}>
      {t(`status.${status}`)}
    </Badge>
  );
}
