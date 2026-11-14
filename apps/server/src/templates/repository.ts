import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type {
  TemplateDto,
  TemplateField,
  TemplateInput,
  TemplateKind,
  TemplateSummaryDto,
} from '@subwatch/shared';
import type { CoreContext } from '../context.js';
import { all, nowIso, one, parseJson, run, toJson } from '../db/helpers.js';

export interface TemplateRow {
  id: string;
  kind: string;
  name: string;
  description: string;
  icon: string;
  color: string;
  category: string;
  version: string;
  fields: string;
  payload: string;
  source_id: string | null;
  source_path: string | null;
  source_revision: string | null;
  created_at: string;
  updated_at: string;
}

interface TemplateSummaryRow extends TemplateRow {
  source_name: string | null;
  usage_count: number;
}

const SUMMARY_SELECT = `SELECT t.*, src.name AS source_name,
  CASE t.kind
    WHEN 'subscription' THEN (SELECT COUNT(*) FROM subscriptions s WHERE s.template_id = t.id)
    ELSE (SELECT COUNT(*) FROM monitors m WHERE m.template_id = t.id)
  END AS usage_count
FROM templates t
LEFT JOIN template_sources src ON src.id = t.source_id`;

function parseFields(row: TemplateRow): TemplateField[] {
  return parseJson<TemplateField[]>(row.fields, []);
}

function parsePayload(row: TemplateRow): Record<string, unknown> {
  return parseJson<Record<string, unknown>>(row.payload, {});
}

