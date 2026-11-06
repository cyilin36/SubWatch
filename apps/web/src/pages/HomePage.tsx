import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  ChevronRight,
  CreditCard,
  ExternalLink,
  Plus,
  Search,
} from 'lucide-react';
import type { MonitorDto, SubscriptionDto } from '@subwatch/shared';
import { api } from '../lib/api';
import { monitorEffectiveStatus } from '../lib/monitors';
import { useAuth } from '../providers/AuthProvider';
import { formatMetricValue, formatRelativeTime, statusTone, type Tone } from '../lib/utils';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Input,
  Skeleton,
  StatusBadge,
  toneStyle,
} from '../components/ui';
import { Segmented } from '../components/common/fields';
import { RenewDialog, type RenewTarget } from '../components/subscriptions/RenewDialog';

type Filter = 'all' | 'subscriptions' | 'monitors';

interface UnifiedRow {
  key: string;
  kind: 'subscription' | 'monitor';
  id: string;
  name: string;
  href: string;
  status: string;
  /** Lower rank = more urgent. */
  rank: number;
  /** Secondary sort: days left for subscriptions, 0 otherwise. */
  sortValue: number;
  searchText: string;
  subscription?: SubscriptionDto;
  monitor?: MonitorDto;
}

function subscriptionRank(subscription: SubscriptionDto): number {
  if (subscription.status === 'expired') return 0;
  if (subscription.status === 'expiring') return 1;
  if (subscription.status === 'paused') return 3;
  return 2;
}

function monitorRank(status: string): number {
  if (status === 'critical' || status === 'down') return 0;
  if (status === 'warning') return 1;
  if (status === 'paused') return 3;
  return 2;
}

function StatCell({ label, value, tone }: { label: string; value: number; tone?: Tone }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5 px-3 py-2 sm:px-4">
      <p className="text-[11px] font-medium leading-tight text-[var(--muted-foreground)]">{label}</p>
      <p
        className="text-lg font-semibold leading-tight tabular-nums"
        style={tone ? { color: toneStyle(tone).color } : undefined}
      >
        {value}
      </p>
    </div>
  );
}

function DueText({ subscription }: { subscription: SubscriptionDto }) {
  const { t } = useTranslation();
  if (subscription.paused || subscription.status === 'paused') {
    return <span className="text-[var(--muted-foreground)]">{t('subscriptions.statusPaused')}</span>;
  }
  const daysLeft = subscription.daysLeft;
  if (daysLeft < 0) {
    return (
      <span className="text-[var(--danger)]">
        {t('subscriptions.daysOverdue', { count: Math.abs(daysLeft) })}
      </span>
    );
  }
  if (daysLeft === 0) {
    return <span className="text-[var(--warning)]">{t('subscriptions.dueToday')}</span>;
  }
  return (
    <span className={daysLeft <= 7 ? 'text-[var(--warning)]' : undefined}>
      {t('subscriptions.daysUntil', { count: daysLeft })}
    </span>
  );
}

function MonitorMeta({ monitor }: { monitor: MonitorDto }) {
  const { t } = useTranslation();
  const { timezone, locale } = useAuth();
  const metrics = Object.entries(monitor.lastMetrics).slice(0, 2);
  return (
    <>
      {metrics.map(([key, metric]) => (
        <span
          key={key}
          className="inline-flex max-w-[10rem] items-center gap-1 rounded-md bg-[var(--surface-muted)] px-1.5 py-0.5"
        >
          <span className="truncate text-[var(--muted-foreground)]">{metric.label || key}</span>
          <span className="font-medium">{formatMetricValue(metric)}</span>
        </span>
      ))}
      <span className="text-[var(--muted-foreground)]">
        {t('home.lastChecked')}:{' '}
        {monitor.lastCheckedAt
          ? formatRelativeTime(monitor.lastCheckedAt, timezone, locale)
          : t('common.never')}
      </span>
    </>
  );
}

