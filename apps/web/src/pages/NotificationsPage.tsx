import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { toast } from 'sonner';
import { BellRing, Eye, RefreshCcw } from 'lucide-react';
import {
  EVENT_TYPES,
  NOTIFICATION_STATUS_VALUES,
  type NotificationDto,
} from '@subwatch/shared';
import { api } from '../lib/api';
import { useAuth } from '../providers/AuthProvider';
import { errorMessage, formatDateTime } from '../lib/utils';
import {
  Alert,
  Button,
  Card,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
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
import { JsonPreview, Pagination } from '../components/common/fields';

const PAGE_SIZE = 20;

export function NotificationsPage() {
  const { t } = useTranslation();
  const { timezone, locale } = useAuth();
  const queryClient = useQueryClient();

  const [statusFilter, setStatusFilter] = useState('all');
  const [eventFilter, setEventFilter] = useState('all');
  const [page, setPage] = useState(0);
  const [payloadTarget, setPayloadTarget] = useState<NotificationDto | null>(null);

  const notificationsQuery = useQuery({
    queryKey: ['notifications', statusFilter, eventFilter, page],
    queryFn: () =>
      api.notifications.list({
        status: statusFilter === 'all' ? undefined : statusFilter,
        eventType: eventFilter === 'all' ? undefined : eventFilter,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      }),
    placeholderData: keepPreviousData,
    refetchInterval: 15_000,
  });

  const retryMutation = useMutation({
    mutationFn: (notification: NotificationDto) => api.notifications.retry(notification.id),
    onSuccess: () => {
      toast.success(t('notifications.retrySuccess'));
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
    },
    onError: (error) => toast.error(t('notifications.retryFailed'), { description: errorMessage(error) }),
  });

  const data = notificationsQuery.data;
  const total = data?.total ?? 0;
  const pages = Math.max(Math.ceil(total / PAGE_SIZE), 1);

  const statusOptions = useMemo(
    () => [
      { value: 'all', label: t('notifications.allStatuses') },
      ...NOTIFICATION_STATUS_VALUES.map((status) => ({
        value: status,
        label: t(`status.${status}`),
      })),
    ],
    [t],
  );

  const eventOptions = useMemo(
    () => [
      { value: 'all', label: t('notifications.allEvents') },
      ...EVENT_TYPES.map((eventType) => ({
        value: eventType,
        label: t(`event.${eventType}`),
      })),
    ],
    [t],
  );

  const applyStatus = (value: string) => {
    setStatusFilter(value);
    setPage(0);
  };
  const applyEvent = (value: string) => {
    setEventFilter(value);
    setPage(0);
  };

  const items = data?.items ?? [];
  const filtersActive = statusFilter !== 'all' || eventFilter !== 'all';

  return (
    <div className="space-y-8">
      <PageHeader
        title={t('notifications.title')}
        description={t('notifications.subtitle')}
        icon={<BellRing className="h-5 w-5" />}
      />

      <section className="space-y-4">
        <div className="glass-flat grid gap-3 rounded-btn p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end sm:p-4">
          <Field label={t('notifications.filterStatus')}>
            <Select
              value={statusFilter}
              onValueChange={applyStatus}
              options={statusOptions}
              ariaLabel={t('notifications.filterStatus')}
            />
          </Field>
          <Field label={t('notifications.filterEvent')}>
            <Select
              value={eventFilter}
              onValueChange={applyEvent}
              options={eventOptions}
              ariaLabel={t('notifications.filterEvent')}
            />
          </Field>
          <Button
            variant="outline"
            size="md"
            className="w-full sm:w-auto"
            loading={notificationsQuery.isFetching}
            onClick={() => void notificationsQuery.refetch()}
          >
            {!notificationsQuery.isFetching ? <RefreshCcw className="h-4 w-4" aria-hidden /> : null}
            {t('common.refresh')}
          </Button>
        </div>

        {notificationsQuery.isPending ? (
          <Card className="p-4 sm:p-5">
            <div className="space-y-3">
              {Array.from({ length: 6 }).map((_, index) => (
                <Skeleton key={index} className="h-12 rounded-btn" />
              ))}
            </div>
          </Card>
        ) : notificationsQuery.isError ? (
          <ErrorState error={notificationsQuery.error} onRetry={() => void notificationsQuery.refetch()} />
        ) : items.length === 0 ? (
          <EmptyState
            icon={<BellRing className="h-8 w-8" aria-hidden />}
            title={filtersActive ? t('notifications.emptyFilter') : t('notifications.noNotifications')}
            description={
              filtersActive
                ? t('notifications.emptyFilterHint')
                : t('notifications.noNotificationsHint')
            }
          />
        ) : (
          <>
            {/* Mobile: stacked glass rows; the wide table is desktop-only. */}
            <div className="space-y-3 md:hidden">
              {items.map((notification) => {
                const retrying =
                  retryMutation.isPending && retryMutation.variables?.id === notification.id;
                return (
                  <div key={notification.id} className="glass p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-body font-medium text-ink">
                          {t(`event.${notification.eventType}`)}
                        </p>
                        <p className="mt-0.5 truncate text-xs text-moonlight">
                          {notification.eventKey}
                        </p>
                      </div>
                      <StatusBadge status={notification.status} />
                    </div>
                    <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
                      <div className="min-w-0">
                        <dt className="type-label">{t('notifications.createdAt')}</dt>
                        <dd className="mt-1 text-xs text-moonlight">
                          {formatDateTime(notification.createdAt, timezone, locale)}
                        </dd>
                      </div>
                      <div className="min-w-0">
                        <dt className="type-label">{t('notifications.channel')}</dt>
                        <dd className="mt-1 truncate text-xs text-moonlight">
                          {notification.channelName ?? t('notifications.noChannel')}
                        </dd>
                      </div>
                      {notification.lastError ? (
                        <div className="col-span-2 min-w-0">
                          <dt className="type-label">{t('notifications.lastError')}</dt>
                          <dd className="mt-1 break-words text-xs text-danger">
                            {notification.lastError}
                          </dd>
                        </div>
                      ) : null}
                    </dl>
                    <div className="mt-4 flex items-center justify-end gap-2">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        title={t('notifications.preview')}
                        aria-label={t('notifications.preview')}
                        onClick={() => setPayloadTarget(notification)}
                      >
                        <Eye className="h-4 w-4" aria-hidden />
                      </Button>
                      {notification.status === 'failed' ? (
                        <Button
                          variant="outline"
                          size="sm"
                          loading={retrying}
                          disabled={retrying}
                          onClick={() => retryMutation.mutate(notification)}
                        >
                          {t('notifications.retry')}
                        </Button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>

            <Card className="hidden overflow-hidden md:block">
              <Table>
                <THead>
                  <TR>
                    <TH>{t('notifications.createdAt')}</TH>
                    <TH>{t('notifications.eventType')}</TH>
                    <TH className="hidden md:table-cell">{t('notifications.channel')}</TH>
                    <TH>{t('notifications.status')}</TH>
                    <TH className="hidden sm:table-cell">{t('notifications.attempts')}</TH>
                    <TH className="hidden lg:table-cell">{t('notifications.lastError')}</TH>
                    <TH className="text-right">{t('common.actions')}</TH>
                  </TR>
                </THead>
                <TBody>
                  {items.map((notification) => {
                    const retrying =
                      retryMutation.isPending &&
                      retryMutation.variables?.id === notification.id;
                    return (
                      <TR key={notification.id}>
                        <TD className="whitespace-nowrap text-xs text-moonlight">
                          {formatDateTime(notification.createdAt, timezone, locale)}
                        </TD>
                        <TD>
                          <p className="text-body text-ink">{t(`event.${notification.eventType}`)}</p>
                          <p className="max-w-[220px] truncate text-xs text-moonlight">
                            {notification.eventKey}
                          </p>
                        </TD>
                        <TD className="hidden md:table-cell">
                          <span className="text-body text-moonlight">
                            {notification.channelName ?? t('notifications.noChannel')}
                          </span>
                        </TD>
                        <TD>
                          <StatusBadge status={notification.status} />
                        </TD>
                        <TD className="hidden tabular-nums sm:table-cell">{notification.attempts}</TD>
                        <TD className="hidden max-w-[240px] lg:table-cell">
                          <p
                            className="truncate text-xs text-danger"
                            title={notification.lastError ?? undefined}
                          >
                            {notification.lastError ?? '—'}
                          </p>
                        </TD>
                        <TD>
                          <div className="flex items-center justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              title={t('notifications.preview')}
                              aria-label={t('notifications.preview')}
                              onClick={() => setPayloadTarget(notification)}
                            >
                              <Eye className="h-4 w-4" aria-hidden />
                            </Button>
                            {notification.status === 'failed' ? (
                              <Button
                                variant="outline"
                                size="sm"
                                loading={retrying}
                                disabled={retrying}
                                onClick={() => retryMutation.mutate(notification)}
                              >
                                {t('notifications.retry')}
                              </Button>
                            ) : null}
                          </div>
                        </TD>
                      </TR>
                    );
                  })}
                </TBody>
              </Table>
            </Card>
            <Pagination
              page={page}
              pages={pages}
              total={total}
              onPageChange={setPage}
              disabled={notificationsQuery.isFetching}
            />
          </>
        )}
      </section>

      <Dialog
        open={Boolean(payloadTarget)}
        onOpenChange={(open) => !open && setPayloadTarget(null)}
        title={t('notifications.payload')}
        description={
          payloadTarget ? formatDateTime(payloadTarget.createdAt, timezone, locale) : undefined
        }
        size="lg"
      >
        {payloadTarget ? (
          <div className="space-y-6">
            <dl className="glass-flat grid gap-5 rounded-btn p-4 sm:grid-cols-2 sm:p-5">
              <div className="min-w-0">
                <dt className="type-label">{t('notifications.eventType')}</dt>
                <dd className="mt-2 text-body text-ink">{t(`event.${payloadTarget.eventType}`)}</dd>
              </div>
              <div className="min-w-0">
                <dt className="type-label">{t('notifications.channel')}</dt>
                <dd className="mt-2 break-words text-body text-ink">
                  {payloadTarget.channelName ?? t('notifications.noChannel')}
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="type-label">{t('notifications.status')}</dt>
                <dd className="mt-2">
                  <StatusBadge status={payloadTarget.status} />
                </dd>
              </div>
              <div className="min-w-0">
                <dt className="type-label">{t('notifications.sentAt')}</dt>
                <dd className="mt-2 text-body text-ink">
                  {payloadTarget.sentAt
                    ? formatDateTime(payloadTarget.sentAt, timezone, locale)
                    : t('notifications.notSet')}
                </dd>
              </div>
            </dl>
            {payloadTarget.lastError ? (
              <Alert tone="danger" title={t('notifications.lastError')}>
                <span className="break-words font-mono text-xs">{payloadTarget.lastError}</span>
              </Alert>
            ) : null}
            <JsonPreview value={payloadTarget.payload} />
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}
