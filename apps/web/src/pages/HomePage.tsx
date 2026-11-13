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
import { formatExpiry, type MonitorDto, type SubscriptionDto } from '@subwatch/shared';
import { api } from '../lib/api';
import { monitorEffectiveStatus } from '../lib/monitors';
import { useAuth } from '../providers/AuthProvider';
import { cn, formatMetricValue, formatRelativeTime } from '../lib/utils';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Input,
  PageHeader,
  Skeleton,
  StatTile,
  StatusBadge,
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

/** Thin moon-steel dot between two pieces of secondary information. */
function MetaDot() {
  return (
    <span className="text-moon-steel/60" aria-hidden>
      ·
    </span>
  );
}

/** Countdown copy for a reminder; colour is the only emphasis it gets. */
function DueText({ subscription }: { subscription: SubscriptionDto }) {
  const { t } = useTranslation();
  if (subscription.paused || subscription.status === 'paused') {
    return <span className="text-moon-steel">{t('subscriptions.statusPaused')}</span>;
  }
  const daysLeft = subscription.daysLeft;
  if (daysLeft < 0) {
    return (
      <span className="text-danger">
        {t('subscriptions.daysOverdue', { count: Math.abs(daysLeft) })}
      </span>
    );
  }
  if (subscription.status === 'expired') {
    return <span className="text-danger">{t('subscriptions.dueTodayExpired')}</span>;
  }
  if (daysLeft === 0) {
    return <span className="text-warning">{t('subscriptions.dueToday')}</span>;
  }
  return (
    <span className={daysLeft <= 7 ? 'text-warning' : 'text-moonlight'}>
      {t('subscriptions.daysUntil', { count: daysLeft })}
    </span>
  );
}

function SubscriptionMeta({ subscription }: { subscription: SubscriptionDto }) {
  const { t } = useTranslation();
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      <span className="text-moonlight">
        {formatExpiry(subscription.expiryDate, subscription.expiryTime)}
      </span>
      <MetaDot />
      <DueText subscription={subscription} />
      <MetaDot />
      <span className="text-moon-steel">{t(`cycle.${subscription.cycle}`)}</span>
    </span>
  );
}

function MonitorMeta({ monitor }: { monitor: MonitorDto }) {
  const { t } = useTranslation();
  const { timezone, locale } = useAuth();
  const metrics = Object.entries(monitor.lastMetrics).slice(0, 2);
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
      {metrics.map(([key, metric]) => (
        <span
          key={key}
          className="inline-flex max-w-[10rem] items-center gap-1 rounded-pill border border-white/10 bg-white/5 px-2.5 py-0.5"
        >
          <span className="truncate text-moon-steel">{metric.label || key}</span>
          <span className="font-medium text-white/90">{formatMetricValue(metric)}</span>
        </span>
      ))}
      {metrics.length > 0 ? <MetaDot /> : null}
      <span className="text-moon-steel">
        {t('home.lastChecked')}
        <span className="text-moonlight">
          {': '}
          {monitor.lastCheckedAt
            ? formatRelativeTime(monitor.lastCheckedAt, timezone, locale)
            : t('common.never')}
        </span>
      </span>
    </span>
  );
}

/**
 * One unified list row: name + status badge on the first line, secondary
 * information on the second, actions pinned to the trailing edge.
 */
function HomeRow({ row, onRenew }: { row: UnifiedRow; onRenew: (target: RenewTarget) => void }) {
  const { t } = useTranslation();
  const subscription = row.subscription;
  const monitor = row.monitor;

  return (
    <li className="group flex items-center gap-2 px-3 py-3.5 transition-colors duration-500 ease-glass hover:bg-white/5 sm:gap-3 sm:px-5 sm:py-4">
      <Link
        to={row.href}
        className="min-w-0 flex-1 rounded-[16px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 focus-visible:ring-offset-2 focus-visible:ring-offset-night"
      >
        <span className="flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1">
          <span className="truncate text-[15px] font-medium text-white">{row.name}</span>
          <StatusBadge status={row.status} />
          <Badge
            tone={row.kind === 'subscription' ? 'info' : 'muted'}
            className="hidden sm:inline-flex"
          >
            {row.kind === 'subscription' ? t('home.typeSubscription') : t('home.typeMonitor')}
          </Badge>
        </span>
        <span className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs">
          {subscription ? <SubscriptionMeta subscription={subscription} /> : null}
          {monitor ? <MonitorMeta monitor={monitor} /> : null}
        </span>
      </Link>

      <div className="flex shrink-0 items-center gap-1">
        {subscription?.url ? (
          <a
            href={subscription.url}
            target="_blank"
            rel="noopener noreferrer"
            title={subscription.url}
            aria-label={t('home.openLink')}
            className="rounded-full p-2 text-moon-steel transition-colors duration-500 ease-glass hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
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
                expiryTime: subscription.expiryTime,
                cycle: subscription.cycle,
              })
            }
          >
            {t('subscriptions.renew')}
          </Button>
        ) : null}

        <ChevronRight className="hidden h-4 w-4 text-moon-steel sm:block" aria-hidden />
      </div>
    </li>
  );
}

