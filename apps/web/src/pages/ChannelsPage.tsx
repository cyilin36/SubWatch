import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Controller, useFieldArray, useForm } from 'react-hook-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Pencil, Plus, Send, Trash2 } from 'lucide-react';
import type { z } from 'zod';
import {
  emailChannelConfigSchema,
  webhookChannelConfigSchema,
  SECRET_KEEP,
  type ChannelDto,
  type ChannelInput,
  type EmailChannelConfig,
  type WebhookChannelConfig,
} from '@subwatch/shared';
import { api } from '../lib/api';
import { getFieldError } from '../lib/form';
import { errorMessage } from '../lib/utils';
import { useAuth } from '../providers/AuthProvider';
import { WEBHOOK_PRESETS } from '../lib/presets';
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
  SecretInput,
  Select,
  Skeleton,
  Switch,
} from '../components/ui';
import { CodeEditor } from '../components/ui/CodeEditor';
import { ChannelIcon } from '../components/common/icons';
import { TagsInput } from '../components/common/fields';

interface EmailFormState {
  host: string;
  port: string;
  secure: boolean;
  requireTls: boolean;
  rejectUnauthorized: boolean;
  user: string;
  password: string;
  from: string;
  fromName: string;
  to: string[];
}

interface WebhookFormState {
  url: string;
  method: 'POST' | 'PUT' | 'PATCH';
  headers: { key: string; value: string; secret: boolean }[];
  contentType: string;
  bodyTemplate: string;
  signingSecret: string;
  timeoutMs: string;
}

interface ChannelFormValues {
  name: string;
  enabled: boolean;
  type: 'email' | 'webhook';
  email: EmailFormState;
  webhook: WebhookFormState;
}

function blankChannelForm(smtp: Partial<EmailChannelConfig> | null = null): ChannelFormValues {
  return {
    name: '',
    enabled: true,
    type: 'email',
    email: {
      host: smtp?.host ?? '',
      port: String(smtp?.port ?? 587),
      secure: smtp?.secure ?? false,
      requireTls: smtp?.requireTls ?? false,
      rejectUnauthorized: smtp?.rejectUnauthorized ?? true,
      user: smtp?.user ?? '',
      password: '',
      from: smtp?.from ?? '',
      fromName: smtp?.fromName ?? 'SubWatch',
      to: smtp?.to ?? [],
    },
    webhook: {
      url: '',
      method: 'POST',
      headers: [],
      contentType: 'application/json',
      bodyTemplate: WEBHOOK_PRESETS[0]?.bodyTemplate ?? '',
      signingSecret: '',
      timeoutMs: '10000',
    },
  };
}

function channelToForm(channel: ChannelDto): ChannelFormValues {
  const values = blankChannelForm();
  values.name = channel.name;
  values.enabled = channel.enabled;
  values.type = channel.type;
  if (channel.type === 'email') {
    const config = channel.config as unknown as Partial<EmailChannelConfig>;
    values.email = {
      host: config.host ?? '',
      port: String(config.port ?? 587),
      secure: config.secure ?? false,
      requireTls: config.requireTls ?? false,
      rejectUnauthorized: config.rejectUnauthorized ?? true,
      user: config.user ?? '',
      password: config.password ?? '',
      from: config.from ?? '',
      fromName: config.fromName ?? 'SubWatch',
      to: config.to ?? [],
    };
  } else {
    const config = channel.config as unknown as Partial<WebhookChannelConfig>;
    values.webhook = {
      url: config.url ?? '',
      method: config.method ?? 'POST',
      headers: (config.headers ?? []).map((header) => ({ ...header })),
      contentType: config.contentType ?? 'application/json',
      bodyTemplate: config.bodyTemplate ?? '',
      signingSecret: config.signingSecret ?? '',
      timeoutMs: String(config.timeoutMs ?? 10000),
    };
  }
  return values;
}

