import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, GitBranch, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { templateSourceInputSchema, type TemplateSourceDto, type TemplateSourceInput } from '@subwatch/shared';
import { api } from '../lib/api';
import { applyZodIssues, getFieldError } from '../lib/form';
import { errorMessage, formatDateTime } from '../lib/utils';
import { useAuth } from '../providers/AuthProvider';
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  Dialog,
  EmptyState,
  ErrorState,
  Field,
  Input,
  PageHeader,
  Skeleton,
  Switch,
} from '../components/ui';

interface SourceFormValues {
  name: string;
  url: string;
  branch: string;
  enabled: boolean;
}

function blankSourceForm(): SourceFormValues {
  return { name: '', url: '', branch: '', enabled: true };
}

function sourceToForm(source: TemplateSourceDto): SourceFormValues {
  return {
    name: source.name,
    url: source.url,
    branch: source.branch,
    enabled: source.enabled,
  };
}

/** Create/edit dialog for a template repository. */
function SourceDialog({
  open,
  onOpenChange,
  source,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  source: TemplateSourceDto | null;
  onCreated: (created: TemplateSourceDto) => void;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const form = useForm<SourceFormValues>({ defaultValues: blankSourceForm() });

  useEffect(() => {
    if (!open) return;
    form.reset(source ? sourceToForm(source) : blankSourceForm());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, source]);

  const errors = form.formState.errors;

  const saveMutation = useMutation({
    mutationFn: (input: TemplateSourceInput) =>
      source ? api.templateSources.update(source.id, input) : api.templateSources.create(input),
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: ['template-sources'] });
      if (source) {
        toast.success(t('templateSources.updated'));
        onOpenChange(false);
      } else {
        toast.success(t('templateSources.created'));
        onOpenChange(false);
        onCreated(saved);
      }
    },
    onError: (error) =>
      toast.error(t('templateSources.saveFailed'), { description: errorMessage(error) }),
  });

  const onSubmit = form.handleSubmit((values) => {
    const parsed = templateSourceInputSchema.safeParse({
      name: values.name.trim(),
      url: values.url.trim(),
      branch: values.branch.trim(),
      enabled: values.enabled,
    });
    if (!parsed.success) {
      applyZodIssues(form, parsed.error);
      return;
    }
    saveMutation.mutate(parsed.data);
  });

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={source ? t('templateSources.editTitle') : t('templateSources.newTitle')}
      description={t('templateSources.subtitle')}
      size="md"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saveMutation.isPending}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="source-form" loading={saveMutation.isPending}>
            {t('common.save')}
          </Button>
        </>
      }
    >
      <form
        id="source-form"
        noValidate
        className="space-y-4"
        onSubmit={(event) => {
          void onSubmit(event);
        }}
      >
        <Field label={t('templateSources.name')} error={getFieldError(errors, 'name')}>
          <Input
            placeholder={t('templateSources.namePlaceholder')}
            invalid={Boolean(getFieldError(errors, 'name'))}
            {...form.register('name')}
          />
        </Field>
        <Field label={t('templateSources.url')} error={getFieldError(errors, 'url')} required>
          <Input
            placeholder={t('templateSources.urlPlaceholder')}
            invalid={Boolean(getFieldError(errors, 'url'))}
            autoComplete="off"
            {...form.register('url')}
          />
        </Field>
        <Field label={t('templateSources.branch')} error={getFieldError(errors, 'branch')}>
          <Input
            placeholder={t('templateSources.branchPlaceholder')}
            invalid={Boolean(getFieldError(errors, 'branch'))}
            autoComplete="off"
            {...form.register('branch')}
          />
        </Field>
        <div className="glass-flat flex items-center justify-between gap-3 rounded-btn px-4 py-3">
          <p className="text-body font-medium text-ink">{t('templateSources.enabled')}</p>
          <Switch
            checked={form.watch('enabled')}
            onCheckedChange={(checked) => form.setValue('enabled', checked, { shouldDirty: true })}
            ariaLabel={t('templateSources.enabled')}
          />
        </div>
      </form>
    </Dialog>
  );
}

