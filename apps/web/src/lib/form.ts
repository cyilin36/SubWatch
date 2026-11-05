import type { FieldErrors, FieldValues, Path, UseFormReturn } from 'react-hook-form';
import type { z } from 'zod';

/** Read a nested RHF error message by dot path. */
export function getFieldError(errors: FieldErrors, path: string): string | undefined {
  const parts = path.split('.');
  let current: unknown = errors;
  for (const part of parts) {
    if (!current || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  if (current && typeof current === 'object' && 'message' in current) {
    const message = (current as { message?: unknown }).message;
    return typeof message === 'string' ? message : undefined;
  }
  return undefined;
}

/** Read the root-level error message set by applyZodIssues. */
export function getRootError(errors: FieldErrors): string | undefined {
  const root = errors.root as { message?: unknown } | undefined;
  return typeof root?.message === 'string' ? root.message : undefined;
}

export interface ApplyIssuesOptions {
  /** Map a zod path (e.g. `config.request.url`) onto a form path (e.g. `request.url`). */
  mapPath?: (path: string, pathArray: (string | number)[]) => string | null;
}

/**
 * Translate a ZodError into RHF field errors. Returns true when every issue was
 * applied to a field, false when at least one issue had no path (root error).
 */
export function applyZodIssues<T extends FieldValues>(
  form: UseFormReturn<T>,
  error: z.ZodError,
  options: ApplyIssuesOptions = {},
): boolean {
  let allMapped = true;
  const issues = error.issues;
  for (const issue of issues) {
    const rawPath = issue.path.map((part) => String(part)).join('.');
    const mapped = options.mapPath
      ? options.mapPath(rawPath, issue.path as (string | number)[])
      : rawPath;
    if (mapped === null) continue;
    if (!mapped) {
      allMapped = false;
      form.setError('root' as Path<T>, { type: 'validate', message: issue.message });
      continue;
    }
    form.setError(mapped as Path<T>, { type: 'validate', message: issue.message });
  }
  return allMapped;
}

/** Convert an empty string input to `undefined` (for optional numeric fields). */
export function optionalNumber(value: unknown): number | undefined {
  if (value === '' || value === null || value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

/** Convert an empty string input to `null` (for nullable numeric fields). */
export function nullableNumber(value: unknown): number | null {
  if (value === '' || value === null || value === undefined) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Convert an empty string input to null, otherwise a number (nullable numeric input). */
export function numberOrNull(value: unknown): number | null {
  return nullableNumber(value);
}
