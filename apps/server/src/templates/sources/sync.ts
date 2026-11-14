import type {
  TemplateInput,
  TemplateSourceAvailableDto,
  TemplateSourceAvailableTemplateDto,
  TemplateSourceSyncResultDto,
} from '@subwatch/shared';
import { TEMPLATE_REPOSITORY_MANIFEST_FILE } from '@subwatch/shared';
import type { CoreContext } from '../../context.js';
import { AppError, BadRequestError, ConflictError, NotFoundError } from '../../lib/errors.js';
import { pruneSourceTemplates, upsertSourceTemplate } from '../repository.js';
import { redactCredentials, syncClone, templateSourceDir } from './git.js';
import { getTemplateSource, listInstalledSourcePaths, recordSync } from './repository.js';
import {
  loadTemplateCatalog,
  TEMPLATES_DIR,
  type CatalogEntry,
  type SkippedTemplate,
  type TemplateCatalog,
} from './scan.js';

/** In-memory lock: at most one clone-backed operation (sync or preview) per source id. */
const running = new Set<string>();

function errorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const message = redactCredentials(raw).trim();
  return message !== '' ? message : 'Template source operation failed';
}

function sourceLockMessage(): string {
  return 'A sync or preview is already running for this source';
}

/** A fatal (unreadable) manifest is reported as a skipped entry at the manifest path. */
function manifestFatalError(catalogue: TemplateCatalog): string | null {
  const hit = catalogue.skipped.find(
    (entry) => entry.path === TEMPLATE_REPOSITORY_MANIFEST_FILE && entry.error !== '',
  );
  return hit ? hit.error : null;
}

function isTemplatesDirMissing(catalogue: TemplateCatalog): boolean {
  return catalogue.skipped.some(
    (entry) => entry.path === TEMPLATES_DIR && entry.error.includes('no templates/ directory'),
  );
}

/**
 * Fold a catalogue entry's display/version metadata (already manifest-over-file
 * resolved) into the template input that is written to the database. This makes
 * the installed template reflect the manifest's `name`/`description`/`version`
 * overrides, not just the fields inside the template file.
 */
function effectiveTemplateInput(entry: CatalogEntry): TemplateInput | null {
  if (entry.input === null) return null;
  return {
    ...entry.input,
    kind: entry.kind,
    name: entry.name,
    description: entry.description,
    icon: entry.icon,
    color: entry.color,
    category: entry.category,
    version: entry.version,
  };
}

/** Clone a source repository into its local clone directory, returning the HEAD commit. */
async function cloneSource(ctx: CoreContext, source: { id: string; url: string; branch: string }) {
  const destDir = templateSourceDir(ctx, source.id);
  const { commit } = await syncClone(ctx, { id: source.id, url: source.url, branch: source.branch }, destDir);
  return { destDir, commit };
}

/**
 * Clone the source repository, install/update every valid template, prune
 * templates that disappeared, and record the outcome. A per-source in-memory
 * lock rejects concurrent syncs with 409. Any failure is captured, recorded on
 * the source and returned as `ok: false` rather than thrown (except a missing
 * source, which is a 404, and unknown selective paths, which are a 400).
 *
 * - `paths` undefined → full sync: install every valid catalogue template and
 *   prune installed templates whose path is no longer offered.
 * - `paths` provided → selective sync: install/update only the requested paths
 *   (unknown paths are rejected with 400), never prune.
 */
export async function syncTemplateSource(
  ctx: CoreContext,
  id: string,
  paths?: string[],
): Promise<TemplateSourceSyncResultDto> {
  if (running.has(id)) {
    throw new ConflictError(sourceLockMessage());
  }
  running.add(id);
  try {
    const source = getTemplateSource(ctx, id);
    if (!source) throw new NotFoundError('Template source not found');

    try {
      const { destDir, commit } = await cloneSource(ctx, source);
      const catalogue = loadTemplateCatalog(destDir);

      // An unreadable manifest or a missing templates/ directory is a
      // misconfiguration, not an empty catalogue: fail without pruning so a
      // broken repository never wipes the templates installed from it before.
      const manifestError = manifestFatalError(catalogue);
      if (manifestError !== null) throw new Error(manifestError);
      if (isTemplatesDirMissing(catalogue)) throw new Error('repository has no templates/ directory');

      const skipped: SkippedTemplate[] = [...catalogue.skipped];

      let candidates: CatalogEntry[];
      let prune: boolean;
      if (paths === undefined) {
        candidates = catalogue.entries;
        prune = true;
      } else {
        const requested = [...new Set(paths)];
        const byPath = new Map(catalogue.entries.map((entry) => [entry.path, entry]));
        const unknown = requested.filter((requestedPath) => !byPath.has(requestedPath));
        if (unknown.length > 0) {
          throw new BadRequestError(`Unknown template path(s): ${unknown.join(', ')}`, {
            paths: unknown,
          });
        }
        candidates = requested.map((requestedPath) => byPath.get(requestedPath)!);
        prune = false;
      }

      let added = 0;
      let updated = 0;
      let unchanged = 0;
      for (const entry of candidates) {
        const input = effectiveTemplateInput(entry);
        if (input === null || entry.error !== null) {
          skipped.push({ path: entry.path, error: entry.error ?? 'invalid template' });
          continue;
        }
        const outcome = upsertSourceTemplate(ctx, source.id, entry.path, commit, input);
        if (outcome === 'added') added += 1;
        else if (outcome === 'updated') updated += 1;
        else unchanged += 1;
      }

      const removed = prune ? pruneSourceTemplates(ctx, source.id, new Set(catalogue.files)) : 0;
      recordSync(ctx, source.id, { commit, error: null });

      return {
        ok: true,
        commit,
        added,
        updated,
        removed,
        unchanged,
        skipped,
        error: null,
      };
    } catch (error) {
      // Unknown selective paths are a client error, not a repository failure.
      if (error instanceof AppError) throw error;
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

/**
 * Clone the source repository and build its catalogue for preview, without any
 * database writes. Shares the per-source lock with `syncTemplateSource`, so a
 * preview and a sync never clone concurrently (the second gets 409). A clone or
 * catalogue failure is returned as an `error` in the DTO (HTTP 200), not thrown.
 */
export async function previewTemplateSource(
  ctx: CoreContext,
  id: string,
): Promise<TemplateSourceAvailableDto> {
  if (running.has(id)) {
    throw new ConflictError(sourceLockMessage());
  }
  running.add(id);
  try {
    const source = getTemplateSource(ctx, id);
    if (!source) throw new NotFoundError('Template source not found');

    try {
      const { destDir, commit } = await cloneSource(ctx, source);
      const catalogue = loadTemplateCatalog(destDir);
      const installedPaths = listInstalledSourcePaths(ctx, id);

      const templates: TemplateSourceAvailableTemplateDto[] = catalogue.entries.map((entry) => ({
        path: entry.path,
        id: entry.id,
        kind: entry.kind,
        name: entry.name,
        description: entry.description,
        icon: entry.icon,
        color: entry.color,
        category: entry.category,
        version: entry.version,
        installed: installedPaths.has(entry.path),
        error: entry.error,
      }));

      return {
        commit,
        repositoryName: catalogue.manifestName,
        repositoryDescription: catalogue.manifestDescription,
        templates,
        skipped: catalogue.skipped,
        error: manifestFatalError(catalogue),
      };
    } catch (error) {
      if (error instanceof AppError) throw error;
      return {
        commit: null,
        repositoryName: null,
        repositoryDescription: null,
        templates: [],
        skipped: [],
        error: errorMessage(error),
      };
    }
  } finally {
    running.delete(id);
  }
}
