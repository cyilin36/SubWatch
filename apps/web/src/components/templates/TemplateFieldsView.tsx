import { useTranslation } from 'react-i18next';
import { ExternalLink } from 'lucide-react';
import type { TemplateField } from '@subwatch/shared';
import { Table, TBody, TD, TH, THead, TR } from '../ui';
import { prettyJson } from '../../lib/utils';

export interface TemplateFieldsViewProps {
  fields: TemplateField[];
  values: Record<string, unknown>;
  className?: string;
}

function JsonValue({ value }: { value: unknown }) {
  return (
    <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded bg-[var(--surface-muted)] p-2 font-mono text-xs">
      {typeof value === 'string' ? value : prettyJson(value)}
    </pre>
  );
}

/** Read-only parameter table shown on subscription details. */
export function TemplateFieldsView({ fields, values, className }: TemplateFieldsViewProps) {
  const { t } = useTranslation();
  if (fields.length === 0) return null;

  return (
    <div className={className}>
      <Table>
        <THead>
          <TR>
            <TH>{t('templates.fields.parameter')}</TH>
            <TH>{t('templates.fields.value')}</TH>
          </TR>
        </THead>
        <TBody>
          {fields.map((field) => {
            const value = values[field.key];
            let content: React.ReactNode;
            if (value === undefined || value === null || value === '') {
              content = <span className="text-[var(--muted-foreground)]">{t('common.none')}</span>;
            } else if (field.type === 'secret') {
              content = <span className="font-mono">••••••</span>;
            } else if (field.type === 'switch') {
              content = value === true ? t('common.yes') : t('common.no');
            } else if (field.type === 'url' && typeof value === 'string') {
              content = (
                <a
                  href={value}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex max-w-full items-center gap-1 text-[var(--brand)] hover:underline"
                >
                  <ExternalLink className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  <span className="truncate">{value}</span>
                </a>
              );
            } else if (field.type === 'json') {
              content = <JsonValue value={value} />;
            } else {
              content = <span className="whitespace-pre-wrap break-words">{String(value)}</span>;
            }
            return (
              <TR key={field.key}>
                <TD className="max-w-[180px]">
                  <span className="block truncate font-medium">{field.label || field.key}</span>
                  <span className="block truncate font-mono text-xs text-[var(--muted-foreground)]">
                    {field.key}
                  </span>
                </TD>
                <TD>{content}</TD>
              </TR>
            );
          })}
        </TBody>
      </Table>
    </div>
  );
}
