import type { TemplateSourceSyncResultDto } from '@subwatch/shared';
import type { CoreContext } from '../../context.js';
import { ConflictError, NotFoundError } from '../../lib/errors.js';
import { pruneSourceTemplates, upsertSourceTemplate } from '../repository.js';
import { redactCredentials, syncClone, templateSourceDir } from './git.js';
import { getTemplateSource, recordSync } from './repository.js';
import { scanTemplates } from './scan.js';

/** In-memory lock: one concurrent sync per source id. */
const running = new Set<string>();

function errorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const message = redactCredentials(raw).trim();
  return message !== '' ? message : 'Template source sync failed';
}

/**
 * Clone the source repository, install/update every valid template, prune
 * templates that disappeared, and record the outcome. A per-source in-memory
 * lock rejects concurrent syncs with 409. Any failure is captured, recorded on
 * the source and returned as `ok: false` rather than thrown (except a missing
 * source, which is a 404).
 */
export async function syncTemplateSource(
  ctx: CoreContext,
  id: string,
): Promise<TemplateSourceSyncResultDto> {
  if (running.has(id)) {
    throw new ConflictError('A sync is already running for this source');
  }
  running.add(id);
  try {
    const source = getTemplateSource(ctx, id);
    if (!source) throw new NotFoundError('Template source not found');

    try {
      const destDir = templateSourceDir(ctx, source.id);
      const { commit } = await syncClone(
        ctx,
        { id: source.id, url: source.url, branch: source.branch },
        destDir,
      );

      const scan = scanTemplates(destDir);

      // A repository without templates/ is a misconfiguration, not an empty
      // catalogue: fail without pruning so a broken repo never wipes the
      // templates installed from its previous good state.
      const templatesDirMissing = scan.skipped.some(
        (entry) => entry.path === 'templates' && entry.error.includes('no templates/ directory'),
      );
      if (templatesDirMissing) {
        throw new Error('repository has no templates/ directory');
      }

      let added = 0;
      let updated = 0;
      let unchanged = 0;
      for (const template of scan.templates) {
        const outcome = upsertSourceTemplate(ctx, source.id, template.path, commit, template.input);
        if (outcome === 'added') added += 1;
        else if (outcome === 'updated') updated += 1;
        else unchanged += 1;
      }

      const removed = pruneSourceTemplates(ctx, source.id, new Set(scan.files));
      recordSync(ctx, source.id, { commit, error: null });

      return {
        ok: true,
        commit,
        added,
        updated,
        removed,
        unchanged,
        skipped: scan.skipped,
        error: null,
      };
    } catch (error) {
      const message = errorMessage(error);
      recordSync(ctx, source.id, { commit: null, error: message });
      return {
        ok: false,
        commit: null,
        added: 0,
        updated: 0,
        removed: 0,
        unchanged: 0,
        skipped: [],
        error: message,
      };
    }
  } finally {
    running.delete(id);
  }
}
