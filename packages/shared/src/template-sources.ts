import { z } from 'zod';
import type { TemplateKind } from './constants.js';

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
