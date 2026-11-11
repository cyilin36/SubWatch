import type { z } from 'zod';
import type {
  SubscriptionTemplatePayload,
  TemplateField,
  TemplateFieldOption,
  TemplateFieldType,
  TemplateKind,
} from '@subwatch/shared';
import { ApiError } from './api';
import type { SubscriptionFormValues } from './subscriptions';
import { errorMessage } from './utils';

// ---------------------------------------------------------------------------
// Field types / kinds (UI metadata only; the server schema is authoritative)
// ---------------------------------------------------------------------------

export const TEMPLATE_FIELD_TYPES: TemplateFieldType[] = [
  'text',
  'textarea',
  'url',
  'number',
  'date',
  'time',
  'select',
  'switch',
  'secret',
  'json',
];

export const TEMPLATE_KINDS: TemplateKind[] = ['subscription', 'monitor'];

export function templateKindLabelKey(kind: TemplateKind): string {
  return `templates.kind.${kind}`;
}

export function templateFieldTypeLabelKey(type: TemplateFieldType): string {
  return `templates.fieldType.${type}`;
}

/** Field types that accept minLength/maxLength/pattern. */
export function fieldTypeSupportsTextConstraints(type: TemplateFieldType): boolean {
  return type === 'text' || type === 'textarea' || type === 'url' || type === 'secret';
}

// ---------------------------------------------------------------------------
// Example payloads ("填入示例")
// ---------------------------------------------------------------------------

/** Minimal field shape needed to build example payloads. */
export type TemplateFieldRef = Pick<TemplateField, 'key' | 'type'>;

function firstFieldOfType(fields: TemplateFieldRef[], ...types: TemplateFieldType[]): TemplateFieldRef | undefined {
  return fields.find((field) => types.includes(field.type));
}

function placeholderOr(field: TemplateFieldRef | undefined, fallback: unknown): unknown {
  return field ? `{{${field.key}}}` : fallback;
}

function inlinePlaceholder(field: TemplateFieldRef | undefined, prefix: string, fallback: string): string {
  return field ? `${prefix}{{${field.key}}}` : fallback;
}

/**
 * Build a payload example that only references declared fields, so the sample
 * never fails the "unknown placeholder" check. Missing field types fall back to
 * literal values that satisfy the target input schema.
 */
export function buildTemplateExamplePayload(
  kind: TemplateKind,
  fields: TemplateFieldRef[],
): Record<string, unknown> {
  const text = firstFieldOfType(fields, 'text');
  const textarea = firstFieldOfType(fields, 'textarea');
  const url = firstFieldOfType(fields, 'url');
  const date = firstFieldOfType(fields, 'date');
  const time = firstFieldOfType(fields, 'time');
  const secret = firstFieldOfType(fields, 'secret');

  if (kind === 'subscription') {
    return {
      name: placeholderOr(text, '示例订阅'),
      url: placeholderOr(url, 'https://example.com'),
      expiryDate: placeholderOr(date, '2030-01-01'),
      expiryTime: placeholderOr(time, '23:59'),
      cycle: 'month',
      reminderOffsets: [7, 3, 1],
      notes: placeholderOr(textarea, ''),
    };
  }

  return {
    name: placeholderOr(text, '示例监控'),
    description: placeholderOr(textarea, ''),
    config: {
      type: 'http',
      request: {
        url: placeholderOr(url, 'https://api.example.com/usage'),
        method: 'GET',
        headers: secret
          ? [{ key: 'Authorization', value: inlinePlaceholder(secret, 'Bearer ', 'Bearer sample'), secret: true }]
          : [],
        query: [],
        bodyType: 'none',
        body: '',
        auth: { type: 'none' },
        timeoutMs: 10000,
        followRedirects: true,
        verifyTls: true,
        maxResponseBytes: 1048576,
      },
      extract: {
        mode: 'json',
        metrics: [{ key: 'remaining', label: 'Remaining', path: 'data.remaining', unit: '' }],
      },
    },
    intervalSeconds: 300,
    failureThreshold: 2,
    staleAfterSeconds: 3600,
    channelIds: [],
    tags: [],
    enabled: true,
    rules: [],
  };
}

// ---------------------------------------------------------------------------
// Parameter values
// ---------------------------------------------------------------------------

