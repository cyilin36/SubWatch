import { z } from 'zod';
import { TEMPLATE_KIND_VALUES, type TemplateKind } from './constants.js';

// ---------------------------------------------------------------------------
// Template repositories ("template sources")
//
// A template repository is a git repository whose `templates/` directory holds
// one JSON file per subscription/monitor template. SubWatch clones the repo and
// installs/updates the templates, so template authors can version and ship
// templates independently of the program itself.
// ---------------------------------------------------------------------------

export const TEMPLATE_SOURCE_FORMAT = 'subwatch-template-repository';
export const TEMPLATE_SOURCE_VERSION = 1;

/** Hard cap on how many template files one repository may contribute. */
export const MAX_TEMPLATE_SOURCE_TEMPLATES = 500;
/** Hard cap on a single template file's size, in bytes. */
export const MAX_TEMPLATE_FILE_BYTES = 256 * 1024;

/**
 * Only scheme-qualified HTTP(S) and local `file://` URLs are accepted. Anything
 * else (ssh://, git://, ext::, bare paths starting with `-`, ...) is rejected so
 * a stored source can never be interpreted as a git CLI option or a remote
 * command helper.
 */
const GIT_URL_PATTERN = /^(?:https?|file):\/\/[^\s]+$/i;

export const templateSourceUrlSchema = z
  .string()
  .min(1)
  .max(2000)
  .regex(GIT_URL_PATTERN, 'url must be an http(s):// or file:// URL');

export const templateSourceInputSchema = z.object({
  name: z.string().max(100).default(''),
  url: templateSourceUrlSchema,
  branch: z.string().max(100).default(''),
  enabled: z.boolean().default(true),
});
export type TemplateSourceInput = z.infer<typeof templateSourceInputSchema>;

export const templateSourceUpdateSchema = templateSourceInputSchema.partial();
export type TemplateSourceUpdate = z.infer<typeof templateSourceUpdateSchema>;

export interface TemplateSourceDto {
  id: string;
  name: string;
  url: string;
  branch: string;
  enabled: boolean;
  lastSyncedAt: string | null;
  lastCommit: string | null;
  lastError: string | null;
  /** Number of templates currently installed from this source. */
  templateCount: number;
  createdAt: string;
  updatedAt: string;
}

/** One template installed from a repository, as shown in the source detail. */
export interface TemplateSourceTemplateDto {
  id: string;
  path: string;
  kind: TemplateKind;
  name: string;
  description: string;
  icon: string;
  color: string;
  category: string;
  version: string;
  updatedAt: string;
}

export interface TemplateSourceDetailDto extends TemplateSourceDto {
  templates: TemplateSourceTemplateDto[];
}

export interface TemplateSourceSkippedFile {
  path: string;
  error: string;
}

export interface TemplateSourceSyncResultDto {
  ok: boolean;
  commit: string | null;
  added: number;
  updated: number;
  removed: number;
  unchanged: number;
  skipped: TemplateSourceSkippedFile[];
  error: string | null;
}

// ---------------------------------------------------------------------------
// Repository manifest
//
// A repository may ship a `subwatch-templates.json` manifest at its root that
// lists the templates it offers (path + optional display/version metadata).
// The manifest is what the preview endpoint reads so a user can see a
// repository's catalogue and install only the templates they select. When the
// manifest is absent, the server falls back to scanning `templates/**/*.json`
// and offers every file.
// ---------------------------------------------------------------------------

export const TEMPLATE_REPOSITORY_MANIFEST_FILE = 'subwatch-templates.json';
export const TEMPLATE_MANIFEST_FORMAT = 'subwatch-template-repository';
export const TEMPLATE_MANIFEST_VERSION = 1;

export const templateManifestEntrySchema = z.object({
  /** Path of the template file inside the repository (e.g. `templates/monitor/x.json`). */
  path: z.string().min(1).max(500),
  /** Optional stable id used for display/selection. */
  id: z.string().min(1).max(100).optional(),
  name: z.string().min(1).max(100).optional(),
  kind: z.enum(TEMPLATE_KIND_VALUES).optional(),
  version: z.string().max(32).optional(),
  description: z.string().max(500).optional(),
  category: z.string().max(50).optional(),
  icon: z.string().max(16).optional(),
  color: z.string().max(20).optional(),
});
export type TemplateManifestEntry = z.infer<typeof templateManifestEntrySchema>;

export const templateManifestSchema = z.object({
  format: z.literal(TEMPLATE_MANIFEST_FORMAT),
  version: z.number().int().optional(),
  name: z.string().max(100).optional(),
  description: z.string().max(500).optional(),
  templates: z.array(templateManifestEntrySchema).max(MAX_TEMPLATE_SOURCE_TEMPLATES),
});
export type TemplateManifest = z.infer<typeof templateManifestSchema>;

/** A path selection used by selective install and uninstall. */
export const templateSourcePathsSchema = z.object({
  paths: z.array(z.string().min(1).max(500)).min(1).max(MAX_TEMPLATE_SOURCE_TEMPLATES),
});
export type TemplateSourcePathsInput = z.infer<typeof templateSourcePathsSchema>;

/** Optional body for `POST /api/template-sources/:id/sync`; no `paths` means full sync. */
export const templateSourceSyncInputSchema = z.object({
  paths: z.array(z.string().min(1).max(500)).max(MAX_TEMPLATE_SOURCE_TEMPLATES).optional(),
});
export type TemplateSourceSyncInput = z.infer<typeof templateSourceSyncInputSchema>;

/** One template offered by a repository, as returned by the preview endpoint. */
export interface TemplateSourceAvailableTemplateDto {
  path: string;
  id: string | null;
  kind: TemplateKind;
  name: string;
  description: string;
  icon: string;
  color: string;
  category: string;
  version: string;
  /** Whether a template from this path is already installed from this source. */
  installed: boolean;
  /** Validation error for this entry (file missing/invalid), or `null`. */
  error: string | null;
}

export interface TemplateSourceAvailableDto {
  commit: string | null;
  repositoryName: string | null;
  repositoryDescription: string | null;
  templates: TemplateSourceAvailableTemplateDto[];
  skipped: TemplateSourceSkippedFile[];
  error: string | null;
}
