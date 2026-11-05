import type { DatabaseSync } from 'node:sqlite';
import {
  SECRET_KEEP,
  generalSettingsSchema,
  emailChannelConfigSchema,
  type EmailChannelConfig,
  type GeneralSettings,
  type MaskedSmtpSettings,
} from '@subwatch/shared';
import type { SecretBox } from '../lib/crypto.js';
import { BadRequestError } from '../lib/errors.js';
import { hashPassword, verifyPassword } from '../auth/password.js';
import { one, run } from '../db/helpers.js';

const KEY_GENERAL = 'general';
const KEY_SMTP = 'smtp';
const KEY_PASSWORD = 'admin_password_hash';

export interface SettingsDefaults {
  timezone: string;
  baseUrl: string;
}

export class SettingsService {
  constructor(
    private readonly db: DatabaseSync,
    private readonly secretBox: SecretBox,
    private readonly defaults: SettingsDefaults,
  ) {}

  private getRaw(key: string): string | undefined {
    const row = one<{ value: string }>(this.db, 'SELECT value FROM settings WHERE key = ?', [key]);
    return row?.value;
  }

  private setRaw(key: string, value: string): void {
    run(
      this.db,
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      [key, value, new Date().toISOString()],
    );
  }

  getGeneral(): GeneralSettings {
    const raw = this.getRaw(KEY_GENERAL);
    if (!raw) {
      return generalSettingsSchema.parse({
        timezone: this.defaults.timezone,
        baseUrl: this.defaults.baseUrl,
      });
    }
    try {
      return generalSettingsSchema.parse(JSON.parse(raw));
    } catch {
      return generalSettingsSchema.parse({
        timezone: this.defaults.timezone,
        baseUrl: this.defaults.baseUrl,
      });
    }
  }

  updateGeneral(patch: Partial<GeneralSettings>): GeneralSettings {
    const current = this.getGeneral();
    const parsed = generalSettingsSchema.safeParse({ ...current, ...patch });
    if (!parsed.success) {
      throw new BadRequestError('Invalid general settings', parsed.error.flatten());
    }
    this.setRaw(KEY_GENERAL, JSON.stringify(parsed.data));
    return parsed.data;
  }

  getSmtp(): EmailChannelConfig | null {
    const raw = this.getRaw(KEY_SMTP);
    if (!raw) return null;
    try {
      const decrypted = this.secretBox.decryptJson<unknown>(raw);
      const parsed = emailChannelConfigSchema.safeParse(decrypted);
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }

  getMaskedSmtp(): MaskedSmtpSettings | null {
    const smtp = this.getSmtp();
    if (!smtp) return null;
    return {
      host: smtp.host,
      port: smtp.port,
      secure: smtp.secure,
      requireTls: smtp.requireTls,
      rejectUnauthorized: smtp.rejectUnauthorized,
      user: smtp.user,
      from: smtp.from,
      fromName: smtp.fromName,
      to: smtp.to,
      passwordSet: smtp.password !== '',
    };
  }

  updateSmtp(patch: Partial<EmailChannelConfig>): EmailChannelConfig {
    const current = this.getSmtp();
    const merged: Partial<EmailChannelConfig> = { ...(current ?? {}), ...patch };
    if (patch.password === SECRET_KEEP || patch.password === undefined) {
      merged.password = current?.password ?? '';
    }
    const parsed = emailChannelConfigSchema.safeParse(merged);
    if (!parsed.success) {
      throw new BadRequestError('Invalid SMTP settings', parsed.error.flatten());
    }
    this.setRaw(KEY_SMTP, this.secretBox.encryptJson(parsed.data));
    return parsed.data;
  }

  getBaseUrl(): string {
    const baseUrl = this.getGeneral().baseUrl;
    return (baseUrl || this.defaults.baseUrl).replace(/\/+$/, '');
  }

  isSetupRequired(): boolean {
    return !this.getRaw(KEY_PASSWORD);
  }

  getPasswordHash(): string | undefined {
    return this.getRaw(KEY_PASSWORD);
  }

  setPassword(password: string): void {
    this.setRaw(KEY_PASSWORD, hashPassword(password));
  }

  verifyAdminPassword(password: string): boolean {
    const hash = this.getPasswordHash();
    if (!hash) return false;
    return verifyPassword(password, hash);
  }

  ensureInitialPassword(envPassword: string | undefined): boolean {
    if (!this.isSetupRequired()) return false;
    if (!envPassword) return false;
    this.setPassword(envPassword);
    return true;
  }
}
