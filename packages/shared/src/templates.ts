import { z } from 'zod';
import {
  MAX_TEMPLATE_FIELD_VALUE_CHARS,
  MAX_TEMPLATE_FIELDS,
  MAX_TEMPLATE_PAYLOAD_BYTES,
  SECRET_KEEP,
  TEMPLATE_EXPORT_FORMAT,
  TEMPLATE_EXPORT_VERSION,
  TEMPLATE_FIELD_TYPE_VALUES,
  TEMPLATE_KIND_VALUES,
} from './constants.js';
import { isDateOnly } from './dates.js';
import { monitorInputSchema, subscriptionInputSchema } from './schemas.js';

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

export const templateKindSchema = z.enum(TEMPLATE_KIND_VALUES);
export const templateFieldTypeSchema = z.enum(TEMPLATE_FIELD_TYPE_VALUES);

const FIELD_KEY_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]*$/;
const FIELD_KEY_MESSAGE = 'Key must start with a letter and contain only letters, digits, "_" or "-"';
const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export const templateFieldKeySchema = z.string().min(1).max(50).regex(FIELD_KEY_PATTERN, FIELD_KEY_MESSAGE);

export const templateFieldOptionSchema = z.object({
  label: z.string().min(1).max(100),
  value: z.string().min(1).max(500),
});
export type TemplateFieldOption = z.infer<typeof templateFieldOptionSchema>;

const templateFieldDefaultSchema = z.union([
  z.string().max(MAX_TEMPLATE_FIELD_VALUE_CHARS),
  z.number().finite(),
  z.boolean(),
]);

function isHttpUrl(value: string): boolean {
  // The shared package targets environments without the DOM URL class; the
  // regular expression is sufficient for validation and the server's zod
  // `url()` checks run on top of the final rendered monitor payload.
  return /^https?:\/\/[^\s]+$/i.test(value);
}

function typeSupportsTextAttributes(type: (typeof TEMPLATE_FIELD_TYPE_VALUES)[number]): boolean {
  return type === 'text' || type === 'textarea' || type === 'url' || type === 'secret';
}

