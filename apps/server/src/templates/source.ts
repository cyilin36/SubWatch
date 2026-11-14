/**
 * Derive a short, human-readable repository label from a template provenance
 * URL so the UI can show "来自 owner/repo".
 *
 * - `<https|http>://host/owner/repo(.git)` → `owner/repo`
 * - `file:///path/to/repo(.git)` → `repo`
 * - Anything empty or unparseable → `null`.
 */
export function deriveSourceLabel(url: string): string | null {
  const trimmed = url.trim();
  if (trimmed === '') return null;

  const stripGitSuffix = (segment: string): string => segment.replace(/\.git$/i, '');

  if (/^file:\/\//i.test(trimmed)) {
    const withoutScheme = trimmed.replace(/^file:\/\//i, '');
    // Drop query/fragment noise, then split on both separators.
    const pathPart = withoutScheme.split(/[?#]/, 1)[0] ?? '';
    const segments = pathPart.split(/[\\/]+/).filter((segment) => segment !== '');
    const last = segments[segments.length - 1];
    if (last === undefined) return null;
    const label = stripGitSuffix(last);
    return label === '' ? null : label;
  }

  if (/^https?:\/\//i.test(trimmed)) {
    let parsed: URL;
    try {
      parsed = new URL(trimmed);
    } catch {
      return null;
    }
    const segments = parsed.pathname.split('/').filter((segment) => segment !== '');
    if (segments.length === 0) return null;
    if (segments.length === 1) {
      const only = stripGitSuffix(segments[0]!);
      return only === '' ? null : only;
    }
    const repo = stripGitSuffix(segments[segments.length - 1]!);
    const owner = segments[segments.length - 2]!;
    if (repo === '') return owner === '' ? null : owner;
    return `${owner}/${repo}`;
  }

  return null;
}
