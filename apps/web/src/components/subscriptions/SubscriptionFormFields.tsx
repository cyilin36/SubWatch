import { useTranslation } from 'react-i18next';
import { Controller, type Path, type UseFormReturn } from 'react-hook-form';
import type { z } from 'zod';
import {
  SECRET_KEEP,
  subscriptionInputSchema,
  type ChannelDto,
  type MonitorDto,
  type SubscriptionDto,
  type TemplateDto,
  type TemplateField,
} from '@subwatch/shared';
import {
  Button,
  Field,
  Input,
  SecretInput,
  Select,
  Switch,
  Textarea,
} from '../ui';
import { AmountInput, FormSection, MultiCheckbox, OffsetsInput, Segmented } from '../common/fields';
import { CURRENCY_OPTIONS, CYCLE_OPTIONS } from '../../lib/presets';
import { addMonthsToDate, todayInZone } from '../../lib/utils';
import { getFieldError } from '../../lib/form';

export type SubscriptionFormValues = z.input<typeof subscriptionInputSchema>;

export interface SubscriptionFormFieldsProps {
  form: UseFormReturn<SubscriptionFormValues>;
  templates: TemplateDto[];
  channels: ChannelDto[];
  monitors: MonitorDto[];
  timezone: string;
  locale: string;
  /** Show a template selector in the basic section (used by the edit view). */
  showTemplateSelect?: boolean;
}

function templateFieldDefaults(template: TemplateDto | undefined): Record<string, string | number | boolean | null> {
  const values: Record<string, string | number | boolean | null> = {};
  for (const field of template?.fields ?? []) {
    if (field.defaultValue !== undefined) {
      values[field.key] = field.defaultValue as string | number | boolean;
    } else {
      values[field.key] = field.type === 'switch' ? false : '';
    }
  }
  return values;
}

/** Default form values for a brand-new subscription, optionally from a template. */
export function blankSubscriptionFormValues(
  template: TemplateDto | undefined,
  timezone: string,
  currency: string,
  defaultReminderOffsets: number[],
): SubscriptionFormValues {
  const today = todayInZone(timezone);
  const cycle = template?.defaultCycle ?? 'month';
  return {
    name: template ? template.name : '',
    templateId: template?.id ?? null,
    fields: templateFieldDefaults(template),
    startDate: today,
    expiryDate: addMonthsToDate(today, cycle === 'custom_days' ? 1 : cycleMonthCount(cycle)),
    cycle,
    cycleDays: template?.defaultCycleDays ?? null,
    amountCents: template?.defaultAmountCents ?? null,
    currency: template?.defaultCurrency ?? currency,
    reminderOffsets: template?.defaultReminderOffsets ?? defaultReminderOffsets,
    channelIds: [],
    linkedMonitorIds: [],
    notes: '',
    paused: false,
    archived: false,
  };
}

function cycleMonthCount(cycle: SubscriptionFormValues['cycle']): number {
  switch (cycle) {
    case 'day':
      return 0;
    case 'week':
      return 0;
    case 'quarter':
      return 3;
    case 'year':
      return 12;
    case 'month':
    default:
      return 1;
  }
}

/** Map an existing subscription DTO to form values. */
export function subscriptionToFormValues(
  subscription: SubscriptionDto,
  template: TemplateDto | undefined,
): SubscriptionFormValues {
  return {
    name: subscription.name,
    templateId: subscription.templateId,
    fields: { ...templateFieldDefaults(template), ...(subscription.fields as Record<string, string | number | boolean | null>) },
    startDate: subscription.startDate,
    expiryDate: subscription.expiryDate,
    cycle: subscription.cycle,
    cycleDays: subscription.cycleDays,
    amountCents: subscription.amountCents,
    currency: subscription.currency,
    reminderOffsets: [...subscription.reminderOffsets],
    channelIds: [...subscription.channelIds],
    linkedMonitorIds: [...subscription.linkedMonitorIds],
    notes: subscription.notes,
    paused: subscription.paused,
    archived: subscription.archived,
  };
}

/**
 * Template-defined fields are validated on the server, but required fields are
 * also enforced client-side with a localized message.
 */