export const templateFieldSchema = z
  .object({
    key: templateFieldKeySchema,
    label: z.string().min(1).max(100),
    type: templateFieldTypeSchema,
    required: z.boolean().default(false),
    placeholder: z.string().max(200).default(''),
    help: z.string().max(500).default(''),
    defaultValue: templateFieldDefaultSchema.optional(),
    options: z.array(templateFieldOptionSchema).max(100).default([]),
    min: z.number().finite().optional(),
    max: z.number().finite().optional(),
    minLength: z.number().int().min(0).max(MAX_TEMPLATE_FIELD_VALUE_CHARS).optional(),
    maxLength: z.number().int().min(1).max(MAX_TEMPLATE_FIELD_VALUE_CHARS).optional(),
    pattern: z.string().max(500).optional(),
  })
  .superRefine((field, ctx) => {
    const add = (message: string, path: (string | number)[] = []) =>
      ctx.addIssue({ code: z.ZodIssueCode.custom, path, message });

    const { type } = field;
    const hasOptions = field.options.length > 0;
    const hasRange = field.min !== undefined || field.max !== undefined;
    const hasLength = field.minLength !== undefined || field.maxLength !== undefined;
    const hasPattern = field.pattern !== undefined;
    const textLike = typeSupportsTextAttributes(type);

    if (hasRange && type !== 'number') add('min/max are only valid for number fields', ['min']);
    if (hasLength && !textLike) add('minLength/maxLength are only valid for text-like fields', ['minLength']);
    if (hasPattern && !textLike) add('pattern is only valid for text-like fields', ['pattern']);
    if (hasOptions && type !== 'select') add('options are only valid for select fields', ['options']);

    if (
      field.minLength !== undefined &&
      field.maxLength !== undefined &&
      field.minLength > field.maxLength
    ) {
      add('minLength cannot exceed maxLength', ['minLength']);
    }
    if (field.min !== undefined && field.max !== undefined && field.min > field.max) {
      add('min cannot exceed max', ['min']);
    }
    if (field.pattern !== undefined) {
      try {
        new RegExp(field.pattern);
      } catch {
        add('pattern is not a valid regular expression', ['pattern']);
      }
    }

    if (type === 'select') {
      if (!hasOptions) add('select fields need at least one option', ['options']);
      if (new Set(field.options.map((option) => option.value)).size !== field.options.length) {
        add('option values must be unique', ['options']);
      }
    }

    if (type === 'secret' && field.defaultValue !== undefined) {
      add('secret fields cannot define a default value', ['defaultValue']);
    }

    const defaultValue = field.defaultValue;
    if (defaultValue === undefined) return;

    if (typeof defaultValue === 'string' && textLike) {
      if (field.minLength !== undefined && defaultValue.length < field.minLength) {
        add('defaultValue is shorter than minLength', ['defaultValue']);
      }
      if (field.maxLength !== undefined && defaultValue.length > field.maxLength) {
        add('defaultValue is longer than maxLength', ['defaultValue']);
      }
      if (field.pattern !== undefined) {
        try {
          if (!new RegExp(field.pattern).test(defaultValue)) {
            add('defaultValue does not match pattern', ['defaultValue']);
          }
        } catch {
          // pattern validity is reported above
        }
      }
    }

    switch (type) {
      case 'text':
      case 'textarea':
        if (typeof defaultValue !== 'string') add('defaultValue must be a string', ['defaultValue']);
        break;
      case 'url':
        if (typeof defaultValue !== 'string' || !isHttpUrl(defaultValue)) {
          add('defaultValue must be an http(s) URL', ['defaultValue']);
        }
        break;
      case 'secret':
        break;
      case 'number':
        if (typeof defaultValue !== 'number') {
          add('defaultValue must be a number', ['defaultValue']);
        } else {
          if (field.min !== undefined && defaultValue < field.min) {
            add('defaultValue is below min', ['defaultValue']);
          }
          if (field.max !== undefined && defaultValue > field.max) {
            add('defaultValue is above max', ['defaultValue']);
          }
        }
        break;
      case 'date':
        if (typeof defaultValue !== 'string' || !isDateOnly(defaultValue)) {
          add('defaultValue must be a YYYY-MM-DD date', ['defaultValue']);
        }
        break;
      case 'time':
        if (typeof defaultValue !== 'string' || !TIME_PATTERN.test(defaultValue)) {
          add('defaultValue must be an HH:mm time', ['defaultValue']);
        }
        break;
      case 'select':
        if (
          typeof defaultValue !== 'string' ||
          !field.options.some((option) => option.value === defaultValue)
        ) {
          add('defaultValue must be one of the configured options', ['defaultValue']);
        }
        break;
      case 'switch':
        if (typeof defaultValue !== 'boolean') {
          add('defaultValue must be a boolean', ['defaultValue']);
        }
        break;
      case 'json':
        if (typeof defaultValue !== 'string') {
          add('defaultValue must be a JSON string', ['defaultValue']);
        } else {
          try {
            JSON.parse(defaultValue);
          } catch {
            add('defaultValue must be valid JSON', ['defaultValue']);
          }
        }
        break;
    }
  });
export type TemplateField = z.infer<typeof templateFieldSchema>;

// ---------------------------------------------------------------------------
// Template definition validation (structural; the rendered payload is only
// validated against the target input schema when a template is applied)
// ---------------------------------------------------------------------------

export interface TemplateIssue {
  path: (string | number)[];
  message: string;
}