/** Layout-matched loading state: the header stays, the data areas shimmer. */
function HomeSkeleton() {
  const { t } = useTranslation();
  return (
    <div className="space-y-8" aria-busy="true">
      <span className="sr-only">{t('common.loading')}</span>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4">
        {[0, 1, 2].map((index) => (
          <div
            key={index}
            className={cn('glass p-5 sm:p-6', index === 0 && 'col-span-2 sm:col-span-1')}
          >
            <Skeleton className="h-3 w-24" />
            <Skeleton className="mt-4 h-10 w-16" />
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <Skeleton className="h-11 w-full sm:max-w-xs" />
        <Skeleton className="h-11 w-64" />
      </div>

      <Card className="overflow-hidden">
        <ul className="divide-y divide-white/10">
          {Array.from({ length: 5 }).map((_, index) => (
            <li key={index} className="flex items-center gap-3 px-4 py-4 sm:px-5">
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-3.5 w-2/5" />
                <Skeleton className="h-3 w-3/5" />
              </div>
              <Skeleton className="h-8 w-16" />
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

/**
 * The single landing page of the app: a three-number stats strip and one
 * unified, urgency-sorted list of reminder subscriptions plus custom monitors.
 * Page actions stay secondary — the night nav already carries the champagne CTA.
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

  return (
    <div className="space-y-8">
      <PageHeader
        label={t('home.eyebrow')}
        title={t('home.title')}
        description={t('app.tagline')}
        actions={
          <>
            <Button variant="secondary" onClick={() => navigate('/monitors/new')}>
              <Activity className="h-4 w-4" aria-hidden />
              {t('home.newMonitor')}
            </Button>
            <Button variant="secondary" onClick={() => navigate('/subscriptions/new')}>
              <Plus className="h-4 w-4" aria-hidden />
              {t('home.newSubscription')}
            </Button>
          </>
        }
      />

      {isLoading ? <HomeSkeleton /> : null}

      {!isLoading && isError ? (
        <ErrorState
          error={subscriptionsQuery.error ?? monitorsQuery.error}
          onRetry={() => {
            void subscriptionsQuery.refetch();
            void monitorsQuery.refetch();
          }}
        />
      ) : null}

      {!isLoading && !isError ? (
        <>
          <section
            aria-label={t('home.eyebrow')}
            className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4"
          >
            {/* The only champagne number on the page. */}
            <StatTile
              className="col-span-2 p-5 sm:col-span-1 sm:p-6"
              label={t('home.stats.total')}
              value={total}
              accent
            />
            <StatTile
              className="p-5 sm:p-6"
              label={t('home.stats.attention')}
              value={attention}
              tone="warning"
            />
            <StatTile
              className="p-5 sm:p-6"
              label={t('home.stats.critical')}
              value={alarming}
              tone="danger"
            />
          </section>

          <section className="space-y-4" aria-label={t('home.title')}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="relative w-full sm:max-w-xs">
                <Search
                  className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-moon-steel"
                  aria-hidden
                />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder={t('home.searchPlaceholder')}
                  className="pl-10"
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
              <p
                className="text-xs tracking-[0.08em] text-moon-steel tabular-nums sm:ml-auto"
                role="status"
              >
                {t('common.total', { total: visibleRows.length })}
              </p>
            </div>

            {rows.length === 0 ? (
              <EmptyState
                icon={<CreditCard className="h-8 w-8" aria-hidden />}
                title={t('home.emptyTitle')}
                description={t('home.emptyDescription')}
                action={
                  <div className="flex flex-wrap items-center justify-center gap-2">
                    <Button variant="secondary" onClick={() => navigate('/subscriptions/new')}>
                      <Plus className="h-4 w-4" aria-hidden />
                      {t('home.newSubscription')}
                    </Button>
                    <Button variant="secondary" onClick={() => navigate('/monitors/new')}>
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
                <ul className="divide-y divide-white/10">
                  {visibleRows.map((row) => (
                    <HomeRow key={row.key} row={row} onRenew={setRenewTarget} />
                  ))}
                </ul>
              </Card>
            )}
          </section>
        </>
      ) : null}

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
