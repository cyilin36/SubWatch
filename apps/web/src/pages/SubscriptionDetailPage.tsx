import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  BellRing,
  CreditCard,
  Pause,
  Pencil,
  Play,
  RefreshCcw,
  Save,
  Trash2,
} from 'lucide-react';
import { useForm } from 'react-hook-form';
import {
  SECRET_KEEP,
  subscriptionInputSchema,
  type ChannelDto,
  type MonitorDto,
  type SubscriptionDto,
  type TemplateDto,
  type TemplateField,
} from '@subwatch/shared';
import { api } from '../lib/api';
import { applyZodIssues } from '../lib/form';
import { subscriptionInputFromDto } from '../lib/subscriptions';
import { useAuth } from '../providers/AuthProvider';
import { errorMessage, formatDateTime, formatMoney } from '../lib/utils';
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
import {
  SubscriptionFormFields,
  subscriptionToFormValues,
  validateRequiredTemplateFields,
  type SubscriptionFormValues,
} from '../components/subscriptions/SubscriptionFormFields';

export function SubscriptionDetailPage() {
  const { t } = useTranslation();
  const { id = '' } = useParams<{ id: string }>();

  const subscriptionQuery = useQuery({
    queryKey: ['subscription', id],
    queryFn: () => api.subscriptions.get(id),
    enabled: Boolean(id),
    refetchInterval: 15_000,
  });
  const templatesQuery = useQuery({ queryKey: ['templates'], queryFn: () => api.templates.list() });
  const monitorsQuery = useQuery({ queryKey: ['monitors'], queryFn: () => api.monitors.list() });
  const channelsQuery = useQuery({ queryKey: ['channels'], queryFn: () => api.channels.list() });

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

  return (
    <SubscriptionDetailContent
      subscription={subscriptionQuery.data}
      templates={templatesQuery.data ?? []}
      monitors={monitorsQuery.data ?? []}
      channels={channelsQuery.data ?? []}
    />
  );
}

function displayTemplateFieldValue(
  field: TemplateField,
  value: unknown,
  t: (key: string) => string,
): string {
  if (value === undefined || value === null || value === '') return '—';
  if (value === SECRET_KEEP || field.type === 'secret') return '••••••••';
  if (field.type === 'switch') return value ? t('common.yes') : t('common.no');
  return String(value);
}

