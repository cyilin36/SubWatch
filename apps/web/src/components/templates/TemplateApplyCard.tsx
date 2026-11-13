import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { LayoutTemplate, Plus, Sparkles } from 'lucide-react';
import type { TemplateDto, TemplateKind, TemplateRenderResultDto } from '@subwatch/shared';
import { api } from '../../lib/api';
import {
  initialTemplateParameterValues,
  summarizeTemplateError,
  templateKindLabelKey,
} from '../../lib/templates';
import { errorMessage } from '../../lib/utils';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Field,
  Select,
  Skeleton,
} from '../ui';
import { TemplateFields } from './TemplateFields';

const NO_TEMPLATE = 'none';

export interface TemplateApplyCardProps {
  kind: TemplateKind;
  /** Template already applied to the form; the card collapses into a summary bar. */
  appliedTemplate: TemplateDto | null;
  onApply: (template: TemplateDto, result: TemplateRenderResultDto) => void;
  onClear: () => void;
  /**
   * Reports the template currently selected in the picker (null when none).
   * New-record pages use it to hide the generic entity form until the payload
   * has been applied, so the form is never mistaken for extra manual input.
   */
  onSelectionChange?: (templateId: string | null) => void;
}

/**
 * "Create from template" card shown above the new subscription / monitor forms:
 * pick a template, fill its parameters, then render the payload into the form.
 */
export function TemplateApplyCard({
  kind,
  appliedTemplate,
  onApply,
  onClear,
  onSelectionChange,
}: TemplateApplyCardProps) {
  const { t } = useTranslation();
  const [selectedId, setSelectedId] = useState<string>(NO_TEMPLATE);
  const [values, setValues] = useState<Record<string, unknown>>({});

  const templatesQuery = useQuery({
    queryKey: ['templates', kind],
    queryFn: () => api.templates.list(kind),
  });

  const templateQuery = useQuery({
    queryKey: ['template', selectedId],
    queryFn: () => api.templates.get(selectedId),
    enabled: selectedId !== NO_TEMPLATE,
  });

  const template = templateQuery.data;

  const renderMutation = useMutation({
    mutationFn: (target: TemplateDto) => api.templates.render(target.id, values),
    onSuccess: (result, target) => {
      onApply(target, result);
      toast.success(t('templates.apply.applied', { name: target.name }));
    },
    onError: (error) => toast.error(t('templates.apply.failed'), { description: errorMessage(error) }),
  });

  useEffect(() => {
    if (!template) return;
    setValues(initialTemplateParameterValues(template.fields));
    renderMutation.reset();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template?.id]);

  useEffect(() => {
    onSelectionChange?.(template?.id ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [template?.id]);

  const errorSummary = renderMutation.error ? summarizeTemplateError(renderMutation.error) : null;
  const templates = templatesQuery.data ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-moonlight" aria-hidden />
          {t('templates.apply.title')}
        </CardTitle>
        <CardDescription>{t(`templates.apply.hint.${kind}`)}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {appliedTemplate ? (
          <div className="glass-flat flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="text-lg leading-none" aria-hidden>
                {appliedTemplate.icon || <LayoutTemplate className="h-4 w-4 text-moonlight" />}
              </span>
              <div className="min-w-0">
                <p className="truncate text-body font-medium text-white">
                  {t('templates.apply.appliedLabel', { name: appliedTemplate.name })}
                </p>
                <p className="truncate text-xs text-moon-steel">{t('templates.apply.appliedHint')}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge tone="info">{t(templateKindLabelKey(appliedTemplate.kind))}</Badge>
              <Button variant="outline" size="sm" onClick={onClear}>
                {t('templates.apply.clear')}
              </Button>
            </div>
          </div>
        ) : templatesQuery.isPending ? (
          <Skeleton className="h-11" />
        ) : templatesQuery.isError ? (
          <Alert tone="danger">{errorMessage(templatesQuery.error)}</Alert>
        ) : templates.length === 0 ? (
          <div className="glass-flat flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <p className="text-body text-moonlight">{t(`templates.apply.empty.${kind}`)}</p>
            <Link
              to={`/templates/new?kind=${kind}`}
              className="inline-flex h-9 items-center gap-1.5 rounded-btn border border-white/15 bg-white/8 px-4 text-xs font-medium text-white transition-colors duration-500 ease-glass hover:border-white/30 hover:bg-white/14 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 focus-visible:ring-offset-2 focus-visible:ring-offset-night"
            >
              <Plus className="h-3.5 w-3.5" aria-hidden />
              {t('templates.apply.createLink')}
            </Link>
          </div>
        ) : (
          <>
            <Field label={t('templates.apply.selectLabel')} htmlFor="template-apply-select">
              <Select
                id="template-apply-select"
                value={selectedId}
                onValueChange={(next) => {
                  setSelectedId(next);
                  setValues({});
                  renderMutation.reset();
                }}
                options={[
                  { value: NO_TEMPLATE, label: t('templates.apply.none') },
                  ...templates.map((summary) => ({
                    value: summary.id,
                    label: `${summary.icon ? `${summary.icon} ` : ''}${summary.name}`,
                  })),
                ]}
              />
            </Field>

            {templateQuery.isError ? <Alert tone="danger">{errorMessage(templateQuery.error)}</Alert> : null}

            {template ? (
              <>
                {template.description ? (
                  <p className="text-xs text-moon-steel">{template.description}</p>
                ) : null}
                {template.fields.length > 0 ? (
                  <TemplateFields
                    fields={template.fields}
                    values={values}
                    fieldErrors={errorSummary?.fieldErrors}
                    onChange={(key, value) => setValues((current) => ({ ...current, [key]: value }))}
                    idPrefix={`template-apply-${kind}`}
                  />
                ) : (
                  <p className="text-xs text-moon-steel">{t('templates.apply.noParameters')}</p>
                )}

                {errorSummary ? (
                  <Alert tone="danger" title={t('templates.apply.failed')}>
                    <ul className="list-disc space-y-0.5 pl-4 text-xs">
                      {errorSummary.messages.map((message, index) => (
                        <li key={index} className="break-words">
                          {message}
                        </li>
                      ))}
                    </ul>
                  </Alert>
                ) : null}

                <div className="flex justify-end">
                  <Button
                    variant="outline"
                    size="sm"
                    loading={renderMutation.isPending}
                    onClick={() => {
                      if (template) renderMutation.mutate(template);
                    }}
                  >
                    <Sparkles className="h-4 w-4" aria-hidden />
                    {t('templates.apply.apply')}
                  </Button>
                </div>
              </>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
