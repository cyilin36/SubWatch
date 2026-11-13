import { useTranslation } from 'react-i18next';
import { Controller, type UseFormReturn } from 'react-hook-form';
import type { ChannelDto } from '@subwatch/shared';
import { Button, Field, Input, Select, Textarea } from '../ui';
import { FormSection, MultiCheckbox, OffsetsInput } from '../common/fields';
import { TemplateFields } from '../templates/TemplateFields';
import { CYCLE_OPTIONS } from '../../lib/presets';
import { getFieldError } from '../../lib/form';
import { addMonthsToDate, todayInZone } from '../../lib/utils';
import type { SubscriptionFormValues } from '../../lib/subscriptions';

export interface SubscriptionFormFieldsProps {
  form: UseFormReturn<SubscriptionFormValues>;
  channels: ChannelDto[];
  timezone: string;
}

const QUICK_MONTHS = [1, 3, 6, 12] as const;

/**
 * The complete subscription form body. Deliberately tiny: name, expiry date and
 * minute-precise expiry time, optional link, renewal cycle, reminder offsets,
 * channels and notes. There is no template picker, no custom fields, no
 * amount/currency.
 */
export function SubscriptionFormFields({ form, channels, timezone }: SubscriptionFormFieldsProps) {
  const { t } = useTranslation();
  const { register, watch, setValue, formState } = form;
  const errors = formState.errors;

  const cycle = watch('cycle') ?? 'month';
  const reminderOffsets = watch('reminderOffsets') ?? [];
  const selectedChannels = watch('channelIds') ?? [];
  const templateFieldDefs = watch('fieldDefs') ?? [];
  const templateFieldValues = watch('fields') ?? {};

  const setQuickDate = (months: number) => {
    setValue('expiryDate', addMonthsToDate(todayInZone(timezone), months), { shouldDirty: true });
  };

  const channelItems = channels.map((channel) => ({
    value: channel.id,
    label: channel.name,
    description: t(`channels.${channel.type}`),
  }));

  return (
    <div className="space-y-6">
      <FormSection title={t('subscriptionForm.basicInfo')}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label={t('common.name')}
            htmlFor="subscription-name"
            error={getFieldError(errors, 'name')}
            className="sm:col-span-2"
            required
          >
            <Input
              id="subscription-name"
              placeholder={t('subscriptionForm.namePlaceholder')}
              invalid={Boolean(getFieldError(errors, 'name'))}
              autoComplete="off"
              {...register('name')}
            />
          </Field>

          <Field
            label={t('subscriptionForm.expiryDate')}
            htmlFor="subscription-expiry"
            error={getFieldError(errors, 'expiryDate')}
            required
          >
            <Input
              id="subscription-expiry"
              type="date"
              invalid={Boolean(getFieldError(errors, 'expiryDate'))}
              {...register('expiryDate')}
            />
          </Field>

          <Field
            label={t('subscriptionForm.expiryTime')}
            htmlFor="subscription-expiry-time"
            hint={t('subscriptionForm.timeHint')}
            error={getFieldError(errors, 'expiryTime')}
            required
          >
            <Input
              id="subscription-expiry-time"
              type="time"
              step={60}
              invalid={Boolean(getFieldError(errors, 'expiryTime'))}
              {...register('expiryTime')}
            />
          </Field>

          <div className="sm:col-span-2">
            <div className="glass-flat flex flex-wrap items-center gap-2 px-4 py-3">
              <span className="type-label mr-1">{t('subscriptionForm.quickAdd')}</span>
              {QUICK_MONTHS.map((months) => (
                <Button
                  key={months}
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setQuickDate(months)}
                >
                  {t(`subscriptionForm.quickMonths.${months}`)}
                </Button>
              ))}
            </div>
          </div>

          <Field
            label={t('subscriptionForm.link')}
            htmlFor="subscription-url"
            hint={t('subscriptionForm.linkHint')}
            error={getFieldError(errors, 'url')}
            className="sm:col-span-2"
          >
            <Input
              id="subscription-url"
              type="url"
              placeholder="https://"
              invalid={Boolean(getFieldError(errors, 'url'))}
              {...register('url')}
            />
          </Field>

          <Field
            label={t('subscriptionForm.cycle')}
            hint={t('subscriptionForm.cycleHint')}
            error={getFieldError(errors, 'cycle')}
          >
            <Select
              value={cycle}
              onValueChange={(value) =>
                setValue('cycle', value as SubscriptionFormValues['cycle'], { shouldDirty: true })
              }
              options={CYCLE_OPTIONS.map((option) => ({ value: option.value, label: t(option.labelKey) }))}
            />
          </Field>
        </div>
      </FormSection>

      {templateFieldDefs.length > 0 ? (
        <FormSection
          title={t('subscriptionForm.fieldsTitle')}
          description={t('subscriptionForm.fieldsHint')}
        >
          <TemplateFields
            fields={templateFieldDefs}
            values={templateFieldValues}
            idPrefix="subscription-fields"
            onChange={(key, value) =>
              setValue('fields', { ...templateFieldValues, [key]: value }, { shouldDirty: true })
            }
          />
        </FormSection>
      ) : null}

      <FormSection
        title={t('subscriptionForm.reminders')}
        description={t('subscriptionForm.reminderOffsetsHint')}
      >
        <Field label={t('subscriptionForm.reminderOffsets')} error={getFieldError(errors, 'reminderOffsets')}>
          <Controller
            control={form.control}
            name="reminderOffsets"
            render={({ field }) => <OffsetsInput value={field.value ?? []} onChange={field.onChange} />}
          />
        </Field>
        <div>
          <p className="type-label mb-2">{t('subscriptionForm.channels')}</p>
          <MultiCheckbox
            items={channelItems}
            value={selectedChannels}
            onChange={(next) => setValue('channelIds', next, { shouldDirty: true })}
            emptyText={t('channels.noChannelsHint')}
          />
          <p className="mt-2 text-xs text-moon-steel">{t('subscriptionForm.channelsHint')}</p>
        </div>
      </FormSection>

      <FormSection title={t('subscriptionForm.notes')}>
        <Field error={getFieldError(errors, 'notes')}>
          <Textarea
            rows={2}
            placeholder={t('subscriptionForm.notesPlaceholder')}
            {...register('notes')}
          />
        </Field>
      </FormSection>
    </div>
  );
}