function HomeRow({ row, onRenew }: { row: UnifiedRow; onRenew: (target: RenewTarget) => void }) {
  const { t } = useTranslation();
  const subscription = row.subscription;
  return (
    <li className="flex items-center gap-2 px-3 py-2.5 transition-colors hover:bg-[var(--surface-muted)]">
      <span
        className="h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: toneStyle(statusTone(row.status)).color }}
        aria-hidden
      />
      <Link to={row.href} className="min-w-0 flex-1">
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
          <span className="truncate text-sm font-medium">{row.name}</span>
          <StatusBadge status={row.status} />
          <Badge
            tone={row.kind === 'subscription' ? 'info' : 'muted'}
            className="hidden sm:inline-flex"
          >
            {row.kind === 'subscription' ? t('home.typeSubscription') : t('home.typeMonitor')}
          </Badge>
        </span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          {subscription ? (
            <>
              <span className="text-[var(--muted-foreground)]">{subscription.expiryDate}</span>
              <DueText subscription={subscription} />
            </>
          ) : row.monitor ? (
            <MonitorMeta monitor={row.monitor} />
          ) : null}
        </span>
      </Link>

      {subscription?.url ? (
        <a
          href={subscription.url}
          target="_blank"
          rel="noopener noreferrer"
          title={subscription.url}
          aria-label={t('home.openLink')}
          className="shrink-0 rounded-md p-1.5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--border)] hover:text-[var(--brand)]"
        >
          <ExternalLink className="h-4 w-4" aria-hidden />
        </a>
      ) : null}

      {subscription ? (
        <Button
          variant="outline"
          size="sm"
          className="shrink-0"
          onClick={() =>
            onRenew({
              id: subscription.id,
              name: subscription.name,
              expiryDate: subscription.expiryDate,
              cycle: subscription.cycle,
            })
          }
        >
          {t('subscriptions.renew')}
        </Button>
      ) : null}

      <Link
        to={row.href}
        aria-label={t('home.open')}
        className="shrink-0 rounded-md p-1.5 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--border)] hover:text-[var(--brand)]"
      >
        <ChevronRight className="h-4 w-4" aria-hidden />
      </Link>
    </li>
  );
}

/**
 * The single landing page of the app: a compact three-number stats strip and one
 * unified, urgency-sorted list of reminder subscriptions plus custom monitors.
 * No dashboard cards, no charts.
 */
