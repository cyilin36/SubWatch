import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Activity,
  CreditCard,
  Download,
  FileJson,
  GitBranch,
  LayoutTemplate,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
  type LucideIcon,
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
import { TemplateGitImportDialog } from '../components/templates/TemplateGitImportDialog';
import { TemplateImportDialog } from '../components/templates/TemplateImportDialog';

const KINDS: TemplateKind[] = ['subscription', 'monitor'];

const KIND_ICONS: Record<TemplateKind, LucideIcon> = {
  subscription: CreditCard,
  monitor: Activity,
};

interface TemplateCardProps {
  template: TemplateSummaryDto;
  timezone: string;
  locale: string;
  exporting: boolean;
  updating: boolean;
  onExport: () => void;
  onUpdate: () => void;
  onDelete: () => void;
}

/**
 * One template row: the whole card navigates to the editor through a stretched
 * link on its title, while the action buttons sit above that overlay.
 */
function TemplateCard({
  template,
  timezone,
  locale,
  exporting,
  updating,
  onExport,
  onUpdate,
  onDelete,
}: TemplateCardProps) {
  const { t } = useTranslation();
  const KindIcon = KIND_ICONS[template.kind];
  const sourceLabel = template.sourceLabel ?? template.sourceUrl ?? '';
  const sourceIsLink = /^https?:\/\//i.test(template.sourceUrl ?? '');

  return (
    <Card interactive className="flex flex-col">
      <div className="flex items-start gap-3 p-5 pb-3">
        <div
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[16px] border border-ink/15 bg-ink/5 text-xl text-moonlight"
          style={template.color ? { borderColor: template.color } : undefined}
          aria-hidden
        >
          {template.icon || <KindIcon className="h-5 w-5" />}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="min-w-0 text-body-lg font-medium leading-snug text-ink">
            <Link
              to={`/templates/${template.id}`}
              className="block max-w-full after:absolute after:inset-0 after:content-[''] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/50 focus-visible:ring-offset-2 focus-visible:ring-offset-night"
            >
              <span className="block truncate">{template.name}</span>
            </Link>
          </h3>
          {template.sourceUrl ? (
            <p className="relative z-10 mt-1 truncate text-xs text-moonlight" title={template.sourceUrl}>
              {sourceIsLink ? (
                <a
                  href={template.sourceUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="underline decoration-ink/20 underline-offset-2 transition-colors duration-500 ease-glass hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/50 focus-visible:ring-offset-2 focus-visible:ring-offset-night"
                >
                  {t('templates.list.sourceLabel', { label: sourceLabel })}
                </a>
              ) : (
                <span>{t('templates.list.sourceLabel', { label: sourceLabel })}</span>
              )}
            </p>
          ) : null}
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            <Badge tone="muted">{t(templateKindLabelKey(template.kind))}</Badge>
            {template.category ? <Badge tone="info">{template.category}</Badge> : null}
            {template.version ? (
              <Badge tone="muted">{t('templates.list.versionBadge', { version: template.version })}</Badge>
            ) : null}
          </div>
        </div>
      </div>

      <div className="flex-1 px-5 pb-3">
        <p className="line-clamp-2 min-h-[2.5rem] text-xs leading-relaxed text-moonlight">
          {template.description || t('templates.list.noDescription')}
        </p>
        <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-moonlight">
          <span>{t('templates.list.fieldCount', { count: template.fieldCount })}</span>
          <span>{t('templates.list.usageCount', { count: template.usageCount })}</span>
          <span>{formatDateTime(template.updatedAt, timezone, locale)}</span>
        </div>
      </div>

      <div className="relative z-10 flex flex-wrap items-center justify-end gap-1.5 border-t border-ink/10 p-2.5">
        <Button variant="outline" size="sm" loading={exporting} onClick={onExport}>
          <Download className="h-3.5 w-3.5" aria-hidden />
          {t('templates.list.export')}
        </Button>
        {template.sourceUrl ? (
          <Button variant="outline" size="sm" loading={updating} onClick={onUpdate}>
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            {t('templates.list.updateFromSource')}
          </Button>
        ) : null}
        <EditButton id={template.id} />
        <Button variant="danger" size="sm" onClick={onDelete}>
          <Trash2 className="h-3.5 w-3.5" aria-hidden />
          {t('common.delete')}
        </Button>
      </div>
    </Card>
  );
}

/** Renders the editor link as an explicit outline action for keyboard users. */
function EditButton({ id }: { id: string }) {
  const { t } = useTranslation();
  return (
    <Link
      to={`/templates/${id}`}
      className="relative z-10 inline-flex h-9 items-center gap-1.5 rounded-btn border border-ink/15 bg-transparent px-4 text-xs font-medium text-ink transition-colors duration-500 ease-glass hover:border-ink/30 hover:bg-ink/8 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/50 focus-visible:ring-offset-2 focus-visible:ring-offset-night"
    >
      <Pencil className="h-3.5 w-3.5" aria-hidden />
      {t('common.edit')}
    </Link>
  );
}

export function TemplatesPage() {
  const { t } = useTranslation();
  const { timezone, locale } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [kind, setKind] = useState<TemplateKind>('subscription');
  const [createOpen, setCreateOpen] = useState(false);
  const [createKind, setCreateKind] = useState<TemplateKind>('subscription');
  const [importOpen, setImportOpen] = useState(false);
  const [gitImportOpen, setGitImportOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<TemplateSummaryDto | null>(null);
  const [updateTarget, setUpdateTarget] = useState<TemplateSummaryDto | null>(null);

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

  const updateMutation = useMutation({
    mutationFn: (template: TemplateSummaryDto) => api.templates.updateFromSource(template.id),
    onSuccess: () => {
      toast.success(t('templates.list.updateSuccess'));
      void queryClient.invalidateQueries({ queryKey: ['templates'] });
      setUpdateTarget(null);
    },
    onError: (error) => toast.error(t('templates.list.updateFailed'), { description: errorMessage(error) }),
  });

  const templates = templatesQuery.data ?? [];

  const renderList = () => {
    if (templatesQuery.isPending) {
      return (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} className="h-52 rounded-card" />
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
                variant="secondary"
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
              <Button variant="outline" onClick={() => setGitImportOpen(true)}>
                <GitBranch className="h-4 w-4" aria-hidden />
                {t('templates.gitImport.button')}
              </Button>
            </div>
          }
        />
      );
    }

    return (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {templates.map((template) => (
          <TemplateCard
            key={template.id}
            template={template}
            timezone={timezone}
            locale={locale}
            exporting={exportMutation.isPending && exportMutation.variables?.id === template.id}
            updating={updateMutation.isPending && updateMutation.variables?.id === template.id}
            onExport={() => exportMutation.mutate(template)}
            onUpdate={() => setUpdateTarget(template)}
            onDelete={() => setDeleteTarget(template)}
          />
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
            <Button variant="secondary" size="sm" onClick={() => setGitImportOpen(true)}>
              <GitBranch className="h-4 w-4" aria-hidden />
              {t('templates.gitImport.button')}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setImportOpen(true)}>
              <Upload className="h-4 w-4" aria-hidden />
              {t('templates.import.button')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setCreateKind(kind);
                setCreateOpen(true);
              }}
            >
              <Plus className="h-4 w-4" aria-hidden />
              {t('templates.newTemplate')}
            </Button>
          </>
        }
      />

      <Tabs value={kind} onValueChange={(value) => setKind(value as TemplateKind)}>
        <TabsList className="sm:w-auto">
          {KINDS.map((entry) => {
            const Icon = KIND_ICONS[entry];
            return (
              <TabsTrigger key={entry} value={entry}>
                <Icon className="h-3.5 w-3.5" aria-hidden />
                {t(templateKindLabelKey(entry))}
              </TabsTrigger>
            );
          })}
        </TabsList>
        {KINDS.map((entry) => (
          <TabsContent key={entry} value={entry}>
            {entry === kind ? renderList() : null}
          </TabsContent>
        ))}
      </Tabs>

      <p className="mt-6 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-moonlight">
        <FileJson className="h-3.5 w-3.5" aria-hidden />
        {t('templates.list.hint')}
        <Link
          to="/subscriptions/new"
          className="text-moonlight underline decoration-ink/20 underline-offset-4 transition-colors duration-500 ease-glass hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/50 focus-visible:ring-offset-2 focus-visible:ring-offset-night"
        >
          {t('templates.list.trySubscription')}
        </Link>
        <span aria-hidden>·</span>
        <Link
          to="/monitors/new"
          className="text-moonlight underline decoration-ink/20 underline-offset-4 transition-colors duration-500 ease-glass hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ink/50 focus-visible:ring-offset-2 focus-visible:ring-offset-night"
        >
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
        <div className="space-y-4">
          <Segmented
            value={createKind}
            onChange={setCreateKind}
            options={KINDS.map((entry) => ({ value: entry, label: t(templateKindLabelKey(entry)) }))}
          />
          <p className="text-xs text-moonlight">{t('templates.list.kindFixedHint')}</p>
        </div>
      </Dialog>

      <TemplateImportDialog
        open={importOpen}
        onOpenChange={setImportOpen}
        onImported={(template) => setKind(template.kind)}
      />

      <TemplateGitImportDialog open={gitImportOpen} onOpenChange={setGitImportOpen} />

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

      <ConfirmDialog
        open={Boolean(updateTarget)}
        onOpenChange={(open) => {
          if (!open) setUpdateTarget(null);
        }}
        title={t('templates.list.updateFromSource')}
        description={t('templates.list.updateConfirm', { name: updateTarget?.name ?? '' })}
        confirmLabel={t('templates.list.updateFromSource')}
        destructive={false}
        loading={updateMutation.isPending}
        onConfirm={() => {
          if (updateTarget) updateMutation.mutate(updateTarget);
        }}
      />
    </div>
  );
}
