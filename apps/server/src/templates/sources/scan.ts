import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  MAX_TEMPLATE_FILE_BYTES,
  MAX_TEMPLATE_SOURCE_TEMPLATES,
  TEMPLATE_EXPORT_FORMAT,
  TEMPLATE_KIND_VALUES,
  TEMPLATE_REPOSITORY_MANIFEST_FILE,
  templateInputSchema,
  templateManifestSchema,
  type TemplateInput,
  type TemplateKind,
  type TemplateManifest,
  type TemplateManifestEntry,
} from '@subwatch/shared';

/**
 * One template a repository offers: either a valid template (`input` set,
 * `error` null) or a broken entry (`input` null, `error` explaining why).
 * `path` is the POSIX path relative to the clone root, e.g.
 * `templates/monitor/x.json`.
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

/**
 * The catalogue a repository offers, built either from its `subwatch-templates.json`
 * manifest or — when there is no manifest — by scanning the `templates/` tree (all `*.json` files).
 * `files` lists every discovered template path (valid or not) so a full sync can
 * prune safely without deleting templates that merely failed validation.
 */
export interface TemplateCatalog {
  files: string[];
  entries: CatalogEntry[];
  manifestName: string | null;
  manifestDescription: string | null;
  skipped: SkippedTemplate[];
}

/** The repository directory that holds the template files. */
export const TEMPLATES_DIR = 'templates';

/**
 * Kind assigned to an error entry whose kind cannot be resolved from either the
 * manifest or the template file. The entry always carries an `error`, so clients
 * treat it as unavailable; this value only groups it in the UI.
 */
const FALLBACK_KIND: TemplateKind = TEMPLATE_KIND_VALUES[0] ?? 'subscription';

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
  const first = error.issues[0]?.message ?? 'invalid template';
  return first;
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

/**
 * Recursively walk `<cloneDir>/templates` and return every `*.json` template
 * file. Symbolic links, dot-prefixed entries and `node_modules` are ignored.
 * The per-repository file cap is enforced here.
 */
function collectJsonFiles(cloneDir: string): {
  absolutePaths: string[];
  relativePaths: string[];
  skipped: SkippedTemplate[];
} {
  const absolutePaths: string[] = [];
  const relativePaths: string[] = [];
  const skipped: SkippedTemplate[] = [];
  const templatesRoot = path.join(cloneDir, TEMPLATES_DIR);

  let rootStat;
  try {
    rootStat = lstatSync(templatesRoot);
  } catch {
    skipped.push({ path: TEMPLATES_DIR, error: 'repository has no templates/ directory' });
    return { absolutePaths, relativePaths, skipped };
  }
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    skipped.push({ path: TEMPLATES_DIR, error: 'repository has no templates/ directory' });
    return { absolutePaths, relativePaths, skipped };
  }

  let limitExceeded = false;

  const walk = (dir: string): void => {
    if (limitExceeded) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    entries.sort();
    for (const entry of entries) {
      if (entry.startsWith('.')) continue;
      if (entry === 'node_modules') continue;
      const absolute = path.join(dir, entry);
      let stat;
      try {
        stat = lstatSync(absolute);
      } catch {
        continue;
      }
      if (stat.isSymbolicLink()) continue;
      if (stat.isDirectory()) {
        walk(absolute);
        if (limitExceeded) return;
        continue;
      }
      if (!stat.isFile()) continue;
      if (!entry.toLowerCase().endsWith('.json')) continue;

      if (absolutePaths.length >= MAX_TEMPLATE_SOURCE_TEMPLATES) {
        limitExceeded = true;
        skipped.push({
          path: TEMPLATES_DIR,
          error: `repository exceeds the limit of ${MAX_TEMPLATE_SOURCE_TEMPLATES} template files`,
        });
        return;
      }

      absolutePaths.push(absolute);
      relativePaths.push(toPosix(path.relative(cloneDir, absolute)));
    }
  };

  walk(templatesRoot);
  return { absolutePaths, relativePaths, skipped };
}

/** Build a catalogue entry from one template file on disk. */
function buildFileEntry(relativePath: string, absolutePath: string): CatalogEntry {
  const { input, error } = readTemplateInput(absolutePath);
  if (!input) {
    return {
      path: relativePath,
      id: null,
      kind: FALLBACK_KIND,
      name: '',
      description: '',
      icon: '',
      color: '',
      category: '',
      version: '',
      input: null,
      error: error ?? 'invalid template',
    };
  }
  return {
    path: relativePath,
    id: null,
    kind: input.kind,
    name: input.name,
    description: input.description,
    icon: input.icon,
    color: input.color,
    category: input.category,
    version: input.version,
    input,
    error: null,
  };
}

