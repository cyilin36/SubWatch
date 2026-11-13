import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { FileJson, Upload } from 'lucide-react';
import {
  templateExportEnvelopeSchema,
  type TemplateDto,
  type TemplateExportEnvelope,
} from '@subwatch/shared';
import { api } from '../../lib/api';
import { parseTemplateImportJson, summarizeTemplateError } from '../../lib/templates';
import { Alert, Badge, Button, Dialog, Textarea } from '../ui';

export interface TemplateImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImported: (template: TemplateDto) => void;
}

interface ImportPreview {
  envelope: TemplateExportEnvelope;
  name: string;
  kind: string;
  fieldCount: number;
}

/**
 * Import a template from a `.json` file or pasted envelope. The JSON is parsed
 * locally first so syntax errors surface immediately; the server remains the
 * authority for schema errors.
 */
export function TemplateImportDialog({ open, onOpenChange, onImported }: TemplateImportDialogProps) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState('');
  const [parseError, setParseError] = useState<string | null>(null);
  const [serverErrors, setServerErrors] = useState<string[]>([]);

  const preview = useMemo<ImportPreview | null>(() => {
    if (text.trim() === '') return null;
    try {
      const parsed = parseTemplateImportJson(text);
      const envelope = templateExportEnvelopeSchema.parse(parsed);
      return {
        envelope,
        name: envelope.template.name,
        kind: envelope.template.kind,
        fieldCount: envelope.template.fields.length,
      };
    } catch {
      return null;
    }
  }, [text]);

  const localIssues = useMemo(() => {
    if (text.trim() === '' || preview) return [];
    try {
      const parsed = parseTemplateImportJson(text);
      const result = templateExportEnvelopeSchema.safeParse(parsed);
      if (result.success) return [];
      return result.error.issues.map((issue) => {
        const path = issue.path.join('.');
        return path ? `${path}: ${issue.message}` : issue.message;
      });
    } catch (error) {
      return [error instanceof Error ? error.message : String(error)];
    }
  }, [text, preview]);

  const importMutation = useMutation({
    mutationFn: (envelope: TemplateExportEnvelope) => api.templates.import(envelope),
    onSuccess: (template) => {
      toast.success(t('templates.import.success', { name: template.name }));
      void queryClient.invalidateQueries({ queryKey: ['templates'] });
      reset();
      onOpenChange(false);
      onImported(template);
    },
    onError: (error) => setServerErrors(summarizeTemplateError(error).messages),
  });

  const reset = () => {
    setText('');
    setFileName('');
    setParseError(null);
    setServerErrors([]);
    importMutation.reset();
  };

  const readFile = async (file: File) => {
    setFileName(file.name);
    setServerErrors([]);
    try {
      const content = await file.text();
      setText(content);
      setParseError(null);
    } catch (error) {
      setParseError(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
      title={t('templates.import.title')}
      description={t('templates.import.hint')}
      size="lg"
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={importMutation.isPending}>
            {t('common.cancel')}
          </Button>
          <Button
            loading={importMutation.isPending}
            disabled={!preview}
            onClick={() => {
              if (preview) {
                setServerErrors([]);
                importMutation.mutate(preview.envelope);
              }
            }}
          >
            <Upload className="h-4 w-4" aria-hidden />
            {t('templates.import.confirm')}
          </Button>
        </>
      }
    >
      <div className="space-y-6">
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={fileRef}
            type="file"
            accept=".json,application/json"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void readFile(file);
              event.target.value = '';
            }}
          />
          <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
            <FileJson className="h-4 w-4" aria-hidden />
            {t('templates.import.chooseFile')}
          </Button>
          {fileName ? <span className="truncate text-xs text-moonlight">{fileName}</span> : null}
        </div>

        <Textarea
          rows={10}
          value={text}
          placeholder={t('templates.import.placeholder')}
          className="font-mono text-xs"
          onChange={(event) => {
            setText(event.target.value);
            setParseError(null);
            setServerErrors([]);
          }}
        />

        {parseError ? <Alert tone="danger">{parseError}</Alert> : null}

        {preview ? (
          <div className="glass-flat flex flex-wrap items-center gap-2 px-4 py-3 text-sm">
            <span className="font-medium text-white">{preview.name}</span>
            <Badge tone="info">{t(`templates.kind.${preview.kind}`)}</Badge>
            <span className="text-xs text-moonlight">
              {t('templates.list.fieldCount', { count: preview.fieldCount })}
            </span>
          </div>
        ) : localIssues.length > 0 ? (
          <Alert tone="danger" title={t('templates.import.invalid')}>
            <ul className="list-disc space-y-0.5 pl-4 text-xs">
              {localIssues.slice(0, 8).map((issue, index) => (
                <li key={index} className="break-words">
                  {issue}
                </li>
              ))}
            </ul>
          </Alert>
        ) : null}

        {serverErrors.length > 0 ? (
          <Alert tone="danger" title={t('templates.import.failed')}>
            <ul className="list-disc space-y-0.5 pl-4 text-xs">
              {serverErrors.map((message, index) => (
                <li key={index} className="break-words">
                  {message}
                </li>
              ))}
            </ul>
          </Alert>
        ) : null}
      </div>
    </Dialog>
  );
}
