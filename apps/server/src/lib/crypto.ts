import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const SECRET_FILE = '.secret-key';
const ENVELOPE_PREFIX = 'enc:v1:';

function parseKeyMaterial(raw: string): Buffer {
  const trimmed = raw.trim();
  let key: Buffer;
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    key = Buffer.from(trimmed, 'hex');
  } else {
    key = Buffer.from(trimmed, 'base64');
  }
  if (key.length !== 32) {
    throw new Error('SUBWATCH_SECRET_KEY must be 32 bytes (64 hex chars or base64)');
  }
  return key;
}

/**
 * Load the master encryption key. The environment variable wins; otherwise a
 * key is generated once at DATA_DIR/.secret-key with mode 0600.
 */
export function loadSecretKey(dataDir: string, envKey?: string): Buffer {
  if (envKey && envKey.trim()) return parseKeyMaterial(envKey);
  const file = path.join(dataDir, SECRET_FILE);
  if (existsSync(file)) {
    return parseKeyMaterial(readFileSync(file, 'utf8'));
  }
  mkdirSync(dataDir, { recursive: true });
  const key = randomBytes(32);
  writeFileSync(file, `${key.toString('base64')}\n`, { mode: 0o600 });
  try {
    chmodSync(file, 0o600);
  } catch {
    // best effort on filesystems that do not support chmod
  }
  return key;
}

export class SecretBox {
  private readonly key: Buffer;

  constructor(key: Buffer) {
    if (key.length !== 32) throw new Error('SecretBox key must be 32 bytes');
    this.key = key;
  }

  encrypt(plaintext: string): string {
    if (plaintext === '') return '';
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${ENVELOPE_PREFIX}${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
  }

  decrypt(value: string): string {
    if (!value) return '';
    if (!value.startsWith(ENVELOPE_PREFIX)) return value; // legacy/plaintext
    const parts = value.slice(ENVELOPE_PREFIX.length).split(':');
    if (parts.length !== 3) throw new Error('Malformed encrypted value');
    const [ivPart, tagPart, dataPart] = parts;
    if (!ivPart || !tagPart || !dataPart) throw new Error('Malformed encrypted value');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(ivPart, 'base64'));
    decipher.setAuthTag(Buffer.from(tagPart, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(dataPart, 'base64')), decipher.final()]).toString('utf8');
  }

  encryptJson(value: unknown): string {
    return this.encrypt(JSON.stringify(value));
  }

  decryptJson<T>(value: string): T {
    return JSON.parse(this.decrypt(value)) as T;
  }
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function hashToken(token: string): string {
  return sha256Hex(token);
}

export function hmacSha256Hex(secret: string, body: string): string {
  return createHmac('sha256', secret).update(body).digest('hex');
}

export function safeEqualHex(a: string, b: string): boolean {
  const left = Buffer.from(a, 'hex');
  const right = Buffer.from(b, 'hex');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
