import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Download,
  FileJson,
  LayoutTemplate,
  Pencil,
  Plus,
  Trash2,
  Upload,
} from 'lucide-react';
import type { TemplateKind, TemplateSummaryDto } from '@subwatch/shared';
import { api } from '../lib/api';
import {
  downloadJsonFile,
  templateExportFilename,
  templateKindLabelKey,
} from '../lib/templates';
import { useAuth } from '../providers/AuthProvider';
import { errorMessage, formatDateTime } from '../lib/utils';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  Dialog,
  EmptyState,
  ErrorState,
  PageHeader,
  Skeleton,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '../components/ui';
import { Segmented } from '../components/common/fields';
import { TemplateImportDialog } from '../components/templates/TemplateImportDialog';

const KINDS: TemplateKind[] = ['subscription', 'monitor'];

export function TemplatesPage() {
  const { t } = useTranslation();
  const { timezone, locale } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [kind, setKind] = useState<TemplateKind>('subscription');
  const [createOpen, setCreateOpen] = useState(false);
  const [createKind, setCreateKind] = useState<TemplateKind>('subscription');
  const [importOpen, setImportOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<TemplateSummaryDto | null>(null);

  const templatesQuery = useQuery({
    queryKey: ['templates', kind],
    queryFn: () => api.templates.list(kind),
  });

  const deleteMutation = useMutation({
    mutationFn: (template: TemplateSummaryDto) => api.templates.remove(template.id),
    onSuccess: (_data, template) => {
      toast.success(t('templates.list.deleted', { name: template.name }));
      void queryClient.invalidateQueries({ queryKey: ['templates'] });
      setDeleteTarget(null);
    },
    onError: (error) => toast.error(t('errors.saveFailed'), { description: errorMessage(error) }),
  });

  const exportMutation = useMutation({
    mutationFn: async (template: TemplateSummaryDto) => {
      const envelope = await api.templates.export(template.id);
      downloadJsonFile(templateExportFilename(template.name), envelope);
      return template;
    },
    onSuccess: (template) => toast.success(t('templates.list.exportSuccess', { name: template.name })),
    onError: (error) => toast.error(t('templates.list.exportFailed'), { description: errorMessage(error) }),
  });

  const templates = templatesQuery.data ?? [];

  const renderList = () => {
    if (templatesQuery.isPending) {
      return (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} className="h-44" />
          ))}
        </div>
      );
    }
    if (templatesQuery.isError) {
      return <ErrorState error={templatesQuery.error} onRetry={() => void templatesQuery.refetch()} />;
    }
    if (templates.length === 0) {
      return (
        <EmptyState
          icon={<LayoutTemplate className="h-8 w-8" aria-hidden />}
          title={t('templates.list.emptyTitle', { kind: t(templateKindLabelKey(kind)) })}
          description={t('templates.list.emptyDescription')}
          action={
            <div className="flex flex-wrap items-center justify-center gap-2">
              <Button
                onClick={() => {
                  setCreateKind(kind);
                  setCreateOpen(true);
                }}
              >
                <Plus className="h-4 w-4" aria-hidden />
                {t('templates.newTemplate')}
              </Button>
              <Button variant="outline" onClick={() => setImportOpen(true)}>
                <Upload className="h-4 w-4" aria-hidden />
                {t('templates.import.button')}
              </Button>
            </div>
          }
        />
      );
    }

    return (
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {templates.map((template) => (
          <Card key={template.id} className="flex flex-col">
            <div className="flex items-start gap-3 p-4 pb-2">
              <div
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-[var(--border)] bg-[var(--surface-muted)] text-xl"
                style={template.color ? { borderColor: template.color } : undefined}
                aria-hidden
              >
                {template.icon || <LayoutTemplate className="h-5 w-5 text-[var(--muted-foreground)]" />}
              </div>
              <div className="min-w-0 flex-1">
                <h3 className="truncate text-sm font-semibold">{template.name}</h3>
                <div className="mt-1 flex flex-wrap items-center gap-1.5">
                  {template.category ? <Badge tone="muted">{template.category}</Badge> : null}
                  <Badge tone="info">{t(templateKindLabelKey(template.kind))}</Badge>
                </div>
              </div>
            </div>

            <div className="flex-1 px-4 pb-2">
              <p className="line-clamp-2 min-h-[2.5rem] text-xs text-[var(--muted-foreground)]">
                {template.description || t('templates.list.noDescription')}
              </p>
              <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--muted-foreground)]">
                <span>{t('templates.list.fieldCount', { count: template.fieldCount })}</span>
                <span>{t('templates.list.usageCount', { count: template.usageCount })}</span>
                <span>{formatDateTime(template.updatedAt, timezone, locale)}</span>
              </div>
            </div>

            <div className="flex flex-wrap items-center justify-end gap-1.5 border-t border-[var(--border)] p-2">
              <Button
                variant="ghost"
                size="sm"
                loading={exportMutation.isPending && exportMutation.variables?.id === template.id}
                onClick={() => exportMutation.mutate(template)}
              >
                <Download className="h-3.5 w-3.5" aria-hidden />
                {t('templates.list.export')}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => navigate(`/templates/${template.id}`)}>
                <Pencil className="h-3.5 w-3.5" aria-hidden />
                {t('common.edit')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-[var(--danger)]"
                onClick={() => setDeleteTarget(template)}
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
                {t('common.delete')}
              </Button>
            </div>
          </Card>
        ))}
      </div>
    );
  };

  return (
    <div>
      <PageHeader
        title={t('templates.title')}
        description={t('templates.subtitle')}
        icon={<LayoutTemplate className="h-5 w-5" />}
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => setImportOpen(true)}>
              <Upload className="h-4 w-4" aria-hidden />
              {t('templates.import.button')}
            </Button>
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" aria-hidden />
              {t('templates.newTemplate')}
            </Button>
          </>
        }
      />

      <Tabs value={kind} onValueChange={(value) => setKind(value as TemplateKind)}>
        <TabsList className="max-w-sm">
          {KINDS.map((entry) => (
            <TabsTrigger key={entry} value={entry}>
              {t(templateKindLabelKey(entry))}
            </TabsTrigger>
          ))}
        </TabsList>
        {KINDS.map((entry) => (
          <TabsContent key={entry} value={entry}>
            {entry === kind ? renderList() : null}
          </TabsContent>
        ))}
      </Tabs>

      <p className="mt-3 flex flex-wrap items-center gap-1 text-xs text-[var(--muted-foreground)]">
        <FileJson className="h-3.5 w-3.5" aria-hidden />
        {t('templates.list.hint')}
        <Link to="/subscriptions/new" className="text-[var(--brand)] hover:underline">
          {t('templates.list.trySubscription')}
        </Link>
        <span aria-hidden>·</span>
        <Link to="/monitors/new" className="text-[var(--brand)] hover:underline">
          {t('templates.list.tryMonitor')}
        </Link>
      </p>

      <Dialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        title={t('templates.list.newTitle')}
        description={t('templates.list.newHint')}
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              onClick={() => {
                setCreateOpen(false);
                navigate(`/templates/new?kind=${createKind}`);
              }}
            >
              {t('templates.list.newContinue')}
            </Button>
          </>
        }
      >
        <Segmented
          value={createKind}
          onChange={setCreateKind}
          options={KINDS.map((entry) => ({ value: entry, label: t(templateKindLabelKey(entry)) }))}
        />
        <p className="mt-2 text-xs text-[var(--muted-foreground)]">{t('templates.list.kindFixedHint')}</p>
      </Dialog>

      <TemplateImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={(template) => setKind(template.kind)}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title={t('templates.list.deleteTitle')}
        description={
          <span className="space-y-1">
            <span className="block">{t('templates.list.deleteDescription', { name: deleteTarget?.name ?? '' })}</span>
            <span className="block text-xs">{t('templates.list.deleteHint')}</span>
          </span>
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
