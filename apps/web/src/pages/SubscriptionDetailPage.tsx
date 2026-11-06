import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ArrowLeft,
  BellRing,
  CreditCard,
  ExternalLink,
  Pause,
  Pencil,
  Play,
  RefreshCcw,
  Save,
  Trash2,
} from 'lucide-react';
import { useForm } from 'react-hook-form';
import { subscriptionInputSchema, type SubscriptionDto } from '@subwatch/shared';
import { api } from '../lib/api';
import { applyZodIssues } from '../lib/form';
import {
  subscriptionFormToInput,
  subscriptionToFormValues,
  type SubscriptionFormValues,
} from '../lib/subscriptions';
import { useAuth } from '../providers/AuthProvider';
import { errorMessage, formatDateTime } from '../lib/utils';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  FullPageSpinner,
  PageHeader,
  StatusBadge,
  Table,
  TBody,
  TD,
  TH,
  THead,
  TR,
} from '../components/ui';
import { RenewDialog, type RenewTarget } from '../components/subscriptions/RenewDialog';
import { SubscriptionFormFields } from '../components/subscriptions/SubscriptionFormFields';

export function SubscriptionDetailPage() {
  const { t } = useTranslation();
  const { id = '' } = useParams<{ id: string }>();

  const subscriptionQuery = useQuery({
    queryKey: ['subscription', id],
    queryFn: () => api.subscriptions.get(id),
    enabled: Boolean(id),
    refetchInterval: 15_000,
  });

  if (subscriptionQuery.isPending) {
    return (
      <div>
        <PageHeader title={t('nav.subscriptions')} />
        <FullPageSpinner label={t('common.loading')} />
      </div>
    );
  }

  if (subscriptionQuery.isError || !subscriptionQuery.data) {
    return (
      <div>
        <PageHeader title={t('nav.subscriptions')} />
        <ErrorState error={subscriptionQuery.error} onRetry={() => void subscriptionQuery.refetch()} />
      </div>
    );
  }

  return <SubscriptionDetailContent subscription={subscriptionQuery.data} />;
}

