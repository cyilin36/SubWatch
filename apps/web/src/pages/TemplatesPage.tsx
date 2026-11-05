import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useFieldArray, useForm, type UseFormReturn } from 'react-hook-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowDown, ArrowUp, Copy, LayoutTemplate, Pencil, Plus, Trash2 } from 'lucide-react';
import type { z } from 'zod';
import {
  DEFAULT_CURRENCY,
  DEFAULT_REMINDER_OFFSETS,
  templateFieldSchema,
  templateInputSchema,
  type TemplateDto,
} from '@subwatch/shared';
import { api } from '../lib/api';
import { applyZodIssues, getFieldError } from '../lib/form';
import { errorMessage, formatMoney } from '../lib/utils';
import { useAuth } from '../providers/AuthProvider';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  Input,
  PageHeader,
  Select,
  Skeleton,
  Switch,
  Textarea,
} from '../components/ui';
import { AmountInput, FormSection, MultiCheckbox } from '../components/common/fields';
import { TemplateIcon } from '../components/common/icons';
import { CURRENCY_OPTIONS, CYCLE_OPTIONS } from '../lib/presets';

type TemplateFormValues = z.input<typeof templateInputSchema>;
type TemplateFieldInput = z.input<typeof templateFieldSchema>;

const FIELD_TYPE_OPTIONS = [
  'text',
  'textarea',
  'number',
  'date',
  'url',
  'select',
  'switch',
  'secret',
] as const;

function blankTemplateForm(currency: string, offsets: number[]): TemplateFormValues {
  return {
    name: '',
    description: '',
    icon: '',
    color: '',
    category: '',
    fields: [],
    defaultCycle: 'month',
    defaultCycleDays: null,
    defaultAmountCents: null,
    defaultCurrency: currency,
    defaultReminderOffsets: offsets,
  };
}

function templateToForm(template: TemplateDto): TemplateFormValues {
  return {
    name: template.name,
    description: template.description,
    icon: template.icon,
    color: template.color,
    category: template.category,
    fields: template.fields.map((field) => ({
      ...field,
      options: field.options.map((option) => ({ ...option })),
    })),
    defaultCycle: template.defaultCycle,
    defaultCycleDays: template.defaultCycleDays,
    defaultAmountCents: template.defaultAmountCents,
    defaultCurrency: template.defaultCurrency,
    defaultReminderOffsets: [...template.defaultReminderOffsets],
  };
}

