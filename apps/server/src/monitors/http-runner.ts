import { Agent } from 'undici';
import type { HttpMonitorConfig, MonitorConfig } from '@subwatch/shared';

export type HttpRequestSpec = HttpMonitorConfig['request'];

export interface HttpRunResult {
  /** True when the request completed (any HTTP status), false on transport faults. */
  ok: boolean;
  httpStatus: number | null;
  headers: Record<string, string>;
  bodyText: string;
  /** Parsed response body when it is JSON, otherwise undefined. */
  bodyJson: unknown;
  durationMs: number;
  error: string | null;
}

const BODYLESS_METHODS = new Set(['GET', 'HEAD']);

/**
 * Validate configuration parts that the shared zod schema intentionally keeps
 * permissive. Returns a human readable error or null when the config is usable.
 */
export function validateRequestConfig(config: MonitorConfig): string | null {
  if (config.type !== 'http') return null;
  const request = config.request;
  if (BODYLESS_METHODS.has(request.method) && request.bodyType !== 'none' && request.body.trim() !== '') {
    return `${request.method} requests cannot carry a request body (set bodyType to none)`;
  }
  if (request.bodyType === 'json' && request.body.trim() !== '') {
    try {
      JSON.parse(request.body);
    } catch {
      return 'Request body is not valid JSON';
    }
  }
  return null;
}

function buildHeaders(spec: HttpRequestSpec): Headers {
  const headers = new Headers();
  for (const header of spec.headers) {
    const key = header.key.trim();
    if (!key) continue;
    headers.append(key, header.value);
  }
  if (!headers.has('accept')) headers.set('accept', 'application/json, text/plain, */*');
  const hasAuthorization = headers.has('authorization');
  if (!hasAuthorization) {
    if (spec.auth.type === 'basic') {
      const credentials = Buffer.from(`${spec.auth.username}:${spec.auth.password}`, 'utf8').toString('base64');
      headers.set('authorization', `Basic ${credentials}`);
    } else if (spec.auth.type === 'bearer' && spec.auth.token !== '') {
      headers.set('authorization', `Bearer ${spec.auth.token}`);
    }
  }
  return headers;
}

function buildBody(spec: HttpRequestSpec): string | undefined {
  if (BODYLESS_METHODS.has(spec.method)) return undefined;
  if (spec.bodyType === 'none') return undefined;
  return spec.body;
}

function applyBodyContentType(spec: HttpRequestSpec, headers: Headers): void {
  if (spec.bodyType === 'none' || BODYLESS_METHODS.has(spec.method)) return;
  if (headers.has('content-type')) return;
  switch (spec.bodyType) {
    case 'json':
      headers.set('content-type', 'application/json');
      break;
    case 'form':
      headers.set('content-type', 'application/x-www-form-urlencoded');
      break;
    default:
      headers.set('content-type', 'text/plain; charset=utf-8');
      break;
  }
}

function serializeBody(spec: HttpRequestSpec): string | undefined {
  const body = buildBody(spec);
  if (body === undefined) return undefined;
  if (spec.bodyType !== 'form') return body;
  const trimmed = body.trim();
  if (!trimmed.startsWith('{')) return body;
  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(parsed)) {
      if (value === null || value === undefined) continue;
      params.append(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
    }
    return params.toString();
  } catch {
    return body;
  }
}

function buildUrl(spec: HttpRequestSpec): URL {
  const url = new URL(spec.url);
  for (const param of spec.query) {
    if (!param.key) continue;
    url.searchParams.append(param.key, param.value);
  }
  return url;
}

function describeFetchError(error: unknown, spec: HttpRequestSpec): string {
  const timedOut =
    error instanceof Error &&
    (error.name === 'TimeoutError' || error.name === 'AbortError' || error.message.includes('timed out'));
  if (timedOut) return `Request timed out after ${spec.timeoutMs}ms`;
  if (error instanceof Error) {
    const cause = (error as { cause?: { message?: string; code?: string; name?: string } }).cause;
    const pieces: string[] = [];
    if (cause?.code) pieces.push(cause.code);
    if (cause?.message && cause.message !== error.message) pieces.push(cause.message);
    if (pieces.length === 0 && error.message) pieces.push(error.message);
    const suffix = pieces.length > 0 ? `: ${pieces.join(' ')}` : '';
    return `Request failed${suffix}`;
  }
  return `Request failed: ${String(error)}`;
}

/**
 * Execute an HTTP probe. Transport failures (DNS, connection, TLS handshake,
 * timeout, oversized response) set `ok: false`; a non-2xx HTTP status is a
 * successful probe and is reported through `httpStatus` instead.
 */
export async function runHttpRequest(spec: HttpRequestSpec): Promise<HttpRunResult> {
  const startedAt = Date.now();
  const url = buildUrl(spec);
  const headers = buildHeaders(spec);
  applyBodyContentType(spec, headers);
  const body = serializeBody(spec);
  const dispatcher = spec.verifyTls ? null : new Agent({ connect: { rejectUnauthorized: false } });

  const init: Record<string, unknown> = {
    method: spec.method,
    headers,
    redirect: spec.followRedirects ? 'follow' : 'manual',
    signal: AbortSignal.timeout(spec.timeoutMs),
  };
  if (body !== undefined) init.body = body;
  if (dispatcher) init.dispatcher = dispatcher;

  try {
    const response = await fetch(url, init as RequestInit);
    const httpStatus = response.status;
    const responseHeaders: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      responseHeaders[key.toLowerCase()] = value;
    });

    const declaredLength = Number(response.headers.get('content-length') ?? '');
    if (Number.isFinite(declaredLength) && declaredLength > spec.maxResponseBytes) {
      await response.body?.cancel().catch(() => undefined);
      return {
        ok: false,
        httpStatus,
        headers: responseHeaders,
        bodyText: '',
        bodyJson: undefined,
        durationMs: Date.now() - startedAt,
        error: `Response was larger than maxResponseBytes (${spec.maxResponseBytes})`,
      };
    }

    const reader = response.body?.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!value) continue;
        received += value.byteLength;
        if (received > spec.maxResponseBytes) {
          await reader.cancel().catch(() => undefined);
          return {
            ok: false,
            httpStatus,
            headers: responseHeaders,
            bodyText: '',
            bodyJson: undefined,
            durationMs: Date.now() - startedAt,
            error: `Response exceeded maxResponseBytes (${spec.maxResponseBytes})`,
          };
        }
        chunks.push(value);
      }
    } else {
      await response.arrayBuffer().catch(() => undefined);
    }

    const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
    const buffer = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      buffer.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const bodyText = new TextDecoder('utf-8', { fatal: false }).decode(buffer);
    let bodyJson: unknown;
    if (bodyText.trim() !== '') {
      try {
        bodyJson = JSON.parse(bodyText);
      } catch {
        bodyJson = undefined;
      }
    }

    return {
      ok: true,
      httpStatus,
      headers: responseHeaders,
      bodyText,
      bodyJson,
      durationMs: Date.now() - startedAt,
      error: null,
    };
  } catch (error) {
    return {
      ok: false,
      httpStatus: null,
      headers: {},
      bodyText: '',
      bodyJson: undefined,
      durationMs: Date.now() - startedAt,
      error: describeFetchError(error, spec),
    };
  } finally {
    if (dispatcher) await dispatcher.close().catch(() => undefined);
  }
}
