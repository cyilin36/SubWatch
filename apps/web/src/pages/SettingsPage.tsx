import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Controller, useForm } from 'react-hook-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  CheckCircle2,
  Info,
  Save,
  Server,
  Settings as SettingsIcon,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import type { z } from 'zod';
import {
  changePasswordSchema,
  generalSettingsSchema,
  type SettingsDto,
} from '@subwatch/shared';
import { api } from '../lib/api';
import { applyZodIssues, getFieldError } from '../lib/form';
import { errorMessage, formatDateTime, formatDurationSeconds } from '../lib/utils';
import { useAuth } from '../providers/AuthProvider';
import { CURRENCY_OPTIONS, getTimezoneOptions, THEME_OPTIONS } from '../lib/presets';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Field,
  Input,
  PageHeader,
  SecretInput,
  Select,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '../components/ui';
import { FormSection, MultiCheckbox, OffsetsInput, TagsInput } from '../components/common/fields';

type GeneralFormValues = z.infer<typeof generalSettingsSchema>;

function generalToForm(settings: SettingsDto): GeneralFormValues {
  return { ...settings.general };
}

interface SmtpFields {
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

function smtpFromSettings(settings: SettingsDto | undefined): SmtpFields {
  const smtp = settings?.smtp;
  return {
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
  };
}

export function SettingsPage() {
  const { t } = useTranslation();
  const { settings, settingsLoading, syncSettings, reloadSettings, timezone, locale } = useAuth();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState('general');

  const channelsQuery = useQuery({ queryKey: ['channels'], queryFn: () => api.channels.list() });
  const healthQuery = useQuery({
    queryKey: ['health'],
    queryFn: () => api.health(),
    refetchInterval: 30_000,
    retry: false,
  });

  const timezoneOptions = useMemo(() => getTimezoneOptions(), []);

  // -------------------------------------------------------------------------
  // General settings
  // -------------------------------------------------------------------------
  const generalForm = useForm<GeneralFormValues>({
    defaultValues: settings ? generalToForm(settings) : undefined,
  });

  useEffect(() => {
    if (settings && !generalForm.formState.isDirty) {
      generalForm.reset(generalToForm(settings));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings]);

  const generalMutation = useMutation({
    mutationFn: (values: GeneralFormValues) => api.settings.patch({ general: values }),
    onSuccess: (nextSettings) => {
      toast.success(t('settings.generalSaved'));
      syncSettings(nextSettings);
      void queryClient.invalidateQueries({ queryKey: ['channels'] });
    },
    onError: (error) => toast.error(t('settings.saveFailed'), { description: errorMessage(error) }),
  });

  const onSaveGeneral = generalForm.handleSubmit((values) => {
    const parsed = generalSettingsSchema.safeParse(values);
    if (!parsed.success) {
      applyZodIssues(generalForm, parsed.error);
      toast.error(t('errors.validation'));
      return;
    }
    generalMutation.mutate(parsed.data);
  });

  // -------------------------------------------------------------------------
  // SMTP settings
  // -------------------------------------------------------------------------
  const [smtp, setSmtp] = useState<SmtpFields>(() => smtpFromSettings(settings));
  useEffect(() => {
    setSmtp(smtpFromSettings(settings));
  }, [settings]);

  const smtpMutation = useMutation({
    mutationFn: (smtpPatch: NonNullable<Parameters<typeof api.settings.patch>[0]>['smtp']) =>
      api.settings.patch({ smtp: smtpPatch }),
    onSuccess: (nextSettings) => {
      toast.success(t('settings.smtpSaveSuccess'));
      syncSettings(nextSettings);
    },
    onError: (error) => toast.error(t('settings.saveFailed'), { description: errorMessage(error) }),
  });

  const testSmtpMutation = useMutation({
    mutationFn: () => api.settings.testSmtp(),
    onSuccess: (result) => {
      if (result.ok) toast.success(t('settings.testSmtpSuccess'));
      else toast.error(t('settings.testSmtpFailed'), { description: result.error ?? undefined });
    },
    onError: (error) =>
      toast.error(t('settings.testSmtpFailed'), { description: errorMessage(error) }),
  });

  const saveSmtp = () => {
    if (!smtp.host.trim() || !smtp.from.trim() || smtp.to.length === 0) {
      toast.error(t('errors.validation'), {
        description: `${t('channels.host')} / ${t('channels.from')} / ${t('channels.to')}`,
      });
      return;
    }
    const port = Number(smtp.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      toast.error(t('errors.validation'), { description: t('channels.port') });
      return;
    }
    smtpMutation.mutate({
      host: smtp.host.trim(),
      port,
      secure: smtp.secure,
      requireTls: smtp.requireTls,
      rejectUnauthorized: smtp.rejectUnauthorized,
      user: smtp.user,
      from: smtp.from.trim(),
      fromName: smtp.fromName,
      to: smtp.to,
      ...(smtp.password ? { password: smtp.password } : {}),
    });
  };

  // -------------------------------------------------------------------------
  // Password
  // -------------------------------------------------------------------------
  const passwordForm = useForm<{
    currentPassword: string;
    newPassword: string;
    confirmPassword: string;
  }>({ defaultValues: { currentPassword: '', newPassword: '', confirmPassword: '' } });

  const passwordMutation = useMutation({
    mutationFn: (values: { currentPassword: string; newPassword: string }) =>
      api.auth.changePassword(values),
    onSuccess: () => {
      toast.success(t('settings.passwordChangedSuccess'));
      passwordForm.reset();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const onChangePassword = passwordForm.handleSubmit((values) => {
    if (values.newPassword !== values.confirmPassword) {
      passwordForm.setError('confirmPassword', {
        type: 'validate',
        message: t('settings.passwordMismatch'),
      });
      return;
    }
    const parsed = changePasswordSchema.safeParse({
      currentPassword: values.currentPassword,
      newPassword: values.newPassword,
    });
    if (!parsed.success) {
      applyZodIssues(passwordForm, parsed.error);
      toast.error(t('errors.validation'));
      return;
    }
    passwordMutation.mutate(parsed.data);
  });

  if (!settings) {
    return (
      <div>
        <PageHeader title={t('settings.title')} description={t('settings.subtitle')} />
        {settingsLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-10" />
            <Skeleton className="h-64" />
          </div>
        ) : (
          <Card className="p-6 text-center">
            <p className="text-sm text-[var(--muted-foreground)]">{t('errors.loadFailed')}</p>
            <Button className="mt-3" size="sm" onClick={() => void reloadSettings()}>
              {t('common.retry')}
            </Button>
          </Card>
        )}
      </div>
    );
  }

  const channelItems = (channelsQuery.data ?? []).map((channel) => ({
    value: channel.id,
    label: channel.name,
    description: t(`channels.${channel.type}`),
  }));

  const healthOk = healthQuery.data?.ok ?? false;

  return (
    <div>
      <PageHeader
        title={t('settings.title')}
        description={t('settings.subtitle')}
        icon={<SettingsIcon className="h-5 w-5" />}
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="max-w-xl">
          <TabsTrigger value="general">{t('settings.general')}</TabsTrigger>
          <TabsTrigger value="smtp">{t('settings.smtp')}</TabsTrigger>
          <TabsTrigger value="security">{t('settings.security')}</TabsTrigger>
          <TabsTrigger value="about">{t('settings.about')}</TabsTrigger>
        </TabsList>

        {/* General ---------------------------------------------------------- */}
        <TabsContent value="general">
          <form
            onSubmit={(event) => {
              void onSaveGeneral(event);
            }}
            noValidate
            className="space-y-4"
          >
            <FormSection title={t('settings.general')} description={t('settings.generalHint')}>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t('settings.appName')} error={getFieldError(generalForm.formState.errors, 'appName')}>
                  <Input {...generalForm.register('appName')} />
                </Field>
                <Field label={t('settings.locale')} hint={t('settings.languageHint')}>
                  <Select
                    value={generalForm.watch('locale')}
                    onValueChange={(value) =>
                      generalForm.setValue('locale', value as GeneralFormValues['locale'], {
                        shouldDirty: true,
                      })
                    }
                    options={[
                      { value: 'zh-CN', label: '中文（简体）' },
                      { value: 'en', label: 'English' },
                    ]}
                  />
                </Field>
                <Field
                  label={t('settings.timezone')}
                  hint={t('settings.timezoneHint')}
                  error={getFieldError(generalForm.formState.errors, 'timezone')}
                >
                  <Input
                    list="settings-timezones"
                    placeholder={t('settings.timezonePlaceholder')}
                    {...generalForm.register('timezone')}
                  />
                  <datalist id="settings-timezones">
                    {timezoneOptions.map((zone) => (
                      <option key={zone} value={zone} />
                    ))}
                  </datalist>
                </Field>
                <Field
                  label={t('settings.reminderTime')}
                  error={getFieldError(generalForm.formState.errors, 'reminderTime')}
                >
                  <Input type="time" {...generalForm.register('reminderTime')} />
                </Field>
                <Field
                  label={t('settings.defaultReminderOffsets')}
                  hint={t('settings.offsetsHint')}
                  className="sm:col-span-2"
                >
                  <Controller
                    control={generalForm.control}
                    name="defaultReminderOffsets"
                    render={({ field }) => (
                      <OffsetsInput value={field.value ?? []} onChange={field.onChange} />
                    )}
                  />
                </Field>
                <Field
                  label={t('settings.runRetentionDays')}
                  error={getFieldError(generalForm.formState.errors, 'runRetentionDays')}
                >
                  <Input type="number" min={1} {...generalForm.register('runRetentionDays', { valueAsNumber: true })} />
                </Field>
                <Field
                  label={t('settings.notificationRetentionDays')}
                  error={getFieldError(generalForm.formState.errors, 'notificationRetentionDays')}
                >
                  <Input
                    type="number"
                    min={1}
                    {...generalForm.register('notificationRetentionDays', { valueAsNumber: true })}
                  />
                </Field>
                <Field
                  label={t('settings.baseUrl')}
                  hint={t('settings.baseUrlHint')}
                  error={getFieldError(generalForm.formState.errors, 'baseUrl')}
                  className="sm:col-span-2"
                >
                  <Input placeholder="https://subwatch.example.com" {...generalForm.register('baseUrl')} />
                </Field>
                <Field label={t('settings.theme')} hint={t('settings.themeHint')}>
                  <Select
                    value={generalForm.watch('theme')}
                    onValueChange={(value) =>
                      generalForm.setValue('theme', value as GeneralFormValues['theme'], {
                        shouldDirty: true,
                      })
                    }
                    options={THEME_OPTIONS.map((option) => ({
                      value: option.value,
                      label: t(option.labelKey),
                    }))}
                  />
                </Field>
                <Field label={t('settings.currency')} hint={t('settings.currencyHint')}>
                  <Select
                    value={generalForm.watch('currency')}
                    onValueChange={(value) =>
                      generalForm.setValue('currency', value, { shouldDirty: true })
                    }
                    options={CURRENCY_OPTIONS.map((code) => ({ value: code, label: code }))}
                  />
                </Field>
              </div>
              <div>
                <p className="mb-1.5 text-sm font-medium">{t('settings.defaultChannelIds')}</p>
                <MultiCheckbox
                  items={channelItems}
                  value={generalForm.watch('defaultChannelIds') ?? []}
                  onChange={(next) =>
                    generalForm.setValue('defaultChannelIds', next, { shouldDirty: true })
                  }
                  emptyText={t('settings.noChannels')}
                />
                <p className="mt-1 text-xs text-[var(--muted-foreground)]">
                  {t('settings.defaultChannelIdsHint')}
                </p>
              </div>
            </FormSection>

            <Card className="flex items-center justify-end gap-2 p-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => generalForm.reset(generalToForm(settings))}
              >
                {t('common.cancel')}
              </Button>
              <Button type="submit" loading={generalMutation.isPending}>
                <Save className="h-4 w-4" aria-hidden />
                {t('settings.saveGeneral')}
              </Button>
            </Card>
          </form>
        </TabsContent>

        {/* SMTP ------------------------------------------------------------- */}
        <TabsContent value="smtp">
          <div className="space-y-4">
            {!settings.smtp ? (
              <Alert tone="warning" title={t('settings.smtpNotConfigured')}>
                {t('settings.smtpHint')}
              </Alert>
            ) : (
              <Alert tone="success" title={t('settings.smtpConfigured')}>
                {settings.smtp.host}:{settings.smtp.port} · {settings.smtp.from}
              </Alert>
            )}

            <FormSection title={t('settings.smtp')} description={t('settings.smtpHint')}>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label={t('channels.host')} required>
                  <Input
                    value={smtp.host}
                    onChange={(event) => setSmtp({ ...smtp, host: event.target.value })}
                    placeholder="smtp.example.com"
                  />
                </Field>
                <Field label={t('channels.port')} required>
                  <Input
                    type="number"
                    min={1}
                    max={65535}
                    value={smtp.port}
                    onChange={(event) => setSmtp({ ...smtp, port: event.target.value })}
                  />
                </Field>
                <Field label={t('channels.user')}>
                  <Input
                    autoComplete="off"
                    value={smtp.user}
                    onChange={(event) => setSmtp({ ...smtp, user: event.target.value })}
                  />
                </Field>
                <Field
                  label={t('channels.password')}
                  hint={
                    settings.smtp?.passwordSet
                      ? t('settings.smtpPasswordKeepHint')
                      : t('settings.smtpPasswordEmpty')
                  }
                >
                  <SecretInput
                    value={smtp.password}
                    hasStoredValue={settings.smtp?.passwordSet ?? false}
                    onChange={(value) => setSmtp({ ...smtp, password: value })}
                    autoComplete="off"
                  />
                </Field>
                <Field label={t('channels.from')} required>
                  <Input
                    value={smtp.from}
                    onChange={(event) => setSmtp({ ...smtp, from: event.target.value })}
                    placeholder="noreply@example.com"
                  />
                </Field>
                <Field label={t('channels.fromName')}>
                  <Input
                    value={smtp.fromName}
                    onChange={(event) => setSmtp({ ...smtp, fromName: event.target.value })}
                  />
                </Field>
                <Field label={t('channels.to')} hint={t('channels.toHint')} className="sm:col-span-2" required>
                  <TagsInput
                    multiline
                    value={smtp.to}
                    onChange={(next) => setSmtp({ ...smtp, to: next })}
                    placeholder="ops@example.com"
                  />
                </Field>
              </div>
              <div className="grid gap-2 sm:grid-cols-3">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-[var(--brand)]"
                    checked={smtp.secure}
                    onChange={(event) => setSmtp({ ...smtp, secure: event.target.checked })}
                  />
                  {t('channels.secure')}
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-[var(--brand)]"
                    checked={smtp.requireTls}
                    onChange={(event) => setSmtp({ ...smtp, requireTls: event.target.checked })}
                  />
                  {t('channels.requireTls')}
                </label>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="h-4 w-4 accent-[var(--brand)]"
                    checked={smtp.rejectUnauthorized}
                    onChange={(event) => setSmtp({ ...smtp, rejectUnauthorized: event.target.checked })}
                  />
                  {t('channels.rejectUnauthorized')}
                </label>
              </div>
              <p className="text-xs text-[var(--muted-foreground)]">{t('settings.smtpTestHint')}</p>
            </FormSection>

            <Card className="flex flex-wrap items-center justify-end gap-2 p-3">
              <Button
                type="button"
                variant="outline"
                loading={testSmtpMutation.isPending}
                disabled={!settings.smtp}
                onClick={() => testSmtpMutation.mutate()}
              >
                {t('settings.testSmtp')}
              </Button>
              <Button type="button" loading={smtpMutation.isPending} onClick={saveSmtp}>
                <Save className="h-4 w-4" aria-hidden />
                {t('settings.saveSmtp')}
              </Button>
            </Card>
          </div>
        </TabsContent>

        {/* Security --------------------------------------------------------- */}
        <TabsContent value="security">
          <form
            onSubmit={(event) => {
              void onChangePassword(event);
            }}
            className="mx-auto max-w-xl space-y-4"
            noValidate
          >
            <FormSection title={t('settings.changePassword')} description={t('settings.passwordHint')}>
              <Field
                label={t('settings.currentPassword')}
                error={getFieldError(passwordForm.formState.errors, 'currentPassword')}
                required
              >
                <Input
                  type="password"
                  autoComplete="current-password"
                  {...passwordForm.register('currentPassword')}
                />
              </Field>
              <Field
                label={t('settings.newPassword')}
                error={getFieldError(passwordForm.formState.errors, 'newPassword')}
                required
              >
                <Input
                  type="password"
                  autoComplete="new-password"
                  {...passwordForm.register('newPassword')}
                />
              </Field>
              <Field
                label={t('settings.confirmPassword')}
                error={getFieldError(passwordForm.formState.errors, 'confirmPassword')}
                required
              >
                <Input
                  type="password"
                  autoComplete="new-password"
                  {...passwordForm.register('confirmPassword')}
                />
              </Field>
            </FormSection>
            <Card className="flex items-center justify-end gap-2 p-3">
              <Button type="submit" loading={passwordMutation.isPending}>
                <ShieldCheck className="h-4 w-4" aria-hidden />
                {t('settings.changePasswordButton')}
              </Button>
            </Card>
          </form>
        </TabsContent>

        {/* About ------------------------------------------------------------ */}
        <TabsContent value="about">
          <div className="grid gap-4 sm:grid-cols-2">
            <Card>
              <CardHeader className="flex-row items-center gap-2">
                <Info className="h-4 w-4 text-[var(--brand)]" aria-hidden />
                <CardTitle>{t('settings.about')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p className="text-[var(--muted-foreground)]">{t('settings.aboutText')}</p>
                <dl className="grid grid-cols-2 gap-2 pt-2">
                  <dt className="text-xs text-[var(--muted-foreground)]">{t('settings.apiVersion')}</dt>
                  <dd className="text-right font-mono text-xs">{settings.version}</dd>
                  <dt className="text-xs text-[var(--muted-foreground)]">{t('settings.uiVersion')}</dt>
                  <dd className="text-right font-mono text-xs">{settings.version}</dd>
                  <dt className="text-xs text-[var(--muted-foreground)]">{t('settings.timezone')}</dt>
                  <dd className="text-right text-xs">{timezone}</dd>
                </dl>
                <p className="pt-2 text-xs text-[var(--muted-foreground)]">{t('settings.aboutHint')}</p>
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="flex-row items-center gap-2">
                <Server className="h-4 w-4 text-[var(--brand)]" aria-hidden />
                <CardTitle>{t('settings.health')}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex items-center gap-2">
                  {healthQuery.isPending ? (
                    <Skeleton className="h-5 w-24" />
                  ) : healthOk ? (
                    <>
                      <CheckCircle2 className="h-4 w-4 text-[var(--success)]" aria-hidden />
                      <span>{t('settings.healthy')}</span>
                      <Badge tone="success">
                        {formatDurationSeconds(healthQuery.data?.uptimeSeconds, locale)}
                      </Badge>
                    </>
                  ) : (
                    <>
                      <XCircle className="h-4 w-4 text-[var(--danger)]" aria-hidden />
                      <span>{t('settings.unhealthy')}</span>
                    </>
                  )}
                </div>
                <dl className="grid grid-cols-2 gap-2 pt-2">
                  <dt className="text-xs text-[var(--muted-foreground)]">{t('settings.apiVersion')}</dt>
                  <dd className="text-right font-mono text-xs">{healthQuery.data?.version ?? settings.version}</dd>
                  <dt className="text-xs text-[var(--muted-foreground)]">{t('settings.health')}</dt>
                  <dd className="text-right text-xs">
                    {healthQuery.data?.ok ? t('settings.healthy') : t('settings.unhealthy')}
                  </dd>
                  <dt className="text-xs text-[var(--muted-foreground)]">{t('common.updatedAt')}</dt>
                  <dd className="text-right text-xs">
                    {healthQuery.dataUpdatedAt
                      ? formatDateTime(new Date(healthQuery.dataUpdatedAt).toISOString(), timezone, 'en')
                      : '—'}
                  </dd>
                </dl>
                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2"
                  loading={healthQuery.isFetching}
                  onClick={() => void healthQuery.refetch()}
                >
                  {t('common.refresh')}
                </Button>
              </CardContent>
            </Card>
          </div>
        </TabsContent>
      </Tabs>
    </div>
  );
}
