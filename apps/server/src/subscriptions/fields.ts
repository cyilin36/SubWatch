import {
  SECRET_KEEP,
  daysLeft,
  isDateOnly,
  type GeneralSettings,
  type SubscriptionStatus,
  type TemplateField,
} from '@subwatch/shared';
import type { SecretBox } from '../lib/crypto.js';
import { BadRequestError } from '../lib/errors.js';

/** Prefix used by `SecretBox` for AES-256-GCM envelopes. */
const ENCRYPTED_PREFIX = 'enc:v1:';

export interface SubscriptionReminderState {
  subscriptionId: string;
  expiryDate: string;
  reminderOffsets: number[];
  paused: boolean;
  archived: boolean;
}

function isBlank(value: unknown): boolean {
  return value === undefined || value === null || value === '';
}

function describe(field: TemplateField): string {
  return field.label || field.key;
}

function coerceText(field: TemplateField, value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  throw new BadRequestError(`Field "${describe(field)}" must be a string`);
}

function coerceNumber(field: TemplateField, value: unknown): number {
  const numeric = typeof value === 'number' ? value : typeof value === 'string' && value.trim() !== '' ? Number(value) : Number.NaN;
  if (!Number.isFinite(numeric)) {
    throw new BadRequestError(`Field "${describe(field)}" must be a number`);
  }
  return numeric;
}

function coerceSwitch(field: TemplateField, value: unknown): boolean {
  if (typeof value === 'boolean') return value;
  if (value === 'true' || value === 1 || value === '1') return true;
  if (value === 'false' || value === 0 || value === '0') return false;
  throw new BadRequestError(`Field "${describe(field)}" must be a boolean`);
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Validate inbound field values against a template field schema, coerce them to
 * their canonical storage types and encrypt `secret` values. When the owning
 * template was removed (or has no fields) the record is stored as free-form;
 * encrypted values keep working because ciphertext carries its own prefix.
 */
export function sanitizeFieldsForStorage(params: {
  input: Record<string, unknown>;
  templateFields: TemplateField[] | null;
  existingStored: Record<string, unknown>;
  secretBox: SecretBox;
}): Record<string, unknown> {
  const { input, templateFields, existingStored, secretBox } = params;
  const source = input && typeof input === 'object' && !Array.isArray(input) ? input : {};

  if (!templateFields || templateFields.length === 0) {
    const freeForm: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(source)) {
      if (value === SECRET_KEEP) {
        const previous = existingStored[key];
        if (typeof previous === 'string' && previous !== '') freeForm[key] = previous;
        continue;
      }
      if (value === undefined) continue;
      freeForm[key] = value;
    }
    return freeForm;
  }

  const known = new Set(templateFields.map((field) => field.key));
  for (const key of Object.keys(source)) {
    if (!known.has(key)) {
      throw new BadRequestError(`Unknown field "${key}" for the selected template`);
    }
  }

  const result: Record<string, unknown> = {};
  for (const field of templateFields) {
    let raw = source[field.key];
    if (raw === undefined && field.defaultValue !== undefined) raw = field.defaultValue;

    if (field.type === 'secret') {
      if (raw === SECRET_KEEP) {
        const previous = existingStored[field.key];
        if (typeof previous === 'string' && previous !== '') {
          result[field.key] = previous;
          continue;
        }
        raw = undefined;
      }
      if (isBlank(raw)) {
        if (field.required) throw new BadRequestError(`Field "${describe(field)}" is required`);
        continue;
      }
      const plaintext = typeof raw === 'string' ? raw : typeof raw === 'number' ? String(raw) : null;
      if (plaintext === null) throw new BadRequestError(`Field "${describe(field)}" must be a string`);
      result[field.key] = secretBox.encrypt(plaintext);
      continue;
    }

    if (raw === null || raw === undefined) {
      if (field.required) throw new BadRequestError(`Field "${describe(field)}" is required`);
      continue;
    }

    switch (field.type) {
      case 'number': {
        if (raw === '') {
          if (field.required) throw new BadRequestError(`Field "${describe(field)}" is required`);
          continue;
        }
        result[field.key] = coerceNumber(field, raw);
        break;
      }
      case 'switch': {
        result[field.key] = coerceSwitch(field, raw);
        break;
      }
      case 'date': {
        const value = coerceText(field, raw);
        if (!isDateOnly(value)) {
          throw new BadRequestError(`Field "${describe(field)}" must be a YYYY-MM-DD date`);
        }
        result[field.key] = value;
        break;
      }
      case 'url': {
        const value = coerceText(field, raw);
        if (value !== '' && !isHttpUrl(value)) {
          throw new BadRequestError(`Field "${describe(field)}" must be an http(s) URL`);
        }
        if (value !== '') result[field.key] = value;
        break;
      }
      case 'select': {
        const value = coerceText(field, raw);
        const allowed = new Set(field.options.map((option) => option.value));
        if (!allowed.has(value)) {
          throw new BadRequestError(`Field "${describe(field)}" does not match any allowed option`);
        }
        result[field.key] = value;
        break;
      }
      case 'textarea':
      case 'text':
      default: {
        const value = coerceText(field, raw);
        if (value === '') {
          if (field.required) throw new BadRequestError(`Field "${describe(field)}" is required`);
          continue;
        }
        result[field.key] = value;
        break;
      }
    }
  }
  return result;
}

/**
 * Replace stored secret values with the `SECRET_KEEP` sentinel so ciphertext
 * never leaves the server. Secrets are detected from the template schema, or
 * from the ciphertext envelope when the template is gone.
 */
export function maskFieldsForOutput(
  stored: Record<string, unknown>,
  templateFields: TemplateField[] | null,
): Record<string, unknown> {
  const masked: Record<string, unknown> = { ...stored };
  if (templateFields && templateFields.length > 0) {
    for (const field of templateFields) {
      if (field.type !== 'secret') continue;
      const value = stored[field.key];
      if (typeof value === 'string' && value !== '') masked[field.key] = SECRET_KEEP;
    }
    return masked;
  }
  for (const [key, value] of Object.entries(masked)) {
    if (typeof value === 'string' && value.startsWith(ENCRYPTED_PREFIX)) {
      masked[key] = SECRET_KEEP;
    }
  }
  return masked;
}

/** Reminder offsets actually used: subscription overrides, otherwise settings default. */
export function resolveEffectiveOffsets(subscriptionOffsets: number[], general: GeneralSettings): number[] {
  const source = subscriptionOffsets.length > 0 ? subscriptionOffsets : general.defaultReminderOffsets;
  const unique = new Set<number>();
  for (const value of source) {
    if (Number.isInteger(value) && value >= 0 && value <= 3650) unique.add(value);
  }
  return [...unique].sort((a, b) => a - b);
}

/** expiring = within the reminder window (at least 7 days) and not yet expired. */
export function deriveSubscriptionStatus(
  state: { paused: boolean; archived: boolean; expiryDate: string; reminderOffsets: number[] },
  general: GeneralSettings,
  timezone: string,
): SubscriptionStatus {
  if (state.archived) return 'archived';
  if (state.paused) return 'paused';
  const remaining = daysLeft(state.expiryDate, timezone);
  if (remaining < 0) return 'expired';
  const offsets = resolveEffectiveOffsets(state.reminderOffsets, general);
  const window = Math.max(7, ...(offsets.length > 0 ? offsets : [0]));
  return remaining <= window ? 'expiring' : 'active';
}
