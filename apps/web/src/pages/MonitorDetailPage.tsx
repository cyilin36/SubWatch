import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Activity,
  ArrowLeft,
  KeyRound,
  Pencil,
  Play,
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
  statusTone,
} from '../lib/utils';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  CopyButton,
  EmptyState,
  ErrorState,
  FullPageSpinner,
  PageHeader,
  Skeleton,
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

  const runMutation = useMutation({
    mutationFn: () => api.monitors.run(id),
    onSuccess: () => {
      toast.success(t('monitorDetail.runSuccess'));
      invalidate();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

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
      <div>
        <PageHeader title={t('nav.monitors')} />
        <FullPageSpinner label={t('common.loading')} />
      </div>
    );
  }

  if (monitorQuery.isError || !monitor) {
    return (
      <div>
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
    <div>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            <span className="truncate">{monitor.name}</span>
            <StatusBadge status={effectiveStatus} />
          </span>
        }
        description={monitor.description || t('monitorDetail.descriptionEmpty')}
        icon={<Activity className="h-5 w-5" />}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => navigate('/')}>
              <ArrowLeft className="h-4 w-4" aria-hidden />
              {t('common.back')}
            </Button>
            <Button variant="outline" size="sm" loading={runMutation.isPending} onClick={() => runMutation.mutate()}>
              {!runMutation.isPending ? <Play className="h-4 w-4" aria-hidden /> : null}
              {t('common.runNow')}
            </Button>
            <Button variant="outline" size="sm" onClick={() => navigate(`/monitors/${id}/edit`)}>
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

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="min-w-0 space-y-4 lg:col-span-2">
          {/* Summary */}
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>{t('monitorDetail.statusLabel')}</CardTitle>
              <div className="flex items-center gap-2">
                <span className="text-xs text-[var(--muted-foreground)]">{t('common.enabled')}</span>
                <Switch
                  checked={monitor.enabled}
                  onCheckedChange={(checked) => toggleMutation.mutate(checked)}
                  disabled={toggleMutation.isPending}
                  ariaLabel={t('common.enabled')}
                />
              </div>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                <div>
                  <dt className="text-xs text-[var(--muted-foreground)]">{t('monitorDetail.interval')}</dt>
                  <dd className="mt-0.5 text-sm font-medium">
                    {formatInterval(monitor.intervalSeconds, locale)}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-[var(--muted-foreground)]">{t('monitorDetail.lastChecked')}</dt>
                  <dd className="mt-0.5 text-sm">
                    {monitor.lastCheckedAt
                      ? formatRelativeTime(monitor.lastCheckedAt, timezone, locale)
                      : t('common.never')}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-[var(--muted-foreground)]">{t('monitorDetail.nextRun')}</dt>
                  <dd className="mt-0.5 text-sm">
                    {monitor.nextRunAt ? formatDateTime(monitor.nextRunAt, timezone, locale) : '—'}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-[var(--muted-foreground)]">
                    {t('monitorDetail.consecutiveFailures')}
                  </dt>
                  <dd className="mt-0.5 text-sm font-medium">{monitor.consecutiveFailures}</dd>
                </div>
                <div>
                  <dt className="text-xs text-[var(--muted-foreground)]">{t('monitorDetail.rulesCountLabel')}</dt>
                  <dd className="mt-0.5 text-sm font-medium">{monitor.rules.length}</dd>
                </div>
              </dl>
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
                <p className="mt-2 text-xs text-[var(--muted-foreground)]">{t('monitorDetail.enabledHint')}</p>
              ) : null}
            </CardContent>
          </Card>

          {/* Current metrics */}
          <Card>
            <CardHeader>
              <CardTitle>{t('monitorDetail.currentMetrics')}</CardTitle>
            </CardHeader>
            <CardContent>
              {metricEntries.length === 0 ? (
                <p className="text-sm text-[var(--muted-foreground)]">{t('monitorDetail.noMetrics')}</p>
              ) : (
                <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                  {metricEntries.map(([key, metric]) => (
                    <div key={key} className="rounded-lg border border-[var(--border)] px-3 py-2">
                      <p className="truncate text-xs text-[var(--muted-foreground)]">{metric.label || key}</p>
                      <p className="mt-0.5 truncate text-lg font-semibold">{formatMetricValue(metric)}</p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Trend chart */}
          <Card>
            <CardHeader className="flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <CardTitle>{t('monitorDetail.trend')}</CardTitle>
              <Segmented
                value={range}
                onChange={setRange}
                options={[
                  { value: '24h', label: t('monitorDetail.range24h') },
                  { value: '7d', label: t('monitorDetail.range7d') },
                  { value: '30d', label: t('monitorDetail.range30d') },
                ]}
              />
            </CardHeader>
            <CardContent>
              {metricsQuery.isPending ? (
                <Skeleton className="h-72" />
              ) : metricsQuery.isError ? (
                <ErrorState error={metricsQuery.error} onRetry={() => void metricsQuery.refetch()} />
              ) : (
                <MetricChart series={series} range={range} timezone={timezone} locale={locale} />
              )}
            </CardContent>
          </Card>

          {/* Run history */}
          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>{t('monitorDetail.runHistory')}</CardTitle>
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={() => void runsQuery.refetch()}
                aria-label={t('common.refresh')}
                loading={runsQuery.isFetching}
              >
                {!runsQuery.isFetching ? <RefreshCcw className="h-4 w-4" aria-hidden /> : null}
              </Button>
            </CardHeader>
            <CardContent className="pt-0">
              {runsQuery.isPending ? (
                <Skeleton className="h-40" />
              ) : runsQuery.isError ? (
                <ErrorState error={runsQuery.error} onRetry={() => void runsQuery.refetch()} />
              ) : runs.length === 0 ? (
                <EmptyState className="border-none py-8" title={t('monitorDetail.noRuns')} />
              ) : (
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
                        <TD className="hidden lg:table-cell text-xs text-[var(--muted-foreground)]">
                          {t(`trigger.${run.trigger}`)}
                        </TD>
                        <TD className="max-w-[220px]">
                          <p className="truncate text-xs text-[var(--danger)]" title={run.error ?? undefined}>
                            {run.error ?? '—'}
                          </p>
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>

        <aside className="min-w-0 space-y-4">
          {/* Rules */}
          <Card>
            <CardHeader>
              <CardTitle>{t('monitorDetail.rulesTitle')}</CardTitle>
            </CardHeader>
            <CardContent>
              {monitor.rules.length === 0 ? (
                <p className="text-sm text-[var(--muted-foreground)]">{t('monitorDetail.noRules')}</p>
              ) : (
                <ul className="space-y-2.5">
                  {monitor.rules.map((rule) => (
                    <li key={rule.id} className="rounded-lg border border-[var(--border)] p-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-sm font-medium">{rule.label || rule.metricKey}</p>
                        <Badge tone={rule.enabled ? 'success' : 'muted'}>
                          {rule.enabled ? t('common.enabled') : t('common.disabled')}
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                        {rule.metricKey} {OPERATOR_SYMBOLS[rule.operator] ?? rule.operator}{' '}
                        {rule.criticalValue ?? rule.warningValue ?? '—'}
                        {rule.unit ? ` ${rule.unit}` : ''}
                      </p>
                      <p className="text-xs text-[var(--muted-foreground)]">
                        {t('severity.warning')} {rule.warningValue ?? '—'} / {t('severity.critical')}{' '}
                        {rule.criticalValue ?? '—'} · ×{rule.durationChecks}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          {/* Push token */}
          {isPush ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <KeyRound className="h-4 w-4 text-[var(--brand)]" aria-hidden />
                  {t('monitorDetail.pushToken')}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <p className="text-xs text-[var(--muted-foreground)]">{t('monitorDetail.pushTokenHint')}</p>
                <div className="flex items-center gap-2">
                  <code className="flex-1 truncate rounded-md bg-[var(--surface-muted)] px-2 py-1.5 font-mono text-xs">
                    {monitor.pushTokenPrefix ? `${monitor.pushTokenPrefix}…` : '—'}
                  </code>
                  {monitor.pushTokenPrefix ? <CopyButton value={monitor.pushTokenPrefix} /> : null}
                </div>
                <Button variant="outline" size="sm" onClick={() => setRotateOpen(true)}>
                  <RefreshCcw className="h-4 w-4" aria-hidden />
                  {t('monitorDetail.rotate')}
                </Button>
              </CardContent>
            </Card>
          ) : null}

          {/* Last error */}
          {monitor.lastError ? (
            <Alert tone="danger" title={t('monitorDetail.lastError')}>
              <p className="break-words text-xs">{monitor.lastError}</p>
            </Alert>
          ) : null}

          {!isPush && monitor.config.type === 'http' ? (
            <Card>
              <CardHeader>
                <CardTitle>{t('monitors.monitorType')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-1.5 text-xs text-[var(--muted-foreground)]">
                <p>
                  {monitor.config.request.method} {monitor.config.request.url}
                </p>
                <p>
                  {t('monitorForm.extractMode')}:{' '}
                  {monitor.config.extract.mode === 'json'
                    ? t('monitorForm.modeJson')
                    : t('monitorForm.modeJs')}
                </p>
                <p>{t(`monitors.${monitor.type}`)}</p>
              </CardContent>
            </Card>
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
