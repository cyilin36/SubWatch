import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowRight } from 'lucide-react';
import { renewInputSchema, type Cycle } from '@subwatch/shared';
import { api, isApiError } from '../../lib/api';
import { nextExpiryDate } from '../../lib/subscriptions';
import { errorMessage, formatDateOnly } from '../../lib/utils';
import { useAuth } from '../../providers/AuthProvider';
import { Alert, Button, Dialog, Field, Input } from '../ui';

export interface RenewTarget {
  id: string;
  name: string;
  expiryDate: string;
  cycle: Cycle;
}

export interface RenewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  target: RenewTarget | null;
}

/**
 * One-click renewal: a single editable date prefilled with
 * max(today, expiry) + cycle. The current expiry is sent along as an
 * optimistic-concurrency guard (409 when it changed elsewhere).
 */
export function RenewDialog({ open, onOpenChange, target }: RenewDialogProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { timezone } = useAuth();
  const [date, setDate] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !target) return;
    setDate(nextExpiryDate(target.expiryDate, target.cycle, timezone));
    setError(null);
  }, [open, target, timezone]);

  const mutation = useMutation({
    mutationFn: () => {
      if (!target) throw new Error('No subscription selected');
      const parsed = renewInputSchema.safeParse({ expectedExpiryDate: target.expiryDate, date });
      if (!parsed.success) {
        throw new Error(parsed.error.issues[0]?.message ?? 'Invalid renewal input');
      }
      return api.subscriptions.renew(target.id, parsed.data);
    },
    onSuccess: (subscription) => {
      toast.success(t('renew.success', { date: subscription.expiryDate }));
      void queryClient.invalidateQueries({ queryKey: ['subscriptions'] });
      void queryClient.invalidateQueries({ queryKey: ['subscription', subscription.id] });
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

  const dateMissing = date.trim() === '';

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
            disabled={dateMissing}
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
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-[var(--surface-muted)] px-3 py-2 text-sm">
          <span className="text-[var(--muted-foreground)]">{t('renew.current')}</span>
          <span className="font-medium">{target ? formatDateOnly(target.expiryDate) : '—'}</span>
          <ArrowRight className="h-3.5 w-3.5 text-[var(--muted-foreground)]" aria-hidden />
          <span className="font-medium">{dateMissing ? '—' : date}</span>
        </div>

        <Field
          label={t('renew.newExpiry')}
          htmlFor="renew-date"
          hint={t('renew.hint')}
          required
          error={dateMissing ? t('renew.dateRequired') : undefined}
        >
          <Input
            id="renew-date"
            type="date"
            value={date}
            invalid={dateMissing}
            onChange={(event) => setDate(event.target.value)}
          />
        </Field>

        {error ? <Alert tone="danger">{error}</Alert> : null}
      </div>
    </Dialog>
  );
}
