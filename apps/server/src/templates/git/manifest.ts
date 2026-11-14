import { lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  MAX_TEMPLATE_FILE_BYTES,
  TEMPLATE_MANIFEST_FILE,
  templateManifestSchema,
  type TemplateManifest,
} from '@subwatch/shared';

export interface ManifestReadResult {
  manifest: TemplateManifest | null;
  /** Fatal error string when the required manifest is missing or invalid. */
  error: string | null;
}

function describeIssues(error: { issues: { message: string }[] }): string {
  return error.issues[0]?.message ?? 'invalid manifest';
}

/**
 * Read and validate the required `subwatch-templates.json` manifest at the root
 * of a cloned repository. Never throws; a missing, unreadable, malformed or
 * schema-invalid manifest is reported as a fatal `error` string.
 */
export function readTemplateManifest(cloneDir: string): ManifestReadResult {
  const manifestPath = path.join(cloneDir, TEMPLATE_MANIFEST_FILE);

  let stat;
  try {
    stat = lstatSync(manifestPath);
  } catch {
    return { manifest: null, error: `repository is missing ${TEMPLATE_MANIFEST_FILE}` };
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    return { manifest: null, error: `${TEMPLATE_MANIFEST_FILE} is not a regular file` };
  }
  if (stat.size > MAX_TEMPLATE_FILE_BYTES) {
    return {
      manifest: null,
      error: `${TEMPLATE_MANIFEST_FILE} exceeds the ${MAX_TEMPLATE_FILE_BYTES} byte limit`,
    };
  }

  let raw: string;
  try {
    raw = readFileSync(manifestPath, 'utf8');
  } catch {
    return { manifest: null, error: `${TEMPLATE_MANIFEST_FILE} could not be read` };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { manifest: null, error: `${TEMPLATE_MANIFEST_FILE} is not valid JSON` };
  }

  const validation = templateManifestSchema.safeParse(parsed);
  if (!validation.success) {
    return {
      manifest: null,
      error: `${TEMPLATE_MANIFEST_FILE} is invalid: ${describeIssues(validation.error)}`,
    };
  }
  return { manifest: validation.data, error: null };
}
