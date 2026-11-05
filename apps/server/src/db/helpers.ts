import type { DatabaseSync } from 'node:sqlite';

export type SqlValue = string | number | bigint | null | Uint8Array;

export function toBool(value: boolean): 0 | 1 {
  return value ? 1 : 0;
}

export function fromBool(value: number | bigint | null | undefined): boolean {
  return Number(value ?? 0) === 1;
}

export function toJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

export function parseJson<T>(raw: string | null | undefined, fallback: T): T {
  if (raw === null || raw === undefined || raw === '') return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export function one<T>(db: DatabaseSync, sql: string, params: SqlValue[] = []): T | undefined {
  const statement = db.prepare(sql);
  return statement.get(...params) as T | undefined;
}

export function all<T>(db: DatabaseSync, sql: string, params: SqlValue[] = []): T[] {
  const statement = db.prepare(sql);
  return statement.all(...params) as T[];
}

export function run(
  db: DatabaseSync,
  sql: string,
  params: SqlValue[] = [],
): { changes: number | bigint; lastInsertRowid: number | bigint } {
  const statement = db.prepare(sql);
  return statement.run(...params);
}

export function withTransaction<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // ignore rollback failure, rethrow original error
    }
    throw error;
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}
