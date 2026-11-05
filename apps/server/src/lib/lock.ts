import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';

function pidIsAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    // EPERM means a process exists but belongs to another user.
    return code === 'EPERM';
  }
}

/**
 * Guard against two SubWatch processes sharing one SQLite data directory.
 * Returns a release function to call during graceful shutdown.
 */
export function acquireDataDirLock(dataDir: string): () => void {
  const lockFile = path.join(dataDir, '.lock');
  if (existsSync(lockFile)) {
    const raw = readFileSync(lockFile, 'utf8').trim();
    const pid = Number(raw);
    if (pidIsAlive(pid)) {
      throw new Error(
        `Another SubWatch process (pid ${pid}) is already using ${dataDir}. Stop it before starting a second instance.`,
      );
    }
  }
  writeFileSync(lockFile, `${process.pid}\n`);
  return () => {
    try {
      if (existsSync(lockFile) && readFileSync(lockFile, 'utf8').trim() === String(process.pid)) {
        unlinkSync(lockFile);
      }
    } catch {
      // best effort cleanup
    }
  };
}