const INLINE_PLACEHOLDER_PATTERN = /\{\{\s*([a-zA-Z][a-zA-Z0-9_-]*)\s*\}\}/g;
const OPENING_BRACES_PATTERN = /\{\{/g;

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return bytes;
}

function walkPayloadStrings(
  value: unknown,
  path: (string | number)[],
  visit: (text: string, path: (string | number)[]) => void,
): void {
  if (typeof value === 'string') {
    visit(value, path);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((entry, index) => walkPayloadStrings(entry, [...path, index], visit));
    return;
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      walkPayloadStrings(entry, [...path, key], visit);
    }
  }
}

/**
 * Validate the parts of a template that do not depend on parameter values:
 * unique field keys, well-formed and declared placeholders, payload size.
 */
export function validateTemplateDefinition(template: {
  fields: TemplateField[];
  payload: Record<string, unknown>;
}): TemplateIssue[] {
  const issues: TemplateIssue[] = [];
  const keys = new Set<string>();

  template.fields.forEach((field, index) => {
    if (keys.has(field.key)) {
      issues.push({
        path: ['fields', index, 'key'],
        message: `Duplicate field key "${field.key}"`,
      });
    }
    keys.add(field.key);
  });

  walkPayloadStrings(template.payload, ['payload'], (text, path) => {
    const tokens = [...text.matchAll(INLINE_PLACEHOLDER_PATTERN)];
    for (const token of tokens) {
      const key = token[1] ?? '';
      if (!keys.has(key)) {
        issues.push({ path, message: `Unknown placeholder "{{${key}}}"` });
      }
    }
    const openingBraces = (text.match(OPENING_BRACES_PATTERN) ?? []).length;
    if (openingBraces !== tokens.length) {
      issues.push({ path, message: 'Unclosed or malformed placeholder' });
    }
  });

  const payloadBytes = utf8ByteLength(JSON.stringify(template.payload));
  if (payloadBytes > MAX_TEMPLATE_PAYLOAD_BYTES) {
    issues.push({
      path: ['payload'],
      message: `Payload must be at most ${MAX_TEMPLATE_PAYLOAD_BYTES} bytes`,
    });
  }

  return issues;
}

export const templateInputSchema = z
  .object({
    kind: templateKindSchema,
    name: z.string().min(1).max(100),
    description: z.string().max(500).default(''),
    /** A single emoji or short glyph shown on the template card. */
    icon: z.string().max(16).default(''),
    color: z
      .string()
      .max(20)
      .default('')
      .refine((value) => value === '' || /^#[0-9a-fA-F]{6}$/.test(value), {
        message: 'color must be empty or a #RRGGBB hex value',
      }),
    category: z.string().max(50).default(''),
    /** Optional author-declared version (e.g. `1.2.0`); free-form, max 32 chars. */
    version: z.string().max(32).default(''),
    fields: z.array(templateFieldSchema).max(MAX_TEMPLATE_FIELDS).default([]),
    payload: z.record(z.unknown()),
  })
  .superRefine((template, ctx) => {
    for (const issue of validateTemplateDefinition(template)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: issue.path, message: issue.message });
    }
  });
export type TemplateInput = z.infer<typeof templateInputSchema>;

export const templateExportEnvelopeSchema = z.object({
  format: z.literal(TEMPLATE_EXPORT_FORMAT),
  version: z.literal(TEMPLATE_EXPORT_VERSION),
  exportedAt: z.string().optional(),
  template: templateInputSchema,
});
export type TemplateExportEnvelope = z.infer<typeof templateExportEnvelopeSchema>;

/**
 * A rendered subscription draft. Every key is optional: missing keys keep the
 * defaults of the regular "new subscription" form.
 */
export const subscriptionTemplatePayloadSchema = subscriptionInputSchema
  .omit({ templateId: true, fields: true })
  .partial()
  .strict();
export type SubscriptionTemplatePayload = z.infer<typeof subscriptionTemplatePayloadSchema>;

/** A rendered monitor draft is a complete monitor input (without provenance). */
export const monitorTemplatePayloadSchema = monitorInputSchema.omit({ templateId: true }).strict();
export type MonitorTemplatePayload = z.infer<typeof monitorTemplatePayloadSchema>;

