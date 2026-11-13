import { useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Activity,
  ArrowLeft,
  KeyRound,
  LayoutTemplate,
  Pencil,
  RefreshCcw,
  Trash2,
} from 'lucide-react';
import { api } from '../lib/api';
import { monitorEffectiveStatus, monitorInputFromDto } from '../lib/monitors';
import { normalizeMetricsResponse } from '../lib/metrics';
import { useAuth } from '../providers/AuthProvider';
import {
  errorMessage,
  formatDateTime,
  formatInterval,
  formatMetricValue,
  formatMs,
  formatRelativeTime,
} from '../lib/utils';
import {
  Alert,
  Badge,
  Button,
  Card,
  ConfirmDialog,
  CopyButton,
  EmptyState,
  ErrorState,
  FullPageSpinner,
  PageHeader,
  Skeleton,
  StatTile,
  StatusBadge,
  Switch,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '../components/ui';
import { MetricChart } from '../components/monitors/MetricChart';
import { PushTokenDialog } from '../components/monitors/PushTokenDialog';
import { Segmented } from '../components/common/fields';

const OPERATOR_SYMBOLS: Record<string, string> = {
  gt: '>',
  gte: '≥',
  lt: '<',
  lte: '≤',
  eq: '=',
  neq: '≠',
};

/** Small recessed well for code-like or long text values. */
function CodeWell({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`glass-flat min-w-0 overflow-x-auto px-4 py-3 font-mono text-xs leading-relaxed text-white/80 ${className ?? ''}`}
    >
      {children}
    </div>
  );
}