export function TemplateSourcesPage() {
  const { t } = useTranslation();
  const { timezone, locale } = useAuth();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingSource, setEditingSource] = useState<TemplateSourceDto | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TemplateSourceDto | null>(null);

  const sourcesQuery = useQuery({
    queryKey: ['template-sources'],
    queryFn: () => api.templateSources.list(),
    refetchInterval: 30_000,
  });

  const invalidateAll = () => {
    void queryClient.invalidateQueries({ queryKey: ['template-sources'] });
    void queryClient.invalidateQueries({ queryKey: ['templates'] });
  };

  const syncMutation = useMutation({
    mutationFn: (source: TemplateSourceDto) => api.templateSources.sync(source.id),
    onSuccess: (result) => {
      invalidateAll();
      if (result.ok) {
        toast.success(
          t('templateSources.syncSuccess', {
            added: result.added,
            updated: result.updated,
            removed: result.removed,
            skipped: result.skipped.length,
          }),
        );
      } else {
        toast.error(t('templateSources.syncFailed'), { description: result.error ?? undefined });
      }
    },
    onError: (error) =>
      toast.error(t('templateSources.syncFailed'), { description: errorMessage(error) }),
  });

  const deleteMutation = useMutation({
    mutationFn: (source: TemplateSourceDto) => api.templateSources.remove(source.id),
    onSuccess: () => {
      toast.success(t('templateSources.deleteSuccess'));
      setDeleteTarget(null);
      invalidateAll();
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

  const sources = sourcesQuery.data ?? [];

  const openCreate = () => {
    setEditingSource(null);
    setDialogOpen(true);
  };

  const openEdit = (source: TemplateSourceDto) => {
    setEditingSource(source);
    setDialogOpen(true);
  };

  const renderSource = (source: TemplateSourceDto) => {
    const syncing = syncMutation.isPending && syncMutation.variables?.id === source.id;
    const displayName = source.name || source.url;
    return (
      <Card key={source.id} className="flex flex-col p-5 sm:p-6">
        <div className="flex items-start gap-3">
          <span className="glass-flat flex h-12 w-12 shrink-0 items-center justify-center rounded-btn text-moonlight">
            <GitBranch className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-body font-medium text-ink" title={displayName}>
              {displayName}
            </p>
            <p className="mt-1 break-all text-xs text-moonlight" title={source.url}>
              {source.url}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <Badge tone={source.enabled ? 'success' : 'muted'} dot>
                {source.enabled ? t('common.enabled') : t('common.disabled')}
              </Badge>
              {source.branch ? <Badge tone="info">{source.branch}</Badge> : null}
              <Badge tone="muted">
                {t('templateSources.templateCount', { count: source.templateCount })}
              </Badge>
            </div>
          </div>
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
          <div className="min-w-0">
            <dt className="text-moonlight">{t('templateSources.lastSynced')}</dt>
            <dd className="mt-0.5 text-ink/85">
              {source.lastSyncedAt
                ? formatDateTime(source.lastSyncedAt, timezone, locale)
                : t('templateSources.neverSynced')}
            </dd>
          </div>
          <div className="min-w-0">
            <dt className="text-moonlight">{t('templateSources.lastCommit')}</dt>
            <dd className="mt-0.5 truncate font-mono text-ink/85">
              {source.lastCommit ? source.lastCommit.slice(0, 7) : '—'}
            </dd>
          </div>
        </dl>

        {source.lastError ? (
          <p
            className="mt-3 flex items-start gap-2 rounded-btn border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger"
            role="alert"
          >
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className="min-w-0 break-words">{source.lastError}</span>
          </p>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-ink/10 pt-4">
          <Button
            variant="outline"
            size="sm"
            loading={syncing}
            disabled={deleteMutation.isPending}
            onClick={() => syncMutation.mutate(source)}
          >
            {!syncing ? <RefreshCw className="h-3.5 w-3.5" aria-hidden /> : null}
            {syncing ? t('templateSources.syncing') : t('templateSources.sync')}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => openEdit(source)}>
            <Pencil className="h-3.5 w-3.5" aria-hidden />
            {t('common.edit')}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-danger hover:text-danger"
            onClick={() => setDeleteTarget(source)}
          >
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
            {t('common.delete')}
          </Button>
        </div>
      </Card>
    );
  };

  const renderList = () => {
    if (sourcesQuery.isPending) {
      return (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} className="h-56 rounded-card" />
          ))}
        </div>
      );
    }
    if (sourcesQuery.isError) {
      return <ErrorState error={sourcesQuery.error} onRetry={() => void sourcesQuery.refetch()} />;
    }
    if (sources.length === 0) {
      return (
        <EmptyState
          icon={<GitBranch className="h-8 w-8" aria-hidden />}
          title={t('templateSources.emptyTitle')}
          description={
            <span className="space-y-2">
              <span className="block">{t('templateSources.emptyDescription')}</span>
              <span className="block font-mono text-xs">{t('templateSources.formatHint')}</span>
            </span>
          }
          action={
            <Button variant="secondary" size="sm" onClick={openCreate}>
              <Plus className="h-4 w-4" aria-hidden />
              {t('templateSources.add')}
            </Button>
          }
        />
      );
    }
    return (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {sources.map((source) => renderSource(source))}
      </div>
    );
  };

  return (
    <div className="space-y-8">
      <PageHeader
        title={t('templateSources.title')}
        description={t('templateSources.subtitle')}
        icon={<GitBranch className="h-5 w-5" />}
        actions={
          <Button variant="secondary" size="sm" onClick={openCreate} disabled={sourcesQuery.isPending}>
            <Plus className="h-4 w-4" aria-hidden />
            {t('templateSources.add')}
          </Button>
        }
      />

      {renderList()}

      {sources.length > 0 ? (
        <p className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-moonlight">
          <GitBranch className="h-3.5 w-3.5" aria-hidden />
          {t('templateSources.formatHint')}
        </p>
      ) : null}

      <SourceDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setEditingSource(null);
        }}
        source={editingSource}
        onCreated={(created) => {
          setEditingSource(null);
          syncMutation.mutate(created);
        }}
      />

      <ConfirmDialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null);
        }}
        title={t('templateSources.deleteTitle')}
        description={
          <span className="space-y-1">
            <span className="block">
              {t('templateSources.deleteDescription', {
                name: deleteTarget ? deleteTarget.name || deleteTarget.url : '',
              })}
            </span>
            <span className="block text-xs">{t('templateSources.deleteHint')}</span>
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
