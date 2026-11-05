import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Activity, Pencil, Play, Plus, Trash2 } from 'lucide-react';
import { MONITOR_STATUS_VALUES } from '@subwatch/shared';
import type { MonitorDto } from '@subwatch/shared';
import { api } from '../lib/api';
import { monitorEffectiveStatus, monitorInputFromDto } from '../lib/monitors';
import { useAuth } from '../providers/AuthProvider';
import {
  errorMessage,
  formatInterval,
  formatRelativeTime,
  statusTone,
} from '../lib/utils';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Input,
  PageHeader,
  Select,
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

const STATUS_FILTERS = ['all', ...MONITOR_STATUS_VALUES] as const;

export function MonitorsPage() {
  const { t } = useTranslation();
  const { timezone, locale } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [deleteTarget, setDeleteTarget] = useState<MonitorDto | null>(null);

  const monitorsQuery = useQuery({
    queryKey: ['monitors'],
    queryFn: () => api.monitors.list(),
    refetchInterval: 15_000,
  });

  const filtered = useMemo(() => {
    const monitors = monitorsQuery.data ?? [];
    const query = search.trim().toLowerCase();
    return monitors.filter((monitor) => {
      if (statusFilter !== 'all' && monitorEffectiveStatus(monitor) !== statusFilter) return false;
      if (!query) return true;
      return (
        monitor.name.toLowerCase().includes(query) ||
        monitor.description.toLowerCase().includes(query) ||
        monitor.tags.some((tag) => tag.toLowerCase().includes(query))
      );
    });
  }, [monitorsQuery.data, search, statusFilter]);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['monitors'] });
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  };

  const runMutation = useMutation({
    mutationFn: (monitor: MonitorDto) => api.monitors.run(monitor.id),
    onSuccess: (result) => {
      toast.success(t('monitors.runSuccess'), {
        description: result.run
          ? `${t('status.' + result.run.status)} · ${result.run.durationMs} ms`
          : undefined,
      });
      invalidate();
      void queryClient.invalidateQueries({ queryKey: ['monitor', result.monitor.id] });
      void queryClient.invalidateQueries({ queryKey: ['monitor-runs', result.monitor.id] });
    },
    onError: (error) => toast.error(t('monitors.runFailed'), { description: errorMessage(error) }),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ monitor, enabled }: { monitor: MonitorDto; enabled: boolean }) =>
      api.monitors.update(monitor.id, { ...monitorInputFromDto(monitor), enabled }),
    onSuccess: (_data, variables) => {
      toast.success(variables.enabled ? t('monitors.enabledToast') : t('monitors.disabledToast'));
      invalidate();
      void queryClient.invalidateQueries({ queryKey: ['monitor', variables.monitor.id] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const deleteMutation = useMutation({
    mutationFn: (monitor: MonitorDto) => api.monitors.remove(monitor.id),
    onSuccess: () => {
      toast.success(t('monitors.deleted'));
      setDeleteTarget(null);
      invalidate();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const statusOptions = [
    { value: 'all', label: t('monitors.allStatuses') },
    ...STATUS_FILTERS.filter((value) => value !== 'all').map((status) => ({
      value: status,
      label: t(`status.${status}`),
    })),
  ];

  return (
    <div>
      <PageHeader
        title={t('monitors.title')}
        description={t('monitors.subtitle')}
        icon={<Activity className="h-5 w-5" />}
        actions={
          <Button size="sm" onClick={() => navigate('/monitors/new')}>
            <Plus className="h-4 w-4" aria-hidden />
            {t('monitors.newMonitor')}
          </Button>
        }
      />

      <Card className="mb-3 p-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="flex-1">
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('monitors.searchPlaceholder')}
              aria-label={t('common.search')}
            />
          </div>
          <div className="w-full sm:w-48">
            <Select
              value={statusFilter}
              onValueChange={setStatusFilter}
              options={statusOptions}
              ariaLabel={t('monitors.filterStatus')}
            />
          </div>
        </div>
      </Card>

      {monitorsQuery.isPending ? (
        <Card className="p-4">
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={index} className="h-10" />
            ))}
          </div>
        </Card>
      ) : monitorsQuery.isError ? (
        <ErrorState error={monitorsQuery.error} onRetry={() => void monitorsQuery.refetch()} />
      ) : (monitorsQuery.data ?? []).length === 0 ? (
        <EmptyState
          icon={<Activity className="h-8 w-8" aria-hidden />}
          title={t('monitors.noMonitors')}
          description={t('monitors.noMonitorsHint')}
          action={
            <Button size="sm" onClick={() => navigate('/monitors/new')}>
              <Plus className="h-4 w-4" aria-hidden />
              {t('monitors.newMonitor')}
            </Button>
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          title={t('monitors.emptyFilter')}
          description={t('monitors.emptyFilterHint')}
          icon={<Activity className="h-8 w-8" aria-hidden />}
        />
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <THead>
              <TR>
                <TH>{t('common.name')}</TH>
                <TH>{t('common.status')}</TH>
                <TH className="hidden md:table-cell">{t('common.type')}</TH>
                <TH className="hidden lg:table-cell">{t('monitors.interval')}</TH>
                <TH className="hidden lg:table-cell">{t('monitors.lastChecked')}</TH>
                <TH className="hidden xl:table-cell">{t('monitors.rules')}</TH>
                <TH className="hidden xl:table-cell">{t('monitors.channels')}</TH>
                <TH>{t('common.enabled')}</TH>
                <TH className="text-right">{t('common.actions')}</TH>
              </TR>
            </THead>
            <TBody>
              {filtered.map((monitor) => (
                <TR key={monitor.id}>
                  <TD>
                    <Link to={`/monitors/${monitor.id}`} className="font-medium hover:text-[var(--brand)]">
                      {monitor.name}
                    </Link>
                    {monitor.description ? (
                      <p className="max-w-xs truncate text-xs text-[var(--muted-foreground)]">
                        {monitor.description}
                      </p>
                    ) : null}
                    {monitor.tags.length > 0 ? (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {monitor.tags.slice(0, 3).map((tag) => (
                          <Badge key={tag} tone="muted" className="px-1.5 py-0 text-[10px]">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                    ) : null}
                  </TD>
                  <TD>
                    <StatusBadge status={monitorEffectiveStatus(monitor)} />
                  </TD>
                  <TD className="hidden md:table-cell">{t(`monitors.${monitor.type}`)}</TD>
                  <TD className="hidden lg:table-cell">
                    {formatInterval(monitor.intervalSeconds, locale)}
                  </TD>
                  <TD className="hidden lg:table-cell">
                    {monitor.lastCheckedAt
                      ? formatRelativeTime(monitor.lastCheckedAt, timezone, locale)
                      : t('dashboard.neverChecked')}
                  </TD>
                  <TD className="hidden xl:table-cell">{monitor.rules.length}</TD>
                  <TD className="hidden xl:table-cell">{monitor.channelIds.length}</TD>
                  <TD>
                    <Switch
                      checked={monitor.enabled}
                      onCheckedChange={(checked) =>
                        toggleMutation.mutate({ monitor, enabled: checked })
                      }
                      disabled={toggleMutation.isPending}
                      ariaLabel={`${t('common.enabled')} ${monitor.name}`}
                    />
                  </TD>
                  <TD>
                    <div className="flex items-center justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        title={t('common.runNow')}
                        aria-label={t('common.runNow')}
                        loading={runMutation.isPending && runMutation.variables?.id === monitor.id}
                        onClick={() => runMutation.mutate(monitor)}
                      >
                        {!(runMutation.isPending && runMutation.variables?.id === monitor.id) ? (
                          <Play className="h-4 w-4" aria-hidden />
                        ) : null}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        title={t('common.edit')}
                        aria-label={t('common.edit')}
                        onClick={() => navigate(`/monitors/${monitor.id}/edit`)}
                      >
                        <Pencil className="h-4 w-4" aria-hidden />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        title={t('common.delete')}
                        aria-label={t('common.delete')}
                        className="text-[var(--danger)]"
                        onClick={() => setDeleteTarget(monitor)}
                      >
                        <Trash2 className="h-4 w-4" aria-hidden />
                      </Button>
                    </div>
                  </TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </Card>
      )}

      <p className="mt-2 text-xs text-[var(--muted-foreground)]">
        {t('common.showingCount', {
          shown: filtered.length,
          total: (monitorsQuery.data ?? []).length,
        })}
      </p>

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={t('monitors.deleteTitle')}
        description={
          deleteTarget
            ? t('monitors.deleteDescription', { name: deleteTarget.name })
            : t('common.deleteWarning')
        }
        confirmLabel={t('common.delete')}
        loading={deleteMutation.isPending}
        onConfirm={() => {
          if (deleteTarget) deleteMutation.mutate(deleteTarget);
        }}
      />
    </div>
  );
}

export default MonitorsPage;