export function HomePage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [renewTarget, setRenewTarget] = useState<RenewTarget | null>(null);

  const subscriptionsQuery = useQuery({
    queryKey: ['subscriptions'],
    queryFn: () => api.subscriptions.list(),
    refetchInterval: 15_000,
  });
  const monitorsQuery = useQuery({
    queryKey: ['monitors'],
    queryFn: () => api.monitors.list(),
    refetchInterval: 10_000,
  });

  const subscriptions = subscriptionsQuery.data ?? [];
  const monitors = monitorsQuery.data ?? [];
  const isLoading = subscriptionsQuery.isPending || monitorsQuery.isPending;
  const isError = subscriptionsQuery.isError || monitorsQuery.isError;

  const rows = useMemo<UnifiedRow[]>(() => {
    const subscriptionRows: UnifiedRow[] = subscriptions.map((subscription) => ({
      key: `subscription:${subscription.id}`,
      kind: 'subscription',
      id: subscription.id,
      name: subscription.name,
      href: `/subscriptions/${subscription.id}`,
      status: subscription.status,
      rank: subscriptionRank(subscription),
      sortValue: subscription.daysLeft,
      searchText: `${subscription.name} ${subscription.url ?? ''} ${subscription.notes}`.toLowerCase(),
      subscription,
    }));
    const monitorRows: UnifiedRow[] = monitors.map((monitor) => {
      const status = monitorEffectiveStatus(monitor);
      return {
        key: `monitor:${monitor.id}`,
        kind: 'monitor',
        id: monitor.id,
        name: monitor.name,
        href: `/monitors/${monitor.id}`,
        status,
        rank: monitorRank(status),
        sortValue: 0,
        searchText: `${monitor.name} ${monitor.description} ${monitor.tags.join(' ')}`.toLowerCase(),
        monitor,
      };
    });
    return [...subscriptionRows, ...monitorRows].sort(
      (a, b) => a.rank - b.rank || a.sortValue - b.sortValue || a.name.localeCompare(b.name),
    );
  }, [subscriptions, monitors]);

  const keyword = search.trim().toLowerCase();
  const visibleRows = rows.filter((row) => {
    if (filter === 'subscriptions' && row.kind !== 'subscription') return false;
    if (filter === 'monitors' && row.kind !== 'monitor') return false;
    if (keyword && !row.searchText.includes(keyword)) return false;
    return true;
  });

  const monitorStatuses = monitors.map((monitor) => monitorEffectiveStatus(monitor));
  const total = subscriptions.length + monitors.length;
  const attention =
    subscriptions.filter((subscription) => subscription.status === 'expiring').length +
    monitorStatuses.filter((status) => status === 'warning').length;
  const alarming =
    subscriptions.filter((subscription) => subscription.status === 'expired').length +
    monitorStatuses.filter((status) => status === 'critical' || status === 'down').length;

  if (isLoading) {
    return (
      <div>
        <Skeleton className="mb-3 h-[62px] rounded-xl" />
        <Skeleton className="mb-3 h-9 w-full max-w-md rounded-lg" />
        <Card className="p-4">
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-11" />
            ))}
          </div>
        </Card>
      </div>
    );
  }

  if (isError) {
    return (
      <div>
        <ErrorState
          error={subscriptionsQuery.error ?? monitorsQuery.error}
          onRetry={() => {
            void subscriptionsQuery.refetch();
            void monitorsQuery.refetch();
          }}
        />
      </div>
    );
  }

  return (
    <div>
      <Card className="mb-3 overflow-hidden">
        <div className="grid grid-cols-3 divide-x divide-[var(--border)]">
          <StatCell label={t('home.stats.total')} value={total} />
          <StatCell label={t('home.stats.attention')} value={attention} tone="warning" />
          <StatCell label={t('home.stats.critical')} value={alarming} tone="danger" />
        </div>
      </Card>

      <div className="mb-3 flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-1 flex-wrap items-center gap-2">
          <div className="relative w-full max-w-xs">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--muted-foreground)]"
              aria-hidden
            />
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('home.searchPlaceholder')}
              className="pl-8"
              aria-label={t('common.search')}
            />
          </div>
          <Segmented
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: t('home.filterAll') },
              { value: 'subscriptions', label: t('home.filterSubscriptions') },
              { value: 'monitors', label: t('home.filterMonitors') },
            ]}
          />
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => navigate('/monitors/new')}>
            <Activity className="h-4 w-4" aria-hidden />
            {t('home.newMonitor')}
          </Button>
          <Button size="sm" onClick={() => navigate('/subscriptions/new')}>
            <Plus className="h-4 w-4" aria-hidden />
            {t('home.newSubscription')}
          </Button>
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={<CreditCard className="h-8 w-8" aria-hidden />}
          title={t('home.emptyTitle')}
          description={t('home.emptyDescription')}
          action={
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button size="sm" onClick={() => navigate('/subscriptions/new')}>
                <Plus className="h-4 w-4" aria-hidden />
                {t('home.newSubscription')}
              </Button>
              <Button variant="outline" size="sm" onClick={() => navigate('/monitors/new')}>
                <Activity className="h-4 w-4" aria-hidden />
                {t('home.newMonitor')}
              </Button>
            </div>
          }
        />
      ) : visibleRows.length === 0 ? (
        <EmptyState
          icon={<Search className="h-8 w-8" aria-hidden />}
          title={t('home.emptyFilterTitle')}
          description={t('home.emptyFilterDescription')}
        />
      ) : (
        <Card className="overflow-hidden">
          <ul className="divide-y divide-[var(--border)]">
            {visibleRows.map((row) => (
              <HomeRow key={row.key} row={row} onRenew={setRenewTarget} />
            ))}
          </ul>
        </Card>
      )}

      <RenewDialog
        open={Boolean(renewTarget)}
        onOpenChange={(open) => {
          if (!open) setRenewTarget(null);
        }}
        target={renewTarget}
      />
    </div>
  );
}
