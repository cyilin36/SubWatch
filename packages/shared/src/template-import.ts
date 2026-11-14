import { z } from 'zod';
import {
  MAX_TEMPLATE_SOURCE_TEMPLATES,
  TEMPLATE_KIND_VALUES,
  type TemplateKind,
} from './constants.js';
import type { TemplateDto } from './types.js';

// ---------------------------------------------------------------------------
// Importing templates from a git repository
//
// A repository the user pulls from must ship a `subwatch-templates.json`
// manifest at its root listing the templates it offers. SubWatch clones the
// repository, reads the manifest, lets the user pick templates, and stores the
// chosen ones as ordinary templates (no repository entity is persisted — only a
// provenance URL/path on each imported template).
// ---------------------------------------------------------------------------

export const TEMPLATE_MANIFEST_FILE = 'subwatch-templates.json';
export const TEMPLATE_MANIFEST_FORMAT = 'subwatch-template-repository';
export const TEMPLATE_MANIFEST_VERSION = 1;

/** Only scheme-qualified HTTP(S) and local `file://` URLs are accepted. */
export const templateGitUrlSchema = z
  .string()
  .min(1)
  .max(2000)
  .regex(/^(?:https?|file):\/\/[^\s]+$/i, 'url must be an http(s):// or file:// URL');

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

/** Body for previewing a repository before importing. */
export const templateGitPreviewInputSchema = z.object({
  url: templateGitUrlSchema,
  branch: z.string().max(100).default(''),
});
export type TemplateGitPreviewInput = z.infer<typeof templateGitPreviewInputSchema>;

/** Body for importing selected templates (paths are manifest entry paths). */
export const templateGitImportInputSchema = z.object({
  url: templateGitUrlSchema,
  branch: z.string().max(100).default(''),
  paths: z.array(z.string().min(1).max(500)).min(1).max(MAX_TEMPLATE_SOURCE_TEMPLATES),
});
export type TemplateGitImportInput = z.infer<typeof templateGitImportInputSchema>;

/** One template offered by a repository, as returned by the preview endpoint. */
export interface TemplateGitPreviewTemplateDto {
  path: string;
  id: string | null;
  kind: TemplateKind;
  name: string;
  description: string;
  icon: string;
  color: string;
  category: string;
  version: string;
  /** Validation error for this entry (file missing/invalid), or `null`. */
  error: string | null;
}

export interface TemplateGitPreviewDto {
  /** Short label derived from the URL, e.g. `owner/repo`. */
  repositoryLabel: string | null;
  repositoryName: string | null;
  repositoryDescription: string | null;
  commit: string | null;
  templates: TemplateGitPreviewTemplateDto[];
  skipped: { path: string; error: string }[];
  error: string | null;
}

export interface TemplateGitImportResultDto {
  imported: number;
  templates: TemplateDto[];
}
