import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { migrations } from './migrations.js';

export type Db = DatabaseSync;

const MAX_BACKUPS = 5;

function applyMigrations(db: Db, dbFile: string, dataDir: string): void {
  const existingTables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
    .all() as Array<{ name: string }>;
  const isFreshDatabase = existingTables.length === 0;

  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL
    );
  `);
  const appliedRows = db.prepare('SELECT version FROM schema_migrations').all() as Array<{ version: number }>;
  const applied = new Set(appliedRows.map((row) => Number(row.version)));
  const pending = migrations.filter((migration) => !applied.has(migration.version));
  if (pending.length === 0) return;

  if (!isFreshDatabase && existsSync(dbFile) && statSync(dbFile).size > 0) {
    try {
      db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
      const backupDir = path.join(dataDir, 'backups');
      mkdirSync(backupDir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      const target = path.join(backupDir, `pre-migration-v${pending[0]?.version ?? 0}-${stamp}.db`);
      copyFileSync(dbFile, target);
      const backups = readdirSync(backupDir)
        .filter((name) => name.startsWith('pre-migration-') && name.endsWith('.db'))
        .sort()
        .reverse();
      for (const stale of backups.slice(MAX_BACKUPS)) {
        rmSync(path.join(backupDir, stale), { force: true });
      }
    } catch {
      // Backups are best-effort; never block migrations on backup failure.
    }
  }

  for (const migration of pending) {
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec(migration.sql);
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)').run(
        migration.version,
        migration.name,
        new Date().toISOString(),
      );
      db.exec('COMMIT');
    } catch (error) {
      try {
        db.exec('ROLLBACK');
      } catch {
        // ignore rollback failure
      }
      throw new Error(
        `Database migration ${migration.version} (${migration.name}) failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}

export function openDatabase(dataDir: string): Db {
  mkdirSync(dataDir, { recursive: true });
  const dbFile = path.join(dataDir, 'subwatch.db');
  const db = new DatabaseSync(dbFile);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');
  db.exec('PRAGMA synchronous = NORMAL;');
  applyMigrations(db, dbFile, dataDir);
  return db;
}

export function closeDatabase(db: Db): void {
  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  } catch {
    // best effort
  }
  db.close();
}
