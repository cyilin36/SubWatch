import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { LockKeyhole, ShieldCheck } from 'lucide-react';
import type { z } from 'zod';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { toast } from 'sonner';
import { loginSchema, setupSchema } from '@subwatch/shared';
import { AuthLayout } from '../components/layout/AuthLayout';
import { Alert, Button, Card, CardContent, Field, Input } from '../components/ui';
import { useAuth } from '../providers/AuthProvider';
import { errorMessage } from '../lib/utils';

const setupFormSchema = setupSchema
  .extend({
    confirmPassword: loginSchema.shape.password,
  })
  .refine((values) => values.password === values.confirmPassword, {
    path: ['confirmPassword'],
    message: 'auth.passwordMismatch',
  });

type LoginValues = z.infer<typeof loginSchema>;
type SetupValues = z.infer<typeof setupFormSchema>;

export function LoginPage() {
  const { t } = useTranslation();
  const { login } = useAuth();
  const navigate = useNavigate();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: { password: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setSubmitError(null);
    try {
      await login(values.password);
      toast.success(t('auth.loginSuccess'));
      navigate('/', { replace: true });
    } catch (error) {
      setSubmitError(errorMessage(error));
    }
  });

  return (
    <AuthLayout>
      <Card>
        <CardContent className="p-6">
          <div className="mb-5 flex flex-col items-center text-center">
            <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--brand)_12%,transparent)] text-[var(--brand)]">
              <LockKeyhole className="h-5 w-5" aria-hidden />
            </div>
            <h1 className="text-lg font-semibold">{t('auth.loginTitle')}</h1>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">{t('auth.loginSubtitle')}</p>
          </div>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              void onSubmit(event);
            }}
          >
            {/* SubWatch has a single admin account. Password managers such as
                Bitwarden only associate and fill a saved login when a username
                field is present, so expose a visually hidden one. */}
            <input
              type="text"
              id="login-username"
              name="username"
              autoComplete="username"
              value="admin"
              readOnly
              tabIndex={-1}
              aria-hidden="true"
              className="sr-only"
            />
            <Field
              label={t('auth.password')}
              htmlFor="login-password"
              error={errors.password?.message}
              required
            >
              <Input
                id="login-password"
                type="password"
                autoComplete="current-password"
                autoFocus
                placeholder={t('auth.passwordPlaceholder')}
                invalid={Boolean(errors.password)}
                {...register('password')}
              />
            </Field>
            {submitError ? <Alert tone="danger">{submitError}</Alert> : null}
            <Button type="submit" className="w-full" loading={isSubmitting}>
              {isSubmitting ? t('auth.loggingIn') : t('auth.login')}
            </Button>
          </form>
        </CardContent>
      </Card>
    </AuthLayout>
  );
}

export function SetupPage() {
  const { t } = useTranslation();
  const { setup } = useAuth();
  const navigate = useNavigate();
  const [submitError, setSubmitError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<SetupValues>({
    resolver: zodResolver(setupFormSchema),
    defaultValues: { password: '', confirmPassword: '' },
  });

  const onSubmit = handleSubmit(async (values) => {
    setSubmitError(null);
    try {
      await setup(values.password);
      toast.success(t('auth.setupSuccess'));
      navigate('/', { replace: true });
    } catch (error) {
      setSubmitError(errorMessage(error));
    }
  });

  return (
    <AuthLayout>
      <Card>
        <CardContent className="p-6">
          <div className="mb-5 flex flex-col items-center text-center">
            <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-[color-mix(in_srgb,var(--brand)_12%,transparent)] text-[var(--brand)]">
              <ShieldCheck className="h-5 w-5" aria-hidden />
            </div>
            <h1 className="text-lg font-semibold">{t('auth.setupTitle')}</h1>
            <p className="mt-1 text-sm text-[var(--muted-foreground)]">{t('auth.setupSubtitle')}</p>
          </div>
          <form
            className="space-y-4"
            onSubmit={(event) => {
              void onSubmit(event);
            }}
          >
            <input
              type="text"
              id="setup-username"
              name="username"
              autoComplete="username"
              value="admin"
              readOnly
              tabIndex={-1}
              aria-hidden="true"
              className="sr-only"
            />
            <Field
              label={t('auth.password')}
              htmlFor="setup-password"
              error={errors.password?.message}
              hint={t('auth.setupHint')}
              required
            >
              <Input
                id="setup-password"
                type="password"
                autoComplete="new-password"
                autoFocus
                invalid={Boolean(errors.password)}
                {...register('password')}
              />
            </Field>
            <Field
              label={t('auth.confirmPassword')}
              htmlFor="setup-confirm"
              error={errors.confirmPassword?.message}
              required
            >
              <Input
                id="setup-confirm"
                type="password"
                autoComplete="new-password"
                invalid={Boolean(errors.confirmPassword)}
                {...register('confirmPassword')}
              />
            </Field>
            {submitError ? <Alert tone="danger">{submitError}</Alert> : null}
            <Button type="submit" className="w-full" loading={isSubmitting}>
              {isSubmitting ? t('auth.settingUp') : t('auth.setup')}
            </Button>
          </form>
        </CardContent>
      </Card>
    </AuthLayout>
  );
}
