import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, CreditCard, Plus, Sparkles } from 'lucide-react';
import { DEFAULT_CURRENCY, DEFAULT_REMINDER_OFFSETS, subscriptionInputSchema } from '@subwatch/shared';
import type { TemplateDto } from '@subwatch/shared';
import { api } from '../lib/api';
import { applyZodIssues } from '../lib/form';
import { errorMessage, formatMoney } from '../lib/utils';
import { useAuth } from '../providers/AuthProvider';
import { Button, Card, EmptyState, ErrorState, PageHeader, Skeleton } from '../components/ui';
import { TemplateIcon } from '../components/common/icons';
import {
  SubscriptionFormFields,
  blankSubscriptionFormValues,
  validateRequiredTemplateFields,
  type SubscriptionFormValues,
} from '../components/subscriptions/SubscriptionFormFields';
import { useForm } from 'react-hook-form';

export function SubscriptionNewPage() {
  const { t } = useTranslation();
  const { timezone, locale, settings } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const general = settings?.general;
  const currency = general?.currency ?? DEFAULT_CURRENCY;
  const defaultOffsets = general?.defaultReminderOffsets ?? [...DEFAULT_REMINDER_OFFSETS];

  // undefined = choose template; null = blank subscription; string = template id
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null | undefined>(undefined);

  const templatesQuery = useQuery({ queryKey: ['templates'], queryFn: () => api.templates.list() });
  const channelsQuery = useQuery({ queryKey: ['channels'], queryFn: () => api.channels.list() });
  const monitorsQuery = useQuery({ queryKey: ['monitors'], queryFn: () => api.monitors.list() });

  const templates = templatesQuery.data ?? [];
  const selectedTemplate = useMemo(
    () => (selectedTemplateId ? templates.find((template) => template.id === selectedTemplateId) : undefined),
    [selectedTemplateId, templates],
  );

  const form = useForm<SubscriptionFormValues>({
    defaultValues: blankSubscriptionFormValues(undefined, timezone, currency, defaultOffsets),
  });

  const createMutation = useMutation({
    mutationFn: (input: Parameters<typeof api.subscriptions.create>[0]) =>
      api.subscriptions.create(input),
    onSuccess: (subscription) => {
      toast.success(t('subscriptionForm.createSuccess'));
      void queryClient.invalidateQueries({ queryKey: ['subscriptions'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      navigate(`/subscriptions/${subscription.id}`);
    },
    onError: (error) => toast.error(t('errors.saveFailed'), { description: errorMessage(error) }),
  });

  const chooseTemplate = (template: TemplateDto | null) => {
    setSelectedTemplateId(template ? template.id : null);
    form.reset(blankSubscriptionFormValues(template ?? undefined, timezone, currency, defaultOffsets));
    createMutation.reset();
  };

  const onSubmit = form.handleSubmit((values) => {
    if (!validateRequiredTemplateFields(form, selectedTemplate, (label) =>
      t('subscriptionForm.requiredField', { label }),
    )) {
      toast.error(t('errors.validation'));
      return;
    }
    const parsed = subscriptionInputSchema.safeParse(values);
    if (!parsed.success) {
      applyZodIssues(form, parsed.error);
      toast.error(t('errors.validation'));
      return;
    }
    createMutation.mutate(parsed.data);
  });

  if (selectedTemplateId === undefined) {
    return (
      <div>
        <PageHeader
          title={t('subscriptions.newSubscription')}
          description={t('subscriptionForm.chooseTemplateHint')}
          icon={<CreditCard className="h-5 w-5" />}
          actions={
            <Button variant="outline" size="sm" onClick={() => navigate('/subscriptions')}>
              <ArrowLeft className="h-4 w-4" aria-hidden />
              {t('common.back')}
            </Button>
          }
        />

        {templatesQuery.isPending ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }).map((_, index) => (
              <Skeleton key={index} className="h-28" />
            ))}
          </div>
        ) : templatesQuery.isError ? (
          <ErrorState error={templatesQuery.error} onRetry={() => void templatesQuery.refetch()} />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <button
              type="button"
              onClick={() => chooseTemplate(null)}
              className="flex items-start gap-3 rounded-xl border border-dashed border-[var(--border)] bg-[var(--surface)] p-4 text-left transition-colors hover:border-[var(--brand)] hover:bg-[var(--surface-muted)]"
            >
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--surface-muted)] text-[var(--brand)]">
                <Plus className="h-5 w-5" aria-hidden />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold">{t('subscriptionForm.blankTemplate')}</span>
                <span className="mt-0.5 block text-xs text-[var(--muted-foreground)]">
                  {t('subscriptionForm.blankTemplateHint')}
                </span>
              </span>
            </button>

            {templates.map((template) => (
              <button
                key={template.id}
                type="button"
                onClick={() => chooseTemplate(template)}
                className="flex items-start gap-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-left transition-colors hover:border-[var(--brand)] hover:bg-[var(--surface-muted)]"
              >
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--surface-muted)]">
                  <TemplateIcon icon={template.icon} color={template.color} />
                </span>
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-semibold">{template.name}</span>
                    {template.isBuiltin ? (
                      <span className="shrink-0 rounded-full bg-[var(--surface-muted)] px-1.5 py-0.5 text-[10px] text-[var(--muted-foreground)]">
                        {t('templates.builtin')}
                      </span>
                    ) : null}
                  </span>
                  {template.description ? (
                    <span className="mt-0.5 line-clamp-2 block text-xs text-[var(--muted-foreground)]">
                      {template.description}
                    </span>
                  ) : null}
                  <span className="mt-1 block truncate text-xs text-[var(--muted-foreground)]">
                    {t(`cycle.${template.defaultCycle}`)}
                    {template.defaultAmountCents !== null
                      ? ` · ${formatMoney(template.defaultAmountCents, template.defaultCurrency, locale)}`
                      : ''}
                  </span>
                </span>
              </button>
            ))}

            {templates.length === 0 ? (
              <EmptyState
                className="sm:col-span-2 lg:col-span-3"
                title={t('subscriptionForm.noTemplates')}
                description={t('subscriptionForm.noTemplatesHint')}
                icon={<Sparkles className="h-8 w-8" aria-hidden />}
                action={
                  <Button size="sm" onClick={() => navigate('/templates')}>
                    {t('templates.newTemplate')}
                  </Button>
                }
              />
            ) : null}
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={t('subscriptions.newSubscription')}
        description={t('subscriptionForm.chooseTemplateHint')}
        icon={<CreditCard className="h-5 w-5" />}
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setSelectedTemplateId(undefined);
              form.reset(blankSubscriptionFormValues(undefined, timezone, currency, defaultOffsets));
            }}
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            {t('subscriptionForm.backToTemplates')}
          </Button>
        }
      />

      <div className="mx-auto max-w-3xl">
        <form
          onSubmit={(event) => {
            void onSubmit(event);
          }}
          noValidate
          className="space-y-4"
        >
          <SubscriptionFormFields
            form={form}
            templates={templates}
            channels={channelsQuery.data ?? []}
            monitors={monitorsQuery.data ?? []}
            timezone={timezone}
            locale={locale}
          />

          <Card className="flex flex-wrap items-center justify-end gap-2 p-3">
            <Button type="button" variant="outline" onClick={() => navigate('/subscriptions')}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" loading={createMutation.isPending}>
              {createMutation.isPending ? t('subscriptionForm.submitting') : t('subscriptionForm.submit')}
            </Button>
          </Card>
        </form>
      </div>
    </div>
  );
}
