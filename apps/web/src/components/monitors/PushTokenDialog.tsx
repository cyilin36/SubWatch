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

/** One-time reveal dialog for a newly created or rotated push token. */
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
      <div className="space-y-4">
        <div>
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <p className="text-sm font-medium">{t('monitorForm.pushTokenTitle')}</p>
            <CopyButton value={token} label={t('monitorForm.copyToken')} />
          </div>
          <Input readOnly value={token} className="font-mono text-xs" onFocus={(event) => event.target.select()} />
          <p className="mt-1 text-xs text-[var(--warning)]">{t('monitorForm.pushTokenOnlyOnce')}</p>
        </div>

        <div>
          <p className="mb-1.5 text-sm font-medium">{t('monitorForm.pushUrl')}</p>
          <div className="flex items-center gap-2">
            <Input readOnly value={pushUrl} className="font-mono text-xs" />
            <CopyButton value={pushUrl} />
          </div>
        </div>

        <div>
          <p className="mb-1.5 text-sm font-medium">{t('monitorForm.pushCurl')}</p>
          <pre className="max-h-44 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-[var(--surface-muted)] p-3 font-mono text-xs">
            {curl}
          </pre>
          <div className="mt-1.5 flex items-center gap-2">
            <CopyButton value={curl} />
            <p className="text-xs text-[var(--muted-foreground)]">{t('monitorForm.pushUrlHint')}</p>
          </div>
        </div>

      </div>
    </Dialog>
  );
}