function SubscriptionDetailContent({
  subscription,
  templates,
  monitors,
  channels,
}: {
  subscription: SubscriptionDto;
  templates: TemplateDto[];
  monitors: MonitorDto[];
  channels: ChannelDto[];
}) {
  const { t } = useTranslation();
  const { timezone, locale } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const template = templates.find((entry) => entry.id === subscription.templateId);
  const [editing, setEditing] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [renewTarget, setRenewTarget] = useState<RenewTarget | null>(null);

  const form = useForm<SubscriptionFormValues>({
    defaultValues: subscriptionToFormValues(subscription, template),
  });

  useEffect(() => {
    if (!editing) form.reset(subscriptionToFormValues(subscription, template));
    // Only re-sync while not editing.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subscription, template, editing]);

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['subscription', subscription.id] });
    void queryClient.invalidateQueries({ queryKey: ['subscriptions'] });
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
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

  const archiveMutation = useMutation({
    mutationFn: () =>
      api.subscriptions.update(subscription.id, {
        ...subscriptionInputFromDto(subscription),
        archived: !subscription.archived,
      }),
    onSuccess: () => {
      toast.success(
        subscription.archived ? t('subscriptions.unarchiveSuccess') : t('subscriptions.archiveSuccess'),
      );
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
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      navigate('/subscriptions', { replace: true });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const onSave = form.handleSubmit((values) => {
    if (
      !validateRequiredTemplateFields(form, template, (label) =>
        t('subscriptionForm.requiredField', { label }),
      )
    ) {
      toast.error(t('errors.validation'));
      return;
    }
    const parsed = subscriptionInputSchema.safeParse(values);
    if (!parsed.success) {
      applyZodIssues(form, parsed.error);
      toast.error(t('errors.validation'));
      return;
    }
    updateMutation.mutate(parsed.data);
  });

  const renewals = subscription.renewals ?? [];
  const channelNames = subscription.channelIds.map(
    (channelId) => channels.find((channel) => channel.id === channelId)?.name ?? channelId,
  );
  const linkedMonitors = subscription.linkedMonitorIds.map((monitorId) => ({
    id: monitorId,
    name: monitors.find((monitor) => monitor.id === monitorId)?.name ?? monitorId,
  }));

  const daysLeft = subscription.daysLeft;
  const cycleLabel =
    subscription.cycle === 'custom_days'
      ? `${t('cycle.custom_days')} · ${subscription.cycleDays ?? '—'}`
      : t(`cycle.${subscription.cycle}`);

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
        templates={templates}
        channels={channels}
        monitors={monitors}
        timezone={timezone}
        locale={locale}
      />
      <Card className="flex flex-wrap items-center justify-end gap-2 p-3">
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            form.reset(subscriptionToFormValues(subscription, template));
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
        description={template?.name ?? t('subscriptionForm.blankTemplate')}
        icon={<CreditCard className="h-5 w-5" />}
        actions={
          editing ? null : (
            <>
              <Button variant="outline" size="sm" onClick={() => navigate('/subscriptions')}>
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
                    amountCents: subscription.amountCents,
                    currency: subscription.currency,
                    cycle: subscription.cycle,
                    cycleDays: subscription.cycleDays,
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
              {!subscription.archived ? (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => lifecycleMutation.mutate(subscription.paused ? 'resume' : 'pause')}
                >
                  {subscription.paused ? (
                    <Play className="h-4 w-4" aria-hidden />
                  ) : (
                    <Pause className="h-4 w-4" aria-hidden />
                  )}
                  {subscription.paused ? t('subscriptions.resume') : t('subscriptions.pause')}
                </Button>
              ) : null}
              <Button variant="outline" size="sm" onClick={() => archiveMutation.mutate()}>
                {subscription.archived ? (
                  <ArchiveRestore className="h-4 w-4" aria-hidden />
                ) : (
                  <Archive className="h-4 w-4" aria-hidden />
                )}
                {subscription.archived ? t('subscriptions.unarchive') : t('subscriptions.archive')}
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
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="min-w-0 space-y-4 lg:col-span-2">
            {daysLeft < 0 && !subscription.archived ? (
              <Alert tone="danger" title={t('subscriptions.expiredLabel')}>
                {t('subscriptions.expiredHint')}
              </Alert>
            ) : daysLeft <= 7 && !subscription.paused && !subscription.archived ? (
              <Alert tone="warning" title={t('subscriptions.expiringLabel')}>
                {t('subscriptions.expiringHint', { count: Math.max(daysLeft, 0) })}
              </Alert>
            ) : null}

            <Card>
              <CardHeader>
                <CardTitle>{t('subscriptions.baseInfo')}</CardTitle>
              </CardHeader>
              <CardContent>
                <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  <div>
                    <dt className="text-xs text-[var(--muted-foreground)]">{t('subscriptions.template')}</dt>
                    <dd className="mt-0.5 text-sm font-medium">
                      {template?.name ?? t('subscriptionForm.blankTemplate')}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-[var(--muted-foreground)]">{t('subscriptions.startDate')}</dt>
                    <dd className="mt-0.5 text-sm">{subscription.startDate}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-[var(--muted-foreground)]">
                      {t('subscriptions.expiryDate')}
                    </dt>
                    <dd className="mt-0.5 text-sm font-medium">{subscription.expiryDate}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-[var(--muted-foreground)]">{t('subscriptions.daysLeft')}</dt>
                    <dd className="mt-0.5 text-sm">
                      {daysLeft < 0
                        ? t('subscriptions.daysOverdue', { count: Math.abs(daysLeft) })
                        : daysLeft === 0
                          ? t('subscriptions.dueToday')
                          : t('subscriptions.daysUntil', { count: daysLeft })}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-[var(--muted-foreground)]">{t('subscriptions.cycle')}</dt>
                    <dd className="mt-0.5 text-sm">{cycleLabel}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-[var(--muted-foreground)]">{t('subscriptions.amount')}</dt>
                    <dd className="mt-0.5 text-sm font-medium">
                      {formatMoney(subscription.amountCents, subscription.currency, locale)}
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
                    <dt className="text-xs text-[var(--muted-foreground)]">{t('subscriptions.reminders')}</dt>
                    <dd className="mt-1 flex flex-wrap gap-1">
                      {channelNames.length === 0 ? (
                        <span className="text-sm text-[var(--muted-foreground)]">{t('settings.noChannels')}</span>
                      ) : (
                        channelNames.map((name) => (
                          <Badge key={name} tone="muted">
                            {name}
                          </Badge>
                        ))
                      )}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-[var(--muted-foreground)]">
                      {t('subscriptions.createdAtLabel')}
                    </dt>
                    <dd className="mt-0.5 text-sm">
                      {formatDateTime(subscription.createdAt, timezone, locale)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-[var(--muted-foreground)]">
                      {t('subscriptions.updatedAtLabel')}
                    </dt>
                    <dd className="mt-0.5 text-sm">
                      {formatDateTime(subscription.updatedAt, timezone, locale)}
                    </dd>
                  </div>
                </dl>
                {subscription.paused ? (
                  <p className="mt-3 text-xs text-[var(--warning)]">{t('subscriptions.statusPaused')}</p>
                ) : null}
                {subscription.archived ? (
                  <p className="mt-3 text-xs text-[var(--muted-foreground)]">
                    {t('subscriptions.statusArchived')}
                  </p>
                ) : null}
              </CardContent>
            </Card>

            {template && template.fields.length > 0 ? (
              <Card>
                <CardHeader>
                  <CardTitle>{t('subscriptions.templateFields')}</CardTitle>
                </CardHeader>
                <CardContent>
                  <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    {template.fields.map((field) => (
                      <div key={field.key}>
                        <dt className="text-xs text-[var(--muted-foreground)]">{field.label}</dt>
                        <dd className="mt-0.5 break-words text-sm">
                          {displayTemplateFieldValue(field, subscription.fields[field.key], t)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </CardContent>
              </Card>
            ) : null}

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
                        <TH className="hidden sm:table-cell">{t('subscriptions.renewalAmount')}</TH>
                        <TH className="hidden md:table-cell">{t('subscriptions.renewalNote')}</TH>
                        <TH className="hidden lg:table-cell">{t('subscriptions.renewalCreatedAt')}</TH>
                      </TR>
                    </THead>
                    <TBody>
                      {renewals.map((renewal) => (
                        <TR key={renewal.id}>
                          <TD>{renewal.fromDate}</TD>
                          <TD className="font-medium">{renewal.toDate}</TD>
                          <TD className="hidden sm:table-cell">
                            {formatMoney(
                              renewal.amountCents,
                              renewal.currency ?? subscription.currency,
                              locale,
                            )}
                          </TD>
                          <TD className="hidden max-w-[200px] truncate md:table-cell">
                            {renewal.note || '—'}
                          </TD>
                          <TD className="hidden lg:table-cell text-xs">
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

          <aside className="min-w-0 space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>{t('subscriptions.linkedMonitors')}</CardTitle>
              </CardHeader>
              <CardContent>
                {linkedMonitors.length === 0 ? (
                  <p className="text-sm text-[var(--muted-foreground)]">
                    {t('subscriptions.noLinkedMonitors')}
                  </p>
                ) : (
                  <ul className="space-y-1.5">
                    {linkedMonitors.map((monitor) => (
                      <li key={monitor.id}>
                        <Link
                          to={`/monitors/${monitor.id}`}
                          className="text-sm font-medium text-[var(--brand)] hover:underline"
                        >
                          {monitor.name}
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>{t('subscriptions.notes')}</CardTitle>
              </CardHeader>
              <CardContent>
                {subscription.notes ? (
                  <p className="whitespace-pre-wrap break-words text-sm">{subscription.notes}</p>
                ) : (
                  <p className="text-sm text-[var(--muted-foreground)]">{t('subscriptions.noNotes')}</p>
                )}
              </CardContent>
            </Card>
          </aside>
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
        onOpenChange={(open) => !open && setRenewTarget(null)}
        target={renewTarget}
      />
    </div>
  );
}
