/**
 * The monitor metrics endpoint returns historical run metrics. The shared
 * contract does not pin an exact envelope, so this module normalizes the
 * likely shapes into a single chart-friendly structure:
 *
 *   - `[{ at, metrics: { key: { value, unit } } }]`
 *   - `{ points: [...] }` / `{ items: [...] }` / `{ data: [...] }`
 *   - `{ series: [{ key, points: [{ t, value }] }] }`
 *   - `{ [metricKey]: [{ t, value }] }`
 */
export interface MetricPoint {
  at: string;
  values: Record<string, number | null>;
}

export interface MetricSeries {
  points: MetricPoint[];
  keys: string[];
}

const TIMESTAMP_KEYS = [
  'at',
  'ts',
  'timestamp',
  'time',
  'date',
  'checkedAt',
  'createdAt',
  'startedAt',
  'finishedAt',
  'recordedAt',
];

function toIsoTimestamp(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = value > 1e12 ? value : value * 1000;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }
  if (typeof value === 'string' && value.length > 0) {
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
    return value;
  }
  return null;
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>;
    if ('value' in record) return toNumber(record.value);
    if ('v' in record) return toNumber(record.v);
  }
  return null;
}

function extractTimestamp(record: Record<string, unknown>): string | null {
  for (const key of TIMESTAMP_KEYS) {
    if (key in record) {
      const iso = toIsoTimestamp(record[key]);
      if (iso) return iso;
    }
  }
  return null;
}

function extractValues(record: Record<string, unknown>): Record<string, number | null> {
  const source =
    (record.metrics as Record<string, unknown> | undefined) ??
    (record.values as Record<string, unknown> | undefined) ??
    record;
  const values: Record<string, number | null> = {};
  for (const [key, raw] of Object.entries(source)) {
    if (TIMESTAMP_KEYS.includes(key)) continue;
    if (typeof raw === 'object' && raw !== null && !('value' in (raw as object)) && !('v' in (raw as object))) {
      continue;
    }
    const numeric = toNumber(raw);
    if (numeric !== null) values[key] = numeric;
  }
  return values;
}

function fromPointArray(items: unknown[]): MetricPoint[] {
  const points: MetricPoint[] = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const at = extractTimestamp(record);
    if (!at) continue;
    const values = extractValues(record);
    if (Object.keys(values).length === 0) continue;
    points.push({ at, values });
  }
  return points;
}

function fromSeriesArray(series: unknown[]): MetricPoint[] {
  const byTimestamp = new Map<string, MetricPoint>();
  for (const entry of series) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    const key = typeof record.key === 'string' ? record.key : typeof record.metricKey === 'string' ? record.metricKey : null;
    const rawPoints = record.points ?? record.values ?? record.data;
    if (!key || !Array.isArray(rawPoints)) continue;
    for (const rawPoint of rawPoints) {
      if (!rawPoint || typeof rawPoint !== 'object') continue;
      const pointRecord = rawPoint as Record<string, unknown>;
      const at = extractTimestamp(pointRecord);
      const value = toNumber(pointRecord.value ?? pointRecord.v ?? pointRecord.y);
      if (!at || value === null) continue;
      const existing = byTimestamp.get(at) ?? { at, values: {} };
      existing.values[key] = value;
      byTimestamp.set(at, existing);
    }
  }
  return [...byTimestamp.values()];
}

function fromMetricMap(map: Record<string, unknown>): MetricPoint[] {
  const byTimestamp = new Map<string, MetricPoint>();
  for (const [key, rawPoints] of Object.entries(map)) {
    if (!Array.isArray(rawPoints)) continue;
    for (const rawPoint of rawPoints) {
      if (!rawPoint || typeof rawPoint !== 'object') continue;
      const pointRecord = rawPoint as Record<string, unknown>;
      const at = extractTimestamp(pointRecord);
      const value = toNumber(pointRecord.value ?? pointRecord.v ?? pointRecord.y);
      if (!at || value === null) continue;
      const existing = byTimestamp.get(at) ?? { at, values: {} };
      existing.values[key] = value;
      byTimestamp.set(at, existing);
    }
  }
  return [...byTimestamp.values()];
}

function collectKeys(points: MetricPoint[]): string[] {
  const keys = new Set<string>();
  for (const point of points) {
    for (const key of Object.keys(point.values)) keys.add(key);
  }
  return [...keys].sort();
}

export function normalizeMetricsResponse(raw: unknown): MetricSeries {
  let points: MetricPoint[] = [];
  if (Array.isArray(raw)) {
    points = raw.some((item) => item && typeof item === 'object' && ('points' in (item as object) || 'values' in (item as object)))
      ? fromSeriesArray(raw)
      : fromPointArray(raw);
  } else if (raw && typeof raw === 'object') {
    const record = raw as Record<string, unknown>;
    const candidate =
      record.points ?? record.items ?? record.data ?? record.runs ?? record.results ?? record.points;
    if (Array.isArray(candidate)) {
      points = fromPointArray(candidate);
    } else if (Array.isArray(record.series)) {
      points = fromSeriesArray(record.series);
    } else {
      points = fromMetricMap(record);
    }
  }
  points.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  return { points, keys: collectKeys(points) };
}