function ChannelDialog({
  open,
  onOpenChange,
  channel,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channel: ChannelDto | null;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { settings } = useAuth();
  const [presetId, setPresetId] = useState<string>('');

  const form = useForm<ChannelFormValues>({ defaultValues: blankChannelForm() });
  const headersArray = useFieldArray({ control: form.control, name: 'webhook.headers' });

  useEffect(() => {
    if (!open) return;
    setPresetId('');
    form.reset(channel ? channelToForm(channel) : blankChannelForm(settings?.smtp ?? null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, channel]);

  const type = form.watch('type');
  const errors = form.formState.errors;

  const saveMutation = useMutation({
    mutationFn: (input: ChannelInput) =>
      channel ? api.channels.update(channel.id, input) : api.channels.create(input),
    onSuccess: () => {
      toast.success(channel ? t('channels.updateSuccess') : t('channels.createSuccess'));
      void queryClient.invalidateQueries({ queryKey: ['channels'] });
      onOpenChange(false);
    },
    onError: (error) => toast.error(t('errors.saveFailed'), { description: errorMessage(error) }),
  });

  const testDraftMutation = useMutation({
    mutationFn: (input: { type: 'email' | 'webhook'; config: Record<string, unknown> }) =>
      api.channels.testConfig({ ...input, id: channel?.id }),
    onSuccess: (result) => {
      if (result.ok) toast.success(t('channels.testSuccess'));
      else toast.error(t('channels.testFailed'), { description: result.error ?? undefined });
    },
    onError: (error) =>
      toast.error(t('channels.testFailed'), { description: errorMessage(error) }),
  });

  const applyEmailErrors = (error: z.ZodError) => {
    for (const issue of error.issues) {
      const path = ['email', ...issue.path.map(String)].join('.');
      form.setError(path as never, { type: 'validate', message: issue.message });
    }
  };

  const applyWebhookErrors = (error: z.ZodError) => {
    for (const issue of error.issues) {
      const path = ['webhook', ...issue.path.map(String)].join('.');
      form.setError(path as never, { type: 'validate', message: issue.message });
    }
  };

  /** Validate the current form values and turn them into a channel config. */
  const buildChannelConfig = (
    values: ChannelFormValues,
  ):
    | { type: 'email'; config: EmailChannelConfig }
    | { type: 'webhook'; config: WebhookChannelConfig }
    | null => {
    if (values.type === 'email') {
      const parsed = emailChannelConfigSchema.safeParse({
        host: values.email.host,
        port: Number(values.email.port),
        secure: values.email.secure,
        requireTls: values.email.requireTls,
        rejectUnauthorized: values.email.rejectUnauthorized,
        user: values.email.user,
        password: values.email.password,
        from: values.email.from,
        fromName: values.email.fromName,
        to: values.email.to,
      });
      if (!parsed.success) {
        applyEmailErrors(parsed.error);
        return null;
      }
      return { type: 'email', config: parsed.data };
    }

    const parsed = webhookChannelConfigSchema.safeParse({
      url: values.webhook.url,
      method: values.webhook.method,
      headers: values.webhook.headers.filter((header) => header.key.trim() !== ''),
      contentType: values.webhook.contentType,
      bodyTemplate: values.webhook.bodyTemplate,
      signingSecret: values.webhook.signingSecret,
      timeoutMs: Number(values.webhook.timeoutMs),
    });
    if (!parsed.success) {
      applyWebhookErrors(parsed.error);
      return null;
    }
    return { type: 'webhook', config: parsed.data };
  };

  const onSubmit = form.handleSubmit((values) => {
    if (!values.name.trim()) {
      form.setError('name', { type: 'required', message: t('validation.required') });
      return;
    }
    const built = buildChannelConfig(values);
    if (!built) {
      toast.error(t('errors.validation'));
      return;
    }
    saveMutation.mutate({ name: values.name, enabled: values.enabled, ...built });
  });

  /** Test-send using the values currently in the form, without saving first. */
  const onTest = () => {
    const built = buildChannelConfig(form.getValues());
    if (!built) {
      toast.error(t('errors.validation'));
      return;
    }
    testDraftMutation.mutate(built);
  };

  const applyPreset = (presetIdValue: string) => {
    setPresetId(presetIdValue);
    const preset = WEBHOOK_PRESETS.find((entry) => entry.id === presetIdValue);
    if (!preset) return;
    form.setValue('webhook.method', preset.method, { shouldDirty: true });
    form.setValue('webhook.contentType', preset.contentType, { shouldDirty: true });
    form.setValue('webhook.bodyTemplate', preset.bodyTemplate, { shouldDirty: true });
    form.setValue('webhook.headers', preset.headers.map((header) => ({ ...header })), {
      shouldDirty: true,
    });
    toast.success(t('channels.presetApplied'));
  };

  const preset = WEBHOOK_PRESETS.find((entry) => entry.id === presetId);

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={channel ? t('channels.edit') : t('channels.create')}
      description={type === 'email' ? t('channels.emailHint') : t('channels.webhookHint')}
      size="lg"
      footer={
        <>
          <Button
            type="button"
            variant="outline"
            loading={testDraftMutation.isPending}
            disabled={saveMutation.isPending}
            onClick={onTest}
          >
            <Send className="h-4 w-4" aria-hidden />
            {t('channels.test')}
          </Button>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saveMutation.isPending}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="channel-form" loading={saveMutation.isPending}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <form
        id="channel-form"
        noValidate
        className="space-y-6"
        onSubmit={(event) => {
          void onSubmit(event);
        }}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label={t('channels.name')} error={getFieldError(errors, 'name')} required>
            <Input
              placeholder={t('channels.namePlaceholder')}
              invalid={Boolean(getFieldError(errors, 'name'))}
              {...form.register('name')}
            />
          </Field>
          <Field label={t('channels.type')}>
            <Select
              value={type}
              onValueChange={(value) =>
                form.setValue('type', value as ChannelFormValues['type'], { shouldDirty: true })
              }
              options={[
                { value: 'email', label: t('channels.email') },
                { value: 'webhook', label: t('channels.webhook') },
              ]}
            />
          </Field>
        </div>
        <div className="glass-flat flex items-center justify-between gap-3 rounded-btn px-4 py-3">
          <p className="text-body font-medium text-ink">{t('channels.enabled')}</p>
          <Switch
            checked={form.watch('enabled')}
            onCheckedChange={(checked) => form.setValue('enabled', checked, { shouldDirty: true })}
            ariaLabel={t('channels.enabled')}
          />
        </div>

        {type === 'email' ? (
          <div className="glass-flat space-y-4 rounded-btn p-4 sm:p-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('channels.host')} error={getFieldError(errors, 'email.host')} required>
                <Input
                  placeholder="smtp.example.com"
                  invalid={Boolean(getFieldError(errors, 'email.host'))}
                  {...form.register('email.host')}
                />
              </Field>
              <Field label={t('channels.port')} error={getFieldError(errors, 'email.port')} required>
                <Input
                  type="number"
                  min={1}
                  max={65535}
                  invalid={Boolean(getFieldError(errors, 'email.port'))}
                  {...form.register('email.port')}
                />
              </Field>
              <Field label={t('channels.user')}>
                <Input autoComplete="off" {...form.register('email.user')} />
              </Field>
              <Field label={t('channels.password')}>
                <Controller
                  control={form.control}
                  name="email.password"
                  render={({ field }) => (
                    <SecretInput
                      value={field.value}
                      hasStoredValue={field.value === SECRET_KEEP}
                      onChange={field.onChange}
                      placeholder={form.watch('email.password') === SECRET_KEEP ? t('channels.passwordKeepHint') : t('channels.passwordNotSet')}
                      autoComplete="off"
                    />
                  )}
                />
              </Field>
              <Field label={t('channels.from')} error={getFieldError(errors, 'email.from')} required>
                <Input
                  placeholder="noreply@example.com"
                  invalid={Boolean(getFieldError(errors, 'email.from'))}
                  {...form.register('email.from')}
                />
              </Field>
              <Field label={t('channels.fromName')}>
                <Input {...form.register('email.fromName')} />
              </Field>
            </div>
            <Field
              label={t('channels.to')}
              hint={t('channels.toHint')}
              error={getFieldError(errors, 'email.to')}
              required
            >
              <TagsInput
                multiline
                value={form.watch('email.to') ?? []}
                onChange={(next) => form.setValue('email.to', next, { shouldDirty: true })}
                placeholder="ops@example.com"
              />
            </Field>
            <div className="grid gap-2 sm:grid-cols-3">
              <label className="flex items-center gap-2 text-sm text-moonlight">
                <input type="checkbox" className="h-4 w-4 accent-moonlight" {...form.register('email.secure')} />
                {t('channels.secure')}
              </label>
              <label className="flex items-center gap-2 text-sm text-moonlight">
                <input type="checkbox" className="h-4 w-4 accent-moonlight" {...form.register('email.requireTls')} />
                {t('channels.requireTls')}
              </label>
              <label className="flex items-center gap-2 text-sm text-moonlight">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-moonlight"
                  {...form.register('email.rejectUnauthorized')}
                />
                {t('channels.rejectUnauthorized')}
              </label>
            </div>
            <p className="text-xs text-moonlight">{t('channels.emailTestHint')}</p>
          </div>
        ) : (
          <div className="glass-flat space-y-4 rounded-btn p-4 sm:p-5">
            <Field label={t('channels.preset')} hint={t('channels.presetHint')}>
              <Select
                value={presetId || undefined}
                onValueChange={applyPreset}
                placeholder={t('channels.presetGeneral')}
                options={WEBHOOK_PRESETS.map((entry) => ({
                  value: entry.id,
                  label: t(entry.labelKey),
                }))}
              />
            </Field>
            {preset ? (
              <p className="glass-flat rounded-btn px-4 py-3 text-xs leading-relaxed break-words text-moonlight">
                {t(preset.hintKey)}
                <br />
                <span className="font-mono break-all">{t('channels.urlExample')}: {preset.urlExample}</span>
              </p>
            ) : null}

            <div className="grid gap-4 sm:grid-cols-[140px_1fr]">
              <Field label={t('channels.method')}>
                <Select
                  value={form.watch('webhook.method')}
                  onValueChange={(value) =>
                    form.setValue(
                      'webhook.method',
                      value as WebhookFormState['method'],
                      { shouldDirty: true },
                    )
                  }
                  options={[
                    { value: 'POST', label: 'POST' },
                    { value: 'PUT', label: 'PUT' },
                    { value: 'PATCH', label: 'PATCH' },
                  ]}
                />
              </Field>
              <Field
                label={t('channels.url')}
                error={getFieldError(errors, 'webhook.url')}
                required
              >
                <Input
                  placeholder={preset?.urlExample ?? 'https://example.com/webhook'}
                  invalid={Boolean(getFieldError(errors, 'webhook.url'))}
                  {...form.register('webhook.url')}
                />
              </Field>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={t('channels.contentType')} error={getFieldError(errors, 'webhook.contentType')}>
                <Input {...form.register('webhook.contentType')} />
              </Field>
              <Field label={t('channels.timeoutMs')} error={getFieldError(errors, 'webhook.timeoutMs')}>
                <Input type="number" min={1000} step={500} {...form.register('webhook.timeoutMs')} />
              </Field>
            </div>

            <Field
              label={t('channels.signingSecret')}
              hint={t('channels.signingSecretHint')}
              error={getFieldError(errors, 'webhook.signingSecret')}
            >
              <Controller
                control={form.control}
                name="webhook.signingSecret"
                render={({ field }) => (
                  <SecretInput
                    value={field.value}
                    hasStoredValue={field.value === SECRET_KEEP}
                    onChange={field.onChange}
                    placeholder={field.value === SECRET_KEEP ? t('channels.secretKeepHint') : undefined}
                    autoComplete="off"
                  />
                )}
              />
            </Field>

            <Field label={t('channels.bodyTemplate')} hint={t('channels.bodyTemplateHint')}>
              <Controller
                control={form.control}
                name="webhook.bodyTemplate"
                render={({ field }) => (
                  <CodeEditor
                    value={field.value}
                    onChange={field.onChange}
                    height="220px"
                    language={form.watch('webhook.contentType').includes('json') ? 'json' : 'text'}
                  />
                )}
              />
            </Field>

            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-body font-medium text-ink">{t('channels.headers')}</p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => headersArray.append({ key: '', value: '', secret: false })}
                >
                  <Plus className="h-3.5 w-3.5" aria-hidden />
                  {t('channels.addHeader')}
                </Button>
              </div>
              <p className="text-xs text-moonlight">{t('channels.headersHint')}</p>
              {headersArray.fields.length === 0 ? (
                <p className="text-xs text-moonlight">{t('common.none')}</p>
              ) : null}
              {headersArray.fields.map((field, index) => {
                const secret = form.watch(`webhook.headers.${index}.secret`);
                const value = form.watch(`webhook.headers.${index}.value`) ?? '';
                return (
                  <div
                    key={field.id}
                    className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.5fr)_auto_auto] sm:items-center"
                  >
                    <Input
                      placeholder={t('channels.headerKey')}
                      aria-label={t('channels.headerKey')}
                      {...form.register(`webhook.headers.${index}.key`)}
                    />
                    {secret ? (
                      <SecretInput
                        value={value}
                        hasStoredValue={value === SECRET_KEEP}
                        onChange={(next) =>
                          form.setValue(`webhook.headers.${index}.value`, next, { shouldDirty: true })
                        }
                        placeholder={t('channels.headerValue')}
                      />
                    ) : (
                      <Input
                        placeholder={t('channels.headerValue')}
                        aria-label={t('channels.headerValue')}
                        {...form.register(`webhook.headers.${index}.value`)}
                      />
                    )}
                    <label className="flex items-center gap-1.5 whitespace-nowrap text-xs text-moonlight">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-moonlight"
                        {...form.register(`webhook.headers.${index}.secret`)}
                      />
                      {t('channels.headerSecret')}
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
          </div>
        )}
        <p className="text-xs text-moonlight">{t('channels.testHint')}</p>
      </form>
    </Dialog>
  );
}

export function ChannelsPage() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingChannel, setEditingChannel] = useState<ChannelDto | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ChannelDto | null>(null);

  const channelsQuery = useQuery({
    queryKey: ['channels'],
    queryFn: () => api.channels.list(),
    refetchInterval: 15_000,
  });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['channels'] });
    void queryClient.invalidateQueries({ queryKey: ['settings'] });
  };

  const toggleMutation = useMutation({
    mutationFn: ({ channel, enabled }: { channel: ChannelDto; enabled: boolean }) =>
      api.channels.update(channel.id, {
        name: channel.name,
        enabled,
        type: channel.type,
        config: channel.config,
      } as unknown as ChannelInput),
    onSuccess: () => invalidate(),
    onError: (error) => toast.error(errorMessage(error)),
  });

  const testMutation = useMutation({
    mutationFn: (channel: ChannelDto) => api.channels.test(channel.id),
    onSuccess: (result) => {
      if (result.ok) toast.success(t('channels.testSuccess'));
      else toast.error(t('channels.testFailed'), { description: result.error ?? undefined });
    },
    onError: (error) =>
      toast.error(t('channels.testFailed'), { description: errorMessage(error) }),
  });

  const deleteMutation = useMutation({
    mutationFn: (channel: ChannelDto) => api.channels.remove(channel.id),
    onSuccess: () => {
      toast.success(t('channels.deleteSuccess'));
      setDeleteTarget(null);
      invalidate();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const channels = channelsQuery.data ?? [];

  const openCreate = () => {
    setEditingChannel(null);
    setDialogOpen(true);
  };

  return (
    <div className="space-y-8">
      <PageHeader
        title={t('channels.title')}
        description={t('channels.subtitle')}
        icon={<Send className="h-5 w-5" />}
        actions={
          <Button variant="secondary" size="sm" onClick={openCreate} disabled={channelsQuery.isPending}>
            <Plus className="h-4 w-4" aria-hidden />
            {t('channels.newChannel')}
          </Button>
        }
      />

      {channelsQuery.isPending ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, index) => (
            <Skeleton key={index} className="h-48 rounded-card" />
          ))}
        </div>
      ) : channelsQuery.isError ? (
        <ErrorState error={channelsQuery.error} onRetry={() => void channelsQuery.refetch()} />
      ) : channels.length === 0 ? (
        <EmptyState
          icon={<Send className="h-8 w-8" aria-hidden />}
          title={t('channels.noChannels')}
          description={t('channels.noChannelsHint')}
          action={
            <Button variant="secondary" size="sm" onClick={openCreate}>
              <Plus className="h-4 w-4" aria-hidden />
              {t('channels.createFirst')}
            </Button>
          }
        />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {channels.map((channel) => {
            const isEmail = channel.type === 'email';
            const summary = isEmail
              ? `${String(channel.config.host ?? '')}:${String(channel.config.port ?? '')} → ${(channel.config.to as string[] | undefined)?.join(', ') ?? ''}`
              : `${String(channel.config.method ?? 'POST')} ${String(channel.config.url ?? '')}`;
            const toggling =
              toggleMutation.isPending && toggleMutation.variables?.channel.id === channel.id;
            const testing =
              testMutation.isPending && testMutation.variables?.id === channel.id;
            return (
              <Card key={channel.id} className="flex flex-col p-5 sm:p-6">
                <div className="flex items-start gap-3">
                  <span className="glass-flat flex h-12 w-12 shrink-0 items-center justify-center rounded-btn text-moonlight">
                    <ChannelIcon type={channel.type} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-body font-medium text-ink">{channel.name}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-1.5">
                      <Badge tone="muted">
                        {isEmail ? t('channels.email') : t('channels.webhook')}
                      </Badge>
                      <Badge tone={channel.enabled ? 'success' : 'muted'} dot>
                        {channel.enabled ? t('common.enabled') : t('common.disabled')}
                      </Badge>
                    </div>
                    <p
                      className="mt-2 line-clamp-2 break-words text-xs leading-relaxed text-moonlight"
                      title={summary}
                    >
                      {summary || t('channels.noConfig')}
                    </p>
                  </div>
                  <Switch
                    checked={channel.enabled}
                    disabled={toggling}
                    onCheckedChange={(checked) => toggleMutation.mutate({ channel, enabled: checked })}
                    ariaLabel={`${t('channels.enabled')} ${channel.name}`}
                  />
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-ink/10 pt-4">
                  <Button
                    variant="outline"
                    size="sm"
                    loading={testing}
                    disabled={toggling || deleteMutation.isPending}
                    onClick={() => testMutation.mutate(channel)}
                  >
                    {!testing ? <Send className="h-3.5 w-3.5" aria-hidden /> : null}
                    {t('channels.test')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={toggling}
                    onClick={() => {
                      setEditingChannel(channel);
                      setDialogOpen(true);
                    }}
                  >
                    <Pencil className="h-3.5 w-3.5" aria-hidden />
                    {t('common.edit')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-danger hover:text-danger"
                    disabled={toggling}
                    onClick={() => setDeleteTarget(channel)}
                  >
                    <Trash2 className="h-3.5 w-3.5" aria-hidden />
                    {t('common.delete')}
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <ChannelDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setEditingChannel(null);
        }}
        channel={editingChannel}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={t('channels.deleteTitle')}
        description={
          deleteTarget
            ? t('channels.deleteDescription', { name: deleteTarget.name })
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
