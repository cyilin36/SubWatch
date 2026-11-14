import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ArrowLeft,
  BellRing,
  CreditCard,
  ExternalLink,
  History,
  LayoutTemplate,
  Pause,
  Pencil,
  Play,
  RefreshCcw,
  Save,
  Trash2,
} from 'lucide-react';
import { useForm } from 'react-hook-form';
import { formatExpiry, subscriptionInputSchema, type SubscriptionDto } from '@subwatch/shared';
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
  ErrorState,
  FullPageSpinner,
  PageHeader,
  StatTile,
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
import { TemplateFieldsView } from '../components/templates/TemplateFieldsView';

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
  const reminderOffsets = [...subscription.reminderOffsets].sort((a, b) => b - a);
  const daysAlarm = !subscription.paused && (daysLeft <= 7 || subscription.status === 'expired');

  const daysHint = subscription.paused
    ? t('subscriptions.statusPaused')
    : daysLeft < 0
      ? t('subscriptions.daysOverdue', { count: Math.abs(daysLeft) })
      : subscription.status === 'expired'
        ? t('subscriptions.dueTodayExpired')
        : daysLeft === 0
          ? t('subscriptions.dueToday')
          : t('subscriptions.daysUntil', { count: daysLeft });

  const editingForm = (
    <form
      onSubmit={(event) => {
        void onSave(event);
      }}
      noValidate
      className="space-y-6"
    >
      <SubscriptionFormFields
        form={form}
        channels={channelsQuery.data ?? []}
        timezone={timezone}
      />
      <div className="glass flex flex-wrap items-center justify-end gap-2 p-3">
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
      </div>
    </form>
  );

  return (
    <div>
      <PageHeader
        label={t('nav.subscriptions')}
        title={
          <span className="flex min-w-0 flex-wrap items-center gap-3">
            <span className="truncate">{subscription.name}</span>
            <StatusBadge status={subscription.status} />
          </span>
        }
        description={`${formatExpiry(subscription.expiryDate, subscription.expiryTime)} · ${t(
          `cycle.${subscription.cycle}`,
        )}`}
        icon={<CreditCard className="h-5 w-5" />}
        actions={
          editing ? null : (
            <>
              <Button variant="ghost" size="sm" onClick={() => navigate('/')}>
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
                    expiryTime: subscription.expiryTime,
                    cycle: subscription.cycle,
                  })
                }
              >
                <RefreshCcw className="h-4 w-4" aria-hidden />
                {t('subscriptions.renew')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                loading={testReminderMutation.isPending}
                onClick={() => testReminderMutation.mutate()}
              >
                {!testReminderMutation.isPending ? <BellRing className="h-4 w-4" aria-hidden /> : null}
                {t('subscriptions.testReminder')}
              </Button>
              <Button
                variant="ghost"
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
        <div className="space-y-6">
          {!subscription.paused && subscription.status === 'expired' ? (
            <Alert tone="danger" title={t('status.expired')}>
              {t('subscriptions.expiredHint')}
            </Alert>
          ) : !subscription.paused && subscription.status === 'expiring' ? (
            <Alert tone="warning" title={t('status.expiring')}>
              {t('subscriptions.expiringHint', { count: Math.max(daysLeft, 0) })}
            </Alert>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            <StatTile
              label={t('subscriptions.expiryDate')}
              value={subscription.expiryDate}
              hint={`${subscription.expiryTime} · ${t(`cycle.${subscription.cycle}`)}`}
            />
            <StatTile
              label={t('subscriptions.daysLeft')}
              value={subscription.paused ? '—' : daysLeft}
              hint={daysHint}
              accent={!subscription.paused && !daysAlarm}
              tone={daysAlarm ? (daysLeft < 0 || subscription.status === 'expired' ? 'danger' : 'warning') : undefined}
            />
            <StatTile
              label={t('subscriptions.reminders')}
              className="sm:col-span-2 xl:col-span-1"
              value={reminderOffsets.length === 0 ? '—' : reminderOffsets.length}
              hint={
                reminderOffsets.length === 0
                  ? t('common.none')
                  : reminderOffsets.map((offset) => t('common.days', { count: offset })).join(' · ')
              }
            />
          </div>

          <div className="grid gap-6 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader>
                <CardTitle>{t('subscriptions.info')}</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="grid gap-5 sm:grid-cols-2">
                  <div className="min-w-0">
                    <dt className="type-label">{t('subscriptions.expiryDate')}</dt>
                    <dd className="mt-1.5 text-body font-medium text-ink">
                      {formatExpiry(subscription.expiryDate, subscription.expiryTime)}
                    </dd>
                  </div>
                  <div className="min-w-0">
                    <dt className="type-label">{t('subscriptions.cycle')}</dt>
                    <dd className="mt-1.5 text-body text-ink/90">{t(`cycle.${subscription.cycle}`)}</dd>
                  </div>
                  <div className="min-w-0 sm:col-span-2">
                    <dt className="type-label">{t('subscriptions.link')}</dt>
                    <dd className="mt-1.5 min-w-0 text-body">
                      {subscription.url ? (
                        <a
                          href={subscription.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex max-w-full items-center gap-1.5 text-moonlight underline decoration-ink/20 underline-offset-4 transition-colors duration-500 ease-glass hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/50 focus-visible:ring-offset-2 focus-visible:ring-offset-night"
                        >
                          <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden />
                          <span className="truncate">{subscription.url}</span>
                        </a>
                      ) : (
                        <span className="text-moonlight">{t('subscriptions.noLink')}</span>
                      )}
                    </dd>
                  </div>
                </dl>

                {subscription.notes ? (
                  <div className="mt-6 border-t border-ink/10 pt-5">
                    <p className="type-label">{t('subscriptions.notes')}</p>
                    <p className="mt-2 whitespace-pre-wrap break-words text-body text-ink/90">
                      {subscription.notes}
                    </p>
                  </div>
                ) : null}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>{t('subscriptions.reminders')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-5">
                <div>
                  <p className="type-label">{t('subscriptionForm.reminderOffsets')}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {reminderOffsets.length === 0 ? (
                      <span className="text-body text-moonlight">{t('common.none')}</span>
                    ) : (
                      reminderOffsets.map((offset) => (
                        <Badge key={offset} tone="info">
                          {t('common.days', { count: offset })}
                        </Badge>
                      ))
                    )}
                  </div>
                </div>
                <div>
                  <p className="type-label">{t('subscriptions.channels')}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {channelNames.length === 0 ? (
                      <span className="text-body text-moonlight">{t('subscriptions.defaultChannels')}</span>
                    ) : (
                      channelNames.map((name) => (
                        <Badge key={name} tone="muted">
                          {name}
                        </Badge>
                      ))
                    )}
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {subscription.templateName || subscription.templateId || subscription.fieldDefs.length > 0 ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <LayoutTemplate className="h-4 w-4 text-moonlight" aria-hidden />
                  {t('subscriptions.templateInfo')}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <p className="type-label">{t('subscriptions.templateName')}</p>
                  <p className="mt-1.5 flex flex-wrap items-center gap-2 text-body font-medium text-ink">
                    {subscription.templateId ? (
                      <Link
                        to={`/templates/${subscription.templateId}`}
                        className="text-moonlight underline decoration-ink/20 underline-offset-4 transition-colors duration-500 ease-glass hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/50 focus-visible:ring-offset-2 focus-visible:ring-offset-night"
                      >
                        {subscription.templateName ?? subscription.templateId}
                      </Link>
                    ) : (
                      <span>{subscription.templateName ?? t('common.none')}</span>
                    )}
                    {!subscription.templateId && subscription.templateName ? (
                      <Badge tone="warning">{t('subscriptions.templateDeleted')}</Badge>
                    ) : null}
                  </p>
                </div>
                {subscription.fieldDefs.length > 0 ? (
                  <TemplateFieldsView fields={subscription.fieldDefs} values={subscription.fields} />
                ) : (
                  <p className="text-body text-moonlight">{t('subscriptions.noTemplateFields')}</p>
                )}
              </CardContent>
            </Card>
          ) : null}

          <Card>
            <CardHeader>
              <CardTitle>{t('subscriptions.renewals')}</CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              {renewals.length === 0 ? (
                <div className="glass-flat flex flex-col items-center px-6 py-10 text-center">
                  <History className="h-6 w-6 text-moonlight" aria-hidden />
                  <p className="mt-3 text-body text-moonlight">{t('subscriptions.noRenewals')}</p>
                </div>
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