export function validateRequiredTemplateFields(
  form: UseFormReturn<SubscriptionFormValues>,
  template: TemplateDto | undefined,
  message: (label: string) => string,
): boolean {
  if (!template) return true;
  let valid = true;
  for (const field of template.fields) {
    if (!field.required) continue;
    const value = form.getValues(`fields.${field.key}` as Path<SubscriptionFormValues>) as unknown;
    if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
      form.setError(`fields.${field.key}` as Path<SubscriptionFormValues>, {
        type: 'required',
        message: message(field.label),
      });
      valid = false;
    }
  }
  return valid;
}

function TemplateFieldInput({
  field,
  form,
}: {
  field: TemplateField;
  form: UseFormReturn<SubscriptionFormValues>;
}) {
  const { t } = useTranslation();
  const name = `fields.${field.key}` as Path<SubscriptionFormValues>;
  const error = getFieldError(form.formState.errors, `fields.${field.key}`);
  const wide = field.type === 'textarea';
  return (
    <Field
      label={field.label}
      required={field.required}
      error={error}
      hint={field.help || undefined}
      className={wide ? 'sm:col-span-2' : undefined}
    >
      <Controller
        control={form.control}
        name={name}
        render={({ field: controllerField }) => {
          const value = controllerField.value;
          switch (field.type) {
            case 'textarea':
              return (
                <Textarea
                  rows={3}
                  value={value === null || value === undefined ? '' : String(value)}
                  onChange={(event) => controllerField.onChange(event.target.value)}
                  placeholder={field.placeholder || undefined}
                />
              );
            case 'select':
              return (
                <Select
                  value={value === null || value === undefined ? undefined : String(value)}
                  onValueChange={(next) => controllerField.onChange(next)}
                  options={field.options.map((option) => ({
                    value: option.value,
                    label: option.label,
                  }))}
                  placeholder={field.placeholder || t('common.selectPlaceholder')}
                />
              );
            case 'switch':
              return (
                <div className="flex h-9 items-center">
                  <Switch
                    checked={Boolean(value)}
                    onCheckedChange={(next) => controllerField.onChange(next)}
                    ariaLabel={field.label}
                  />
                </div>
              );
            case 'number':
              return (
                <Input
                  type="number"
                  step="any"
                  value={value === null || value === undefined ? '' : String(value)}
                  onChange={(event) =>
                    controllerField.onChange(event.target.value === '' ? null : Number(event.target.value))
                  }
                  placeholder={field.placeholder || undefined}
                />
              );
            case 'date':
              return (
                <Input
                  type="date"
                  value={value === null || value === undefined ? '' : String(value)}
                  onChange={(event) => controllerField.onChange(event.target.value)}
                />
              );
            case 'secret':
              return (
                <SecretInput
                  value={value === null || value === undefined ? '' : String(value)}
                  hasStoredValue={value === SECRET_KEEP}
                  onChange={(next) => controllerField.onChange(next)}
                  placeholder={field.placeholder || t('common.secret')}
                  autoComplete="off"
                />
              );
            case 'url':
              return (
                <Input
                  type="url"
                  value={value === null || value === undefined ? '' : String(value)}
                  onChange={(event) => controllerField.onChange(event.target.value)}
                  placeholder={field.placeholder || 'https://'}
                />
              );
            default:
              return (
                <Input
                  value={value === null || value === undefined ? '' : String(value)}
                  onChange={(event) => controllerField.onChange(event.target.value)}
                  placeholder={field.placeholder || undefined}
                />
              );
          }
        }}
      />
    </Field>
  );
}

