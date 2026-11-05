import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { addCycle, renewInputSchema, type SubscriptionDto } from '@subwatch/shared';
import { api, isApiError } from '../../lib/api';
import { errorMessage, formatDateOnly } from '../../lib/utils';
import { useAuth } from '../../providers/AuthProvider';
import { AmountInput, Segmented } from '../common/fields';
import { Alert, Button, Dialog, Field, Input, Select, Textarea } from '../ui';
import { CURRENCY_OPTIONS } from '../../lib/presets';

export interface RenewTarget {
  id: string;
  name: string;
  expiryDate: string;
  amountCents: number | null;
  currency: string;
  cycle?: SubscriptionDto['cycle'];
  cycleDays?: number | null;
}

export interface RenewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: RenewTarget | null;
}

/** Renewal dialog shared by the dashboard, subscription list and detail pages. */
export function RenewDialog({ open, onOpenChange, target }: RenewDialogProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { timezone } = useAuth();

  const [mode, setMode] = useState<'cycle' | 'custom'>('cycle');
  const [base, setBase] = useState<'expiry' | 'today'>('expiry');
  const [customDate, setCustomDate] = useState('');
  const [amountCents, setAmountCents] = useState<number | null>(null);
  const [currency, setCurrency] = useState('CNY');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !target) return;
    setMode('cycle');
    setBase('expiry');
    setCustomDate(addCycle(target.expiryDate, 'month'));
    setAmountCents(target.amountCents);
    setCurrency(target.currency || 'CNY');
    setNote('');
    setError(null);
  }, [open, target]);

  const mutation = useMutation({
    mutationFn: async () => {
      if (!target) throw new Error('No subscription selected');
      const payload = {
        mode,
        base,
        date: mode === 'custom' ? customDate : undefined,
        amountCents,
        currency,
        note,
        expectedExpiryDate: target.expiryDate,
      };
      const parsed = renewInputSchema.safeParse(payload);
      if (!parsed.success) {
        throw new Error(parsed.error.issues[0]?.message ?? 'Invalid renewal input');
      }
      return api.subscriptions.renew(target.id, parsed.data);
    },
    onSuccess: (subscription) => {
      toast.success(t('renew.success', { date: subscription.expiryDate }));
      void queryClient.invalidateQueries({ queryKey: ['subscriptions'] });
      void queryClient.invalidateQueries({ queryKey: ['subscription', subscription.id] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      onOpenChange(false);
    },
    onError: (mutationError) => {
      if (isApiError(mutationError) && mutationError.status === 409) {
        setError(t('renew.expectedExpiryChanged'));
        return;
      }
      setError(errorMessage(mutationError));
    },
  });

  const cyclePreview = (() => {
    if (!target?.cycle) return null;
    const start = base === 'expiry' ? target.expiryDate : new Date().toISOString().slice(0, 10);
    return addCycle(start, target.cycle, target.cycleDays ?? null);
  })();

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('renew.title')}
      description={target ? t('renew.description', { name: target.name }) : undefined}
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>
            {t('common.cancel')}
          </Button>
          <Button
            loading={mutation.isPending}
            onClick={() => {
              setError(null);
              mutation.mutate();
            }}
          >
            {mutation.isPending ? t('renew.submitting') : t('renew.confirm')}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label={t('renew.mode')}>
          <Segmented
            value={mode}
            onChange={setMode}
            options={[
              { value: 'cycle', label: t('renew.cycleMode') },
              { value: 'custom', label: t('renew.customMode') },
            ]}
          />
        </Field>

        {mode === 'cycle' ? (
          <Field label={t('renew.base')} hint={t('renew.previewHint')}>
            <Segmented
              value={base}
              onChange={setBase}
              options={[
                { value: 'expiry', label: t('renew.baseExpiry') },
                { value: 'today', label: t('renew.baseToday') },
              ]}
            />
          </Field>
        ) : (
          <Field
            label={t('renew.newExpiry')}
            htmlFor="renew-custom-date"
            error={mode === 'custom' && !customDate ? t('renew.customDateRequired') : undefined}
            required
          >
            <Input
              id="renew-custom-date"
              type="date"
              value={customDate}
              onChange={(event) => setCustomDate(event.target.value)}
            />
          </Field>
        )}

        {mode === 'cycle' && cyclePreview ? (
          <p className="rounded-lg bg-[var(--surface-muted)] px-3 py-2 text-sm">
            {t('renew.preview')}: <span className="font-medium">{formatDateOnly(cyclePreview)}</span>
          </p>
        ) : null}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label={t('renew.amount')} hint={t('renew.amountHint')}>
            <AmountInput
              value={amountCents}
              onChange={setAmountCents}
              currency={currency}
              placeholder="0.00"
            />
          </Field>
          <Field label={t('renew.currency')}>
            <Select
              value={currency}
              onValueChange={setCurrency}
              options={CURRENCY_OPTIONS.map((code) => ({ value: code, label: code }))}
            />
          </Field>
        </div>

        <Field label={t('renew.note')}>
          <Textarea
            rows={2}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder={t('renew.notePlaceholder')}
          />
        </Field>

        <p className="text-xs text-[var(--muted-foreground)]">
          {t('settings.timezone')}: {timezone}
        </p>

        {error ? <Alert tone="danger">{error}</Alert> : null}
      </div>
    </Dialog>
  );
}
