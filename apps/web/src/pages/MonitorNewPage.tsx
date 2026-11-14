import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Activity } from 'lucide-react';
import type { MonitorInput, TemplateDto, TemplateRenderResultDto } from '@subwatch/shared';
import type { MonitorCreateResult } from '../lib/api';
import { PageHeader } from '../components/ui';
import { MonitorForm } from '../components/monitors/MonitorForm';
import { PushTokenDialog } from '../components/monitors/PushTokenDialog';
import { TemplateApplyCard } from '../components/templates/TemplateApplyCard';
import { TemplatePendingCard } from '../components/templates/TemplatePendingCard';

export function MonitorNewPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [created, setCreated] = useState<MonitorCreateResult | null>(null);
  const [applied, setApplied] = useState<{ template: TemplateDto; input: MonitorInput } | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);
  const pendingTemplate = selectedTemplateId !== null && applied === null;

  const handleApply = (template: TemplateDto, result: TemplateRenderResultDto) => {
    if (result.kind !== 'monitor') return;
    setApplied({ template, input: result.payload });
  };

  return (
    <div className="space-y-8">
      <PageHeader
        label={t('nav.monitors')}
        title={t('monitors.newMonitor')}
        description={t('monitors.subtitle')}
        icon={<Activity className="h-5 w-5" />}
      />
      <div className="space-y-8">
        <TemplateApplyCard
          kind="monitor"
          appliedTemplate={applied?.template ?? null}
          onApply={handleApply}
          onClear={() => setApplied(null)}
          onSelectionChange={setSelectedTemplateId}
        />
        {pendingTemplate ? (
          <TemplatePendingCard kind="monitor" />
        ) : (
          <div className="space-y-4">
            {applied ? (
              <p className="text-body text-moonlight">{t('templates.apply.prefilledHint')}</p>
            ) : null}
            <MonitorForm
              key={applied?.template.id ?? 'blank'}
              mode="create"
              initialInput={applied?.input}
              templateId={applied?.template.id ?? null}
              onSaved={(result) => {
                if (result.pushToken) setCreated(result as MonitorCreateResult);
                else navigate(`/monitors/${result.id}`);
              }}
            />
          </div>
        )}
      </div>
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
