import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Archive,
  ArchiveRestore,
  ArrowRight,
  CreditCard,
  Pause,
  Play,
  Plus,
  RefreshCcw,
} from 'lucide-react';
import { SUBSCRIPTION_STATUS_VALUES, type SubscriptionDto } from '@subwatch/shared';
import { api } from '../lib/api';
import { subscriptionInputFromDto } from '../lib/subscriptions';
import { useAuth } from '../providers/AuthProvider';
import { errorMessage, formatInterval, formatMoney } from '../lib/utils';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Input,
  PageHeader,
  Select,
  Skeleton,
  StatusBadge,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '../components/ui';
import { RenewDialog, type RenewTarget } from '../components/subscriptions/RenewDialog';

const STATUS_FILTERS = ['all', ...SUBSCRIPTION_STATUS_VALUES] as const;

function daysLeftLabel(subscription: SubscriptionDto, t: (key: string, options?: Record<string, unknown>) => string): string {
  const days = subscription.daysLeft;
  if (subscription.status === 'archived') return t('subscriptions.statusArchived');
  if (subscription.status === 'paused') return t('subscriptions.statusPaused');
  if (days < 0) return t('subscriptions.daysOverdue', { count: Math.abs(days) });
  if (days === 0) return t('subscriptions.dueToday');
  return t('subscriptions.daysUntil', { count: days });
}

