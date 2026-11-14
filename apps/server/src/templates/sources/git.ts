import { spawn } from 'node:child_process';
import { rmSync } from 'node:fs';
import path from 'node:path';
import type { CoreContext } from '../../context.js';

/** How long a single git subprocess may run before it is killed. */
const GIT_TIMEOUT_MS = 120_000;

/** Subdirectory of the data dir that holds all cloned template repositories. */
const TEMPLATE_SOURCES_DIR = 'template-sources';

/**
 * Remove `user:pass@` (or bare `user@`) userinfo from HTTP(S) URLs. Credentials
 * embedded in a repository URL must never reach logs or API responses.
 */
export function redactGitUrl(url: string): string {
  return url.replace(/^(https?:\/\/)[^/@\s]*@/i, '$1');
}

/**
 * Redact credentials from every HTTP(S) URL embedded anywhere in arbitrary text
 * (for example a git stderr message). This is the last line of defence before a
 * message is logged or returned to a client.
 */
export function redactCredentials(text: string): string {
  return text.replace(/(https?:\/\/)[^/@\s]*@/gi, '$1');
}

/** Absolute clone destination for one template source, always inside the data dir. */
export function templateSourceDir(ctx: CoreContext, sourceId: string): string {
  return path.join(ctx.config.dataDir, TEMPLATE_SOURCES_DIR, sourceId);
}

/**
 * Refuse to touch any path that is not strictly inside `<dataDir>/template-sources`.
 * Guards the recursive delete so a bug can never remove files outside the data dir.
 */
function assertInsideSourceRoot(ctx: CoreContext, target: string): void {
  const root = path.resolve(ctx.config.dataDir, TEMPLATE_SOURCES_DIR);
  const resolved = path.resolve(target);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error('Refusing to operate on a path outside the template-sources directory');
  }
}

interface GitResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

/**
 * Run git without a shell, with terminal prompts disabled and system config
 * ignored. Rejects (never leaves a child behind) when the timeout elapses.
 */
function runGit(args: string[], timeoutMs = GIT_TIMEOUT_MS): Promise<GitResult> {
  return new Promise<GitResult>((resolve, reject) => {
    const child = spawn('git', args, {
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_CONFIG_NOSYSTEM: '1' },
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      reject(new Error(`git ${args[0] ?? ''} timed out after ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });

    child.on('close', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr });
    });
  });
}

export interface CloneSource {
  id: string;
  url: string;
  branch: string;
}

/**
 * Clone a single branch of a repository into `destDir` and report the checked-out
 * HEAD commit. The URL is passed after `--` so it can never be interpreted as a
 * git option; the branch is only supplied when non-empty.
 */
export async function syncClone(
  ctx: CoreContext,
  source: CloneSource,
  destDir: string,
): Promise<{ commit: string }> {
  assertInsideSourceRoot(ctx, destDir);
  rmSync(destDir, { recursive: true, force: true });

  const branch = source.branch.trim();
  // Reject branch names that could be parsed as a git option or that contain
  // unexpected characters; the URL is additionally passed after `--`.
  if (branch !== '' && (branch.startsWith('-') || !/^[A-Za-z0-9._/-]+$/.test(branch))) {
    throw new Error('Invalid branch name');
  }

  const args = ['clone', '--depth', '1', '--single-branch'];
  if (branch !== '') {
    args.push('--branch', branch);
  }
  args.push('--', source.url, destDir);

  const cloneResult = await runGit(args);
  if (cloneResult.code !== 0) {
    const detail = redactCredentials(cloneResult.stderr.trim());
    throw new Error(
      detail !== ''
        ? `git clone failed: ${detail}`
        : `git clone failed with exit code ${cloneResult.code ?? 'unknown'}`,
    );
  }

  const revResult = await runGit(['-C', destDir, 'rev-parse', 'HEAD']);
  if (revResult.code !== 0) {
    const detail = redactCredentials(revResult.stderr.trim());
    throw new Error(
      detail !== '' ? `git rev-parse HEAD failed: ${detail}` : 'git rev-parse HEAD failed',
    );
  }

  const commit = revResult.stdout.trim();
  if (commit === '') throw new Error('git rev-parse HEAD produced no commit');
  return { commit };
}