export function MonitorDetailPage() {
  const { t } = useTranslation();
  const { timezone, locale } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { id = '' } = useParams<{ id: string }>();

  const [range, setRange] = useState<'24h' | '7d' | '30d'>('24h');
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [rotateOpen, setRotateOpen] = useState(false);
  const [rotatedToken, setRotatedToken] = useState<string | null>(null);

  const monitorQuery = useQuery({
    queryKey: ['monitor', id],
    queryFn: () => api.monitors.get(id),
    enabled: Boolean(id),
    refetchInterval: 15_000,
  });

  const monitor = monitorQuery.data;

  const runsQuery = useQuery({
    queryKey: ['monitor-runs', id],
    queryFn: () => api.monitors.runs(id, 50),
    enabled: Boolean(id),
    refetchInterval: 15_000,
  });

  const metricsQuery = useQuery({
    queryKey: ['monitor-metrics', id, range],
    queryFn: () => api.monitors.metrics(id, range),
    enabled: Boolean(id),
    refetchInterval: 30_000,
  });

  const series = useMemo(
    () => (metricsQuery.data ? normalizeMetricsResponse(metricsQuery.data) : { points: [], keys: [] }),
    [metricsQuery.data],
  );

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['monitor', id] });
    void queryClient.invalidateQueries({ queryKey: ['monitor-runs', id] });
    void queryClient.invalidateQueries({ queryKey: ['monitor-metrics', id] });
    void queryClient.invalidateQueries({ queryKey: ['monitors'] });
  };

  const toggleMutation = useMutation({
    mutationFn: (enabled: boolean) =>
      api.monitors.update(id, { ...monitorInputFromDto(monitor!), enabled }),
    onSuccess: (_data, enabled) => {
      toast.success(enabled ? t('monitorDetail.enabledToast') : t('monitorDetail.disabledToast'));
      invalidate();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const rotateMutation = useMutation({
    mutationFn: () => api.monitors.rotatePushToken(id),
    onSuccess: (result) => {
      setRotateOpen(false);
      setRotatedToken(result.pushToken);
      toast.success(t('monitorDetail.rotateSuccess'));
      void queryClient.invalidateQueries({ queryKey: ['monitor', id] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.monitors.remove(id),
    onSuccess: () => {
      toast.success(t('monitorDetail.deleteSuccess'));
      void queryClient.invalidateQueries({ queryKey: ['monitors'] });
      navigate('/', { replace: true });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  if (monitorQuery.isPending) {
    return (
      <div className="space-y-8">
        <PageHeader title={t('nav.monitors')} />
        <FullPageSpinner label={t('common.loading')} />
      </div>
    );
  }

  if (monitorQuery.isError || !monitor) {
    return (
      <div className="space-y-8">
        <PageHeader title={t('nav.monitors')} />
        <ErrorState error={monitorQuery.error} onRetry={() => void monitorQuery.refetch()} />
      </div>
    );
  }

  const effectiveStatus = monitorEffectiveStatus(monitor);
  const metricEntries = Object.entries(monitor.lastMetrics);
  const runs = runsQuery.data?.items ?? [];
  const isPush = monitor.config.type === 'push';

  return (
    <div className="space-y-8">
      <PageHeader
        label={t('nav.monitors')}
        title={
          <span className="flex min-w-0 flex-wrap items-center gap-3">
            <span className="truncate">{monitor.name}</span>
            <StatusBadge status={effectiveStatus} />
          </span>
        }
        description={monitor.description || t('monitorDetail.descriptionEmpty')}
        icon={<Activity className="h-5 w-5" />}
        actions={
          <>
            <Button variant="ghost" size="sm" onClick={() => navigate('/')}>
              <ArrowLeft className="h-4 w-4" aria-hidden />
              {t('common.back')}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => navigate(`/monitors/${id}/edit`)}>
              <Pencil className="h-4 w-4" aria-hidden />
              {t('common.edit')}
            </Button>
            <Button variant="danger" size="sm" onClick={() => setDeleteOpen(true)}>
              <Trash2 className="h-4 w-4" aria-hidden />
              {t('common.delete')}
            </Button>
          </>
        }
      />

      {/* Key numbers: the current metrics when available, otherwise the config
          summary. Only the first tile is allowed to carry the champagne accent. */}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {metricEntries.length > 0 ? (
          metricEntries.slice(0, 4).map(([key, metric], index) => (
            <StatTile
              key={key}
              label={metric.label || key}
              value={<span className="block truncate">{formatMetricValue(metric)}</span>}
              hint={index === 0 ? t('monitorDetail.currentMetrics') : undefined}
              accent={index === 0}
            />
          ))
        ) : (
          <>
            <StatTile
              label={t('monitorDetail.interval')}
              value={formatInterval(monitor.intervalSeconds, locale)}
            />
            <StatTile
              label={t('monitorDetail.consecutiveFailures')}
              value={monitor.consecutiveFailures}
              tone={monitor.consecutiveFailures > 0 ? 'danger' : undefined}
            />
            <StatTile label={t('monitorDetail.rulesCountLabel')} value={monitor.rules.length} />
          </>
        )}
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_360px] xl:items-start">
        <div className="min-w-0 space-y-6">
          {/* Trend chart */}
          {metricsQuery.isError ? (
            <ErrorState error={metricsQuery.error} onRetry={() => void metricsQuery.refetch()} />
          ) : (
            <Card className="p-6 sm:p-8">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <h2 className="text-[18px] font-medium leading-snug text-white">
                  {t('monitorDetail.trend')}
                </h2>
                <Segmented
                  value={range}
                  onChange={setRange}
                  options={[
                    { value: '24h', label: t('monitorDetail.range24h') },
                    { value: '7d', label: t('monitorDetail.range7d') },
                    { value: '30d', label: t('monitorDetail.range30d') },
                  ]}
                />
              </div>
              {metricsQuery.isPending ? (
                <Skeleton className="mt-5 h-72" />
              ) : (
                <div className="glass-flat mt-5 rounded-btn p-4">
                  <MetricChart series={series} range={range} timezone={timezone} locale={locale} />
                </div>
              )}
            </Card>
          )}

          {/* Run history */}
          {runsQuery.isError ? (
            <ErrorState error={runsQuery.error} onRetry={() => void runsQuery.refetch()} />
          ) : runsQuery.isPending ? (
            <Card className="p-6 sm:p-8">
              <h2 className="text-[18px] font-medium leading-snug text-white">
                {t('monitorDetail.runHistory')}
              </h2>
              <Skeleton className="mt-5 h-40" />
            </Card>
          ) : runs.length === 0 ? (
            <EmptyState
              title={t('monitorDetail.noRuns')}
              action={
                <Button
                  variant="outline"
                  size="sm"
                  loading={runsQuery.isFetching}
                  onClick={() => void runsQuery.refetch()}
                >
                  {!runsQuery.isFetching ? <RefreshCcw className="h-3.5 w-3.5" aria-hidden /> : null}
                  {t('common.refresh')}
                </Button>
              }
            />
          ) : (
            <Card className="overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-3 p-6 sm:px-8">
                <h2 className="text-[18px] font-medium leading-snug text-white">
                  {t('monitorDetail.runHistory')}
                </h2>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  onClick={() => void runsQuery.refetch()}
                  aria-label={t('common.refresh')}
                  loading={runsQuery.isFetching}
                >
                  {!runsQuery.isFetching ? <RefreshCcw className="h-4 w-4" aria-hidden /> : null}
                </Button>
              </div>
              <Table>
                <THead>
                  <TR>
                    <TH>{t('monitorDetail.checkedAt')}</TH>
                    <TH>{t('common.status')}</TH>
                    <TH className="hidden sm:table-cell">{t('monitorDetail.httpStatusLabel')}</TH>
                    <TH className="hidden md:table-cell">{t('monitorDetail.durationLabel')}</TH>
                    <TH className="hidden lg:table-cell">{t('monitorDetail.triggerLabel')}</TH>
                    <TH>{t('notifications.lastError')}</TH>
                  </TR>
                </THead>
                <TBody>
                  {runs.map((run) => (
                    <TR key={run.id}>
                      <TD className="whitespace-nowrap text-xs">
                        {formatDateTime(run.startedAt, timezone, locale)}
                      </TD>
                      <TD>
                        <StatusBadge status={run.status} />
                      </TD>
                      <TD className="hidden sm:table-cell">{run.httpStatus ?? '—'}</TD>
                      <TD className="hidden md:table-cell">{formatMs(run.durationMs)}</TD>
                      <TD className="hidden text-xs text-moonlight lg:table-cell">
                        {t(`trigger.${run.trigger}`)}
                      </TD>
                      <TD className="max-w-[220px]">
                        <p
                          className="truncate text-xs text-danger"
                          title={run.error ?? undefined}
                        >
                          {run.error ?? '—'}
                        </p>
                      </TD>
                    </TR>
                  ))}
                </TBody>
              </Table>
            </Card>
          )}
        </div>

        <aside className="min-w-0 space-y-6">
          {/* Status and configuration */}
          <Card className="p-6">
            <div className="flex items-start justify-between gap-4">
              <h2 className="min-w-0 text-[18px] font-medium leading-snug text-white">
                {t('monitorDetail.statusLabel')}
              </h2>
              <div className="flex shrink-0 items-center gap-2">
                <span className="text-xs text-moonlight">{t('common.enabled')}</span>
                <Switch
                  checked={monitor.enabled}
                  onCheckedChange={(checked) => toggleMutation.mutate(checked)}
                  disabled={toggleMutation.isPending}
                  ariaLabel={t('common.enabled')}
                />
              </div>
            </div>

            <dl className="mt-5 grid grid-cols-2 gap-4">
              <div>
                <dt className="type-label">{t('monitorDetail.interval')}</dt>
                <dd className="mt-1.5 text-body font-medium text-white">
                  {formatInterval(monitor.intervalSeconds, locale)}
                </dd>
              </div>
              <div>
                <dt className="type-label">{t('monitorDetail.lastChecked')}</dt>
                <dd className="mt-1.5 text-body text-white">
                  {monitor.lastCheckedAt
                    ? formatRelativeTime(monitor.lastCheckedAt, timezone, locale)
                    : t('common.never')}
                </dd>
              </div>
              <div>
                <dt className="type-label">{t('monitorDetail.nextRun')}</dt>
                <dd className="mt-1.5 text-body text-white">
                  {monitor.nextRunAt ? formatDateTime(monitor.nextRunAt, timezone, locale) : '—'}
                </dd>
              </div>
              <div>
                <dt className="type-label">{t('monitorDetail.consecutiveFailures')}</dt>
                <dd className="mt-1.5 text-body font-medium text-white">
                  {monitor.consecutiveFailures}
                </dd>
              </div>
              <div>
                <dt className="type-label">{t('monitorDetail.rulesCountLabel')}</dt>
                <dd className="mt-1.5 text-body font-medium text-white">{monitor.rules.length}</dd>
              </div>
            </dl>

            {monitor.templateName ? (
              <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-white/10 pt-4 text-xs">
                <LayoutTemplate className="h-3.5 w-3.5 text-moonlight" aria-hidden />
                <span className="text-moonlight/80">{t('monitorDetail.templateSource')}</span>
                {monitor.templateId ? (
                  <Link
                    to={`/templates/${monitor.templateId}`}
                    className="rounded-btn font-medium text-moonlight underline-offset-4 transition-colors duration-500 ease-glass hover:text-white hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
                  >
                    {monitor.templateName}
                  </Link>
                ) : (
                  <span className="font-medium text-white">{monitor.templateName}</span>
                )}
                {!monitor.templateId ? (
                  <Badge tone="warning">{t('monitorDetail.templateDeleted')}</Badge>
                ) : null}
              </div>
            ) : null}

            {monitor.tags.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {monitor.tags.map((tag) => (
                  <Badge key={tag} tone="muted">
                    {tag}
                  </Badge>
                ))}
              </div>
            ) : null}

            {monitor.lastError && !monitor.enabled ? (
              <p className="mt-3 text-xs text-moonlight">{t('monitorDetail.enabledHint')}</p>
            ) : null}

            {monitor.config.type === 'http' ? (
              <div className="mt-5 border-t border-white/10 pt-4">
                <CodeWell>
                  <p className="break-all">
                    {monitor.config.request.method} {monitor.config.request.url}
                  </p>
                  <p className="mt-1">
                    {t('monitorForm.extractMode')}:{' '}
                    {monitor.config.extract.mode === 'json'
                      ? t('monitorForm.modeJson')
                      : t('monitorForm.modeJs')}
                  </p>
                  <p className="mt-1">{t(`monitors.${monitor.type}`)}</p>
                </CodeWell>
              </div>
            ) : null}
          </Card>

          {/* Threshold rules */}
          <Card className="p-6">
            <h2 className="text-[18px] font-medium leading-snug text-white">
              {t('monitorDetail.rulesTitle')}
            </h2>
            {monitor.rules.length === 0 ? (
              <p className="mt-3 text-body text-moonlight">{t('monitorDetail.noRules')}</p>
            ) : (
              <ul className="mt-4 space-y-2">
                {monitor.rules.map((rule) => (
                  <li key={rule.id} className="glass-flat px-4 py-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="min-w-0 truncate text-sm font-medium text-white">
                        {rule.label || rule.metricKey}
                      </p>
                      <Badge tone={rule.enabled ? 'success' : 'muted'}>
                        {rule.enabled ? t('common.enabled') : t('common.disabled')}
                      </Badge>
                    </div>
                    <p className="mt-1 break-words text-xs text-moonlight">
                      {rule.metricKey} {OPERATOR_SYMBOLS[rule.operator] ?? rule.operator}{' '}
                      {rule.criticalValue ?? rule.warningValue ?? '—'}
                      {rule.unit ? ` ${rule.unit}` : ''}
                    </p>
                    <p className="text-xs text-moonlight">
                      {t('severity.warning')} {rule.warningValue ?? '—'} / {t('severity.critical')}{' '}
                      {rule.criticalValue ?? '—'} · ×{rule.durationChecks}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {/* Push token */}
          {isPush ? (
            <Card className="p-6">
              <h2 className="flex items-center gap-2 text-[18px] font-medium leading-snug text-white">
                <KeyRound className="h-4 w-4 text-moonlight" aria-hidden />
                {t('monitorDetail.pushToken')}
              </h2>
              <p className="mt-2 text-xs text-moonlight">{t('monitorDetail.pushTokenHint')}</p>
              <div className="mt-4 flex flex-wrap items-center gap-2">
                <CodeWell className="min-w-0 flex-1">
                  <code className="block truncate">
                    {monitor.pushTokenPrefix ? `${monitor.pushTokenPrefix}…` : '—'}
                  </code>
                </CodeWell>
                {monitor.pushTokenPrefix ? (
                  <CopyButton value={monitor.pushTokenPrefix} size="sm" />
                ) : null}
              </div>
              <Button
                variant="outline"
                size="sm"
                className="mt-3"
                onClick={() => setRotateOpen(true)}
              >
                <RefreshCcw className="h-4 w-4" aria-hidden />
                {t('monitorDetail.rotate')}
              </Button>
            </Card>
          ) : null}

          {/* Last error */}
          {monitor.lastError ? (
            <Alert tone="danger" title={t('monitorDetail.lastError')}>
              <p className="break-words text-xs">{monitor.lastError}</p>
            </Alert>
          ) : null}
        </aside>
      </div>

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t('monitorDetail.deleteTitle')}
        description={t('monitorDetail.deleteDescription', { name: monitor.name })}
        confirmLabel={t('common.delete')}
        loading={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate()}
      />

      <ConfirmDialog
        open={rotateOpen}
        onOpenChange={setRotateOpen}
        title={t('monitorDetail.rotateTitle')}
        description={t('monitorDetail.rotateDescription')}
        confirmLabel={t('monitorDetail.rotate')}
        loading={rotateMutation.isPending}
        destructive={false}
        onConfirm={() => rotateMutation.mutate()}
      />

      <PushTokenDialog
        open={Boolean(rotatedToken)}
        token={rotatedToken ?? ''}
        title={t('monitorDetail.rotateTitle')}
        hint={t('monitorForm.pushTokenCreatedHint')}
        onOpenChange={(open) => !open && setRotatedToken(null)}
      />
    </div>
  );
}
