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

const COLORS = ['#2563eb', '#16a34a', '#d97706', '#dc2626', '#7c3aed', '#0891b2', '#db2777', '#65a30d'];

export interface MetricChartProps {
  series: MetricSeries;
  range: '24h' | '7d' | '30d';
  timezone: string;
  locale: string;
}

/** Recharts line chart for historical monitor metrics. */
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

  if (keys.length === 0) {
    return <p className="py-10 text-center text-sm text-[var(--muted-foreground)]">{t('monitorDetail.noChartData')}</p>;
  }

  const formatTimestamp = (value: string | number) => {
    const dt = DateTime.fromISO(String(value), { zone: timezone }).setLocale(locale === 'zh-CN' ? 'zh-CN' : 'en-US');
    if (!dt.isValid) return String(value);
    return range === '24h' ? dt.toFormat('HH:mm') : dt.toFormat('MM-dd HH:mm');
  };

  return (
    <div>
      {keys.length > 1 ? (
        <div className="mb-2 flex justify-end">
          <Select
            value={selectedKey}
            onValueChange={setSelectedKey}
            className="h-8 w-44 text-xs"
            ariaLabel={t('monitorDetail.metricSelector')}
            options={[
              { value: 'all', label: t('monitorDetail.allMetrics') },
              ...keys.map((key) => ({ value: key, label: key })),
            ]}
          />
        </div>
      ) : null}
      <div className="h-72 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -12 }}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="at"
              tickFormatter={formatTimestamp}
              stroke="var(--muted-foreground)"
              fontSize={11}
              minTickGap={28}
            />
            <YAxis stroke="var(--muted-foreground)" fontSize={11} width={52} />
            <RechartsTooltip
              contentStyle={{
                backgroundColor: 'var(--surface)',
                borderColor: 'var(--border)',
                borderRadius: 8,
                fontSize: 12,
                color: 'var(--foreground)',
              }}
              labelFormatter={(value) => formatTimestamp(value as string)}
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {shownKeys.map((key, index) => (
              <Line
                key={key}
                type="monotone"
                dataKey={key}
                name={key}
                stroke={COLORS[index % COLORS.length]}
                strokeWidth={2}
                dot={false}
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
