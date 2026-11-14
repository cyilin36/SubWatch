import { lstatSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  MAX_TEMPLATE_FILE_BYTES,
  MAX_TEMPLATE_SOURCE_TEMPLATES,
  TEMPLATE_EXPORT_FORMAT,
  TEMPLATE_KIND_VALUES,
  templateInputSchema,
  type TemplateInput,
  type TemplateKind,
  type TemplateManifest,
  type TemplateManifestEntry,
} from '@subwatch/shared';

/** The repository directory that must hold every template file. */
export const TEMPLATES_DIR = 'templates';

/** Kind used for an error entry whose kind cannot be resolved from manifest or file. */
const FALLBACK_KIND: TemplateKind = TEMPLATE_KIND_VALUES[0] ?? 'subscription';

/**
 * One template a repository offers: either a valid template (`input` set,
 * `error` null) or a broken entry (`input` null, `error` explaining why).
 * `path` is the POSIX path relative to the clone root, e.g. `templates/monitor/x.json`.
 */
export interface CatalogEntry {
  path: string;
  id: string | null;
  kind: TemplateKind;
  name: string;
  description: string;
  icon: string;
  color: string;
  category: string;
  version: string;
  input: TemplateInput | null;
  error: string | null;
}

export interface SkippedTemplate {
  path: string;
  error: string;
}

/** The catalogue a repository offers, built from its required manifest. */
export interface TemplateCatalog {
  entries: CatalogEntry[];
  manifestName: string | null;
  manifestDescription: string | null;
  skipped: SkippedTemplate[];
}

function toPosix(value: string): string {
  return value.split(path.sep).join('/');
}

function isExportEnvelope(value: unknown): value is { format: string; template?: unknown } {
  return (
    value !== null &&
    typeof value === 'object' &&
    (value as { format?: unknown }).format === TEMPLATE_EXPORT_FORMAT
  );
}

function describeIssues(error: { issues: { message: string }[] }): string {
  return error.issues[0]?.message ?? 'invalid template';
}

function isPathInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
}

/** Read and validate one template file. Never throws. */
function readTemplateInput(absolutePath: string): {
  input: TemplateInput | null;
  error: string | null;
} {
  let stat;
  try {
    stat = lstatSync(absolutePath);
  } catch {
    return { input: null, error: 'file could not be read' };
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    return { input: null, error: 'file could not be read' };
  }
  if (stat.size > MAX_TEMPLATE_FILE_BYTES) {
    return { input: null, error: `file exceeds the ${MAX_TEMPLATE_FILE_BYTES} byte limit` };
  }

  let raw: string;
  try {
    raw = readFileSync(absolutePath, 'utf8');
  } catch {
    return { input: null, error: 'file could not be read' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { input: null, error: 'invalid JSON' };
  }

  const candidate = isExportEnvelope(parsed) ? parsed.template : parsed;
  const validation = templateInputSchema.safeParse(candidate);
  if (!validation.success) {
    return { input: null, error: describeIssues(validation.error) };
  }
  return { input: validation.data, error: null };
}

/** Build a catalogue entry for a manifest entry pointing at a broken file. */
function buildErrorEntry(
  declaredPath: string,
  entry: TemplateManifestEntry,
  error: string,
): CatalogEntry {
  return {
    path: declaredPath,
    id: entry.id ?? null,
    kind: entry.kind ?? FALLBACK_KIND,
    name: entry.name ?? '',
    description: entry.description ?? '',
    icon: entry.icon ?? '',
    color: entry.color ?? '',
    category: entry.category ?? '',
    version: entry.version ?? '',
    input: null,
    error,
  };
}

/**
 * Build the catalogue a cloned repository offers from its required manifest.
 * Each referenced file must live inside `<cloneDir>/templates/`; entries with an
 * out-of-tree path, a missing file or an invalid template become error entries.
 * Display metadata resolves as `manifest field ?? file field ?? ''`.
 */
export function buildTemplateCatalog(cloneDir: string, manifest: TemplateManifest): TemplateCatalog {
  const entries: CatalogEntry[] = [];
  const skipped: SkippedTemplate[] = [];
  const seen = new Set<string>();

  for (const entry of manifest.templates) {
    if (entries.length >= MAX_TEMPLATE_SOURCE_TEMPLATES) {
      skipped.push({
        path: TEMPLATES_DIR,
        error: `repository exceeds the limit of ${MAX_TEMPLATE_SOURCE_TEMPLATES} templates`,
      });
      break;
    }

    const absolute = path.resolve(cloneDir, entry.path);
    if (!isPathInside(cloneDir, absolute)) {
      entries.push(buildErrorEntry(entry.path, entry, 'template path must stay inside the repository'));
      continue;
    }
    const relative = toPosix(path.relative(cloneDir, absolute));
    if (!relative.startsWith(`${TEMPLATES_DIR}/`)) {
      entries.push(
        buildErrorEntry(
          entry.path,
          entry,
          `template path must be inside the ${TEMPLATES_DIR}/ directory`,
        ),
      );
      continue;
    }

    if (seen.has(relative)) {
      skipped.push({ path: relative, error: 'duplicate template path in manifest' });
      continue;
    }
    seen.add(relative);

    const { input, error } = readTemplateInput(absolute);
    if (!input) {
      entries.push(buildErrorEntry(relative, entry, error ?? 'invalid template'));
      continue;
    }

    entries.push({
      path: relative,
      id: entry.id ?? null,
      kind: entry.kind ?? input.kind,
      name: entry.name ?? input.name ?? '',
      description: entry.description ?? input.description ?? '',
      icon: entry.icon ?? input.icon ?? '',
      color: entry.color ?? input.color ?? '',
      category: entry.category ?? input.category ?? '',
      version: entry.version ?? input.version ?? '',
      input,
      error: null,
    });
  }

  return {
    entries,
    manifestName: manifest.name ?? null,
    manifestDescription: manifest.description ?? null,
    skipped,
  };
}
