import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, Download, RefreshCw } from 'lucide-react';
import type { TemplateGitPreviewDto } from '@subwatch/shared';
import { api } from '../../lib/api';
import { templateKindLabelKey } from '../../lib/templates';
import { errorMessage } from '../../lib/utils';
import { Alert, Badge, Button, Dialog, Field, Input } from '../ui';

export interface TemplateGitImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const checkboxClass =
  'mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border border-ink/30 bg-transparent accent-[var(--color-accent-ink)] disabled:cursor-not-allowed disabled:opacity-45';

/**
 * Import templates from a git repository. The user enters a repository URL
 * (and optional branch), previews the `subwatch-templates.json` manifest and
 * imports the selected entries as ordinary templates.
 */
export function TemplateGitImportDialog({ open, onOpenChange }: TemplateGitImportDialogProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();

  const [url, setUrl] = useState('');
  const [branch, setBranch] = useState('');
  const [preview, setPreview] = useState<TemplateGitPreviewDto | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [requestError, setRequestError] = useState<{ message: string; kind: 'preview' | 'import' } | null>(
    null,
  );

  const reset = () => {
    setUrl('');
    setBranch('');
    setPreview(null);
    setSelected([]);
    setRequestError(null);
    previewMutation.reset();
    importMutation.reset();
  };

  useEffect(() => {
    if (open) reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const previewMutation = useMutation({
    mutationFn: () => api.templates.gitPreview({ url: url.trim(), branch: branch.trim() }),
    onSuccess: (data) => {
      setPreview(data);
      setRequestError(null);
      setSelected(
        data.templates.filter((entry) => !entry.error).map((entry) => entry.path),
      );
    },
    onError: (error) => {
      setPreview(null);
      setSelected([]);
      setRequestError({ message: errorMessage(error), kind: 'preview' });
    },
  });

  const importMutation = useMutation({
    mutationFn: () =>
      api.templates.gitImport({ url: url.trim(), branch: branch.trim(), paths: selected }),
    onSuccess: (result) => {
      toast.success(t('templates.gitImport.importSuccess', { count: result.imported }));
      void queryClient.invalidateQueries({ queryKey: ['templates'] });
      reset();
      onOpenChange(false);
    },
    onError: (error) => setRequestError({ message: errorMessage(error), kind: 'import' }),
  });

  const templates = preview?.templates ?? [];
  const selectable = useMemo(
    () => templates.filter((entry) => !entry.error).map((entry) => entry.path),
    [templates],
  );
  const allSelected = selectable.length > 0 && selectable.every((path) => selected.includes(path));

  const toggleOne = (path: string, checked: boolean) => {
    setSelected((current) => (checked ? [...current, path] : current.filter((entry) => entry !== path)));
  };

  const toggleAll = () => {
    setSelected(allSelected ? [] : selectable);
  };

  const canPreview = url.trim() !== '' && !previewMutation.isPending;
  const busy = previewMutation.isPending || importMutation.isPending;

  const renderPreview = () => {
    if (!preview) return null;

    return (
      <div className="space-y-4">
        {preview.error ? (
          <Alert tone="danger" title={t('templates.gitImport.previewFailed')}>
            <span className="break-words">{preview.error}</span>
          </Alert>
        ) : null}

        <div className="flex flex-wrap items-center gap-2 text-xs text-moonlight">
          {preview.repositoryLabel || preview.repositoryName ? (
            <Badge tone="info">
              {t('templates.gitImport.repository')}: {preview.repositoryLabel ?? preview.repositoryName}
            </Badge>
          ) : null}
          <span className="font-mono">
            {t('templates.gitImport.commit')}: {preview.commit ? preview.commit.slice(0, 7) : '—'}
          </span>
        </div>

        {templates.length === 0 ? (
          preview.error ? null : (
            <p className="py-8 text-center text-sm text-moonlight">{t('templates.gitImport.emptyPreview')}</p>
          )
        ) : (
          <>
            {selectable.length > 0 ? (
              <label className="flex cursor-pointer items-center gap-2 text-xs text-moonlight">
                <input type="checkbox" className={checkboxClass} checked={allSelected} onChange={toggleAll} />
                {t('templates.gitImport.selectAll')}
              </label>
            ) : null}

            <ul className="space-y-2">
              {templates.map((entry) => {
                const disabled = Boolean(entry.error);
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
                        </div>
                        <p className="mt-1 text-body font-medium text-ink">{entry.name}</p>
                        {entry.description ? (
                          <p className="mt-0.5 text-xs text-moonlight">{entry.description}</p>
                        ) : null}
                        <p className="mt-1 break-all font-mono text-[11px] text-moonlight">{entry.path}</p>
                        {entry.error ? (
                          <p className="mt-1 flex items-start gap-1.5 text-xs text-danger" role="alert">
                            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                            <span className="min-w-0 break-words">{entry.error}</span>
                          </p>
                        ) : null}
                      </div>
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
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
      title={t('templates.gitImport.title')}
      description={t('templates.gitImport.description')}
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button
            loading={importMutation.isPending}
            disabled={selected.length === 0}
            onClick={() => {
              setRequestError(null);
              importMutation.mutate();
            }}
          >
            <Download className="h-4 w-4" aria-hidden />
            {importMutation.isPending
              ? t('templates.gitImport.importing')
              : t('templates.gitImport.importSelected')}
          </Button>
        </>
      }
    >
      <div className="space-y-5">
        <Field label={t('templates.gitImport.url')} htmlFor="git-import-url" required>
          <Input
            id="git-import-url"
            value={url}
            placeholder={t('templates.gitImport.urlPlaceholder')}
            autoComplete="off"
            onChange={(event) => {
              setUrl(event.target.value);
              setPreview(null);
              setSelected([]);
              setRequestError(null);
            }}
          />
        </Field>

        <Field
          label={t('templates.gitImport.branch')}
          htmlFor="git-import-branch"
          hint={t('templates.gitImport.branchPlaceholder')}
        >
          <Input
            id="git-import-branch"
            value={branch}
            placeholder={t('templates.gitImport.branchPlaceholder')}
            autoComplete="off"
            onChange={(event) => {
              setBranch(event.target.value);
              setPreview(null);
              setSelected([]);
              setRequestError(null);
            }}
          />
        </Field>

        <div>
          <Button
            variant="outline"
            size="sm"
            loading={previewMutation.isPending}
            disabled={!canPreview}
            onClick={() => {
              setRequestError(null);
              previewMutation.mutate();
            }}
          >
            {!previewMutation.isPending ? <RefreshCw className="h-4 w-4" aria-hidden /> : null}
            {previewMutation.isPending
              ? t('templates.gitImport.previewing')
              : t('templates.gitImport.preview')}
          </Button>
        </div>

        {requestError ? (
          <Alert
            tone="danger"
            title={
              requestError.kind === 'preview'
                ? t('templates.gitImport.previewFailed')
                : t('templates.gitImport.importFailed')
            }
          >
            <span className="break-words">{requestError.message}</span>
          </Alert>
        ) : null}

        {renderPreview()}
      </div>
    </Dialog>
  );
}