/** Seed values for a parameter form: declared defaults plus `false` for switches. */
export function initialTemplateParameterValues(fields: TemplateField[]): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  for (const field of fields) {
    if (field.defaultValue !== undefined) values[field.key] = field.defaultValue;
    else if (field.type === 'switch') values[field.key] = false;
  }
  return values;
}

/** Render an unknown parameter value as input text. */
export function templateValueToText(type: TemplateFieldType, value: unknown): string {
  if (value === undefined || value === null) return '';
  if (type === 'json') {
    if (typeof value === 'string') return value;
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value);
    }
  }
  if (typeof value === 'boolean') return String(value);
  return String(value);
}

/** Overlay a rendered subscription payload onto the current form values. */
export function applySubscriptionTemplatePayload(
  current: SubscriptionFormValues,
  payload: SubscriptionTemplatePayload,
): SubscriptionFormValues {
  return {
    ...current,
    ...(payload.name !== undefined ? { name: payload.name } : {}),
    ...(payload.url !== undefined ? { url: payload.url } : {}),
    ...(payload.expiryDate !== undefined ? { expiryDate: payload.expiryDate } : {}),
    ...(payload.expiryTime !== undefined ? { expiryTime: payload.expiryTime } : {}),
    ...(payload.cycle !== undefined ? { cycle: payload.cycle } : {}),
    ...(payload.reminderOffsets !== undefined ? { reminderOffsets: [...payload.reminderOffsets] } : {}),
    ...(payload.channelIds !== undefined ? { channelIds: [...payload.channelIds] } : {}),
    ...(payload.notes !== undefined ? { notes: payload.notes } : {}),
    ...(payload.paused !== undefined ? { paused: payload.paused } : {}),
  };
}

// ---------------------------------------------------------------------------
// Server error / zod issue formatting
// ---------------------------------------------------------------------------

export interface TemplateErrorSummary {
  /** Human readable lines, usually the server message plus per-field details. */
  messages: string[];
  /** Per-parameter messages keyed by field key (used to mark inputs). */
  fieldErrors: Record<string, string[]>;
}

function formatIssuePath(path: (string | number)[]): string {
  let text = '';
  for (const part of path) {
    if (typeof part === 'number') text += `[${part}]`;
    else text += text ? `.${part}` : part;
  }
  return text;
}

function appendZodFlatten(
  target: TemplateErrorSummary,
  flattened: { formErrors?: string[]; fieldErrors?: Record<string, string[] | undefined> },
): void {
  for (const message of flattened.formErrors ?? []) target.messages.push(message);
  for (const [key, messages] of Object.entries(flattened.fieldErrors ?? {})) {
    for (const message of messages ?? []) {
      target.fieldErrors[key] = [...(target.fieldErrors[key] ?? []), message];
      target.messages.push(`${key}: ${message}`);
    }
  }
}

/**
 * Normalize the render/save error details returned by the template API:
 * `{ fieldErrors, issues }`, `{ issues }` or `{ field }`.
 */
export function summarizeTemplateError(error: unknown): TemplateErrorSummary {
  const summary: TemplateErrorSummary = { messages: [], fieldErrors: {} };
  const pushMessage = (message: string) => {
    if (message && !summary.messages.includes(message)) summary.messages.push(message);
  };
  if (!(error instanceof ApiError)) {
    summary.messages.push(errorMessage(error));
    return summary;
  }
  const details = error.details;
  if (details && typeof details === 'object') {
    const payload = details as {
      fieldErrors?: unknown;
      issues?: unknown;
      field?: unknown;
    };
    if (payload.fieldErrors && typeof payload.fieldErrors === 'object') {
      appendZodFlatten(summary, {
        fieldErrors: payload.fieldErrors as Record<string, string[] | undefined>,
      });
    }
    if (payload.issues && typeof payload.issues === 'object') {
      appendZodFlatten(
        summary,
        payload.issues as { formErrors?: string[]; fieldErrors?: Record<string, string[] | undefined> },
      );
    }
    if (typeof payload.field === 'string' && summary.messages.length === 0) {
      pushMessage(`${payload.field}: ${error.message}`);
    }
  }
  if (summary.messages.length === 0) pushMessage(error.message);
  // Drop duplicate lines produced by `{ fieldErrors, issues }` payloads.
  summary.messages = [...new Set(summary.messages)];
  return summary;
}

/** Flatten a locally produced ZodError into `path: message` lines. */
export function summarizeZodError(error: z.ZodError): string[] {
  return error.issues.map((issue) => {
    const path = formatIssuePath(issue.path as (string | number)[]);
    return path ? `${path}: ${issue.message}` : issue.message;
  });
}