// ---------------------------------------------------------------------------
// Parameter values
// ---------------------------------------------------------------------------

export type TemplateFieldValues = Record<string, unknown>;

export type TemplateValuesResult =
  | { success: true; values: TemplateFieldValues }
  | { success: false; error: z.ZodError };

function fieldValueSchema(field: TemplateField): z.ZodTypeAny {
  const maxLength = field.maxLength ?? MAX_TEMPLATE_FIELD_VALUE_CHARS;
  const minLength = field.required ? Math.max(1, field.minLength ?? 0) : (field.minLength ?? 0);
  const pattern = field.pattern === undefined ? undefined : new RegExp(field.pattern);

  const withPattern = <T extends z.ZodTypeAny>(schema: T): z.ZodTypeAny =>
    pattern === undefined
      ? schema
      : schema.refine((value: unknown) => typeof value === 'string' && pattern.test(value), {
          message: 'Value does not match the required pattern',
        });

  switch (field.type) {
    case 'text':
    case 'textarea':
      return withPattern(z.string().min(minLength).max(maxLength));
    case 'secret':
      return withPattern(z.string().min(minLength).max(maxLength));
    case 'url':
      return withPattern(
        z
          .string()
          .min(minLength)
          .max(maxLength)
          .refine((value) => isHttpUrl(value), { message: 'Value must be an http(s) URL' }),
      );
    case 'number': {
      let schema = z.coerce.number().finite();
      if (field.min !== undefined) schema = schema.min(field.min);
      if (field.max !== undefined) schema = schema.max(field.max);
      return schema;
    }
    case 'date':
      return z.string().refine((value) => isDateOnly(value), {
        message: 'Value must be a YYYY-MM-DD date',
      });
    case 'time':
      return z.string().regex(TIME_PATTERN, 'Value must be an HH:mm time');
    case 'select': {
      const allowed = new Set(field.options.map((option) => option.value));
      return z.string().refine((value) => allowed.has(value), {
        message: 'Value must be one of the configured options',
      });
    }
    case 'switch':
      return z.union([z.boolean(), z.enum(['true', 'false']).transform((value) => value === 'true')]);
    case 'json':
      return z
        .union([z.string(), z.number(), z.boolean(), z.array(z.unknown()), z.record(z.unknown())])
        .transform((value, ctx) => {
          if (typeof value !== 'string') return value;
          try {
            return JSON.parse(value) as unknown;
          } catch {
            ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Value must be valid JSON' });
            return z.NEVER;
          }
        });
  }
}

export function templateValuesSchema(fields: TemplateField[]): z.ZodType<TemplateFieldValues> {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const field of fields) {
    const schema = fieldValueSchema(field);
    shape[field.key] = field.required ? schema : schema.optional();
  }
  return z.object(shape).strict() as unknown as z.ZodType<TemplateFieldValues>;
}

/**
 * Apply defaults, empty-value normalization, type coercion and per-field
 * validation to user-supplied parameter values.
 */
export function coerceTemplateValues(
  fields: TemplateField[],
  rawValues: Record<string, unknown>,
): TemplateValuesResult {
  const normalized: Record<string, unknown> = { ...rawValues };
  for (const field of fields) {
    let value = normalized[field.key];
    if (value === undefined || value === null) {
      value = field.defaultValue;
    }
    if (
      typeof value === 'string' &&
      value === '' &&
      field.type !== 'text' &&
      field.type !== 'textarea'
    ) {
      value = undefined;
    }
    if (value === undefined) delete normalized[field.key];
    else normalized[field.key] = value;
  }

  const parsed = templateValuesSchema(fields).safeParse(normalized);
  if (!parsed.success) return { success: false, error: parsed.error };
  return { success: true, values: parsed.data };
}