/** Build a catalogue entry for a manifest entry pointing at a broken file. */
function buildManifestErrorEntry(
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

/** Fallback catalogue: scan the `templates/` tree (all `*.json` files) and offer every file. */
function loadFallbackCatalog(cloneDir: string): TemplateCatalog {
  const collected = collectJsonFiles(cloneDir);
  const entries: CatalogEntry[] = [];
  collected.absolutePaths.forEach((absolute, index) => {
    const relativePath =
      collected.relativePaths[index] ?? toPosix(path.relative(cloneDir, absolute));
    entries.push(buildFileEntry(relativePath, absolute));
  });
  return {
    files: [...collected.relativePaths],
    entries,
    manifestName: null,
    manifestDescription: null,
    skipped: [...collected.skipped],
  };
}

/** Catalogue built from a validated `subwatch-templates.json` manifest. */
function loadManifestCatalog(cloneDir: string, manifest: TemplateManifest): TemplateCatalog {
  const entries: CatalogEntry[] = [];
  const files: string[] = [];
  const seen = new Set<string>();

  for (const entry of manifest.templates) {
    const absolute = path.resolve(cloneDir, entry.path);
    if (!isPathInside(cloneDir, absolute)) {
      entries.push(
        buildManifestErrorEntry(entry.path, entry, 'template path must stay inside the repository'),
      );
      continue;
    }
    const relative = toPosix(path.relative(cloneDir, absolute));
    if (!relative.startsWith(`${TEMPLATES_DIR}/`)) {
      entries.push(
        buildManifestErrorEntry(
          entry.path,
          entry,
          `template path must be inside the ${TEMPLATES_DIR}/ directory`,
        ),
      );
      continue;
    }

    // Record the discovered path even when the file fails validation, so a full
    // sync does not prune a previously-installed template that temporarily broke.
    if (!seen.has(relative)) {
      seen.add(relative);
      files.push(relative);
    }

    const { input, error } = readTemplateInput(absolute);
    if (!input) {
      entries.push(buildManifestErrorEntry(relative, entry, error ?? 'invalid template'));
      continue;
    }

    entries.push({
      path: relative,
      id: entry.id ?? null,
      kind: entry.kind ?? input.kind,
      name: entry.name ?? input.name,
      description: entry.description ?? input.description,
      icon: entry.icon ?? input.icon,
      color: entry.color ?? input.color,
      category: entry.category ?? input.category,
      version: entry.version ?? input.version ?? '',
      input,
      error: null,
    });
  }

  return {
    files,
    entries,
    manifestName: manifest.name ?? null,
    manifestDescription: manifest.description ?? null,
    skipped: [],
  };
}

interface ManifestReadResult {
  manifest: TemplateManifest | null;
  fatalError: string | null;
}

/** Read and validate the optional repository manifest. Never throws. */
function readManifest(cloneDir: string): ManifestReadResult {
  const manifestPath = path.join(cloneDir, TEMPLATE_REPOSITORY_MANIFEST_FILE);

  let stat;
  try {
    stat = lstatSync(manifestPath);
  } catch {
    // No manifest: the caller falls back to scanning the templates directory.
    return { manifest: null, fatalError: null };
  }
  if (stat.isSymbolicLink() || !stat.isFile()) {
    return {
      manifest: null,
      fatalError: `${TEMPLATE_REPOSITORY_MANIFEST_FILE} is not a regular file`,
    };
  }
  if (stat.size > MAX_TEMPLATE_FILE_BYTES) {
    return {
      manifest: null,
      fatalError: `${TEMPLATE_REPOSITORY_MANIFEST_FILE} exceeds the ${MAX_TEMPLATE_FILE_BYTES} byte limit`,
    };
  }

  let raw: string;
  try {
    raw = readFileSync(manifestPath, 'utf8');
  } catch {
    return { manifest: null, fatalError: `${TEMPLATE_REPOSITORY_MANIFEST_FILE} could not be read` };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { manifest: null, fatalError: `${TEMPLATE_REPOSITORY_MANIFEST_FILE} is not valid JSON` };
  }

  const validation = templateManifestSchema.safeParse(parsed);
  if (!validation.success) {
    return {
      manifest: null,
      fatalError: `${TEMPLATE_REPOSITORY_MANIFEST_FILE} is invalid: ${describeIssues(validation.error)}`,
    };
  }
  return { manifest: validation.data, fatalError: null };
}

/**
 * Build the catalogue a cloned repository offers. Uses `subwatch-templates.json`
 * when present (validating every referenced file) and otherwise falls back to
 * scanning the `templates/` tree (all `*.json` files). A broken manifest is surfaced as a fatal
 * `skipped` entry (at the manifest path) with no catalogue entries, so callers
 * can refuse to prune a repository they cannot read.
 */
export function loadTemplateCatalog(cloneDir: string): TemplateCatalog {
  const { manifest, fatalError } = readManifest(cloneDir);
  if (fatalError !== null) {
    return {
      files: [],
      entries: [],
      manifestName: null,
      manifestDescription: null,
      skipped: [{ path: TEMPLATE_REPOSITORY_MANIFEST_FILE, error: fatalError }],
    };
  }
  if (manifest) {
    return loadManifestCatalog(cloneDir, manifest);
  }
  return loadFallbackCatalog(cloneDir);
}
