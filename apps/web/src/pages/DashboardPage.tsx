import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BellRing,
  CreditCard,
  Plus,
  TrendingUp,
} from 'lucide-react';
import type { MonitorStatus } from '@subwatch/shared';
import { api } from '../lib/api';
import { useAuth } from '../providers/AuthProvider';
import {
  formatDateTime,
  formatMetricValue,
  formatMoney,
  formatRelativeTime,
  statusTone,
  type Tone,
} from '../lib/utils';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
  StatusBadge,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
  toneStyle,
} from '../components/ui';
import { RenewDialog, type RenewTarget } from '../components/subscriptions/RenewDialog';

function StatCard({
  label,
  value,
  tone,
  icon,
}: {
  label: string;
  value: ReactNode;
  tone?: Tone;
  icon?: ReactNode;
}) {
  return (
    <Card className="p-3.5">
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-xs font-medium text-[var(--muted-foreground)]">{label}</p>
        {icon ? (
          <span style={tone ? { color: toneStyle(tone).color } : { color: 'var(--muted-foreground)' }}>
            {icon}
          </span>
        ) : null}
      </div>
      <p
        className="mt-1 text-2xl font-semibold tabular-nums"
        style={tone ? { color: toneStyle(tone).color } : undefined}
      >
        {value}
      </p>
    </Card>
  );
}

function MetricChips({ metrics }: { metrics: Record<string, { value: number | string | boolean; label?: string; unit?: string }> }) {
  const entries = Object.entries(metrics).slice(0, 3);
  if (entries.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {entries.map(([key, metric]) => (
        <span
          key={key}
          className="inline-flex max-w-full items-center gap-1 rounded-md bg-[var(--surface-muted)] px-2 py-0.5 text-xs"
        >
          <span className="truncate text-[var(--muted-foreground)]">{metric.label || key}</span>
          <span className="font-medium">{formatMetricValue(metric)}</span>
        </span>
      ))}
    </div>
  );
}