export function SubscriptionsPage() {
  const { t } = useTranslation();
  const { locale } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [renewTarget, setRenewTarget] = useState<RenewTarget | null>(null);

  const subscriptionsQuery = useQuery({
    queryKey: ['subscriptions'],
    queryFn: () => api.subscriptions.list(),
    refetchInterval: 15_000,
  });

  const filtered = useMemo(() => {
    const subscriptions = subscriptionsQuery.data ?? [];
    const query = search.trim().toLowerCase();
    return subscriptions.filter((subscription) => {
      if (statusFilter !== 'all' && subscription.status !== statusFilter) return false;
      if (!query) return true;
      return (
        subscription.name.toLowerCase().includes(query) ||
        (subscription.templateName ?? '').toLowerCase().includes(query)
      );
    });
  }, [subscriptionsQuery.data, search, statusFilter]);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['subscriptions'] });
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  };

  const lifecycleMutation = useMutation({
    mutationFn: async ({ action, subscription }: { action: 'pause' | 'resume'; subscription: SubscriptionDto }) =>
      action === 'pause' ? api.subscriptions.pause(subscription.id) : api.subscriptions.resume(subscription.id),
    onSuccess: (_result, variables) => {
      toast.success(
        variables.action === 'pause' ? t('subscriptions.pauseSuccess') : t('subscriptions.resumeSuccess'),
      );
      invalidate();
      void queryClient.invalidateQueries({ queryKey: ['subscription', variables.subscription.id] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const archiveMutation = useMutation({
    mutationFn: (subscription: SubscriptionDto) =>
      api.subscriptions.update(subscription.id, {
        ...subscriptionInputFromDto(subscription),
        archived: !subscription.archived,
      }),
    onSuccess: (_result, subscription) => {
      toast.success(
        subscription.archived ? t('subscriptions.unarchiveSuccess') : t('subscriptions.archiveSuccess'),
      );
      invalidate();
      void queryClient.invalidateQueries({ queryKey: ['subscription', subscription.id] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const statusOptions = [
    { value: 'all', label: t('subscriptions.allStatuses') },
    ...STATUS_FILTERS.filter((value) => value !== 'all').map((status) => ({
      value: status,
      label: t(`status.${status}`),
    })),
  ];

  return (
    <div>
      <PageHeader
        title={t('subscriptions.title')}
        description={t('subscriptions.subtitle')}
        icon={<CreditCard className="h-5 w-5" />}
        actions={
          <Button size="sm" onClick={() => navigate('/subscriptions/new')}>
            <Plus className="h-4 w-4" aria-hidden />
            {t('subscriptions.newSubscription')}
          </Button>
        }
      />

      <Card className="mb-3 p-3">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <div className="flex-1">
            <Input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder={t('subscriptions.searchPlaceholder')}
              aria-label={t('common.search')}
            />
          </div>
          <div className="w-full sm:w-48">
            <Select
              value={statusFilter}
              onValueChange={setStatusFilter}
              options={statusOptions}
              ariaLabel={t('subscriptions.filterStatus')}
            />
          </div>
        </div>
      </Card>

      {subscriptionsQuery.isPending ? (
        <Card className="p-4">
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, index) => (
              <Skeleton key={index} className="h-10" />
            ))}
          </div>
        </Card>
      ) : subscriptionsQuery.isError ? (
        <ErrorState error={subscriptionsQuery.error} onRetry={() => void subscriptionsQuery.refetch()} />
      ) : (subscriptionsQuery.data ?? []).length === 0 ? (
        <EmptyState
          icon={<CreditCard className="h-8 w-8" aria-hidden />}
          title={t('subscriptions.noSubscriptions')}
          description={t('subscriptions.noSubscriptionsHint')}
          action={
            <Button size="sm" onClick={() => navigate('/subscriptions/new')}>
              <Plus className="h-4 w-4" aria-hidden />
              {t('subscriptions.newSubscription')}
            </Button>
          }
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          title={t('subscriptions.emptyFilter')}
          description={t('subscriptions.emptyFilterHint')}
          icon={<CreditCard className="h-8 w-8" aria-hidden />}
        />
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <THead>
              <TR>
                <TH>{t('subscriptions.name')}</TH>
                <TH>{t('common.status')}</TH>
                <TH>{t('subscriptions.expiryDate')}</TH>
                <TH className="hidden md:table-cell">{t('subscriptions.cycle')}</TH>
                <TH className="hidden sm:table-cell">{t('subscriptions.amount')}</TH>
                <TH className="text-right">{t('common.actions')}</TH>
              </TR>
            </THead>
            <TBody>
              {filtered.map((subscription) => {
                const cycleLabel =
                  subscription.cycle === 'custom_days'
                    ? `${t('cycle.custom_days')} · ${subscription.cycleDays ?? '—'}`
                    : t(`cycle.${subscription.cycle}`);
                return (
                  <TR key={subscription.id}>
                    <TD>
                      <Link
                        to={`/subscriptions/${subscription.id}`}
                        className="font-medium hover:text-[var(--brand)]"
                      >
                        {subscription.name}
                      </Link>
                      <p className="text-xs text-[var(--muted-foreground)]">
                        {subscription.templateName ?? t('subscriptionForm.blankTemplate')}
                      </p>
                    </TD>
                    <TD>
                      <StatusBadge status={subscription.status} />
                      <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                        {daysLeftLabel(subscription, t)}
                      </p>
                    </TD>
                    <TD className="whitespace-nowrap">{subscription.expiryDate}</TD>
                    <TD className="hidden md:table-cell">{cycleLabel}</TD>
                    <TD className="hidden sm:table-cell">
                      {formatMoney(subscription.amountCents, subscription.currency, locale)}
                    </TD>
                    <TD>
                      <div className="flex flex-wrap items-center justify-end gap-1">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() =>
                            setRenewTarget({
                              id: subscription.id,
                              name: subscription.name,
                              expiryDate: subscription.expiryDate,
                              amountCents: subscription.amountCents,
                              currency: subscription.currency,
                              cycle: subscription.cycle,
                              cycleDays: subscription.cycleDays,
                            })
                          }
                        >
                          <RefreshCcw className="h-3.5 w-3.5" aria-hidden />
                          {t('subscriptions.renew')}
                        </Button>
                        {subscription.status !== 'archived' ? (
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            title={subscription.paused ? t('subscriptions.resume') : t('subscriptions.pause')}
                            aria-label={subscription.paused ? t('subscriptions.resume') : t('subscriptions.pause')}
                            onClick={() =>
                              lifecycleMutation.mutate({
                                action: subscription.paused ? 'resume' : 'pause',
                                subscription,
                              })
                            }
                          >
                            {subscription.paused ? (
                              <Play className="h-4 w-4" aria-hidden />
                            ) : (
                              <Pause className="h-4 w-4" aria-hidden />
                            )}
                          </Button>
                        ) : null}
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          title={subscription.archived ? t('subscriptions.unarchive') : t('subscriptions.archive')}
                          aria-label={subscription.archived ? t('subscriptions.unarchive') : t('subscriptions.archive')}
                          onClick={() => archiveMutation.mutate(subscription)}
                        >
                          {subscription.archived ? (
                            <ArchiveRestore className="h-4 w-4" aria-hidden />
                          ) : (
                            <Archive className="h-4 w-4" aria-hidden />
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          title={t('subscriptions.detail')}
                          aria-label={t('subscriptions.detail')}
                          onClick={() => navigate(`/subscriptions/${subscription.id}`)}
                        >
                          <ArrowRight className="h-4 w-4" aria-hidden />
                        </Button>
                      </div>
                    </TD>
                  </TR>
                );
              })}
            </TBody>
          </Table>
        </Card>
      )}

      <p className="mt-2 text-xs text-[var(--muted-foreground)]">
        {t('common.showingCount', {
          shown: filtered.length,
          total: (subscriptionsQuery.data ?? []).length,
        })}
      </p>

      <RenewDialog
        open={Boolean(renewTarget)}
        onOpenChange={(open) => !open && setRenewTarget(null)}
        target={renewTarget}
      />
    </div>
  );
}
