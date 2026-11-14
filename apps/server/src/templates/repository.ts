import { randomUUID } from 'node:crypto';
import type {
  TemplateDto,
  TemplateField,
  TemplateInput,
  TemplateKind,
  TemplateSummaryDto,
} from '@subwatch/shared';
import type { CoreContext } from '../context.js';
import { all, nowIso, one, parseJson, run, toJson } from '../db/helpers.js';
import { deriveSourceLabel } from './source.js';

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
  source_url: string | null;
  source_branch: string | null;
  source_path: string | null;
  source_revision: string | null;
  created_at: string;
  updated_at: string;
}

interface TemplateSummaryRow extends TemplateRow {
  usage_count: number;
}

const SUMMARY_SELECT = `SELECT t.*,
  CASE t.kind
    WHEN 'subscription' THEN (SELECT COUNT(*) FROM subscriptions s WHERE s.template_id = t.id)
    ELSE (SELECT COUNT(*) FROM monitors m WHERE m.template_id = t.id)
  END AS usage_count
FROM templates t`;

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
    sourceUrl: row.source_url,
    sourceBranch: row.source_branch ?? '',
    sourcePath: row.source_path,
    sourceRevision: row.source_revision,
    sourceLabel: row.source_url === null ? null : deriveSourceLabel(row.source_url),
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
    sourceUrl: row.source_url,
    sourceLabel: row.source_url === null ? null : deriveSourceLabel(row.source_url),
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
       (id, kind, name, description, icon, color, category, version, fields, payload,
        source_url, source_branch, source_path, source_revision, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL, ?, ?)`,
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
// Git-imported templates
//
// Imported templates are ordinary rows; the only extra state is the provenance
// recorded on the row itself. There is no persisted repository entity.
// ---------------------------------------------------------------------------

export interface TemplateGitSource {
  url: string;
  branch: string;
  path: string;
  revision: string;
}

/** Insert a template imported from a git repository, recording its provenance. */
export function createGitTemplate(
  ctx: CoreContext,
  input: TemplateInput,
  source: TemplateGitSource,
): TemplateDto {
  const id = randomUUID();
  const now = nowIso();
  run(
    ctx.db,
    `INSERT INTO templates
       (id, kind, name, description, icon, color, category, version, fields, payload,
        source_url, source_branch, source_path, source_revision, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
      source.url,
      source.branch,
      source.path,
      source.revision,
      now,
      now,
    ],
  );
  const created = getTemplateById(ctx, id);
  if (!created) throw new Error('Failed to read back the created template');
  return created;
}

/** Overwrite an imported template's content and revision, leaving its source columns intact. */
export function updateGitTemplateContent(
  ctx: CoreContext,
  id: string,
  input: TemplateInput,
  revision: string,
): TemplateDto | undefined {
  const existing = getTemplateRow(ctx, id);
  if (!existing) return undefined;
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
      revision,
      nowIso(),
      id,
    ],
  );
  return getTemplateById(ctx, id);
}