export function rowToTemplateDto(row: TemplateRow): TemplateDto {
  return {
    id: row.id,
    kind: row.kind as TemplateKind,
    name: row.name,
    description: row.description,
    icon: row.icon,
    color: row.color,
    category: row.category,
    version: row.version,
    fields: parseFields(row),
    payload: parsePayload(row),
    sourceId: row.source_id,
    sourcePath: row.source_path,
    sourceRevision: row.source_revision,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToSummary(row: TemplateSummaryRow): TemplateSummaryDto {
  return {
    id: row.id,
    kind: row.kind as TemplateKind,
    name: row.name,
    description: row.description,
    icon: row.icon,
    color: row.color,
    category: row.category,
    version: row.version,
    fieldCount: parseFields(row).length,
    usageCount: Number(row.usage_count ?? 0),
    sourceId: row.source_id,
    sourceName: row.source_name,
    updatedAt: row.updated_at,
  };
}

export function listTemplateSummaries(ctx: CoreContext, kind?: TemplateKind): TemplateSummaryDto[] {
  const rows = kind
    ? all<TemplateSummaryRow>(ctx.db, `${SUMMARY_SELECT} WHERE t.kind = ? ORDER BY t.name ASC, t.created_at ASC`, [
        kind,
      ])
    : all<TemplateSummaryRow>(ctx.db, `${SUMMARY_SELECT} ORDER BY t.kind ASC, t.name ASC, t.created_at ASC`);
  return rows.map(rowToSummary);
}

export function getTemplateRow(ctx: CoreContext, id: string): TemplateRow | undefined {
  return one<TemplateRow>(ctx.db, 'SELECT * FROM templates WHERE id = ?', [id]);
}

export function getTemplateById(ctx: CoreContext, id: string): TemplateDto | undefined {
  const row = getTemplateRow(ctx, id);
  return row ? rowToTemplateDto(row) : undefined;
}

export function createTemplate(ctx: CoreContext, input: TemplateInput): TemplateDto {
  const id = randomUUID();
  const now = nowIso();
  run(
    ctx.db,
    `INSERT INTO templates
       (id, kind, name, description, icon, color, category, version, fields, payload, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      input.kind,
      input.name,
      input.description,
      input.icon,
      input.color,
      input.category,
      input.version,
      toJson(input.fields),
      toJson(input.payload),
      now,
      now,
    ],
  );
  const created = getTemplateById(ctx, id);
  if (!created) throw new Error('Failed to read back the created template');
  return created;
}

export function updateTemplate(ctx: CoreContext, id: string, input: TemplateInput): TemplateDto | undefined {
  const existing = getTemplateRow(ctx, id);
  if (!existing) return undefined;
  run(
    ctx.db,
    `UPDATE templates SET
       name = ?, description = ?, icon = ?, color = ?, category = ?, version = ?, fields = ?, payload = ?, updated_at = ?
     WHERE id = ?`,
    [
      input.name,
      input.description,
      input.icon,
      input.color,
      input.category,
      input.version,
      toJson(input.fields),
      toJson(input.payload),
      nowIso(),
      id,
    ],
  );
  return getTemplateById(ctx, id);
}

export function deleteTemplate(ctx: CoreContext, id: string): boolean {
  return Number(run(ctx.db, 'DELETE FROM templates WHERE id = ?', [id]).changes) > 0;
}

// ---------------------------------------------------------------------------
// Repository-managed ("template source") helpers
// ---------------------------------------------------------------------------

/** All raw template rows installed from one template source. */
export function listTemplateRowsBySource(ctx: CoreContext, sourceId: string): TemplateRow[] {
  return all<TemplateRow>(
    ctx.db,
    'SELECT * FROM templates WHERE source_id = ? ORDER BY source_path ASC, created_at ASC',
    [sourceId],
  );
}

function templateInputsEqual(existing: TemplateRow, input: TemplateInput): boolean {
  return (
    existing.name === input.name &&
    existing.description === input.description &&
    existing.icon === input.icon &&
    existing.color === input.color &&
    existing.category === input.category &&
    existing.version === input.version &&
    existing.kind === input.kind &&
    isDeepStrictEqual(parseFields(existing), input.fields) &&
    isDeepStrictEqual(parsePayload(existing), input.payload)
  );
}

/**
 * Install or refresh one repository template, keyed by its stable
 * `(source_id, source_path)` identity.
 *
 * - New path → insert a new template row.
 * - Existing path whose content changed → update every content field plus the
 *   revision.
 * - Existing path whose content is unchanged → only record the new revision, so
 *   the row's `updated_at` keeps reflecting the last real content change.
 */
export function upsertSourceTemplate(
  ctx: CoreContext,
  sourceId: string,
  sourcePath: string,
  sourceRevision: string,
  input: TemplateInput,
): 'added' | 'updated' | 'unchanged' {
  const existing = one<TemplateRow>(
    ctx.db,
    'SELECT * FROM templates WHERE source_id = ? AND source_path = ?',
    [sourceId, sourcePath],
  );

  if (!existing) {
    const id = randomUUID();
    const now = nowIso();
    run(
      ctx.db,
      `INSERT INTO templates
         (id, kind, name, description, icon, color, category, version, fields, payload,
          source_id, source_path, source_revision, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.kind,
        input.name,
        input.description,
        input.icon,
        input.color,
        input.category,
        input.version,
        toJson(input.fields),
        toJson(input.payload),
        sourceId,
        sourcePath,
        sourceRevision,
        now,
        now,
      ],
    );
    return 'added';
  }

  if (!templateInputsEqual(existing, input)) {
    run(
      ctx.db,
      `UPDATE templates SET
         kind = ?, name = ?, description = ?, icon = ?, color = ?, category = ?, version = ?,
         fields = ?, payload = ?, source_revision = ?, updated_at = ?
       WHERE id = ?`,
      [
        input.kind,
        input.name,
        input.description,
        input.icon,
        input.color,
        input.category,
        input.version,
        toJson(input.fields),
        toJson(input.payload),
        sourceRevision,
        nowIso(),
        existing.id,
      ],
    );
    return 'updated';
  }

  run(ctx.db, 'UPDATE templates SET source_revision = ? WHERE id = ?', [sourceRevision, existing.id]);
  return 'unchanged';
}

/**
 * Delete every template of a source whose `source_path` is not in `keepPaths`.
 * Returns the number of rows removed. Templates with a NULL `source_path` never
 * belong to a source and are left untouched.
 */
export function pruneSourceTemplates(ctx: CoreContext, sourceId: string, keepPaths: Set<string>): number {
  const paths = [...keepPaths];
  if (paths.length === 0) {
    return Number(run(ctx.db, 'DELETE FROM templates WHERE source_id = ?', [sourceId]).changes);
  }
  const placeholders = paths.map(() => '?').join(', ');
  return Number(
    run(
      ctx.db,
      `DELETE FROM templates WHERE source_id = ? AND source_path NOT IN (${placeholders})`,
      [sourceId, ...paths],
    ).changes,
  );
}

/** Delete every template installed from a source. Returns the number removed. */
export function deleteSourceTemplates(ctx: CoreContext, sourceId: string): number {
  return Number(run(ctx.db, 'DELETE FROM templates WHERE source_id = ?', [sourceId]).changes);
}

/**
 * Delete the source's templates whose `source_path` is in `paths`. Used by the
 * selective "uninstall" action. Returns the number of rows removed; unknown
 * paths are ignored.
 */
export function deleteSourceTemplatesByPaths(
  ctx: CoreContext,
  sourceId: string,
  paths: string[],
): number {
  const unique = [...new Set(paths)];
  if (unique.length === 0) return 0;
  const placeholders = unique.map(() => '?').join(', ');
  return Number(
    run(
      ctx.db,
      `DELETE FROM templates WHERE source_id = ? AND source_path IN (${placeholders})`,
      [sourceId, ...unique],
    ).changes,
  );
}
