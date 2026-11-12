import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Controller, useFieldArray, useForm, type Path, type UseFormReturn } from 'react-hook-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Save, Trash2, Wand2 } from 'lucide-react';
import type { z } from 'zod';
import {
  SECRET_KEEP,
  type MonitorDto,
  type MonitorInput,
  type MonitorTestResult,
} from '@subwatch/shared';
import { api } from '../../lib/api';
import { getFieldError } from '../../lib/form';
import { errorMessage } from '../../lib/utils';
import { OPERATOR_OPTIONS } from '../../lib/presets';
import {
  Alert,
  Button,
  Field,
  Input,
  SecretInput,
  Select,
  Switch,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Textarea,
} from '../ui';
import { CodeEditor } from '../ui/CodeEditor';
import { FormSection, MultiCheckbox, RootError, Segmented, TagsInput } from '../common/fields';
import { Collapsible } from './Collapsible';
import { MonitorTestPanel } from './MonitorTestPanel';
import {
  blankMetricRow,
  blankRuleRow,
  buildMonitorInput,
  monitorInputToFormValues,
  monitorToFormValues,
  blankMonitorFormValues,
  tabForFormPath,
  zodPathToFormPath,
  type MonitorFormTab,
  type MonitorFormValues,
} from './monitorFormModel';

const JS_EXAMPLE = `const used = ctx.num(ctx.get(ctx.data, 'usage.used'));
const limit = ctx.num(ctx.get(ctx.data, 'usage.limit'));

return {
  metrics: {
    remaining: {
      value: Math.max(0, 100 - (used / limit) * 100),
      label: 'remaining',
      unit: '%',
    },
  },
  status: 'up',
};
`;

const METRIC_KEYS_DATALIST_ID = 'monitor-metric-keys';

/** Form fields hidden inside the rule's "advanced" disclosure (used to force it open on errors). */
const RULE_ADVANCED_FIELDS = [
  'durationChecks',
  'cooldownSeconds',
  'repeatIntervalSeconds',
  'recoveryOperator',
  'recoveryValue',
  'recoveryChecks',
] as const;

export interface MonitorFormProps {
  mode: 'create' | 'edit';
  monitor?: MonitorDto;
  /** Initial values rendered from a user template (create mode only). */
  initialInput?: MonitorInput;
  /** Template the monitor was created from; only sent in create mode. */
  templateId?: string | null;
  onSaved: (result: MonitorDto & { pushToken?: string }) => void;
}