function TemplateFieldEditor({
  form,
  index,
  total,
  onRemove,
  onMoveUp,
  onMoveDown,
}: {
  form: UseFormReturn<TemplateFormValues>;
  index: number;
  total: number;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const { t } = useTranslation();
  const { control, register, watch, setValue, formState } = form;
  const errors = formState.errors;
  const optionsArray = useFieldArray({ control, name: `fields.${index}.options` });
  const type = watch(`fields.${index}.type`);
  const required = watch(`fields.${index}.required`) ?? false;
  const error = (path: string) => getFieldError(errors, `fields.${index}.${path}`);

  return (
    <div className="space-y-3 rounded-lg border border-[var(--border)] p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-medium">
          {t('templates.fields')} #{index + 1}
        </p>
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={index === 0}
            aria-label={t('common.moveUp')}
            onClick={onMoveUp}
          >
            <ArrowUp className="h-4 w-4" aria-hidden />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            disabled={index === total - 1}
            aria-label={t('common.moveDown')}
            onClick={onMoveDown}
          >
            <ArrowDown className="h-4 w-4" aria-hidden />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            className="text-[var(--danger)]"
            aria-label={t('common.remove')}
            onClick={onRemove}
          >
            <Trash2 className="h-4 w-4" aria-hidden />
          </Button>
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <Field label={t('templates.fieldKey')} error={error('key')} hint={t('templates.fieldKeyHint')} required>
          <Input
            placeholder="account_id"
            invalid={Boolean(error('key'))}
            {...register(`fields.${index}.key`)}
          />
        </Field>
        <Field label={t('templates.fieldLabel')} error={error('label')} required>
          <Input
            placeholder={t('templates.fieldLabel')}
            invalid={Boolean(error('label'))}
            {...register(`fields.${index}.label`)}
          />
        </Field>
        <Field label={t('templates.fieldType')}>
          <Select
            value={type}
            onValueChange={(value) =>
              setValue(`fields.${index}.type`, value as TemplateFieldInput['type'], {
                shouldDirty: true,
              })
            }
            options={FIELD_TYPE_OPTIONS.map((option) => ({
              value: option,
              label: t(`fieldType.${option}`),
            }))}
          />
        </Field>
        <Field label={t('templates.fieldPlaceholder')}>
          <Input placeholder={t('templates.fieldPlaceholder')} {...register(`fields.${index}.placeholder`)} />
        </Field>
        <Field label={t('templates.fieldHelp')}>
          <Input placeholder={t('templates.fieldHelp')} {...register(`fields.${index}.help`)} />
        </Field>
        <div className="flex items-end gap-3">
          <label className="flex h-9 items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4 accent-[var(--brand)]" {...register(`fields.${index}.required`)} />
            {t('templates.fieldRequired')}
          </label>
          <div className="flex-1">
            <Field label={t('templates.fieldDefault')}>
              <Input
                placeholder={t('templates.defaultValueHint')}
                {...register(`fields.${index}.defaultValue`)}
              />
            </Field>
          </div>
        </div>
      </div>

      {type === 'select' ? (
        <div className="space-y-2 rounded-lg bg-[var(--surface-muted)] p-2.5">
          <div className="flex items-center justify-between">
            <p className="text-xs font-medium">{t('templates.fieldOptions')}</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => optionsArray.append({ label: '', value: '' })}
            >
              <Plus className="h-3.5 w-3.5" aria-hidden />
              {t('templates.addOption')}
            </Button>
          </div>
          {error('options') ? (
            <p className="text-xs text-[var(--danger)]">{error('options')}</p>
          ) : null}
          {optionsArray.fields.map((option, optionIndex) => (
            <div key={option.id} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
              <Input
                placeholder={t('templates.optionLabel')}
                aria-label={t('templates.optionLabel')}
                {...register(`fields.${index}.options.${optionIndex}.label`)}
              />
              <Input
                placeholder={t('templates.optionValue')}
                aria-label={t('templates.optionValue')}
                {...register(`fields.${index}.options.${optionIndex}.value`)}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={t('common.remove')}
                onClick={() => optionsArray.remove(optionIndex)}
              >
                <Trash2 className="h-4 w-4" aria-hidden />
              </Button>
            </div>
          ))}
          <p className="text-xs text-[var(--muted-foreground)]">{t('templates.optionsRequired')}</p>
          <p className="text-xs text-[var(--muted-foreground)]">
            {t('templates.fieldRequired')}: {required ? t('common.yes') : t('common.no')}
          </p>
        </div>
      ) : null}
    </div>
  );
}

