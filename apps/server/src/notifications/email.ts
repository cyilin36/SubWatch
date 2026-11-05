import nodemailer from 'nodemailer';
import { APP_VERSION, type EmailChannelConfig, type Locale } from '@subwatch/shared';

export interface EmailMessage {
  subject: string;
  html: string;
  text: string;
}

export interface EmailResult {
  ok: boolean;
  error?: string;
}

const CONNECTION_TIMEOUT_MS = 15_000;
const GREETING_TIMEOUT_MS = 15_000;
const SOCKET_TIMEOUT_MS = 20_000;
const MAX_ERROR_CHARS = 500;

function buildFrom(config: EmailChannelConfig): string {
  const from = config.from.trim();
  const name = config.fromName.replace(/["\\\r\n]/g, ' ').trim();
  // A caller may already provide a display name ("SubWatch <a@b.c>").
  if (!name || from.includes('<')) return from;
  return `"${name}" <${from}>`;
}

function createTransport(config: EmailChannelConfig) {
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    requireTLS: config.secure ? undefined : config.requireTls,
    auth: config.user
      ? {
          user: config.user,
          pass: config.password,
        }
      : undefined,
    tls: {
      rejectUnauthorized: config.rejectUnauthorized,
      servername: config.host,
    },
    connectionTimeout: CONNECTION_TIMEOUT_MS,
    greetingTimeout: GREETING_TIMEOUT_MS,
    socketTimeout: SOCKET_TIMEOUT_MS,
    logger: false,
    debug: false,
  });
}

/**
 * Turn an SMTP failure into a short, credential-free message. Node/nodemailer
 * errors can echo configuration values, so any stored password is redacted
 * before the text is persisted or returned to the API.
 */
export function sanitizeEmailError(error: unknown, config: EmailChannelConfig): string {
  const parts: string[] = [];
  if (error && typeof error === 'object') {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && code) parts.push(code);
  }
  const rawMessage = error instanceof Error ? error.message : String(error);
  if (rawMessage) parts.push(rawMessage);
  let text = parts.join(': ').replace(/\s+/g, ' ').trim();
  if (config.password) text = text.split(config.password).join('[redacted]');
  if (text.length > MAX_ERROR_CHARS) text = `${text.slice(0, MAX_ERROR_CHARS - 1)}…`;
  return text || 'Email delivery failed';
}

export async function sendEmail(
  config: EmailChannelConfig,
  message: EmailMessage,
): Promise<EmailResult> {
  const transport = createTransport(config);
  try {
    await transport.sendMail({
      from: buildFrom(config),
      to: config.to.join(', '),
      subject: message.subject,
      text: message.text,
      html: message.html,
      headers: { 'X-SubWatch-Version': APP_VERSION },
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: sanitizeEmailError(error, config) };
  } finally {
    try {
      transport.close();
    } catch {
      // best effort; a closed socket must not mask a delivery result
    }
  }
}

export function defaultTestEmailMessage(locale: Locale = 'zh-CN'): EmailMessage {
  if (locale === 'en') {
    return {
      subject: 'SubWatch test email',
      text: 'This is a test email from SubWatch. If you received it, email notifications are configured correctly.',
      html: '<p>This is a test email from SubWatch.</p><p>If you received it, email notifications are configured correctly.</p>',
    };
  }
  return {
    subject: 'SubWatch 测试邮件',
    text: '这是一封来自 SubWatch 的测试邮件。收到即表示邮件通知配置正确。',
    html: '<p>这是一封来自 SubWatch 的测试邮件。</p><p>收到即表示邮件通知配置正确。</p>',
  };
}

/** Send a test email; returns `{ok, error?}` instead of throwing. */
export async function testEmail(
  config: EmailChannelConfig,
  message: EmailMessage = defaultTestEmailMessage(),
): Promise<EmailResult> {
  return sendEmail(config, message);
}
