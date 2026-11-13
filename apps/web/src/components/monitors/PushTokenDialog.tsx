import { useTranslation } from 'react-i18next';
import { useAuth } from '../../providers/AuthProvider';
import { Button, CopyButton, Dialog, Input } from '../ui';

export interface PushTokenDialogProps {
  open: boolean;
  token: string;
  title: string;
  hint: string;
  onOpenChange: (open: boolean) => void;
  onDone?: () => void;
}

/**
 * One-time reveal dialog for a newly created or rotated push token. Content is
 * spaced on a 24px rhythm; every copyable block sits in a recessed glass well.
 */
export function PushTokenDialog({ open, token, title, hint, onOpenChange, onDone }: PushTokenDialogProps) {
  const { t } = useTranslation();
  const { baseUrl } = useAuth();
  const base = baseUrl || (typeof window !== 'undefined' ? window.location.origin : '');
  const pushUrl = `${base}/api/push/${token}`;
  const curl = `curl -X POST "${pushUrl}" \\\n  -H 'Content-Type: application/json' \\\n  -d '{"status":"up","metrics":{"remaining":{"value":12.5,"unit":"%"}}}'`;

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={hint}
      size="lg"
      footer={
        <Button
          onClick={() => {
            onOpenChange(false);
            onDone?.();
          }}
        >
          {t('common.close')}
        </Button>
      }
    >
      <div className="space-y-6">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="type-label">{t('monitorForm.pushTokenTitle')}</p>
            <CopyButton value={token} label={t('monitorForm.copyToken')} />
          </div>
          <Input
            readOnly
            value={token}
            className="font-mono text-xs"
            onFocus={(event) => event.target.select()}
          />
          <p className="text-xs text-warning">{t('monitorForm.pushTokenOnlyOnce')}</p>
        </div>

        <div className="space-y-2">
          <p className="type-label">{t('monitorForm.pushUrl')}</p>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Input readOnly value={pushUrl} className="min-w-0 flex-1 font-mono text-xs" />
            <CopyButton value={pushUrl} className="shrink-0" />
          </div>
        </div>

        <div className="space-y-2">
          <p className="type-label">{t('monitorForm.pushCurl')}</p>
          <pre className="glass-flat max-h-44 overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-xs leading-relaxed text-white/80">
            {curl}
          </pre>
          <div className="flex flex-wrap items-center gap-3">
            <CopyButton value={curl} />
            <p className="min-w-0 text-xs text-moonlight">{t('monitorForm.pushUrlHint')}</p>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
