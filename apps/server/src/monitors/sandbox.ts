import * as vm from 'node:vm';
import {
  JS_EVAL_TIMEOUT_MS,
  MAX_JS_CODE_BYTES,
  type HttpExtractor,
  type MetricValue,
} from '@subwatch/shared';

export interface ExtractorInput {
  /** Parsed JSON body (undefined when the response was not JSON). */
  data: unknown;
  text: string;
  headers: Record<string, string>;
  status: number;
  durationMs: number;
  /** ISO timestamp for the current run. */
  now: string;
}

export interface ExtractResult {
  ok: boolean;
  metrics: Record<string, MetricValue>;
  status: 'up' | 'down' | null;
  message: string | null;
  logs: string[];
  error: string | null;
}

const MAX_LOG_ENTRIES = 50;
const MAX_LOG_LENGTH = 2_000;
const MAX_METRICS = 100;
const METRIC_KEY_RE = /^[a-zA-Z_][a-zA-Z0-9_.-]*$/;

// ---------------------------------------------------------------------------
// Shared helpers (also exposed inside the sandbox)
// ---------------------------------------------------------------------------

/** Resolve `a.b.0.c` / `a.b[0].c` style paths against parsed JSON. */
export function getPath(source: unknown, path: string): unknown {
  if (!path) return source;
  const tokens = path
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter((token) => token.length > 0);
  let current: unknown = source;
  for (const token of tokens) {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current)) {
      const index = Number(token);
      if (!Number.isInteger(index)) return undefined;
      current = current[index];
    } else if (typeof current === 'object') {
      current = (current as Record<string, unknown>)[token];
    } else {
      return undefined;
    }
  }
  return current;
}

/** Coerce to a finite number; returns NaN (or `fallback`) when not numeric. */
export function toNumber(value: unknown, fallback?: number): number {
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return value;
    return fallback !== undefined ? fallback : Number.NaN;
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed !== '') {
      const parsed = Number(trimmed);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return fallback !== undefined ? fallback : Number.NaN;
}

function percentage(part: unknown, total: unknown): number {
  const numerator = toNumber(part);
  const denominator = toNumber(total);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return Number.NaN;
  return (numerator / denominator) * 100;
}

function clampValue(value: unknown, min: unknown, max: unknown): number {
  const numericValue = toNumber(value);
  const lower = toNumber(min, 0);
  const upper = toNumber(max, 0);
  return Math.min(upper, Math.max(lower, numericValue));
}

function sumValues(...args: unknown[]): number {
  const values = args.length === 1 && Array.isArray(args[0]) ? (args[0] as unknown[]) : args;
  let total = 0;
  for (const value of values) {
    const numeric = toNumber(value);
    if (Number.isFinite(numeric)) total += numeric;
  }
  return total;
}

function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== 'object') return value;
  const object = value as unknown as object;
  if (seen.has(object)) return value;
  seen.add(object);
  for (const key of Object.keys(object)) {
    deepFreeze((object as Record<string, unknown>)[key], seen);
  }
  return Object.freeze(value);
}

function formatLogArgument(value: unknown): string {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  if (value === null) return 'null';
  if (value === undefined) return 'undefined';
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

// ---------------------------------------------------------------------------
// JavaScript extractor
// ---------------------------------------------------------------------------

function wrapScript(code: string): string {
  // Wrap in a function so users can write `return { metrics: ... }` at top level.
  return `(function () {\n'use strict';\n${code}\n})()`;
}

function normalizeMetricEntry(key: string, raw: unknown): { metric?: MetricValue; error?: string } {
  let value: unknown = raw;
  let label: unknown;
  let unit: unknown;
  if (raw !== null && typeof raw === 'object' && !Array.isArray(raw)) {
    const entry = raw as Record<string, unknown>;
    value = entry.value;
    label = entry.label;
    unit = entry.unit;
  }
  if (value === null || value === undefined) return { error: `Metric "${key}" is missing a value` };
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return { error: `Metric "${key}" is not a finite number` };
  } else if (typeof value !== 'string' && typeof value !== 'boolean') {
    return { error: `Metric "${key}" must be a number, string or boolean` };
  }
  if (typeof value === 'string' && value.length > 2_000) return { error: `Metric "${key}" string value is too long` };
  const metric: MetricValue = { value };
  if (label !== undefined && label !== null && label !== '') {
    if (typeof label !== 'string') return { error: `Metric "${key}" label must be a string` };
    metric.label = label.slice(0, 100);
  }
  if (unit !== undefined && unit !== null && unit !== '') {
    if (typeof unit !== 'string') return { error: `Metric "${key}" unit must be a string` };
    metric.unit = unit.slice(0, 20);
  }
  return { metric };
}

