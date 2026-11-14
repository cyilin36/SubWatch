import { randomUUID } from 'node:crypto';
import type {
  TemplateKind,
  TemplateSourceDetailDto,
  TemplateSourceDto,
  TemplateSourceInput,
  TemplateSourceTemplateDto,
} from '@subwatch/shared';
import type { CoreContext } from '../../context.js';
import { all, fromBool, nowIso, one, run, toBool, withTransaction } from '../../db/helpers.js';
import { ConflictError } from '../../lib/errors.js';
import { deleteSourceTemplates, listTemplateRowsBySource } from '../repository.js';

interface TemplateSourceRow {
  id: string;
  name: string;
  url: string;
  branch: string;
  enabled: number;
  last_synced_at: string | null;
  last_commit: string | null;
  last_error: string | null;
  created_at: string;
  updated_at: string;
}

type TemplateSourceRowWithCount = TemplateSourceRow & { template_count: number };

const SELECT_WITH_COUNT = `SELECT s.*,
  (SELECT COUNT(*) FROM templates t WHERE t.source_id = s.id) AS template_count
FROM template_sources s`;

function rowToDto(row: TemplateSourceRowWithCount): TemplateSourceDto {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    branch: row.branch,
    enabled: fromBool(row.enabled),
    lastSyncedAt: row.last_synced_at,
    lastCommit: row.last_commit,
    lastError: row.last_error,
    templateCount: Number(row.template_count ?? 0),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function isUniqueViolation(error: unknown): boolean {
  return error instanceof Error && /UNIQUE constraint failed/i.test(error.message);
}

export function listTemplateSources(ctx: CoreContext): TemplateSourceDto[] {
  const rows = all<TemplateSourceRowWithCount>(
    ctx.db,
    `${SELECT_WITH_COUNT} ORDER BY s.name ASC, s.created_at ASC`,
  );
  return rows.map(rowToDto);
}

export function getTemplateSource(ctx: CoreContext, id: string): TemplateSourceDto | undefined {
  const row = one<TemplateSourceRowWithCount>(ctx.db, `${SELECT_WITH_COUNT} WHERE s.id = ?`, [id]);
  return row ? rowToDto(row) : undefined;
}

export function getTemplateSourceDetail(
  ctx: CoreContext,
  id: string,
): TemplateSourceDetailDto | undefined {
  const source = getTemplateSource(ctx, id);
  if (!source) return undefined;
  const rows = listTemplateRowsBySource(ctx, id);
  const templates: TemplateSourceTemplateDto[] = rows.map((row) => ({
    id: row.id,
    path: row.source_path ?? '',
    kind: row.kind as TemplateKind,
    name: row.name,
    description: row.description,
    icon: row.icon,
    color: row.color,
    category: row.category,
    updatedAt: row.updated_at,
  }));
  return { ...source, templates };
}

export function createTemplateSource(ctx: CoreContext, input: TemplateSourceInput): TemplateSourceDto {
  const id = randomUUID();
  const now = nowIso();
  try {
    run(
      ctx.db,
      `INSERT INTO template_sources
         (id, name, url, branch, enabled, last_synced_at, last_commit, last_error, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?)`,
      [id, input.name, input.url, input.branch, toBool(input.enabled), now, now],
    );
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ConflictError('A template source with this URL and branch already exists');
    }
    throw error;
  }
  const created = getTemplateSource(ctx, id);
  if (!created) throw new Error('Failed to read back the created template source');
  return created;
}

export function updateTemplateSource(
  ctx: CoreContext,
  id: string,
  input: TemplateSourceInput,
): TemplateSourceDto | undefined {
  const existing = one<TemplateSourceRow>(ctx.db, 'SELECT * FROM template_sources WHERE id = ?', [id]);
  if (!existing) return undefined;
  try {
    run(
      ctx.db,
      `UPDATE template_sources
         SET name = ?, url = ?, branch = ?, enabled = ?, updated_at = ?
       WHERE id = ?`,
      [input.name, input.url, input.branch, toBool(input.enabled), nowIso(), id],
    );
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new ConflictError('A template source with this URL and branch already exists');
    }
    throw error;
  }
  return getTemplateSource(ctx, id);
}

/**
 * Delete a source together with all of its managed templates. Runs in a
 * transaction so a failure never leaves a source without its templates (or the
 * reverse). Returns false when the source does not exist.
 */
export function deleteTemplateSourceWithTemplates(ctx: CoreContext, id: string): boolean {
  return withTransaction(ctx.db, () => {
    const exists = one<{ id: string }>(ctx.db, 'SELECT id FROM template_sources WHERE id = ?', [id]);
    if (!exists) return false;
    deleteSourceTemplates(ctx, id);
    run(ctx.db, 'DELETE FROM template_sources WHERE id = ?', [id]);
    return true;
  });
}

export function recordSync(
  ctx: CoreContext,
  id: string,
  result: { commit: string | null; error: string | null },
): void {
  run(
    ctx.db,
    'UPDATE template_sources SET last_synced_at = ?, last_commit = ?, last_error = ? WHERE id = ?',
    [nowIso(), result.commit, result.error, id],
  );
}