/** Shared editable body of the create and edit subscription forms. */
export function SubscriptionFormFields({
  form,
  templates,
  channels,
  monitors,
  timezone,
  locale,
  showTemplateSelect = false,
}: SubscriptionFormFieldsProps) {
  const { t } = useTranslation();
  const { register, watch, setValue, getValues, formState } = form;
  const errors = formState.errors;

  const templateId = watch('templateId');
  const template = templates.find((entry) => entry.id === templateId);
  const cycle = watch('cycle') ?? 'month';
  const amountCents = watch('amountCents') ?? null;
  const currency = watch('currency') ?? 'CNY';
  const reminderOffsets = watch('reminderOffsets') ?? [];
  const selectedChannels = watch('channelIds') ?? [];
  const selectedMonitors = watch('linkedMonitorIds') ?? [];
  const paused = watch('paused') ?? false;
  const startDate = watch('startDate') ?? '';
  const today = todayInZone(timezone);

  const applyQuickMonths = (months: number) => {
    const base = startDate && /^\d{4}-\d{2}-\d{2}$/.test(startDate) ? startDate : today;
    setValue('expiryDate', addMonthsToDate(base, months), { shouldDirty: true });
  };

  const channelItems = channels.map((channel) => ({
    value: channel.id,
    label: channel.name,
    description: t(`channels.${channel.type}`),
  }));
  const monitorItems = monitors.map((monitor) => ({
    value: monitor.id,
    label: monitor.name,
    description: monitor.description || t(`monitors.${monitor.type}`),
  }));

  return (
    <div className="space-y-4">
      <FormSection title={t('subscriptionForm.basicInfo')}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('common.name')} error={getFieldError(errors, 'name')} required>
            <Input
              placeholder={template?.name ?? t('subscriptions.name')}
              invalid={Boolean(getFieldError(errors, 'name'))}
              {...register('name')}
            />
          </Field>
          {showTemplateSelect ? (
            <Field label={t('subscriptions.template')}>
              <Select
                value={templateId ?? 'none'}
                onValueChange={(value) => {
                  const nextId = value === 'none' ? null : value;
                  const nextTemplate = templates.find((entry) => entry.id === nextId);
                  setValue('templateId', nextId, { shouldDirty: true });
                  setValue('fields', templateFieldDefaults(nextTemplate), { shouldDirty: true });
                  if (nextTemplate) {
                    setValue('cycle', nextTemplate.defaultCycle, { shouldDirty: true });
                    setValue('cycleDays', nextTemplate.defaultCycleDays, { shouldDirty: true });
                    if (nextTemplate.defaultAmountCents !== null) {
                      setValue('amountCents', nextTemplate.defaultAmountCents, { shouldDirty: true });
                    }
                    setValue('currency', nextTemplate.defaultCurrency, { shouldDirty: true });
                    setValue('reminderOffsets', nextTemplate.defaultReminderOffsets, {
                      shouldDirty: true,
                    });
                  }
                }}
                options={[
                  { value: 'none', label: t('subscriptionForm.blankTemplate') },
                  ...templates.map((entry) => ({ value: entry.id, label: entry.name })),
                ]}
              />
            </Field>
          ) : (
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] px-3 py-2">
              <p className="text-xs text-[var(--muted-foreground)]">{t('subscriptions.template')}</p>
              <p className="mt-0.5 truncate text-sm font-medium">
                {template?.name ?? t('subscriptionForm.blankTemplate')}
              </p>
            </div>
          )}
        </div>
        <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] px-3 py-2">
          <div>
            <p className="text-sm font-medium">{t('subscriptionForm.createPaused')}</p>
            <p className="text-xs text-[var(--muted-foreground)]">{t('subscriptionForm.reminderOffsetsHint')}</p>
          </div>
          <Switch
            checked={paused}
            onCheckedChange={(checked) => setValue('paused', checked, { shouldDirty: true })}
            ariaLabel={t('subscriptionForm.createPaused')}
          />
        </div>
      </FormSection>

      {template && template.fields.length > 0 ? (
        <FormSection
          title={t('subscriptionForm.templateFields')}
          description={t('subscriptionForm.customFieldsHint')}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            {template.fields.map((field) => (
              <TemplateFieldInput key={field.key} field={field} form={form} />
            ))}
          </div>
        </FormSection>
      ) : null}

      <FormSection title={t('subscriptionForm.dates')} description={t('subscriptionForm.dateHint')}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label={t('subscriptionForm.startDate')}
            error={getFieldError(errors, 'startDate')}
            required
          >
            <Input
              type="date"
              invalid={Boolean(getFieldError(errors, 'startDate'))}
              {...register('startDate')}
            />
          </Field>
          <Field
            label={t('subscriptionForm.expiryDate')}
            error={getFieldError(errors, 'expiryDate')}
            required
          >
            <Input
              type="date"
              invalid={Boolean(getFieldError(errors, 'expiryDate'))}
              {...register('expiryDate')}
            />
          </Field>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-[var(--muted-foreground)]">
            {t('subscriptionForm.quickAdd')}:
          </span>
          <Button type="button" variant="outline" size="sm" onClick={() => applyQuickMonths(1)}>
            {t('subscriptionForm.month1')}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => applyQuickMonths(3)}>
            {t('subscriptionForm.month3')}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => applyQuickMonths(6)}>
            {t('subscriptionForm.month6')}
          </Button>
          <Button type="button" variant="outline" size="sm" onClick={() => applyQuickMonths(12)}>
            {t('subscriptionForm.month12')}
          </Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('subscriptionForm.cycle')} error={getFieldError(errors, 'cycle')}>
            <Select
              value={cycle}
              onValueChange={(value) =>
                setValue('cycle', value as SubscriptionFormValues['cycle'], { shouldDirty: true })
              }
              options={CYCLE_OPTIONS.map((option) => ({ value: option.value, label: t(option.labelKey) }))}
            />
          </Field>
          {cycle === 'custom_days' ? (
            <Field
              label={t('subscriptionForm.cycleDays')}
              error={getFieldError(errors, 'cycleDays')}
              required
            >
              <Input type="number" min={1} {...register('cycleDays', { valueAsNumber: true })} />
            </Field>
          ) : null}
        </div>
      </FormSection>

      <FormSection title={t('common.amount')}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('subscriptionForm.amount')} error={getFieldError(errors, 'amountCents')}>
            <Controller
              control={form.control}
              name="amountCents"
              render={({ field }) => (
                <AmountInput
                  value={field.value ?? null}
                  onChange={field.onChange}
                  currency={currency}
                  placeholder={t('subscriptionForm.amountPlaceholder')}
                />
              )}
            />
          </Field>
          <Field label={t('subscriptionForm.currency')} error={getFieldError(errors, 'currency')}>
            <Select
              value={currency}
              onValueChange={(value) => setValue('currency', value, { shouldDirty: true })}
              options={CURRENCY_OPTIONS.map((code) => ({ value: code, label: code }))}
            />
          </Field>
        </div>
      </FormSection>

      <FormSection
        title={t('subscriptionForm.reminderOffsets')}
        description={t('subscriptionForm.reminderOffsetsHint')}
      >
        <Field label={t('settings.defaultReminderOffsets')}>
          <Controller
            control={form.control}
            name="reminderOffsets"
            render={({ field }) => (
              <OffsetsInput value={field.value ?? []} onChange={field.onChange} />
            )}
          />
        </Field>
        <div>
          <p className="mb-1.5 text-sm font-medium">{t('subscriptionForm.channels')}</p>
          <MultiCheckbox
            items={channelItems}
            value={selectedChannels}
            onChange={(next) => setValue('channelIds', next, { shouldDirty: true })}
            emptyText={t('channels.noChannelsHint')}
          />
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">
            {t('subscriptionForm.channelsHint')}
          </p>
        </div>
      </FormSection>

      <FormSection title={t('subscriptions.related')}>
        <div>
          <p className="mb-1.5 text-sm font-medium">{t('subscriptionForm.linkedMonitors')}</p>
          <MultiCheckbox
            items={monitorItems}
            value={selectedMonitors}
            onChange={(next) => setValue('linkedMonitorIds', next, { shouldDirty: true })}
            emptyText={t('subscriptionForm.noMonitorOptions')}
          />
          <p className="mt-1 text-xs text-[var(--muted-foreground)]">
            {t('subscriptionForm.linkedMonitorsHint')}
          </p>
        </div>
        <Field label={t('subscriptionForm.notes')} error={getFieldError(errors, 'notes')}>
          <Textarea
            rows={3}
            placeholder={t('subscriptionForm.notesPlaceholder')}
            {...register('notes')}
          />
        </Field>
      </FormSection>

      <p className="text-xs text-[var(--muted-foreground)]">
        {t('settings.timezone')}: {timezone} · {locale}
      </p>
    </div>
  );
}

export { Segmented };
