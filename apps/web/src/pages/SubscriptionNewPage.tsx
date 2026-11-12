import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { ArrowLeft, CreditCard } from 'lucide-react';
import {
  DEFAULT_REMINDER_OFFSETS,
  subscriptionInputSchema,
  type TemplateDto,
  type TemplateRenderResultDto,
} from '@subwatch/shared';
import { api } from '../lib/api';
import { applyZodIssues } from '../lib/form';
import { applySubscriptionTemplatePayload } from '../lib/templates';
import {
  blankSubscriptionFormValues,
  subscriptionFormToInput,
  type SubscriptionFormValues,
} from '../lib/subscriptions';
import { errorMessage } from '../lib/utils';
import { useAuth } from '../providers/AuthProvider';
import { Button, Card, ErrorState, PageHeader } from '../components/ui';
import { SubscriptionFormFields } from '../components/subscriptions/SubscriptionFormFields';
import { TemplateApplyCard } from '../components/templates/TemplateApplyCard';
import { TemplatePendingCard } from '../components/templates/TemplatePendingCard';

/** Create a simple reminder subscription: name + date + optional link/notes. */
export function SubscriptionNewPage() {
  const { t } = useTranslation();
  const { timezone, settings } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const defaultOffsets = settings?.general.defaultReminderOffsets ?? [...DEFAULT_REMINDER_OFFSETS];

  const channelsQuery = useQuery({ queryKey: ['channels'], queryFn: () => api.channels.list() });

  const form = useForm<SubscriptionFormValues>({
    defaultValues: blankSubscriptionFormValues(timezone, defaultOffsets),
  });

  const [appliedTemplate, setAppliedTemplate] = useState<TemplateDto | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const pendingTemplate = selectedTemplateId !== null && appliedTemplate === null;

  const handleApplyTemplate = (template: TemplateDto, result: TemplateRenderResultDto) => {
    if (result.kind !== 'subscription') return;
    form.reset({
      ...applySubscriptionTemplatePayload(form.getValues(), result.payload),
      templateId: template.id,
      fieldDefs: template.fields.map((field) => ({ ...field })),
      fields: { ...result.values },
    });
    setAppliedTemplate(template);
  };

  const handleClearTemplate = () => {
    form.reset(
      blankSubscriptionFormValues(
        timezone,
        settings?.general.defaultReminderOffsets ?? [...DEFAULT_REMINDER_OFFSETS],
      ),
    );
    setAppliedTemplate(null);
  };

  // Settings load asynchronously; apply the server-side default offsets once they
  // arrive unless the user already started editing.
  useEffect(() => {
    if (!settings || form.formState.isDirty || appliedTemplate) return;
    form.reset(blankSubscriptionFormValues(timezone, settings.general.defaultReminderOffsets));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings, timezone, appliedTemplate]);

  const createMutation = useMutation({
    mutationFn: (input: Parameters<typeof api.subscriptions.create>[0]) =>
      api.subscriptions.create(input),
    onSuccess: (subscription) => {
      toast.success(t('subscriptions.createSuccess'));
      void queryClient.invalidateQueries({ queryKey: ['subscriptions'] });
      navigate(`/subscriptions/${subscription.id}`);
    },
    onError: (error) => toast.error(t('errors.saveFailed'), { description: errorMessage(error) }),
  });

  const onSubmit = form.handleSubmit((values) => {
    const parsed = subscriptionInputSchema.safeParse(subscriptionFormToInput(values));
    if (!parsed.success) {
      applyZodIssues(form, parsed.error);
      toast.error(t('errors.validation'));
      return;
    }
    createMutation.mutate(parsed.data);
  });

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title={t('subscriptions.newSubscription')}
        icon={<CreditCard className="h-5 w-5" />}
        actions={
          <Button variant="outline" size="sm" onClick={() => navigate('/')}>
            <ArrowLeft className="h-4 w-4" aria-hidden />
            {t('common.back')}
          </Button>
        }
      />

      <div className="mb-4">
        <TemplateApplyCard
          kind="subscription"
          appliedTemplate={appliedTemplate}
          onApply={handleApplyTemplate}
          onClear={handleClearTemplate}
          onSelectionChange={setSelectedTemplateId}
        />
      </div>

      {pendingTemplate ? (
        <TemplatePendingCard kind="subscription" />
      ) : channelsQuery.isError ? (
        <ErrorState error={channelsQuery.error} onRetry={() => void channelsQuery.refetch()} />
      ) : (
        <>
          {appliedTemplate ? (
            <p className="mb-3 text-sm text-[var(--muted-foreground)]">
              {t('templates.apply.prefilledHint')}
            </p>
          ) : null}
          <form
            onSubmit={(event) => {
              void onSubmit(event);
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
              <Button type="button" variant="outline" onClick={() => navigate('/')}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" loading={createMutation.isPending}>
                {createMutation.isPending ? t('subscriptionForm.submitting') : t('subscriptionForm.submit')}
              </Button>
            </Card>
          </form>
        </>
      )}
    </div>
  );
}
