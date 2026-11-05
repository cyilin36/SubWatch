import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { SESSION_TTL_DAYS } from '@subwatch/shared';
import { hashToken, randomToken } from '../lib/crypto.js';
import { all, one, run } from '../db/helpers.js';

export interface SessionRow {
  id: string;
  token_hash: string;
  created_at: string;
  expires_at: string;
  user_agent: string | null;
  ip: string | null;
}

export interface CreatedSession {
  token: string;
  expiresAt: string;
}

export interface SessionMeta {
  userAgent?: string | null;
  ip?: string | null;
}

export function createSession(db: DatabaseSync, meta: SessionMeta = {}): CreatedSession {
  const token = randomToken(32);
  const id = randomUUID();
  const createdAt = new Date();
  const expiresAt = new Date(createdAt.getTime() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  run(
    db,
    `INSERT INTO sessions (id, token_hash, created_at, expires_at, user_agent, ip)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [
      id,
      hashToken(token),
      createdAt.toISOString(),
      expiresAt.toISOString(),
      meta.userAgent ?? null,
      meta.ip ?? null,
    ],
  );
  return { token, expiresAt: expiresAt.toISOString() };
}

export function getValidSession(db: DatabaseSync, token: string): SessionRow | null {
  if (!token) return null;
  const row = one<SessionRow>(db, 'SELECT * FROM sessions WHERE token_hash = ?', [hashToken(token)]);
  if (!row) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    run(db, 'DELETE FROM sessions WHERE id = ?', [row.id]);
    return null;
  }
  return row;
}

export function deleteSession(db: DatabaseSync, token: string): void {
  if (!token) return;
  run(db, 'DELETE FROM sessions WHERE token_hash = ?', [hashToken(token)]);
}

export function deleteAllSessions(db: DatabaseSync): void {
  run(db, 'DELETE FROM sessions');
}

export function cleanupExpiredSessions(db: DatabaseSync): void {
  run(db, 'DELETE FROM sessions WHERE expires_at <= ?', [new Date().toISOString()]);
}

export function listSessions(db: DatabaseSync): SessionRow[] {
  return all<SessionRow>(db, 'SELECT * FROM sessions ORDER BY created_at DESC');
}