function runJavaScriptExtractor(code: string, input: ExtractorInput): ExtractResult {
  const logs: string[] = [];
  const log = (...args: unknown[]): void => {
    if (logs.length >= MAX_LOG_ENTRIES) return;
    const line = args.map(formatLogArgument).join(' ').slice(0, MAX_LOG_LENGTH);
    logs.push(line);
  };

  const frozenData = deepFreeze(input.data);
  const frozenHeaders = Object.freeze({ ...input.headers });
  const helpers = {
    get: getPath,
    num: toNumber,
    pct: percentage,
    clamp: clampValue,
    sum: sumValues,
    log,
  };
  const ctxView = Object.freeze({
    data: frozenData,
    text: input.text,
    headers: frozenHeaders,
    status: input.status,
    durationMs: input.durationMs,
    now: input.now,
    ...helpers,
  });
  const sandbox: Record<string, unknown> = {
    data: frozenData,
    text: input.text,
    headers: frozenHeaders,
    status: input.status,
    durationMs: input.durationMs,
    now: input.now,
    ...helpers,
    // README documents the `ctx.*` style as well; expose both spellings.
    ctx: ctxView,
  };
  const context = vm.createContext(sandbox, { codeGeneration: { strings: false, wasm: false } });

  let output: unknown;
  try {
    const script = new vm.Script(wrapScript(code), { filename: 'monitor-extractor.js' });
    output = script.runInContext(context, { timeout: JS_EVAL_TIMEOUT_MS });
  } catch (error) {
    return {
      ok: false,
      metrics: {},
      status: null,
      message: null,
      logs,
      error: `JavaScript extractor failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  if (output === null || output === undefined || typeof output !== 'object') {
    return {
      ok: false,
      metrics: {},
      status: null,
      message: null,
      logs,
      error: 'JavaScript extractor must return an object like { metrics: { ... } }',
    };
  }
  if (typeof (output as { then?: unknown }).then === 'function') {
    return {
      ok: false,
      metrics: {},
      status: null,
      message: null,
      logs,
      error: 'JavaScript extractor must be synchronous (do not return a Promise)',
    };
  }

  const result = output as Record<string, unknown>;
  const rawMetrics = result.metrics;
  if (rawMetrics === null || typeof rawMetrics !== 'object' || Array.isArray(rawMetrics)) {
    return {
      ok: false,
      metrics: {},
      status: null,
      message: null,
      logs,
      error: 'JavaScript extractor must return a `metrics` object',
    };
  }

  const metrics: Record<string, MetricValue> = {};
  const errors: string[] = [];
  const entries = Object.entries(rawMetrics as Record<string, unknown>);
  if (entries.length > MAX_METRICS) {
    return {
      ok: false,
      metrics: {},
      status: null,
      message: null,
      logs,
      error: `JavaScript extractor returned too many metrics (max ${MAX_METRICS})`,
    };
  }
  for (const [key, raw] of entries) {
    if (!METRIC_KEY_RE.test(key) || key.length > 100) {
      errors.push(`Invalid metric key "${key}"`);
      continue;
    }
    const normalized = normalizeMetricEntry(key, raw);
    if (normalized.error) errors.push(normalized.error);
    else if (normalized.metric) metrics[key] = normalized.metric;
  }

  let status: 'up' | 'down' | null = null;
  if (result.status !== undefined && result.status !== null) {
    if (result.status !== 'up' && result.status !== 'down') {
      errors.push('Extractor status must be "up" or "down"');
    } else {
      status = result.status;
    }
  }

  let message: string | null = null;
  if (result.message !== undefined && result.message !== null) {
    if (typeof result.message !== 'string') errors.push('Extractor message must be a string');
    else message = result.message.slice(0, 2_000);
  }

  if (errors.length > 0) {
    return { ok: false, metrics, status, message, logs, error: errors.join('; ') };
  }
  return { ok: true, metrics, status, message, logs, error: null };
}

// ---------------------------------------------------------------------------
// Declarative JSON extractor
// ---------------------------------------------------------------------------

function runJsonExtractor(extractor: Extract<HttpExtractor, { mode: 'json' }>, input: ExtractorInput): ExtractResult {
  if (input.data === undefined) {
    return {
      ok: false,
      metrics: {},
      status: null,
      message: null,
      logs: [],
      error: input.text.trim() === ''
        ? 'Response body is empty, cannot extract JSON metrics'
        : 'Response body is not valid JSON, cannot extract metrics',
    };
  }
  const metrics: Record<string, MetricValue> = {};
  const errors: string[] = [];
  for (const definition of extractor.metrics) {
    const raw = getPath(input.data, definition.path);
    if (raw === undefined) {
      errors.push(`Metric "${definition.key}" not found at path "${definition.path}"`);
      continue;
    }
    const numeric = toNumber(raw, Number.NaN);
    if (!Number.isFinite(numeric)) {
      errors.push(`Metric "${definition.key}" at path "${definition.path}" is not numeric`);
      continue;
    }
    const scaled = numeric * (definition.scale ?? 1) + (definition.offset ?? 0);
    const metric: MetricValue = { value: scaled };
    if (definition.label) metric.label = definition.label;
    if (definition.unit) metric.unit = definition.unit;
    metrics[definition.key] = metric;
  }
  if (errors.length > 0) {
    return { ok: false, metrics, status: null, message: null, logs: [], error: errors.join('; ') };
  }
  return { ok: true, metrics, status: null, message: null, logs: [], error: null };
}

/** Run the configured extractor against an HTTP response. Never throws. */
export function extractMetrics(extractor: HttpExtractor, input: ExtractorInput): ExtractResult {
  if (extractor.mode === 'javascript') {
    if (extractor.code.length > MAX_JS_CODE_BYTES) {
      return {
        ok: false,
        metrics: {},
        status: null,
        message: null,
        logs: [],
        error: `JavaScript extractor is longer than ${MAX_JS_CODE_BYTES} characters`,
      };
    }
    return runJavaScriptExtractor(extractor.code, input);
  }
  return runJsonExtractor(extractor, input);
}