export function DashboardPage() {
  const { t } = useTranslation();
  const { timezone, locale } = useAuth();
  const navigate = useNavigate();
  const [renewTarget, setRenewTarget] = useState<RenewTarget | null>(null);

  const dashboardQuery = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.dashboard.get(),
    refetchInterval: 5000,
    staleTime: 4000,
  });

  const data = dashboardQuery.data;

  if (dashboardQuery.isPending) {
    return (
      <div>
        <PageHeader title={t('dashboard.title')} description={t('dashboard.subtitle')} />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-[74px]" />
          ))}
        </div>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {Array.from({ length: 5 }).map((_, index) => (
            <Skeleton key={index} className="h-[74px]" />
          ))}
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <Skeleton className="h-56" />
          <Skeleton className="h-56" />
        </div>
      </div>
    );
  }

  if (dashboardQuery.isError || !data) {
    return (
      <div>
        <PageHeader title={t('dashboard.title')} description={t('dashboard.subtitle')} />
        <ErrorState error={dashboardQuery.error} onRetry={() => void dashboardQuery.refetch()} />
      </div>
    );
  }

  const monitorCounts: { status: MonitorStatus; value: number; tone: Tone; labelKey: string }[] = [
    { status: 'up', value: data.monitors.up, tone: 'success', labelKey: 'dashboard.up' },
    { status: 'warning', value: data.monitors.warning, tone: 'warning', labelKey: 'dashboard.warning' },
    { status: 'critical', value: data.monitors.critical, tone: 'danger', labelKey: 'dashboard.critical' },
    { status: 'down', value: data.monitors.down, tone: 'danger', labelKey: 'dashboard.down' },
    { status: 'unknown', value: data.monitors.unknown, tone: 'muted', labelKey: 'dashboard.unknown' },
    { status: 'paused', value: data.monitors.paused, tone: 'info', labelKey: 'dashboard.paused' },
  ];

  return (
    <div>
      <PageHeader
        title={t('dashboard.title')}
        description={t('dashboard.subtitle')}
        icon={<TrendingUp className="h-5 w-5" />}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => navigate('/monitors/new')}>
              <Plus className="h-4 w-4" aria-hidden />
              {t('dashboard.newMonitor')}
            </Button>
            <Button size="sm" onClick={() => navigate('/subscriptions/new')}>
              <CreditCard className="h-4 w-4" aria-hidden />
              {t('dashboard.newSubscription')}
            </Button>
          </>
        }
      />

      {/* Monitor status counters */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-7">
        <StatCard
          label={t('dashboard.monitorsTotal')}
          value={data.monitors.total}
          icon={<Activity className="h-4 w-4" aria-hidden />}
        />
        {monitorCounts.map((item) => (
          <StatCard key={item.status} label={t(item.labelKey)} value={item.value} tone={item.tone} />
        ))}
      </div>

      {/* Subscription counters + cost */}
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard
          label={t('dashboard.subscriptionsTotal')}
          value={data.subscriptions.total}
          icon={<CreditCard className="h-4 w-4" aria-hidden />}
        />
        <StatCard
          label={t('dashboard.activeSubscriptions')}
          value={data.subscriptions.active}
          tone="success"
        />
        <StatCard label={t('dashboard.expiring')} value={data.subscriptions.expiring} tone="warning" />
        <StatCard label={t('dashboard.expired')} value={data.subscriptions.expired} tone="danger" />
        <StatCard
          label={t('dashboard.monthlyCost')}
          value={formatMoney(data.subscriptions.monthlyCostCents, data.subscriptions.currency, locale)}
          tone="info"
        />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {/* Active alerts */}
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-[var(--warning)]" aria-hidden />
              {t('dashboard.currentAlerts')}
            </CardTitle>
            <Button variant="ghost" size="sm" onClick={() => navigate('/monitors')}>
              {t('dashboard.viewMonitors')}
              <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </Button>
          </CardHeader>
          <CardContent>
            {data.alerts.length === 0 ? (
              <EmptyState
                className="border-none py-8"
                title={t('dashboard.noAlerts')}
                icon={<Activity className="h-7 w-7" aria-hidden />}
              />
            ) : (
              <ul className="divide-y divide-[var(--border)]">
                {data.alerts.map((alert) => (
                  <li key={`${alert.monitorId}-${alert.metricKey ?? 'availability'}`} className="flex items-center gap-3 py-2.5">
                    <StatusBadge status={alert.severity} />
                    <div className="min-w-0 flex-1">
                      <Link
                        to={`/monitors/${alert.monitorId}`}
                        className="block truncate text-sm font-medium hover:text-[var(--brand)]"
                      >
                        {alert.monitorName}
                      </Link>
                      <p className="truncate text-xs text-[var(--muted-foreground)]">
                        {alert.metricLabel || alert.metricKey || t('monitors.statusLabel')}
                        {alert.value !== null ? ` · ${formatMetricValue(alert.value)}` : ''}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs text-[var(--muted-foreground)]">
                      {formatRelativeTime(alert.since, timezone, locale)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Expiring subscriptions */}
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <CreditCard className="h-4 w-4 text-[var(--warning)]" aria-hidden />
              {t('dashboard.expiring30')}
            </CardTitle>
            <Button variant="ghost" size="sm" onClick={() => navigate('/subscriptions')}>
              {t('dashboard.viewSubscriptions')}
              <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </Button>
          </CardHeader>
          <CardContent className="pt-0">
            {data.expiring.length === 0 ? (
              <EmptyState
                className="border-none py-8"
                title={t('dashboard.noExpiring')}
                icon={<CreditCard className="h-7 w-7" aria-hidden />}
              />
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>{t('subscriptions.name')}</TH>
                    <TH>{t('subscriptions.expiryDate')}</TH>
                    <TH className="text-right">{t('common.actions')}</TH>
                  </TR>
                </THead>
                <TBody>
                  {data.expiring.map((item) => (
                    <TR key={item.id}>
                      <TD>
                        <Link to={`/subscriptions/${item.id}`} className="font-medium hover:text-[var(--brand)]">
                          {item.name}
                        </Link>
                        <p className="text-xs text-[var(--muted-foreground)]">
                          {item.templateName ?? t('subscriptions.template')}
                        </p>
                      </TD>
                      <TD>
                        <p>{item.expiryDate}</p>
                        <p
                          className="text-xs"
                          style={{
                            color: item.daysLeft < 0 ? 'var(--danger)' : item.daysLeft <= 7 ? 'var(--warning)' : 'var(--muted-foreground)',
                          }}
                        >
                          {item.daysLeft < 0
                            ? t('subscriptions.daysOverdue', { count: Math.abs(item.daysLeft) })
                            : item.daysLeft === 0
                              ? t('subscriptions.dueToday')
                              : t('subscriptions.daysUntil', { count: item.daysLeft })}
                        </p>
                      </TD>
                      <TD className="text-right">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            setRenewTarget({
                              id: item.id,
                              name: item.name,
                              expiryDate: item.expiryDate,
                              amountCents: item.amountCents,
                              currency: item.currency,
                            })
                          }
                        >
                          {t('dashboard.renew')}
                        </Button>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        {/* Monitor cards */}
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>{t('dashboard.monitorCards')}</CardTitle>
            <Button variant="ghost" size="sm" onClick={() => navigate('/monitors')}>
              {t('common.viewAll')}
              <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </Button>
          </CardHeader>
          <CardContent>
            {data.monitorCards.length === 0 ? (
              <EmptyState
                className="border-none py-8"
                title={t('dashboard.noMonitors')}
                description={t('dashboard.noMonitorsHint')}
                icon={<Activity className="h-7 w-7" aria-hidden />}
                action={
                  <Button size="sm" onClick={() => navigate('/monitors/new')}>
                    <Plus className="h-4 w-4" aria-hidden />
                    {t('dashboard.newMonitor')}
                  </Button>
                }
              />
            ) : (
              <div className="grid gap-2.5 sm:grid-cols-2">
                {data.monitorCards.map((monitor) => (
                  <Link
                    key={monitor.id}
                    to={`/monitors/${monitor.id}`}
                    className="rounded-lg border border-[var(--border)] p-3 transition-colors hover:border-[var(--brand)] hover:bg-[var(--surface-muted)]"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className="truncate text-sm font-medium">{monitor.name}</span>
                      <StatusBadge status={monitor.status} />
                    </div>
                    <MetricChips metrics={monitor.metrics} />
                    <p className="mt-2 truncate text-xs text-[var(--muted-foreground)]">
                      {t('dashboard.lastChecked')}:{' '}
                      {monitor.lastCheckedAt
                        ? formatRelativeTime(monitor.lastCheckedAt, timezone, locale)
                        : t('dashboard.neverChecked')}
                    </p>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent notifications */}
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <BellRing className="h-4 w-4 text-[var(--info)]" aria-hidden />
              {t('dashboard.recentNotifications')}
            </CardTitle>
            <Button variant="ghost" size="sm" onClick={() => navigate('/notifications')}>
              {t('dashboard.viewNotifications')}
              <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </Button>
          </CardHeader>
          <CardContent>
            {data.recentNotifications.length === 0 ? (
              <EmptyState
                className="border-none py-8"
                title={t('dashboard.noNotifications')}
                icon={<BellRing className="h-7 w-7" aria-hidden />}
              />
            ) : (
              <ul className="divide-y divide-[var(--border)]">
                {data.recentNotifications.map((notification) => (
                  <li key={notification.id} className="flex items-center gap-3 py-2.5">
                    <StatusBadge status={notification.status} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{t(`event.${notification.eventType}`)}</p>
                      <p className="truncate text-xs text-[var(--muted-foreground)]">
                        {notification.channelName ?? t('notifications.noChannel')}
                        {notification.lastError ? ` · ${notification.lastError}` : ''}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs text-[var(--muted-foreground)]">
                      {formatRelativeTime(notification.createdAt, timezone, locale)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>

      <p className="mt-4 text-center text-xs text-[var(--muted-foreground)]">{t('dashboard.autoRefresh')}</p>

      <RenewDialog open={Boolean(renewTarget)} onOpenChange={(open) => !open && setRenewTarget(null)} target={renewTarget} />
    </div>
  );
}

export default DashboardPage;