// ---------------------------------------------------------------------------
// Export envelope / downloads
// ---------------------------------------------------------------------------

/** Parse pasted or uploaded import JSON, with a readable error. */
export function parseTemplateImportJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : 'Invalid JSON');
  }
}

export function templateExportFilename(name: string): string {
  const slug = name
    .trim()
    .toLowerCase()
    .replace(/[\\/:*?"<>|\s]+/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '');
  return `${slug || 'template'}.subwatch-template.json`;
}

export function downloadJsonFile(filename: string, data: unknown): void {
  const blob = new Blob([`${JSON.stringify(data, null, 2)}\n`], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Editor draft model
// ---------------------------------------------------------------------------

export interface TemplateFieldDraft {
  key: string;
  label: string;
  type: TemplateFieldType;
  required: boolean;
  placeholder: string;
  help: string;
  /** Text form of the default value; `''` means "no default". */
  defaultValue: string;
  /** One `label=value` pair per line (select fields only). */
  optionsText: string;
  min: string;
  max: string;
  minLength: string;
  maxLength: string;
  pattern: string;
}

export function blankTemplateFieldDraft(type: TemplateFieldType = 'text'): TemplateFieldDraft {
  return {
    key: '',
    label: '',
    type,
    required: false,
    placeholder: '',
    help: '',
    defaultValue: '',
    optionsText: '',
    min: '',
    max: '',
    minLength: '',
    maxLength: '',
    pattern: '',
  };
}

export function templateFieldToDraft(field: TemplateField): TemplateFieldDraft {
  const { defaultValue } = field;
  return {
    key: field.key,
    label: field.label,
    type: field.type,
    required: field.required,
    placeholder: field.placeholder,
    help: field.help,
    defaultValue:
      defaultValue === undefined
        ? ''
        : typeof defaultValue === 'string'
          ? defaultValue
          : String(defaultValue),
    optionsText: field.options.map((option) => `${option.label}=${option.value}`).join('\n'),
    min: field.min === undefined ? '' : String(field.min),
    max: field.max === undefined ? '' : String(field.max),
    minLength: field.minLength === undefined ? '' : String(field.minLength),
    maxLength: field.maxLength === undefined ? '' : String(field.maxLength),
    pattern: field.pattern ?? '',
  };
}

export function parseOptionsText(text: string): TemplateFieldOption[] {
  const options: TemplateFieldOption[] = [];
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const separator = trimmed.indexOf('=');
    const label = separator === -1 ? trimmed : trimmed.slice(0, separator).trim();
    const value = separator === -1 ? trimmed : trimmed.slice(separator + 1).trim();
    if (!label || !value) continue;
    options.push({ label, value });
  }
  return options;
}

function optionalNumberText(text: string): number | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  return Number(trimmed);
}

/**
 * Convert the editor draft back to the wire shape. Invalid numbers are kept as
 * `NaN` so the shared schema reports them instead of silently dropping input.
 */
export function draftToTemplateField(draft: TemplateFieldDraft): Record<string, unknown> {
  const field: Record<string, unknown> = {
    key: draft.key.trim(),
    label: draft.label,
    type: draft.type,
    required: draft.required,
    placeholder: draft.placeholder,
    help: draft.help,
  };

  if (draft.defaultValue !== '') {
    if (draft.type === 'switch') field.defaultValue = draft.defaultValue === 'true';
    else if (draft.type === 'number') field.defaultValue = Number(draft.defaultValue);
    else field.defaultValue = draft.defaultValue;
  }

  if (draft.type === 'select') {
    field.options = parseOptionsText(draft.optionsText);
  }
  if (draft.type === 'number') {
    const min = optionalNumberText(draft.min);
    const max = optionalNumberText(draft.max);
    if (min !== undefined) field.min = min;
    if (max !== undefined) field.max = max;
  }
  if (fieldTypeSupportsTextConstraints(draft.type)) {
    const minLength = optionalNumberText(draft.minLength);
    const maxLength = optionalNumberText(draft.maxLength);
    if (minLength !== undefined) field.minLength = minLength;
    if (maxLength !== undefined) field.maxLength = maxLength;
    if (draft.pattern.trim() !== '') field.pattern = draft.pattern;
  }

  return field;
}
