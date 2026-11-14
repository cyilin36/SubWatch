import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useForm } from 'react-hook-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, Eye, GitBranch, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react';
import {
  templateSourceInputSchema,
  type TemplateSourceAvailableTemplateDto,
  type TemplateSourceDto,
  type TemplateSourceInput,
} from '@subwatch/shared';
import { api } from '../lib/api';
import { applyZodIssues, getFieldError } from '../lib/form';
import { templateKindLabelKey } from '../lib/templates';
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

/** Browse a repository's catalogue and install/uninstall individual templates. */
function BrowseDialog({
  open,
  onOpenChange,
  source,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  source: TemplateSourceDto | null;
}) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<string[]>([]);
  const [uninstallTarget, setUninstallTarget] = useState<TemplateSourceAvailableTemplateDto | null>(null);

  const availableQuery = useQuery({
    queryKey: ['template-sources', source?.id, 'available'],
    queryFn: () => api.templateSources.available(source!.id),
    enabled: open && Boolean(source),
  });

  useEffect(() => {
    if (!open) return;
    setSelected([]);
    setUninstallTarget(null);
  }, [open, source?.id]);

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['template-sources'] });
    void queryClient.invalidateQueries({ queryKey: ['templates'] });
    void availableQuery.refetch();
  };

  const installMutation = useMutation({
    mutationFn: (paths: string[]) => api.templateSources.sync(source!.id, paths),
    onSuccess: (result) => {
      refresh();
      setSelected([]);
      if (result.ok) {
        toast.success(
          t('templateSources.installSuccess', {
            added: result.added,
            updated: result.updated,
            removed: result.removed,
            skipped: result.skipped.length,
          }),
        );
      } else {
        toast.error(t('templateSources.installFailed'), { description: result.error ?? undefined });
      }
    },
    onError: (error) =>
      toast.error(t('templateSources.installFailed'), { description: errorMessage(error) }),
  });

  const uninstallMutation = useMutation({
    mutationFn: (path: string) => api.templateSources.uninstall(source!.id, [path]),
    onSuccess: (result) => {
      refresh();
      setUninstallTarget(null);
      toast.success(t('templateSources.uninstallSuccess', { count: result.removed }));
    },
    onError: (error) =>
      toast.error(t('templateSources.uninstallFailed'), { description: errorMessage(error) }),
  });

  const data = availableQuery.data;
  const templates = data?.templates ?? [];
  const selectable = templates.filter((entry) => !entry.installed && !entry.error);
  const allSelected = selectable.length > 0 && selectable.every((entry) => selected.includes(entry.path));

  const toggleOne = (path: string, checked: boolean) => {
    setSelected((current) => (checked ? [...current, path] : current.filter((entry) => entry !== path)));
  };

  const toggleAll = () => {
    setSelected(allSelected ? [] : selectable.map((entry) => entry.path));
  };

  const checkboxClass =
    'mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border border-ink/30 bg-transparent accent-[var(--color-champagne-ink)] disabled:cursor-not-allowed disabled:opacity-45';

  const renderBody = () => {
    if (availableQuery.isPending) {
      return (
        <div className="space-y-3">
          {[0, 1, 2].map((index) => (
            <Skeleton key={index} className="h-24 rounded-btn" />
          ))}
        </div>
      );
    }
    if (availableQuery.isError) {
      return <ErrorState error={availableQuery.error} onRetry={() => void availableQuery.refetch()} />;
    }

    return (
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-2 text-xs text-moonlight">
          {data?.repositoryName ? <Badge tone="info">{data.repositoryName}</Badge> : null}
          <span className="font-mono">
            {t('templateSources.commitLabel')}: {data?.commit ? data.commit.slice(0, 7) : '—'}
          </span>
        </div>

        {data?.repositoryDescription ? (
          <p className="text-xs text-moonlight">{data.repositoryDescription}</p>
        ) : null}

        {data?.error ? (
          <p
            className="flex items-start gap-2 rounded-btn border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger"
            role="alert"
          >
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
            <span className="min-w-0 break-words">
              <span className="font-medium">{t('templateSources.catalogError')}: </span>
              {data.error}
            </span>
          </p>
        ) : null}

        {templates.length === 0 ? (
          <p className="py-8 text-center text-sm text-moonlight">
            {t('templateSources.noAvailableTemplates')}
          </p>
        ) : (
          <>
            {selectable.length > 0 ? (
              <label className="flex cursor-pointer items-center gap-2 text-xs text-moonlight">
                <input
                  type="checkbox"
                  className={checkboxClass}
                  checked={allSelected}
                  onChange={toggleAll}
                />
                {t('templateSources.selectAll')}
              </label>
            ) : null}

            <ul className="space-y-2">
              {templates.map((entry) => {
                const disabled = entry.installed || Boolean(entry.error);
                return (
                  <li key={entry.path} className="glass-flat rounded-btn p-3">
                    <div className="flex items-start gap-3">
                      <input
                        type="checkbox"
                        className={checkboxClass}
                        aria-label={entry.name}
                        checked={selected.includes(entry.path)}
                        disabled={disabled}
                        onChange={(event) => toggleOne(entry.path, event.target.checked)}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge tone="muted">{t(templateKindLabelKey(entry.kind))}</Badge>
                          {entry.category ? <Badge tone="info">{entry.category}</Badge> : null}
                          {entry.version ? (
                            <Badge tone="muted">
                              {t('templates.list.versionBadge', { version: entry.version })}
                            </Badge>
                          ) : null}
                          {entry.installed ? (
                            <Badge tone="success" dot>
                              {t('templateSources.installed')}
                            </Badge>
                          ) : null}
                        </div>
                        <p className="mt-1 text-body font-medium text-ink">{entry.name}</p>
                        {entry.description ? (
                          <p className="mt-0.5 text-xs text-moonlight">{entry.description}</p>
                        ) : null}
                        <p className="mt-1 break-all font-mono text-[11px] text-moonlight">{entry.path}</p>
                        {entry.error ? (
                          <p className="mt-1 text-xs text-danger" role="alert">
                            {entry.error}
                          </p>
                        ) : null}
                      </div>
                      {entry.installed ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-danger hover:text-danger"
                          onClick={() => setUninstallTarget(entry)}
                        >
                          <Trash2 className="h-3.5 w-3.5" aria-hidden />
                          {t('templateSources.uninstall')}
                        </Button>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
    );
  };

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={onOpenChange}
        title={t('templateSources.availableTitle')}
        description={t('templateSources.availableDescription')}
        size="lg"
        footer={
          <>
            <Button
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={installMutation.isPending}
            >
              {t('common.cancel')}
            </Button>
            <Button
              onClick={() => installMutation.mutate(selected)}
              loading={installMutation.isPending}
              disabled={selected.length === 0}
            >
              {t('templateSources.installSelected')}
              {selected.length > 0
                ? ` · ${t('templateSources.selectedCount', { count: selected.length })}`
                : ''}
            </Button>
          </>
        }
      >
        {renderBody()}
      </Dialog>

      <ConfirmDialog
        open={Boolean(uninstallTarget)}
        onOpenChange={(next) => {
          if (!next) setUninstallTarget(null);
        }}
        title={t('templateSources.uninstall')}
        description={
          uninstallTarget
            ? t('templateSources.uninstallConfirm', { name: uninstallTarget.name })
            : undefined
        }
        confirmLabel={t('templateSources.uninstall')}
        loading={uninstallMutation.isPending}
        onConfirm={() => {
          if (uninstallTarget) uninstallMutation.mutate(uninstallTarget.path);
        }}
      />
    </>
  );
}

export function TemplateSourcesPage() {
  const { t } = useTranslation();
  const { timezone, locale } = useAuth();
  const queryClient = useQueryClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingSource, setEditingSource] = useState<TemplateSourceDto | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<TemplateSourceDto | null>(null);
  const [browseSource, setBrowseSource] = useState<TemplateSourceDto | null>(null);

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
          <Button variant="ghost" size="sm" onClick={() => setBrowseSource(source)}>
            <Eye className="h-3.5 w-3.5" aria-hidden />
            {t('templateSources.browseTemplates')}
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

      <BrowseDialog
        open={Boolean(browseSource)}
        onOpenChange={(open) => {
          if (!open) setBrowseSource(null);
        }}
        source={browseSource}
      />
    </div>
  );
}
