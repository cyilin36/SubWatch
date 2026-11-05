import path from 'node:path';
import { mkdirSync } from 'node:fs';
import { z } from 'zod';
import { DEFAULT_TIMEZONE } from '@subwatch/shared';

const envSchema = z.object({
  NODE_ENV: z.string().default('production'),
  PORT: z.coerce.number().int().min(1).max(65535).default(8080),
  HOST: z.string().default('0.0.0.0'),
  DATA_DIR: z.string().default('./data'),
  TZ: z.string().default(DEFAULT_TIMEZONE),
  SUBWATCH_SECRET_KEY: z.string().optional(),
  SUBWATCH_ADMIN_PASSWORD: z.string().optional(),
  SUBWATCH_BASE_URL: z.string().optional(),
  SUBWATCH_WEB_DIR: z.string().optional(),
  TRUST_PROXY: z.string().default('0'),
  LOG_LEVEL: z.string().default('info'),
});

export interface Config {
  nodeEnv: string;
  isProduction: boolean;
  port: number;
  host: string;
  dataDir: string;
  webDir: string;
  repoRoot: string;
  defaultTimezone: string;
  secretKey: string | undefined;
  adminPassword: string | undefined;
  baseUrl: string;
  trustProxy: boolean;
  logLevel: string;
}

function isTruthy(value: string): boolean {
  return value === '1' || value.toLowerCase() === 'true' || value.toLowerCase() === 'yes';
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join('.') || 'env'}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid environment configuration: ${details}`);
  }
  const value = parsed.data;
  const repoRoot = path.resolve(import.meta.dirname, '../../..');
  const dataDir = path.resolve(process.cwd(), value.DATA_DIR);
  const webDir = value.SUBWATCH_WEB_DIR
    ? path.resolve(process.cwd(), value.SUBWATCH_WEB_DIR)
    : path.join(repoRoot, 'apps/web/dist');
  mkdirSync(dataDir, { recursive: true });
  return {
    nodeEnv: value.NODE_ENV,
    isProduction: value.NODE_ENV !== 'development',
    port: value.PORT,
    host: value.HOST,
    dataDir,
    webDir,
    repoRoot,
    defaultTimezone: value.TZ,
    secretKey: value.SUBWATCH_SECRET_KEY,
    adminPassword: value.SUBWATCH_ADMIN_PASSWORD,
    baseUrl: value.SUBWATCH_BASE_URL?.replace(/\/+$/, '') ?? `http://localhost:${value.PORT}`,
    trustProxy: isTruthy(value.TRUST_PROXY),
    logLevel: value.LOG_LEVEL,
  };
}
