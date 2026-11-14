import type {
  TemplateDto,
  TemplateGitImportInput,
  TemplateGitImportResultDto,
  TemplateGitPreviewDto,
  TemplateGitPreviewInput,
  TemplateGitPreviewTemplateDto,
  TemplateInput,
} from '@subwatch/shared';
import type { CoreContext } from '../../context.js';
import { AppError, BadRequestError, NotFoundError } from '../../lib/errors.js';
import {
  createGitTemplate,
  getTemplateRow,
  updateGitTemplateContent,
} from '../repository.js';
import { deriveSourceLabel } from '../source.js';
import { redactCredentials, withGitClone } from './git.js';
import { readTemplateManifest } from './manifest.js';
import { buildTemplateCatalog, type CatalogEntry } from './catalog.js';

function errorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const message = redactCredentials(raw).trim();
  return message !== '' ? message : 'Template import failed';
}

/**
 * Fold a catalogue entry's display/version metadata (already manifest-over-file
 * resolved) into the template input written to the database, so the imported
 * template reflects the manifest overrides.
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

/**
 * Clone the repository and return a preview of the templates its manifest
 * offers, without any database writes. Clone or manifest failures are returned
 * as an `error` in the DTO (HTTP 200), never thrown.
 */
export async function previewGitTemplates(
  ctx: CoreContext,
  input: TemplateGitPreviewInput,
): Promise<TemplateGitPreviewDto> {
  const repositoryLabel = deriveSourceLabel(input.url);
  try {
    return await withGitClone(ctx, { url: input.url, branch: input.branch }, async ({ dir, commit }) => {
      const { manifest, error } = readTemplateManifest(dir);
      if (!manifest) {
        return {
          repositoryLabel,
          repositoryName: null,
          repositoryDescription: null,
          commit,
          templates: [],
          skipped: [],
          error: error ?? 'invalid manifest',
        };
      }

      const catalog = buildTemplateCatalog(dir, manifest);
      const templates: TemplateGitPreviewTemplateDto[] = catalog.entries.map((entry) => ({
        path: entry.path,
        id: entry.id,
        kind: entry.kind,
        name: entry.name,
        description: entry.description,
        icon: entry.icon,
        color: entry.color,
        category: entry.category,
        version: entry.version,
        error: entry.error,
      }));

      return {
        repositoryLabel,
        repositoryName: catalog.manifestName,
        repositoryDescription: catalog.manifestDescription,
        commit,
        templates,
        skipped: catalog.skipped,
        error: null,
      };
    });
  } catch (error) {
    return {
      repositoryLabel,
      repositoryName: null,
      repositoryDescription: null,
      commit: null,
      templates: [],
      skipped: [],
      error: errorMessage(error),
    };
  }
}

/**
 * Clone the repository, validate the requested manifest paths, and store each
 * selected template with its provenance. A missing/invalid manifest, an unknown
 * requested path, or a selected entry that fails validation is a 400.
 */
export async function importGitTemplates(
  ctx: CoreContext,
  input: TemplateGitImportInput,
): Promise<TemplateGitImportResultDto> {
  try {
    return await withGitClone(ctx, { url: input.url, branch: input.branch }, async ({ dir, commit }) => {
      const { manifest, error } = readTemplateManifest(dir);
      if (!manifest) throw new BadRequestError(error ?? 'Invalid manifest');

      const catalog = buildTemplateCatalog(dir, manifest);
      const byPath = new Map(catalog.entries.map((entry) => [entry.path, entry]));
      const requested = [...new Set(input.paths)];

      const unknown = requested.filter((requestedPath) => !byPath.has(requestedPath));
      if (unknown.length > 0) {
        throw new BadRequestError(`Unknown template path(s): ${unknown.join(', ')}`, {
          paths: unknown,
        });
      }

      // Validate every selected entry before writing anything, so a bad selection
      // never leaves a partially imported set behind.
      const selected: { path: string; input: TemplateInput }[] = [];
      for (const requestedPath of requested) {
        const entry = byPath.get(requestedPath)!;
        const effective = effectiveTemplateInput(entry);
        if (effective === null || entry.error !== null) {
          throw new BadRequestError(
            `Template "${requestedPath}" is invalid: ${entry.error ?? 'invalid template'}`,
          );
        }
        selected.push({ path: entry.path, input: effective });
      }

      const templates: TemplateDto[] = selected.map(({ path, input: effective }) =>
        createGitTemplate(ctx, effective, {
          url: input.url,
          branch: input.branch,
          path,
          revision: commit,
        }),
      );

      return { imported: templates.length, templates };
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new BadRequestError(errorMessage(error));
  }
}

/**
 * Re-clone the repository a template was imported from, locate its source file,
 * and overwrite the template's content with the latest version and revision.
 * Missing provenance, a missing/invalid manifest, or a missing/invalid source
 * entry is a 400.
 */
export async function updateTemplateFromSource(ctx: CoreContext, id: string): Promise<TemplateDto> {
  const row = getTemplateRow(ctx, id);
  if (!row) throw new NotFoundError('Template not found');
  if (!row.source_url) throw new BadRequestError('Template has no source repository');
  if (!row.source_path) throw new BadRequestError('Template has no source repository');

  const sourceUrl = row.source_url;
  const sourceBranch = row.source_branch ?? '';
  const sourcePath = row.source_path;

  try {
    return await withGitClone(ctx, { url: sourceUrl, branch: sourceBranch }, async ({ dir, commit }) => {
      const { manifest, error } = readTemplateManifest(dir);
      if (!manifest) throw new BadRequestError(error ?? 'Invalid manifest');

      const catalog = buildTemplateCatalog(dir, manifest);
      const entry = catalog.entries.find((candidate) => candidate.path === sourcePath);
      if (!entry) {
        throw new BadRequestError(`Template source file "${sourcePath}" was not found in the repository`);
      }
      const effective = effectiveTemplateInput(entry);
      if (effective === null || entry.error !== null) {
        throw new BadRequestError(
          `Template source file "${sourcePath}" is invalid: ${entry.error ?? 'invalid template'}`,
        );
      }

      const updated = updateGitTemplateContent(ctx, id, effective, commit);
      if (!updated) throw new NotFoundError('Template not found');
      return updated;
    });
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw new BadRequestError(errorMessage(error));
  }
}
