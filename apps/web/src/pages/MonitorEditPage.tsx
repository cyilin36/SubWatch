import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useQuery } from '@tanstack/react-query';
import { Activity } from 'lucide-react';
import { api } from '../lib/api';
import { ErrorState, FullPageSpinner, PageHeader } from '../components/ui';
import { MonitorForm } from '../components/monitors/MonitorForm';

export function MonitorEditPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { id = '' } = useParams<{ id: string }>();

  const monitorQuery = useQuery({
    queryKey: ['monitor', id],
    queryFn: () => api.monitors.get(id),
    enabled: Boolean(id),
  });

  if (monitorQuery.isPending) {
    return (
      <div className="space-y-8">
        <PageHeader title={t('monitors.editMonitor')} />
        <FullPageSpinner label={t('common.loading')} />
      </div>
    );
  }
  if (monitorQuery.isError || !monitorQuery.data) {
    return (
      <div className="space-y-8">
        <PageHeader title={t('monitors.editMonitor')} />
        <ErrorState error={monitorQuery.error} onRetry={() => void monitorQuery.refetch()} />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <PageHeader
        label={t('nav.monitors')}
        title={t('monitors.editMonitor')}
        description={monitorQuery.data.name}
        icon={<Activity className="h-5 w-5" />}
      />
      <MonitorForm
        mode="edit"
        monitor={monitorQuery.data}
        onSaved={() => navigate(`/monitors/${monitorQuery.data?.id ?? id}`)}
      />
    </div>
  );
}
