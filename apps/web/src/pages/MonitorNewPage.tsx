import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Activity } from 'lucide-react';
import { api, type MonitorCreateResult } from '../lib/api';
import { PageHeader } from '../components/ui';
import { MonitorForm } from '../components/monitors/MonitorForm';
import { PushTokenDialog } from '../components/monitors/PushTokenDialog';

export function MonitorNewPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [created, setCreated] = useState<MonitorCreateResult | null>(null);

  return (
    <div>
      <PageHeader
        title={t('monitors.newMonitor')}
        description={t('monitors.subtitle')}
        icon={<Activity className="h-5 w-5" />}
      />
      <MonitorForm
        mode="create"
        onSaved={(result) => {
          if (result.pushToken) setCreated(result as MonitorCreateResult);
          else navigate(`/monitors/${result.id}`);
        }}
      />
      <PushTokenDialog
        open={Boolean(created)}
        token={created?.pushToken ?? ''}
        title={t('monitorForm.pushTokenCreatedTitle')}
        hint={t('monitorForm.pushTokenCreatedHint')}
        onOpenChange={(open) => {
          if (!open && created) navigate(`/monitors/${created.id}`);
        }}
        onDone={() => {
          if (created) navigate(`/monitors/${created.id}`);
        }}
      />
    </div>
  );
}