function TemplateDialog({
  open,
  onOpenChange,
  template,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template: TemplateDto | null;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { settings } = useAuth();
  const currency = settings?.general.currency ?? DEFAULT_CURRENCY;
  const offsets = settings?.general.defaultReminderOffsets ?? [...DEFAULT_REMINDER_OFFSETS];

  const form = useForm<TemplateFormValues>({
    defaultValues: template ? templateToForm(template) : blankTemplateForm(currency, offsets),
  });
  const fieldsArray = useFieldArray({ control: form.control, name: 'fields' });

  useEffect(() => {
    if (!open) return;
    form.reset(template ? templateToForm(template) : blankTemplateForm(currency, offsets));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, template]);

  const amountCents = form.watch('defaultAmountCents') ?? null;
  const defaultCurrency = form.watch('defaultCurrency') ?? currency;

  const saveMutation = useMutation({
    mutationFn: (values: z.infer<typeof templateInputSchema>) =>
      template ? api.templates.update(template.id, values) : api.templates.create(values),
    onSuccess: () => {
      toast.success(template ? t('templates.updateSuccess') : t('templates.createSuccess'));
      void queryClient.invalidateQueries({ queryKey: ['templates'] });
      onOpenChange(false);
    },
    onError: (error) => toast.error(t('errors.saveFailed'), { description: errorMessage(error) }),
  });

  const onSubmit = form.handleSubmit((values) => {
    const parsed = templateInputSchema.safeParse(values);
    if (!parsed.success) {
      applyZodIssues(form, parsed.error);
      toast.error(t('errors.validation'));
      return;
    }
    saveMutation.mutate(parsed.data);
  });

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={template ? t('templates.editTemplate') : t('templates.createTemplate')}
      description={t('templates.newTemplateHint')}
      size="xl"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saveMutation.isPending}>
            {t('common.cancel')}
          </Button>
          <Button loading={saveMutation.isPending} type="submit" form="template-form">
            {t('common.save')}
          </Button>
        </>
      }
    >
      <form
        id="template-form"
        className="space-y-4"
        noValidate
        onSubmit={(event) => {
          void onSubmit(event);
        }}
      >
        <FormSection title={t('templates.defaults')}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label={t('templates.name')} error={getFieldError(form.formState.errors, 'name')} required>
              <Input
                placeholder={t('templates.namePlaceholder')}
                invalid={Boolean(getFieldError(form.formState.errors, 'name'))}
                {...form.register('name')}
              />
            </Field>
            <Field label={t('templates.category')}>
              <Input placeholder={t('templates.categoryPlaceholder')} {...form.register('category')} />
            </Field>
            <Field label={t('templates.icon')} hint={t('templates.iconHint')}>
              <Input placeholder={t('templates.iconPlaceholder')} {...form.register('icon')} />
            </Field>
            <Field label={t('templates.color')}>
              <Input placeholder={t('templates.colorPlaceholder')} {...form.register('color')} />
            </Field>
            <Field label={t('templates.description')} className="sm:col-span-2">
              <Textarea
                rows={2}
                placeholder={t('templates.descriptionPlaceholder')}
                {...form.register('description')}
              />
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label={t('templates.defaultCycle')}>
              <Select
                value={form.watch('defaultCycle')}
                onValueChange={(value) =>
                  form.setValue('defaultCycle', value as TemplateFormValues['defaultCycle'], {
                    shouldDirty: true,
                  })
                }
                options={CYCLE_OPTIONS.map((option) => ({ value: option.value, label: t(option.labelKey) }))}
              />
            </Field>
            {form.watch('defaultCycle') === 'custom_days' ? (
              <Field
                label={t('templates.defaultCycleDays')}
                error={getFieldError(form.formState.errors, 'defaultCycleDays')}
              >
                <Input
                  type="number"
                  min={1}
                  {...form.register('defaultCycleDays', { valueAsNumber: true })}
                />
              </Field>
            ) : null}
            <Field label={t('templates.defaultAmount')}>
              <AmountInput
                value={amountCents}
                onChange={(cents) =>
                  form.setValue('defaultAmountCents', cents, { shouldDirty: true })
                }
                currency={defaultCurrency}
              />
            </Field>
            <Field label={t('templates.defaultCurrency')}>
              <Select
                value={defaultCurrency}
                onValueChange={(value) => form.setValue('defaultCurrency', value, { shouldDirty: true })}
                options={CURRENCY_OPTIONS.map((code) => ({ value: code, label: code }))}
              />
            </Field>
          </div>
          <Field label={t('templates.defaultReminderOffsets')}>
            <MultiCheckbox
              items={[0, 1, 3, 7, 14, 30].map((offset) => ({
                value: String(offset),
                label: t('common.days', { count: offset }),
              }))}
              value={(form.watch('defaultReminderOffsets') ?? []).map(String)}
              onChange={(next) =>
                form.setValue(
                  'defaultReminderOffsets',
                  next.map(Number).sort((a, b) => b - a),
                  { shouldDirty: true },
                )
              }
              className="sm:grid-cols-3 lg:grid-cols-6"
            />
          </Field>
        </FormSection>

        <FormSection title={t('templates.fields')} description={t('templates.fieldsHint')}>
          <div className="space-y-2">
            {fieldsArray.fields.map((field, index) => (
              <TemplateFieldEditor
                key={field.id}
                form={form}
                index={index}
                total={fieldsArray.fields.length}
                onRemove={() => fieldsArray.remove(index)}
                onMoveUp={() => fieldsArray.move(index, index - 1)}
                onMoveDown={() => fieldsArray.move(index, index + 1)}
              />
            ))}
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              fieldsArray.append({
                key: '',
                label: '',
                type: 'text',
                required: false,
                placeholder: '',
                help: '',
                options: [],
              })
            }
          >
            <Plus className="h-3.5 w-3.5" aria-hidden />
            {t('templates.addField')}
          </Button>
        </FormSection>
      </form>
    </Dialog>
  );
}