export function MonitorForm({ mode, monitor, initialInput, templateId, onSaved }: MonitorFormProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<MonitorFormTab>('basic');

  const defaultValues = useMemo(
    () =>
      initialInput
        ? monitorInputToFormValues(initialInput)
        : monitor
          ? monitorToFormValues(monitor)
          : blankMonitorFormValues(),
    [monitor, initialInput],
  );

  const form = useForm<MonitorFormValues>({ defaultValues, mode: 'onSubmit' });
  const {
    control,
    register,
    handleSubmit,
    watch,
    setValue,
    getValues,
    formState: { errors },
  } = form;

  const headersArray = useFieldArray({ control, name: 'request.headers' });
  const queryArray = useFieldArray({ control, name: 'request.query' });
  const metricsArray = useFieldArray({ control, name: 'metrics' });
  const rulesArray = useFieldArray({ control, name: 'rules' });

  const monitorType = watch('type');
  const extractMode = watch('extractMode');
  const bodyType = watch('request.bodyType');
  const authType = watch('request.authType');
  const watchedMetrics = watch('metrics');
  const watchedTags = watch('tags');
  const watchedChannels = watch('channelIds');
  const watchedRules = watch('rules');
  const enabled = watch('enabled');

  // Advanced disclosures start expanded when the loaded monitor already uses
  // any of the hidden options, and pop open when a hidden field fails validation.
  const basicAdvancedHasError = Boolean(
    getFieldError(errors, 'failureThreshold') || getFieldError(errors, 'staleAfterSeconds'),
  );
  const requestAdvancedHasError = Boolean(
    errors.request && Object.keys(errors.request).some((key) => key !== 'url'),
  );

  const initiallyOpenAdvanced = useMemo(() => {
    const request = defaultValues.request;
    return {
      basic:
        defaultValues.description.trim() !== '' ||
        defaultValues.tags.length > 0 ||
        defaultValues.failureThreshold !== '2' ||
        defaultValues.staleAfterSeconds !== '3600',
      request:
        request.headers.length > 0 ||
        request.query.length > 0 ||
        request.bodyType !== 'none' ||
        request.authType !== 'none' ||
        request.timeoutMs !== '10000' ||
        !request.followRedirects ||
        !request.verifyTls ||
        request.maxResponseBytes !== '1048576',
    };
  }, [defaultValues]);

  const channelsQuery = useQuery({
    queryKey: ['channels'],
    queryFn: () => api.channels.list(),
  });

  const applyBuildErrors = (error: z.ZodError): MonitorFormTab => {
    let firstTab: MonitorFormTab = 'basic';
    let found = false;
    for (const issue of error.issues) {
      const mapped = zodPathToFormPath(issue.path as (string | number)[]);
      if (!mapped) continue;
      form.setError(mapped as Path<MonitorFormValues>, {
        type: 'validate',
        message: issue.message,
      });
      if (!found) {
        found = true;
        firstTab = tabForFormPath(mapped);
      }
    }
    if (!found) {
      form.setError('root', { type: 'validate', message: t('errors.validation') });
    }
    return firstTab;
  };

  const saveMutation = useMutation({
    mutationFn: async (input: MonitorInput) =>
      mode === 'create'
        ? api.monitors.create(input)
        : api.monitors.update(monitor?.id ?? '', input),
    onSuccess: (result) => {
      toast.success(mode === 'create' ? t('monitorForm.createSuccess') : t('monitorForm.updateSuccess'));
      void queryClient.invalidateQueries({ queryKey: ['monitors'] });
      if (result.id) {
        void queryClient.invalidateQueries({ queryKey: ['monitor', result.id] });
        void queryClient.invalidateQueries({ queryKey: ['monitor-runs', result.id] });
      }
      onSaved(result as MonitorDto & { pushToken?: string });
    },
    onError: (error) => toast.error(t('monitorForm.saveFailed'), { description: errorMessage(error) }),
  });

  const testMutation = useMutation<MonitorTestResult, unknown, MonitorInput>({
    mutationFn: (input) => api.monitors.test({ config: input.config, rules: input.rules }),
  });

  const onSubmit = handleSubmit((values) => {
    const built = buildMonitorInput(values);
    if (!built.success) {
      setTab(applyBuildErrors(built.error));
      toast.error(t('errors.validation'));
      return;
    }
    // Template provenance is recorded on creation only; edits keep the original.
    saveMutation.mutate(
      mode === 'create' && templateId ? { ...built.input, templateId } : built.input,
    );
  });

  const handleTest = () => {
    const built = buildMonitorInput(getValues());
    if (!built.success) {
      setTab(applyBuildErrors(built.error));
      toast.error(t('errors.validation'));
      return;
    }
    if (built.input.config.type !== 'http') {
      toast.error(t('monitorForm.fillTestUrl'));
      return;
    }
    testMutation.mutate(built.input);
  };

  const metricKeyOptions = (watchedMetrics ?? [])
    .filter((metric) => metric.key.trim() !== '')
    .map((metric) => ({ key: `${metric.key}`, label: metric.label || metric.key }));

  const operatorOptions = OPERATOR_OPTIONS.map((option) => ({
    value: option.value,
    label: t(option.labelKey),
  }));

  const recoveryOperatorOptions = [
    { value: 'none', label: t('common.none') },
    ...operatorOptions,
  ];

  const channelItems = (channelsQuery.data ?? []).map((channel) => ({
    value: channel.id,
    label: channel.name,
    description: t(`channels.${channel.type}`),
  }));

  return (
    <form
      onSubmit={(event) => {
        void onSubmit(event);
      }}
      noValidate
    >
      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0">
          <Tabs value={tab} onValueChange={(value) => setTab(value as MonitorFormTab)}>
            <TabsList>
              <TabsTrigger value="basic">{t('monitorForm.basic')}</TabsTrigger>
              <TabsTrigger value="request" disabled={monitorType === 'push'}>
                {t('monitorForm.request')}
              </TabsTrigger>
              <TabsTrigger value="extract" disabled={monitorType === 'push'}>
                {t('monitorForm.extract')}
              </TabsTrigger>
              <TabsTrigger value="rules">{t('monitorForm.rules')}</TabsTrigger>
            </TabsList>

            <TabsContent value="basic">
              <FormSection title={t('monitorForm.basic')} description={t('monitorForm.basicHint')}>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field
                    label={t('common.name')}
                    htmlFor="monitor-name"
                    error={getFieldError(errors, 'name')}
                    required
                  >
                    <Input
                      id="monitor-name"
                      placeholder={t('monitorForm.namePlaceholder')}
                      invalid={Boolean(getFieldError(errors, 'name'))}
                      {...register('name')}
                    />
                  </Field>
                  <Field label={t('monitors.monitorType')}>
                    <Segmented
                      value={monitorType}
                      onChange={(value) => {
                        setValue('type', value, { shouldDirty: true });
                        if (value === 'push' && (tab === 'request' || tab === 'extract')) setTab('basic');
                      }}
                      options={[
                        { value: 'http', label: t('monitors.http') },
                        { value: 'push', label: t('monitors.push') },
                      ]}
                    />
                  </Field>
                </div>

                {monitorType === 'push' ? <Alert tone="info">{t('monitors.pushHint')}</Alert> : null}

                <div className="grid gap-3 sm:grid-cols-2 sm:items-start">
                  <Field
                    label={t('monitors.intervalSeconds')}
                    htmlFor="monitor-interval"
                    error={getFieldError(errors, 'intervalSeconds')}
                    hint={t('monitorForm.intervalHint')}
                  >
                    <Input
                      id="monitor-interval"
                      type="number"
                      min={30}
                      {...register('intervalSeconds')}
                    />
                  </Field>
                  <div className="flex items-center justify-between gap-3 rounded-lg border border-[var(--border)] px-3 py-2">
                    <div>
                      <p className="text-sm font-medium">{t('common.enabled')}</p>
                      <p className="text-xs text-[var(--muted-foreground)]">
                        {t('monitorDetail.enabledHint')}
                      </p>
                    </div>
                    <Switch
                      checked={enabled}
                      onCheckedChange={(checked) => setValue('enabled', checked, { shouldDirty: true })}
                      ariaLabel={t('common.enabled')}
                    />
                  </div>
                </div>

                <div>
                  <p className="mb-1.5 text-sm font-medium">{t('monitors.channelIds')}</p>
                  <MultiCheckbox
                    items={channelItems}
                    value={watchedChannels ?? []}
                    onChange={(next) => setValue('channelIds', next, { shouldDirty: true })}
                    emptyText={t('channels.noChannelsHint')}
                  />
                  <p className="mt-1 text-xs text-[var(--muted-foreground)]">{t('monitors.channelsHint')}</p>
                </div>

                <Collapsible
                  title={t('common.advanced')}
                  hint={t('common.advancedHint')}
                  defaultOpen={initiallyOpenAdvanced.basic}
                  forceOpen={basicAdvancedHasError}
                >
                  <Field label={t('common.description')} htmlFor="monitor-description">
                    <Textarea
                      id="monitor-description"
                      rows={2}
                      placeholder={t('monitorForm.descriptionPlaceholder')}
                      {...register('description')}
                    />
                  </Field>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field
                      label={t('monitors.failureThreshold')}
                      htmlFor="monitor-failure"
                      error={getFieldError(errors, 'failureThreshold')}
                      hint={t('monitorForm.failureThresholdHint')}
                    >
                      <Input
                        id="monitor-failure"
                        type="number"
                        min={1}
                        max={20}
                        {...register('failureThreshold')}
                      />
                    </Field>
                    <Field
                      label={t('monitors.staleAfterSeconds')}
                      htmlFor="monitor-stale"
                      error={getFieldError(errors, 'staleAfterSeconds')}
                      hint={t('monitorForm.staleAfterHint')}
                    >
                      <Input
                        id="monitor-stale"
                        type="number"
                        min={60}
                        {...register('staleAfterSeconds')}
                      />
                    </Field>
                  </div>

                  <Field label={t('monitors.tags')} hint={t('monitors.tagsHint')}>
                    <TagsInput
                      value={watchedTags ?? []}
                      onChange={(next) => setValue('tags', next, { shouldDirty: true })}
                      placeholder="vps, api, quota"
                    />
                  </Field>
                </Collapsible>
              </FormSection>
            </TabsContent>

            <TabsContent value="request">
              <FormSection title={t('monitorForm.request')} description={t('monitorForm.requestHint')}>
                <div className="grid gap-3 sm:grid-cols-[130px_1fr]">
                  <Field label={t('monitorForm.method')}>
                    <Select
                      value={watch('request.method')}
                      onValueChange={(value) =>
                        setValue('request.method', value as MonitorFormValues['request']['method'], {
                          shouldDirty: true,
                        })
                      }
                      options={['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'].map((method) => ({
                        value: method,
                        label: method,
                      }))}
                    />
                  </Field>
                  <Field
                    label={t('monitorForm.url')}
                    htmlFor="monitor-url"
                    error={getFieldError(errors, 'request.url')}
                    required
                  >
                    <Input
                      id="monitor-url"
                      placeholder={t('monitorForm.urlPlaceholder')}
                      invalid={Boolean(getFieldError(errors, 'request.url'))}
                      {...register('request.url')}
                    />
                  </Field>
                </div>

                <Collapsible
                  title={t('common.advanced')}
                  hint={t('common.advancedHint')}
                  defaultOpen={initiallyOpenAdvanced.request}
                  forceOpen={requestAdvancedHasError}
                >
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Field
                      label={t('monitorForm.timeoutMs')}
                      error={getFieldError(errors, 'request.timeoutMs')}
                    >
                      <Input type="number" min={1000} step={500} {...register('request.timeoutMs')} />
                    </Field>
                    <Field
                      label={t('monitorForm.maxResponseBytes')}
                      error={getFieldError(errors, 'request.maxResponseBytes')}
                    >
                      <Input type="number" min={1024} step={1024} {...register('request.maxResponseBytes')} />
                    </Field>
                    <div className="flex flex-col justify-end gap-2">
                      <div className="flex items-center justify-between gap-2 text-sm">
                        <span>{t('monitorForm.followRedirects')}</span>
                        <Controller
                          control={control}
                          name="request.followRedirects"
                          render={({ field }) => (
                            <Switch checked={field.value} onCheckedChange={field.onChange} />
                          )}
                        />
                      </div>
                      <div className="flex items-center justify-between gap-2 text-sm">
                        <span>{t('monitorForm.verifyTls')}</span>
                        <Controller
                          control={control}
                          name="request.verifyTls"
                          render={({ field }) => (
                            <Switch checked={field.value} onCheckedChange={field.onChange} />
                          )}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Headers */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium">{t('monitorForm.headers')}</p>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => headersArray.append({ key: '', value: '', secret: false })}
                      >
                        <Plus className="h-3.5 w-3.5" aria-hidden />
                        {t('monitorForm.addHeader')}
                      </Button>
                    </div>
                    {headersArray.fields.length === 0 ? (
                      <p className="text-xs text-[var(--muted-foreground)]">{t('common.none')}</p>
                    ) : null}
                    {headersArray.fields.map((field, index) => {
                      const secret = watch(`request.headers.${index}.secret`);
                      const value = watch(`request.headers.${index}.value`) ?? '';
                      return (
                        <div
                          key={field.id}
                          className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_auto_auto] sm:items-center"
                        >
                          <Input
                            placeholder={t('monitorForm.headerKey')}
                            aria-label={t('monitorForm.headerKey')}
                            {...register(`request.headers.${index}.key`)}
                          />
                          {secret ? (
                            <SecretInput
                              value={value}
                              hasStoredValue={value === SECRET_KEEP}
                              onChange={(next) =>
                                setValue(`request.headers.${index}.value`, next, { shouldDirty: true })
                              }
                              placeholder={t('monitorForm.headerValue')}
                            />
                          ) : (
                            <Input
                              placeholder={t('monitorForm.headerValue')}
                              aria-label={t('monitorForm.headerValue')}
                              {...register(`request.headers.${index}.value`)}
                            />
                          )}
                          <label className="flex items-center gap-1.5 whitespace-nowrap text-xs text-[var(--muted-foreground)]">
                            <input
                              type="checkbox"
                              className="h-4 w-4 accent-[var(--brand)]"
                              {...register(`request.headers.${index}.secret`)}
                            />
                            {t('monitorForm.headerSecret')}
                          </label>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label={t('common.remove')}
                            onClick={() => headersArray.remove(index)}
                          >
                            <Trash2 className="h-4 w-4" aria-hidden />
                          </Button>
                        </div>
                      );
                    })}
                  </div>

                  {/* Query params */}
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium">{t('monitorForm.query')}</p>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => queryArray.append({ key: '', value: '' })}
                      >
                        <Plus className="h-3.5 w-3.5" aria-hidden />
                        {t('monitorForm.addQuery')}
                      </Button>
                    </div>
                    {queryArray.fields.length === 0 ? (
                      <p className="text-xs text-[var(--muted-foreground)]">{t('common.none')}</p>
                    ) : null}
                    {queryArray.fields.map((field, index) => (
                      <div
                        key={field.id}
                        className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_auto]"
                      >
                        <Input
                          placeholder={t('monitorForm.queryKey')}
                          aria-label={t('monitorForm.queryKey')}
                          {...register(`request.query.${index}.key`)}
                        />
                        <Input
                          placeholder={t('monitorForm.queryValue')}
                          aria-label={t('monitorForm.queryValue')}
                          {...register(`request.query.${index}.value`)}
                        />
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={t('common.remove')}
                          onClick={() => queryArray.remove(index)}
                        >
                          <Trash2 className="h-4 w-4" aria-hidden />
                        </Button>
                      </div>
                    ))}
                  </div>

                  {/* Body */}
                  <div className="grid gap-3 sm:grid-cols-[180px_1fr] sm:items-start">
                    <Field label={t('monitorForm.bodyType')}>
                      <Select
                        value={bodyType}
                        onValueChange={(value) =>
                          setValue(
                            'request.bodyType',
                            value as MonitorFormValues['request']['bodyType'],
                            { shouldDirty: true },
                          )
                        }
                        options={[
                          { value: 'none', label: t('monitorForm.bodyTypeNone') },
                          { value: 'json', label: t('monitorForm.bodyTypeJson') },
                          { value: 'raw', label: t('monitorForm.bodyTypeRaw') },
                          { value: 'form', label: t('monitorForm.bodyTypeForm') },
                        ]}
                      />
                    </Field>
                    {bodyType !== 'none' ? (
                      <Field label={t('monitorForm.body')}>
                        {bodyType === 'json' ? (
                          <Controller
                            control={control}
                            name="request.body"
                            render={({ field }) => (
                              <CodeEditor
                                value={field.value}
                                onChange={field.onChange}
                                language="json"
                                height="160px"
                                placeholder={t('monitorForm.bodyPlaceholder')}
                              />
                            )}
                          />
                        ) : (
                          <Textarea
                            rows={4}
                            placeholder={t('monitorForm.bodyPlaceholder')}
                            {...register('request.body')}
                          />
                        )}
                      </Field>
                    ) : null}
                  </div>

                  {/* Auth */}
                  <div className="space-y-3">
                    <Field label={t('monitorForm.authType')}>
                      <Select
                        value={authType}
                        onValueChange={(value) =>
                          setValue(
                            'request.authType',
                            value as MonitorFormValues['request']['authType'],
                            { shouldDirty: true },
                          )
                        }
                        options={[
                          { value: 'none', label: t('monitorForm.authNone') },
                          { value: 'basic', label: t('monitorForm.authBasic') },
                          { value: 'bearer', label: t('monitorForm.authBearer') },
                        ]}
                      />
                    </Field>
                    {authType === 'basic' ? (
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Field label={t('monitorForm.username')}>
                          <Input autoComplete="off" {...register('request.username')} />
                        </Field>
                        <Field label={t('monitorForm.password')}>
                          <Controller
                            control={control}
                            name="request.password"
                            render={({ field }) => (
                              <SecretInput
                                value={field.value}
                                hasStoredValue={field.value === SECRET_KEEP}
                                onChange={field.onChange}
                                autoComplete="off"
                              />
                            )}
                          />
                        </Field>
                      </div>
                    ) : null}
                    {authType === 'bearer' ? (
                      <Field label={t('monitorForm.token')}>
                        <Controller
                          control={control}
                          name="request.token"
                          render={({ field }) => (
                            <SecretInput
                              value={field.value}
                              hasStoredValue={field.value === SECRET_KEEP}
                              onChange={field.onChange}
                              autoComplete="off"
                            />
                          )}
                        />
                      </Field>
                    ) : null}
                  </div>
                </Collapsible>
              </FormSection>
            </TabsContent>

            <TabsContent value="extract">
              <FormSection title={t('monitorForm.extract')} description={t('monitorForm.extractHint')}>
                <Segmented
                  value={extractMode}
                  onChange={(value) => setValue('extractMode', value, { shouldDirty: true })}
                  options={[
                    { value: 'json', label: t('monitorForm.modeJson') },
                    { value: 'javascript', label: t('monitorForm.modeJs') },
                  ]}
                />

                {extractMode === 'json' ? (
                  <>
                    <p className="text-xs text-[var(--muted-foreground)]">{t('monitorForm.pathHint')}</p>
                    <datalist id={METRIC_KEYS_DATALIST_ID}>
                      {metricKeyOptions.map((option) => (
                        <option key={option.key} value={option.key}>
                          {option.label}
                        </option>
                      ))}
                    </datalist>
                    <div className="space-y-2">
                      {metricsArray.fields.map((field, index) => (
                        <div key={field.id} className="space-y-2 rounded-lg border border-[var(--border)] p-3">
                          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                            <Field
                              label={t('monitorForm.metricKey')}
                              error={getFieldError(errors, `metrics.${index}.key`)}
                              required
                            >
                              <Input
                                placeholder="remaining"
                                invalid={Boolean(getFieldError(errors, `metrics.${index}.key`))}
                                {...register(`metrics.${index}.key`)}
                              />
                            </Field>
                            <Field label={t('monitorForm.metricLabel')}>
                              <Input placeholder="Remaining quota" {...register(`metrics.${index}.label`)} />
                            </Field>
                            <Field
                              label={t('monitorForm.metricPath')}
                              className="sm:col-span-2"
                              error={getFieldError(errors, `metrics.${index}.path`)}
                              required
                            >
                              <Input
                                placeholder="data.usage.remaining"
                                invalid={Boolean(getFieldError(errors, `metrics.${index}.path`))}
                                {...register(`metrics.${index}.path`)}
                              />
                            </Field>
                          </div>
                          <div className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
                            <Field label={t('monitorForm.metricUnit')}>
                              <Input placeholder="%" {...register(`metrics.${index}.unit`)} />
                            </Field>
                            <Field label={t('monitorForm.metricScale')}>
                              <Input type="number" step="any" {...register(`metrics.${index}.scale`)} />
                            </Field>
                            <Field label={t('monitorForm.metricOffset')}>
                              <Input type="number" step="any" {...register(`metrics.${index}.offset`)} />
                            </Field>
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              aria-label={t('common.remove')}
                              className="text-[var(--danger)]"
                              onClick={() => metricsArray.remove(index)}
                            >
                              <Trash2 className="h-4 w-4" aria-hidden />
                            </Button>
                          </div>
                        </div>
                      ))}
                      {getFieldError(errors, 'metrics') ? (
                        <p className="text-xs text-[var(--danger)]">
                          {getFieldError(errors, 'metrics')}
                        </p>
                      ) : null}
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => metricsArray.append(blankMetricRow())}
                      >
                        <Plus className="h-3.5 w-3.5" aria-hidden />
                        {t('monitorForm.addMetric')}
                      </Button>
                    </div>
                  </>
                ) : (
                  <div className="space-y-2">
                    <Field label={t('monitorForm.code')} error={getFieldError(errors, 'code')}>
                      <Controller
                        control={control}
                        name="code"
                        render={({ field }) => (
                          <CodeEditor
                            value={field.value}
                            onChange={field.onChange}
                            height="320px"
                            language="javascript"
                          />
                        )}
                      />
                    </Field>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => setValue('code', JS_EXAMPLE, { shouldDirty: true })}
                      >
                        <Wand2 className="h-3.5 w-3.5" aria-hidden />
                        {t('monitorForm.insertExample')}
                      </Button>
                      <p className="text-xs text-[var(--muted-foreground)]">{t('monitorForm.codeHint')}</p>
                    </div>
                    <details className="rounded-lg border border-[var(--border)]">
                      <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-[var(--muted-foreground)]">
                        {t('monitorForm.codeExampleLabel')}
                      </summary>
                      <pre className="overflow-auto border-t border-[var(--border)] bg-[var(--surface-muted)] p-3 font-mono text-xs">
                        {JS_EXAMPLE}
                      </pre>
                    </details>
                  </div>
                )}
              </FormSection>
            </TabsContent>

            <TabsContent value="rules">
              <FormSection title={t('monitorForm.rules')} description={t('monitorForm.rulesHint')}>
                <datalist id={METRIC_KEYS_DATALIST_ID}>
                  {metricKeyOptions.map((option) => (
                    <option key={option.key} value={option.key}>
                      {option.label}
                    </option>
                  ))}
                </datalist>
                {rulesArray.fields.length === 0 ? (
                  <p className="text-sm text-[var(--muted-foreground)]">{t('monitorForm.noRules')}</p>
                ) : null}
                <div className="space-y-3">
                  {rulesArray.fields.map((field, index) => {
                    const rule = watchedRules?.[index];
                    const recoveryOperator = rule?.recoveryOperator ?? 'none';
                    const ruleAdvancedInitialOpen = Boolean(
                      rule &&
                        (rule.durationChecks !== '1' ||
                          rule.cooldownSeconds !== '3600' ||
                          rule.repeatIntervalSeconds !== '0' ||
                          rule.recoveryOperator !== 'none'),
                    );
                    const ruleAdvancedHasError = RULE_ADVANCED_FIELDS.some((advancedField) =>
                      Boolean(getFieldError(errors, `rules.${index}.${advancedField}`)),
                    );
                    return (
                      <div key={field.id} className="space-y-3 rounded-lg border border-[var(--border)] p-3">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-medium">
                            {t('monitorForm.rules')} #{index + 1}
                          </p>
                          <div className="flex items-center gap-2">
                            <Controller
                              control={control}
                              name={`rules.${index}.enabled`}
                              render={({ field: enabledField }) => (
                                <label className="flex items-center gap-1.5 text-xs text-[var(--muted-foreground)]">
                                  <Switch
                                    checked={enabledField.value}
                                    onCheckedChange={enabledField.onChange}
                                    ariaLabel={t('monitorForm.ruleEnabled')}
                                  />
                                  {t('monitorForm.ruleEnabled')}
                                </label>
                              )}
                            />
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon-sm"
                              aria-label={t('common.remove')}
                              className="text-[var(--danger)]"
                              onClick={() => rulesArray.remove(index)}
                            >
                              <Trash2 className="h-4 w-4" aria-hidden />
                            </Button>
                          </div>
                        </div>
                        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                          <Field
                            label={t('monitorForm.ruleMetric')}
                            error={getFieldError(errors, `rules.${index}.metricKey`)}
                            required
                          >
                            <Input
                              list={METRIC_KEYS_DATALIST_ID}
                              placeholder={t('monitorForm.ruleMetricPlaceholder')}
                              invalid={Boolean(getFieldError(errors, `rules.${index}.metricKey`))}
                              {...register(`rules.${index}.metricKey`)}
                            />
                          </Field>
                          <Field
                            label={t('monitorForm.operator')}
                            error={getFieldError(errors, `rules.${index}.operator`)}
                          >
                            <Select
                              value={rule?.operator ?? 'lt'}
                              onValueChange={(value) =>
                                setValue(
                                  `rules.${index}.operator`,
                                  value as MonitorFormValues['rules'][number]['operator'],
                                  { shouldDirty: true },
                                )
                              }
                              options={operatorOptions}
                            />
                          </Field>
                          <Field
                            label={t('monitorForm.warningValue')}
                            error={getFieldError(errors, `rules.${index}.warningValue`)}
                          >
                            <Input
                              type="number"
                              step="any"
                              placeholder="20"
                              invalid={Boolean(getFieldError(errors, `rules.${index}.warningValue`))}
                              {...register(`rules.${index}.warningValue`)}
                            />
                          </Field>
                          <Field
                            label={t('monitorForm.criticalValue')}
                            error={getFieldError(errors, `rules.${index}.criticalValue`)}
                          >
                            <Input
                              type="number"
                              step="any"
                              placeholder="5"
                              invalid={Boolean(getFieldError(errors, `rules.${index}.criticalValue`))}
                              {...register(`rules.${index}.criticalValue`)}
                            />
                          </Field>
                        </div>
                        <Collapsible
                          title={t('common.advanced')}
                          defaultOpen={ruleAdvancedInitialOpen}
                          forceOpen={ruleAdvancedHasError}
                        >
                          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                            <Field label={t('monitorForm.durationChecks')}>
                              <Input type="number" min={1} {...register(`rules.${index}.durationChecks`)} />
                            </Field>
                            <Field label={t('monitorForm.cooldownSeconds')}>
                              <Input type="number" min={0} {...register(`rules.${index}.cooldownSeconds`)} />
                            </Field>
                            <Field label={t('monitorForm.repeatIntervalSeconds')}>
                              <Input
                                type="number"
                                min={0}
                                {...register(`rules.${index}.repeatIntervalSeconds`)}
                              />
                            </Field>
                            <Field label={t('monitorForm.recoveryOperator')}>
                              <Select
                                value={recoveryOperator}
                                onValueChange={(value) =>
                                  setValue(
                                    `rules.${index}.recoveryOperator`,
                                    value as MonitorFormValues['rules'][number]['recoveryOperator'],
                                    { shouldDirty: true },
                                  )
                                }
                                options={recoveryOperatorOptions}
                              />
                            </Field>
                            <Field label={t('monitorForm.recoveryValue')}>
                              <Input
                                type="number"
                                step="any"
                                disabled={recoveryOperator === 'none'}
                                {...register(`rules.${index}.recoveryValue`)}
                              />
                            </Field>
                            <Field label={t('monitorForm.recoveryChecks')}>
                              <Input type="number" min={1} {...register(`rules.${index}.recoveryChecks`)} />
                            </Field>
                          </div>
                        </Collapsible>
                        {getFieldError(errors, `rules.${index}.warningValue`) ? null : (
                          <p className="text-xs text-[var(--muted-foreground)]">
                            {t('monitorForm.ruleHint')}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => rulesArray.append(blankRuleRow())}
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden />
                  {t('monitorForm.addRule')}
                </Button>
                <p className="text-xs text-[var(--muted-foreground)]">{t('monitorForm.thresholdHint')}</p>
              </FormSection>
            </TabsContent>
          </Tabs>
        </div>

        <aside className="space-y-3 xl:sticky xl:top-20 xl:self-start">
          <MonitorTestPanel
            result={testMutation.data}
            error={testMutation.error}
            pending={testMutation.isPending}
            onRun={handleTest}
            disabled={monitorType === 'push'}
          />
          <Alert tone="info">{t('monitorForm.testChannelHint')}</Alert>
        </aside>
      </div>

      <div className="mt-4 flex flex-col gap-2">
        <RootError message={getFieldError(errors, 'root')} />
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => navigate('/')}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" loading={saveMutation.isPending}>
            <Save className="h-4 w-4" aria-hidden />
            {mode === 'create' ? t('monitorForm.createMonitor') : t('monitorForm.saveMonitor')}
          </Button>
        </div>
      </div>
    </form>
  );
}
