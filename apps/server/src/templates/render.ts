import {
  coerceTemplateValues,
  monitorTemplatePayloadSchema,
  renderTemplatePayload,
  subscriptionTemplatePayloadSchema,
  TemplateRenderError,
  type TemplateRenderResultDto,
} from '@subwatch/shared';
import type { CoreContext } from '../context.js';
import { BadRequestError, NotFoundError } from '../lib/errors.js';
import { getTemplateById } from './repository.js';

/**
 * Resolve a template with the user-supplied parameter values and validate the
 * rendered result against the target entity's input schema.
 */
export function renderTemplate(
  ctx: CoreContext,
  id: string,
  rawValues: Record<string, unknown>,
): TemplateRenderResultDto {
  const template = getTemplateById(ctx, id);
  if (!template) throw new NotFoundError('Template not found');

  const coerced = coerceTemplateValues(template.fields, rawValues);
  if (!coerced.success) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of coerced.error.issues) {
      const key = String(issue.path[0] ?? '_');
      (fieldErrors[key] ??= []).push(issue.message);
    }
    throw new BadRequestError('Template parameter values are invalid', {
      fieldErrors,
      issues: coerced.error.flatten(),
    });
  }

  let rendered: Record<string, unknown>;
  try {
    rendered = renderTemplatePayload(template.payload, coerced.values);
  } catch (error) {
    if (error instanceof TemplateRenderError) {
      throw new BadRequestError(`Template parameter "${error.fieldKey}" has no value`, {
        field: error.fieldKey,
      });
    }
    throw error;
  }

  if (template.kind === 'subscription') {
    const parsed = subscriptionTemplatePayloadSchema.safeParse(rendered);
    if (!parsed.success) {
      throw new BadRequestError('Template payload is invalid after rendering', {
        issues: parsed.error.flatten(),
      });
    }
    return { kind: 'subscription', values: coerced.values, payload: parsed.data };
  }

  const parsed = monitorTemplatePayloadSchema.safeParse(rendered);
  if (!parsed.success) {
    throw new BadRequestError('Template payload is invalid after rendering', {
      issues: parsed.error.flatten(),
    });
  }
  return { kind: 'monitor', values: coerced.values, payload: parsed.data };
}