export function TemplatesPage() {
  const { t } = useTranslation();
  const { locale } = useAuth();
  const queryClient = useQueryClient();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingTemplate, setEditingTemplate] = useState<TemplateDto | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TemplateDto | null>(null);

  const templatesQuery = useQuery({
    queryKey: ['templates'],
    queryFn: () => api.templates.list(),
    refetchInterval: 15_000,
  });

  const cloneMutation = useMutation({
    mutationFn: (template: TemplateDto) => api.templates.clone(template.id),
    onSuccess: () => {
      toast.success(t('templates.cloneSuccess'));
      void queryClient.invalidateQueries({ queryKey: ['templates'] });
    },
    onError: (error) => toast.error(t('templates.cloneFailed'), { description: errorMessage(error) }),
  });

  const deleteMutation = useMutation({
    mutationFn: (template: TemplateDto) => api.templates.remove(template.id),
    onSuccess: () => {
      toast.success(t('templates.deleteSuccess'));
      setDeleteTarget(null);
      void queryClient.invalidateQueries({ queryKey: ['templates'] });
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const templates = templatesQuery.data ?? [];
  const builtin = useMemo(() => templates.filter((template) => template.isBuiltin), [templates]);
  const custom = useMemo(() => templates.filter((template) => !template.isBuiltin), [templates]);

  const openCreate = () => {
    setEditingTemplate(null);
    setDialogOpen(true);
  };

  const renderCard = (template: TemplateDto) => (
    <Card key={template.id} className="flex flex-col p-4">
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--surface-muted)]">
          <TemplateIcon icon={template.icon} color={template.color} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <p className="truncate text-sm font-semibold">{template.name}</p>
            {template.isBuiltin ? <Badge tone="info">{t('templates.builtinBadge')}</Badge> : null}
            {template.category ? <Badge tone="muted">{template.category}</Badge> : null}
          </div>
          {template.description ? (
            <p className="mt-1 line-clamp-2 text-xs text-[var(--muted-foreground)]">
              {template.description}
            </p>
          ) : null}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-[var(--muted-foreground)]">
        <span>{t(`cycle.${template.defaultCycle}`)}</span>
        <span>·</span>
        <span>
          {template.defaultAmountCents !== null
            ? formatMoney(template.defaultAmountCents, template.defaultCurrency, locale)
            : '—'}
        </span>
        <span>·</span>
        <span>{t('templates.fieldsCount', { count: template.fields.length })}</span>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-1.5 border-t border-[var(--border)] pt-3">
        <Button variant="outline" size="sm" onClick={() => cloneMutation.mutate(template)}>
          <Copy className="h-3.5 w-3.5" aria-hidden />
          {t('templates.clone')}
        </Button>
        {!template.isBuiltin ? (
          <>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setEditingTemplate(template);
                setDialogOpen(true);
              }}
            >
              <Pencil className="h-3.5 w-3.5" aria-hidden />
              {t('common.edit')}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="text-[var(--danger)]"
              onClick={() => setDeleteTarget(template)}
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
              {t('common.delete')}
            </Button>
          </>
        ) : null}
      </div>
    </Card>
  );

  return (
    <div>
      <PageHeader
        title={t('templates.title')}
        description={t('templates.subtitle')}
        icon={<LayoutTemplate className="h-5 w-5" />}
        actions={
          <Button size="sm" onClick={openCreate}>
            <Plus className="h-4 w-4" aria-hidden />
            {t('templates.newTemplate')}
          </Button>
        }
      />

      {templatesQuery.isPending ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, index) => (
            <Skeleton key={index} className="h-40" />
          ))}
        </div>
      ) : templatesQuery.isError ? (
        <ErrorState error={templatesQuery.error} onRetry={() => void templatesQuery.refetch()} />
      ) : (
        <div className="space-y-6">
          <section>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold">{t('templates.builtin')}</h2>
              <p className="text-xs text-[var(--muted-foreground)]">{t('templates.readonly')}</p>
            </div>
            {builtin.length === 0 ? (
              <EmptyState title={t('templates.noTemplates')} />
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{builtin.map(renderCard)}</div>
            )}
          </section>

          <section>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold">{t('templates.custom')}</h2>
            </div>
            {custom.length === 0 ? (
              <EmptyState
                title={t('templates.noCustomTemplates')}
                description={t('templates.noCustomHint')}
                action={
                  <Button size="sm" onClick={openCreate}>
                    <Plus className="h-4 w-4" aria-hidden />
                    {t('templates.newTemplate')}
                  </Button>
                }
              />
            ) : (
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{custom.map(renderCard)}</div>
            )}
          </section>
        </div>
      )}

      <TemplateDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setEditingTemplate(null);
        }}
        template={editingTemplate}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={t('templates.deleteTitle')}
        description={
          deleteTarget
            ? t('templates.deleteDescription', { name: deleteTarget.name })
            : t('common.deleteWarning')
        }
        confirmLabel={t('common.delete')}
        loading={deleteMutation.isPending}
        onConfirm={() => {
          if (deleteTarget) deleteMutation.mutate(deleteTarget);
        }}
      />
    </div>
  );
}