function SubscriptionDetailContent({ subscription }: { subscription: SubscriptionDto }) {
  const { t } = useTranslation();
  const { timezone, locale } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const channelsQuery = useQuery({ queryKey: ['channels'], queryFn: () => api.channels.list() });
  const [editing, setEditing] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [renewTarget, setRenewTarget] = useState<RenewTarget | null>(null);

  const form = useForm<SubscriptionFormValues>({
    defaultValues: subscriptionToFormValues(subscription),
  });

  useEffect(() => {
    if (!editing) form.reset(subscriptionToFormValues(subscription));
    // Only re-sync while not editing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subscription, editing]);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['subscription', subscription.id] });
    void queryClient.invalidateQueries({ queryKey: ['subscriptions'] });
  };

  const updateMutation = useMutation({
    mutationFn: (input: Parameters<typeof api.subscriptions.update>[1]) =>
      api.subscriptions.update(subscription.id, input),
    onSuccess: () => {
      toast.success(t('subscriptions.editSuccess'));
      setEditing(false);
      invalidate();
    },
    onError: (error) => toast.error(t('errors.saveFailed'), { description: errorMessage(error) }),
  });

  const lifecycleMutation = useMutation({
    mutationFn: (action: 'pause' | 'resume') =>
      action === 'pause' ? api.subscriptions.pause(subscription.id) : api.subscriptions.resume(subscription.id),
    onSuccess: (_result, action) => {
      toast.success(action === 'pause' ? t('subscriptions.pauseSuccess') : t('subscriptions.resumeSuccess'));
      invalidate();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const testReminderMutation = useMutation({
    mutationFn: () => api.subscriptions.testReminder(subscription.id),
    onSuccess: (result) => {
      if (result.ok) toast.success(t('subscriptions.testReminderSuccess'));
      else toast.error(t('subscriptions.testReminderFailed'), { description: result.error ?? undefined });
    },
    onError: (error) =>
      toast.error(t('subscriptions.testReminderFailed'), { description: errorMessage(error) }),
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.subscriptions.remove(subscription.id),
    onSuccess: () => {
      toast.success(t('subscriptions.deleted'));
      void queryClient.invalidateQueries({ queryKey: ['subscriptions'] });
      navigate('/', { replace: true });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const onSave = form.handleSubmit((values) => {
    const parsed = subscriptionInputSchema.safeParse(subscriptionFormToInput(values));
    if (!parsed.success) {
      applyZodIssues(form, parsed.error);
      toast.error(t('errors.validation'));
      return;
    }
    updateMutation.mutate(parsed.data);
  });

  const channelNames = subscription.channelIds
    .map((channelId) => (channelsQuery.data ?? []).find((channel) => channel.id === channelId)?.name)
    .filter((name): name is string => Boolean(name));

  const daysLeft = subscription.daysLeft;
  const renewals = subscription.renewals ?? [];

  const editingForm = (
    <form
      onSubmit={(event) => {
        void onSave(event);
      }}
      noValidate
      className="space-y-4"
    >
      <SubscriptionFormFields
        form={form}
        channels={channelsQuery.data ?? []}
        timezone={timezone}
      />
      <Card className="flex flex-wrap items-center justify-end gap-2 p-3">
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            form.reset(subscriptionToFormValues(subscription));
            setEditing(false);
          }}
        >
          {t('common.cancel')}
        </Button>
        <Button type="submit" loading={updateMutation.isPending}>
          <Save className="h-4 w-4" aria-hidden />
          {t('subscriptions.saveChanges')}
        </Button>
      </Card>
    </form>
  );

  return (
    <div>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            <span className="truncate">{subscription.name}</span>
            <StatusBadge status={subscription.status} />
          </span>
        }
        description={`${subscription.expiryDate} · ${t(`cycle.${subscription.cycle}`)}`}
        icon={<CreditCard className="h-5 w-5" />}
        actions={
          editing ? null : (
            <>
              <Button variant="outline" size="sm" onClick={() => navigate('/')}>
                <ArrowLeft className="h-4 w-4" aria-hidden />
                {t('common.back')}
              </Button>
              <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                <Pencil className="h-4 w-4" aria-hidden />
                {t('common.edit')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setRenewTarget({
                    id: subscription.id,
                    name: subscription.name,
                    expiryDate: subscription.expiryDate,
                    cycle: subscription.cycle,
                  })
                }
              >
                <RefreshCcw className="h-4 w-4" aria-hidden />
                {t('subscriptions.renew')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                loading={testReminderMutation.isPending}
                onClick={() => testReminderMutation.mutate()}
              >
                {!testReminderMutation.isPending ? <BellRing className="h-4 w-4" aria-hidden /> : null}
                {t('subscriptions.testReminder')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                loading={lifecycleMutation.isPending}
                onClick={() => lifecycleMutation.mutate(subscription.paused ? 'resume' : 'pause')}
              >
                {subscription.paused ? (
                  <Play className="h-4 w-4" aria-hidden />
                ) : (
                  <Pause className="h-4 w-4" aria-hidden />
                )}
                {subscription.paused ? t('subscriptions.resume') : t('subscriptions.pause')}
              </Button>
              <Button variant="danger" size="sm" onClick={() => setDeleteOpen(true)}>
                <Trash2 className="h-4 w-4" aria-hidden />
                {t('common.delete')}
              </Button>
            </>
          )
        }
      />

      {editing ? (
        editingForm
      ) : (
        <div className="mx-auto max-w-3xl space-y-4">
          {!subscription.paused && subscription.status === 'expired' ? (
            <Alert tone="danger" title={t('status.expired')}>
              {t('subscriptions.expiredHint')}
            </Alert>
          ) : !subscription.paused && subscription.status === 'expiring' ? (
            <Alert tone="warning" title={t('status.expiring')}>
              {t('subscriptions.expiringHint', { count: Math.max(daysLeft, 0) })}
            </Alert>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>{t('subscriptions.info')}</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <dt className="text-xs text-[var(--muted-foreground)]">
                    {t('subscriptions.expiryDate')}
                  </dt>
                  <dd className="mt-0.5 text-sm font-medium">{subscription.expiryDate}</dd>
                </div>
                <div>
                  <dt className="text-xs text-[var(--muted-foreground)]">
                    {t('subscriptions.daysLeft')}
                  </dt>
                  <dd className="mt-0.5 text-sm">
                    {subscription.paused ? (
                      <span className="text-[var(--muted-foreground)]">
                        {t('subscriptions.statusPaused')}
                      </span>
                    ) : daysLeft < 0 ? (
                      <span className="text-[var(--danger)]">
                        {t('subscriptions.daysOverdue', { count: Math.abs(daysLeft) })}
                      </span>
                    ) : daysLeft === 0 ? (
                      <span className="text-[var(--warning)]">{t('subscriptions.dueToday')}</span>
                    ) : (
                      <span className={daysLeft <= 7 ? 'text-[var(--warning)]' : undefined}>
                        {t('subscriptions.daysUntil', { count: daysLeft })}
                      </span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-[var(--muted-foreground)]">{t('subscriptions.cycle')}</dt>
                  <dd className="mt-0.5 text-sm">{t(`cycle.${subscription.cycle}`)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-[var(--muted-foreground)]">
                    {t('subscriptions.link')}
                  </dt>
                  <dd className="mt-0.5 truncate text-sm">
                    {subscription.url ? (
                      <a
                        href={subscription.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex max-w-full items-center gap-1 text-[var(--brand)] hover:underline"
                      >
                        <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden />
                        <span className="truncate">{subscription.url}</span>
                      </a>
                    ) : (
                      <span className="text-[var(--muted-foreground)]">
                        {t('subscriptions.noLink')}
                      </span>
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-[var(--muted-foreground)]">
                    {t('subscriptions.reminders')}
                  </dt>
                  <dd className="mt-1 flex flex-wrap gap-1">
                    {subscription.reminderOffsets.length === 0 ? (
                      <span className="text-sm text-[var(--muted-foreground)]">{t('common.none')}</span>
                    ) : (
                      subscription.reminderOffsets.map((offset) => (
                        <Badge key={offset} tone="info">
                          {t('common.days', { count: offset })}
                        </Badge>
                      ))
                    )}
                  </dd>
                </div>
                <div>
                  <dt className="text-xs text-[var(--muted-foreground)]">
                    {t('subscriptions.channels')}
                  </dt>
                  <dd className="mt-1 flex flex-wrap gap-1">
                    {channelNames.length === 0 ? (
                      <span className="text-sm text-[var(--muted-foreground)]">
                        {t('subscriptions.defaultChannels')}
                      </span>
                    ) : (
                      channelNames.map((name) => (
                        <Badge key={name} tone="muted">
                          {name}
                        </Badge>
                      ))
                    )}
                  </dd>
                </div>
              </dl>

              {subscription.notes ? (
                <div className="mt-4 border-t border-[var(--border)] pt-3">
                  <p className="text-xs text-[var(--muted-foreground)]">{t('subscriptions.notes')}</p>
                  <p className="mt-1 whitespace-pre-wrap break-words text-sm">{subscription.notes}</p>
                </div>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('subscriptions.renewals')}</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {renewals.length === 0 ? (
                <EmptyState className="border-none py-8" title={t('subscriptions.noRenewals')} />
              ) : (
                <Table>
                  <THead>
                    <TR>
                      <TH>{t('subscriptions.renewalFrom')}</TH>
                      <TH>{t('subscriptions.renewalTo')}</TH>
                      <TH className="hidden sm:table-cell">{t('subscriptions.renewalCreatedAt')}</TH>
                    </TR>
                  </THead>
                  <TBody>
                    {renewals.map((renewal) => (
                      <TR key={renewal.id}>
                        <TD>{renewal.fromDate}</TD>
                        <TD className="font-medium">{renewal.toDate}</TD>
                        <TD className="hidden text-xs sm:table-cell">
                          {formatDateTime(renewal.createdAt, timezone, locale)}
                        </TD>
                      </TR>
                    ))}
                  </TBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      <ConfirmDialog
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={t('subscriptions.deleteTitle')}
        description={t('subscriptions.deleteDescription', { name: subscription.name })}
        confirmLabel={t('common.delete')}
        loading={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate()}
      />

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
