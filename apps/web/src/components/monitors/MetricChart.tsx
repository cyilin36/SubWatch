import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DateTime } from 'luxon';
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { MetricSeries } from '../../lib/metrics';
import { Select } from '../ui';

/**
 * Night-glass series colours, in priority order: moonlight first, then the
 * status and structural tones. No legacy chart palette is allowed here —
 * every stroke resolves through a design token.
 */
const SERIES_COLORS = [
  'var(--color-moonlight)',
  'var(--color-success)',
  'var(--color-warning)',
  'var(--color-danger)',
  'var(--color-info)',
];

const GRID_STROKE = 'var(--chart-grid)';
const AXIS_STROKE = 'var(--chart-axis)';
const TICK_FILL = 'var(--chart-tick)';

export interface MetricChartProps {
  series: MetricSeries;
  range: '24h' | '7d' | '30d';
  timezone: string;
  locale: string;
}

/** Recharts line chart for historical monitor metrics, rendered on glass. */
export function MetricChart({ series, range, timezone, locale }: MetricChartProps) {
  const { t } = useTranslation();
  const [selectedKey, setSelectedKey] = useState('all');

  const keys = series.keys;
  const shownKeys = selectedKey === 'all' ? keys : [selectedKey].filter((key) => keys.includes(key));

  const data = useMemo(
    () =>
      series.points.map((point) => {
        const row: Record<string, number | string | null> = { at: point.at };
        for (const key of keys) row[key] = point.values[key] ?? null;
        return row;
      }),
    [series.points, keys],
  );

  const formatTimestamp = (value: string | number) => {
    const dt = DateTime.fromISO(String(value), { zone: timezone }).setLocale(
      locale === 'zh-CN' ? 'zh-CN' : 'en-US',
    );
    if (!dt.isValid) return String(value);
    return range === '24h' ? dt.toFormat('HH:mm') : dt.toFormat('MM-dd HH:mm');
  };

  if (keys.length === 0) {
    return (
      <p className="glass-flat px-6 py-10 text-center text-body text-moonlight">
        {t('monitorDetail.noChartData')}
      </p>
    );
  }

  return (
    <div className="min-w-0">
      {keys.length > 1 ? (
        <div className="mb-3 flex justify-end">
          <Select
            value={selectedKey}
            onValueChange={setSelectedKey}
            className="h-9 w-44 text-xs"
            ariaLabel={t('monitorDetail.metricSelector')}
            options={[
              { value: 'all', label: t('monitorDetail.allMetrics') },
              ...keys.map((key) => ({ value: key, label: key })),
            ]}
          />
        </div>
      ) : null}
      <div className="h-72 w-full min-w-0">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
            <CartesianGrid
              stroke={GRID_STROKE}
              strokeDasharray="3 3"
              vertical={false}
            />
            <XAxis
              dataKey="at"
              tickFormatter={formatTimestamp}
              tick={{ fill: TICK_FILL, fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: AXIS_STROKE }}
              minTickGap={28}
            />
            <YAxis
              tick={{ fill: TICK_FILL, fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              width={52}
            />
            <RechartsTooltip
              cursor={{ stroke: AXIS_STROKE, strokeOpacity: 0.45, strokeDasharray: '3 3' }}
              content={({ active, payload, label }) => {
                if (!active || !payload || payload.length === 0) return null;
                return (
                  <div className="glass-popover rounded-btn min-w-[168px] px-4 py-3">
                    <p className="type-label">{formatTimestamp(label as string)}</p>
                    <ul className="mt-2 space-y-1.5">
                      {payload.map((entry) => (
                        <li
                          key={String(entry.dataKey ?? entry.name)}
                          className="flex items-center justify-between gap-4 text-xs"
                        >
                          <span className="flex min-w-0 items-center gap-2">
                            <span
                              className="h-2 w-2 shrink-0 rounded-full"
                              style={{ backgroundColor: entry.color }}
                              aria-hidden
                            />
                            <span className="truncate text-moonlight">{entry.name}</span>
                          </span>
                          <span className="font-medium tabular-nums text-ink">{entry.value}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              }}
            />
            <Legend
              wrapperStyle={{ fontSize: 12 }}
              iconType="circle"
              iconSize={8}
              formatter={(value) => <span className="text-moonlight">{value}</span>}
            />
            {shownKeys.map((key, index) => (
              <Line
                key={key}
                type="monotone"
                dataKey={key}
                name={key}
                stroke={SERIES_COLORS[index % SERIES_COLORS.length]}
                strokeWidth={2}
                dot={false}
                activeDot={{ r: 4, strokeWidth: 0 }}
                connectNulls
                isAnimationActive={false}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
