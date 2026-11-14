import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  MAX_TEMPLATE_FILE_BYTES,
  MAX_TEMPLATE_SOURCE_TEMPLATES,
  TEMPLATE_EXPORT_FORMAT,
  templateInputSchema,
  type TemplateInput,
} from '@subwatch/shared';

export interface ScannedTemplate {
  /** POSIX path relative to the clone root, e.g. `templates/monitor/x.json`. */
  path: string;
  input: TemplateInput;
}

export interface SkippedTemplate {
  path: string;
  error: string;
}

export interface ScanResult {
  /** Every discovered `*.json` path (valid or not), used for safe pruning. */
  files: string[];
  templates: ScannedTemplate[];
  skipped: SkippedTemplate[];
}

const TEMPLATES_DIR = 'templates';

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

/**
 * Recursively walk `<cloneDir>/templates` and return every `*.json` template
 * file. Symbolic links, dot-prefixed entries and `node_modules` are ignored.
 * Returns the paths of all discovered files plus the count cap is enforced here.
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

/**
 * Scan a cloned repository for template files and validate each one. Invalid
 * files never abort the scan: they are reported in `skipped` so the rest of the
 * repository still installs. `files` always lists every discovered JSON path.
 */
export function scanTemplates(cloneDir: string): ScanResult {
  const collected = collectJsonFiles(cloneDir);
  const templates: ScannedTemplate[] = [];
  const skipped: SkippedTemplate[] = [...collected.skipped];

  collected.absolutePaths.forEach((absolute, index) => {
    const relativePath = collected.relativePaths[index] ?? toPosix(path.relative(cloneDir, absolute));

    let stat;
    try {
      stat = lstatSync(absolute);
    } catch {
      skipped.push({ path: relativePath, error: 'file could not be read' });
      return;
    }
    if (stat.size > MAX_TEMPLATE_FILE_BYTES) {
      skipped.push({
        path: relativePath,
        error: `file exceeds the ${MAX_TEMPLATE_FILE_BYTES} byte limit`,
      });
      return;
    }

    let raw: string;
    try {
      raw = readFileSync(absolute, 'utf8');
    } catch {
      skipped.push({ path: relativePath, error: 'file could not be read' });
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      skipped.push({ path: relativePath, error: 'invalid JSON' });
      return;
    }

    const candidate = isExportEnvelope(parsed) ? parsed.template : parsed;
    const validation = templateInputSchema.safeParse(candidate);
    if (!validation.success) {
      skipped.push({ path: relativePath, error: describeIssues(validation.error) });
      return;
    }

    templates.push({ path: relativePath, input: validation.data });
  });

  return { files: collected.relativePaths, templates, skipped };
}
