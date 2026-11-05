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
  Button,
  Card,
  Dialog,
  EmptyState,
  ErrorState,
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
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
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

  return (
    <div>
      <PageHeader
        title={t('notifications.title')}
        description={t('notifications.subtitle')}
        icon={<BellRing className="h-5 w-5" />}
      />

      <Card className="mb-3 p-3">
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <Select
            value={statusFilter}
            onValueChange={applyStatus}
            options={statusOptions}
            ariaLabel={t('notifications.filterStatus')}
          />
          <Select
            value={eventFilter}
            onValueChange={applyEvent}
            options={eventOptions}
            ariaLabel={t('notifications.filterEvent')}
          />
          <div className="hidden sm:block" />
          <div className="flex justify-end">
            <Button
              variant="outline"
              size="sm"
              loading={notificationsQuery.isFetching}
              onClick={() => void notificationsQuery.refetch()}
            >
              {!notificationsQuery.isFetching ? <RefreshCcw className="h-4 w-4" aria-hidden /> : null}
              {t('common.refresh')}
            </Button>
          </div>
        </div>
      </Card>

      {notificationsQuery.isPending ? (
        <Card className="p-4">
          <div className="space-y-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-10" />
            ))}
          </div>
        </Card>
      ) : notificationsQuery.isError ? (
        <ErrorState error={notificationsQuery.error} onRetry={() => void notificationsQuery.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<BellRing className="h-8 w-8" aria-hidden />}
          title={
            statusFilter !== 'all' || eventFilter !== 'all'
              ? t('notifications.emptyFilter')
              : t('notifications.noNotifications')
          }
          description={
            statusFilter !== 'all' || eventFilter !== 'all'
              ? t('notifications.emptyFilterHint')
              : t('notifications.noNotificationsHint')
          }
        />
      ) : (
        <>
          <Card className="overflow-hidden">
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
                {items.map((notification) => (
                  <TR key={notification.id}>
                    <TD className="whitespace-nowrap text-xs">
                      {formatDateTime(notification.createdAt, timezone, locale)}
                    </TD>
                    <TD>
                      <p className="text-sm">{t(`event.${notification.eventType}`)}</p>
                      <p className="max-w-[220px] truncate text-xs text-[var(--muted-foreground)]">
                        {notification.eventKey}
                      </p>
                    </TD>
                    <TD className="hidden md:table-cell">
                      {notification.channelName ?? t('notifications.noChannel')}
                    </TD>
                    <TD>
                      <StatusBadge status={notification.status} />
                    </TD>
                    <TD className="hidden sm:table-cell">{notification.attempts}</TD>
                    <TD className="hidden max-w-[240px] lg:table-cell">
                      <p
                        className="truncate text-xs text-[var(--danger)]"
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
                            loading={
                              retryMutation.isPending &&
                              retryMutation.variables?.id === notification.id
                            }
                            onClick={() => retryMutation.mutate(notification)}
                          >
                            {t('notifications.retry')}
                          </Button>
                        ) : null}
                      </div>
                    </TD>
                  </TR>
                ))}
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
          <div className="space-y-3">
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <div>
                <dt className="text-xs text-[var(--muted-foreground)]">{t('notifications.eventType')}</dt>
                <dd>{t(`event.${payloadTarget.eventType}`)}</dd>
              </div>
              <div>
                <dt className="text-xs text-[var(--muted-foreground)]">{t('notifications.channel')}</dt>
                <dd>{payloadTarget.channelName ?? t('notifications.noChannel')}</dd>
              </div>
              <div>
                <dt className="text-xs text-[var(--muted-foreground)]">{t('notifications.status')}</dt>
                <dd>
                  <StatusBadge status={payloadTarget.status} />
                </dd>
              </div>
              <div>
                <dt className="text-xs text-[var(--muted-foreground)]">{t('notifications.sentAt')}</dt>
                <dd>{payloadTarget.sentAt ? formatDateTime(payloadTarget.sentAt, timezone, locale) : t('notifications.notSet')}</dd>
              </div>
            </dl>
            {payloadTarget.lastError ? (
              <p className="break-words rounded-lg bg-[color-mix(in_srgb,var(--danger)_10%,transparent)] p-2 text-xs text-[var(--danger)]">
                {payloadTarget.lastError}
              </p>
            ) : null}
            <JsonPreview value={payloadTarget.payload} />
          </div>
        ) : null}
      </Dialog>
    </div>
  );
}