/** Representative values used by the template editor preview. */
export function sampleTemplateValues(fields: TemplateField[]): TemplateFieldValues {
  const values: TemplateFieldValues = {};
  for (const field of fields) {
    values[field.key] =
      field.defaultValue !== undefined
        ? field.defaultValue
        : {
            text: 'sample',
            textarea: 'sample',
            url: 'https://example.com',
            number: 0,
            date: '2030-01-01',
            time: '00:00',
            select: field.options[0]?.value ?? 'option',
            switch: false,
            secret: 'sample-secret',
            json: '[]',
          }[field.type];
  }
  return values;
}

/** Replace stored secret values with the SECRET_KEEP sentinel before sending them to the browser. */
export function maskTemplateValues(
  fields: TemplateField[],
  values: TemplateFieldValues,
): TemplateFieldValues {
  const masked: TemplateFieldValues = { ...values };
  for (const field of fields) {
    if (field.type !== 'secret') continue;
    const value = masked[field.key];
    if (typeof value === 'string' && value !== '') masked[field.key] = SECRET_KEEP;
  }
  return masked;
}

/** Restore SECRET_KEEP sentinels from the previously stored values. */
export function restoreMaskedTemplateValues(
  fields: TemplateField[],
  incoming: TemplateFieldValues,
  previous: TemplateFieldValues,
): TemplateFieldValues {
  const restored: TemplateFieldValues = { ...incoming };
  for (const field of fields) {
    if (field.type !== 'secret') continue;
    if (restored[field.key] === SECRET_KEEP) {
      const previousValue = previous[field.key];
      if (previousValue === undefined) delete restored[field.key];
      else restored[field.key] = previousValue;
    }
  }
  return restored;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

export class TemplateRenderError extends Error {
  readonly fieldKey: string;

  constructor(fieldKey: string) {
    super(`Template parameter "${fieldKey}" has no value`);
    this.name = 'TemplateRenderError';
    this.fieldKey = fieldKey;
  }
}

const WHOLE_PLACEHOLDER_PATTERN = /^\{\{\s*([a-zA-Z][a-zA-Z0-9_-]*)\s*\}\}$/;

function replacementFor(key: string, values: TemplateFieldValues): unknown {
  if (!(key in values) || values[key] === undefined) throw new TemplateRenderError(key);
  return values[key];
}

function interpolate(text: string, values: TemplateFieldValues): string {
  return text.replace(INLINE_PLACEHOLDER_PATTERN, (_match, key: string) => {
    const value = replacementFor(key, values);
    return typeof value === 'string' ? value : JSON.stringify(value);
  });
}

function renderNode(node: unknown, values: TemplateFieldValues): unknown {
  if (typeof node === 'string') {
    const whole = WHOLE_PLACEHOLDER_PATTERN.exec(node);
    if (whole) return replacementFor(whole[1] ?? '', values);
    return interpolate(node, values);
  }
  if (Array.isArray(node)) return node.map((entry) => renderNode(entry, values));
  if (node !== null && typeof node === 'object') {
    const rendered: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(node as Record<string, unknown>)) {
      rendered[key] = renderNode(entry, values);
    }
    return rendered;
  }
  return node;
}

/**
 * Render a template payload with typed parameter values. Whole-string
 * placeholders keep the value's JSON type (number/boolean/array/object); inline
 * placeholders are stringified.
 */
export function renderTemplatePayload(
  payload: Record<string, unknown>,
  values: TemplateFieldValues,
): Record<string, unknown> {
  return renderNode(payload, values) as Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Render result DTO shared by the API and the WebUI
// ---------------------------------------------------------------------------

export interface SubscriptionTemplateRenderDto {
  kind: 'subscription';
  values: TemplateFieldValues;
  payload: SubscriptionTemplatePayload;
}

export interface MonitorTemplateRenderDto {
  kind: 'monitor';
  values: TemplateFieldValues;
  payload: MonitorTemplatePayload;
}

export type TemplateRenderResultDto = SubscriptionTemplateRenderDto | MonitorTemplateRenderDto;
