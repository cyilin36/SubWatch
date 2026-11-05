import { fetch } from 'undici';
import { APP_VERSION, type WebhookChannelConfig } from '@subwatch/shared';
import { hmacSha256Hex } from '../lib/crypto.js';

export interface WebhookMessage {
  event: string;
  title: string;
  message: string;
  severity: string;
  timestamp: string;
  data: Record<string, unknown>;
  appUrl: string;
}

export interface WebhookResult {
  ok: boolean;
  status?: number;
  error?: string;
}

const MAX_ERROR_CHARS = 500;
const MAX_RESPONSE_SNIPPET_CHARS = 500;

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

function escapeJsonStringContent(value: string): string {
  const encoded = JSON.stringify(value);
  return typeof encoded === 'string' ? encoded.slice(1, -1) : '';
}

/**
 * Webhook body: a stable JSON envelope by default, or the configured template
 * with `{{placeholders}}` substituted. For JSON content types placeholder
 * values are JSON-string escaped so the resulting body stays valid JSON;
 * `{{dataJson}}` is always inserted as raw JSON.
 */
export function buildWebhookBody(
  config: WebhookChannelConfig,
  message: WebhookMessage,
): string {
  const template = config.bodyTemplate;
  if (!template.trim()) {
    return JSON.stringify({
      source: 'subwatch',
      event: message.event,
      title: message.title,
      message: message.message,
      severity: message.severity,
      timestamp: message.timestamp,
      data: message.data ?? {},
      appUrl: message.appUrl,
    });
  }

  const jsonMode = /json/i.test(config.contentType);
  const replacements: Record<string, string> = {
    event: message.event,
    title: message.title,
    message: message.message,
    severity: message.severity,
    timestamp: message.timestamp,
    dataJson: JSON.stringify(message.data ?? {}),
    appUrl: message.appUrl,
  };

  return template.replace(/\{\{\s*([a-zA-Z][a-zA-Z0-9_]*)\s*\}\}/g, (match, key: string) => {
    if (!(key in replacements)) return match;
    const value = replacements[key] ?? '';
    if (key === 'dataJson') return value;
    return jsonMode ? escapeJsonStringContent(value) : value;
  });
}

export function buildWebhookHeaders(
  config: WebhookChannelConfig,
  body: string,
): Record<string, string> {
  const headers: Record<string, string> = {};
  const lowerKeys = new Set<string>();
  for (const header of config.headers) {
    const key = header.key.trim();
    if (!key) continue;
    headers[key] = header.value;
    lowerKeys.add(key.toLowerCase());
  }
  const contentType = config.contentType.trim();
  if (contentType && !lowerKeys.has('content-type')) {
    headers['Content-Type'] = contentType;
  }
  if (!lowerKeys.has('user-agent')) {
    headers['User-Agent'] = `SubWatch/${APP_VERSION}`;
  }
  if (config.signingSecret) {
    headers['X-SubWatch-Signature'] = `sha256=${hmacSha256Hex(config.signingSecret, body)}`;
  }
  return headers;
}

function sanitizeWebhookError(error: unknown, config: WebhookChannelConfig, timeoutMs: number): string {
  let text: string;
  if (error instanceof Error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      return `Webhook request timed out after ${timeoutMs}ms`;
    }
    const cause = (error as { cause?: unknown }).cause;
    const causeMessage =
      cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : '';
    text = causeMessage ? `${error.message}: ${causeMessage}` : error.message;
  } else {
    text = String(error);
  }
  text = text.replace(/\s+/g, ' ').trim();
  if (config.signingSecret) text = text.split(config.signingSecret).join('[redacted]');
  return truncate(text, MAX_ERROR_CHARS) || 'Webhook request failed';
}

async function readResponseSnippet(response: {
  text(): Promise<string>;
}): Promise<string> {
  try {
    const text = await response.text();
    return truncate(text.replace(/\s+/g, ' ').trim(), MAX_RESPONSE_SNIPPET_CHARS);
  } catch {
    return '';
  }
}

export async function sendWebhook(
  config: WebhookChannelConfig,
  message: WebhookMessage,
): Promise<WebhookResult> {
  const body = buildWebhookBody(config, message);
  const headers = buildWebhookHeaders(config, body);
  const timeoutMs = Math.min(Math.max(config.timeoutMs, 1000), 60_000);

  try {
    const response = await fetch(config.url, {
      method: config.method,
      headers,
      body,
      redirect: 'follow',
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
      const detail = await readResponseSnippet(response);
      const statusLine = `Webhook responded with HTTP ${response.status}${
        response.statusText ? ` ${response.statusText}` : ''
      }`;
      return {
        ok: false,
        status: response.status,
        error: truncate(detail ? `${statusLine}: ${detail}` : statusLine, MAX_ERROR_CHARS),
      };
    }

    // Drain the body so the connection can be reused/released.
    try {
      await response.body?.cancel();
    } catch {
      // ignore
    }
    return { ok: true, status: response.status };
  } catch (error) {
    return {
      ok: false,
      error: sanitizeWebhookError(error, config, timeoutMs),
    };
  }
}
