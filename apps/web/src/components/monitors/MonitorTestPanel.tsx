import { useTranslation } from 'react-i18next';
import { AlertTriangle, ChevronRight, ClipboardList, Play, Terminal } from 'lucide-react';
import type { MonitorTestResult } from '@subwatch/shared';
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Spinner,
} from '../ui';
import {
  errorMessage,
  formatMetricValue,
  formatMs,
  prettyJson,
  statusTone,
  type Tone,
} from '../../lib/utils';

const LEVEL_TONES: Record<string, Tone> = {
  ok: 'success',
  warning: 'warning',
  critical: 'danger',
};

export interface MonitorTestPanelProps {
  result: MonitorTestResult | undefined;
  error: unknown;
  pending: boolean;
  onRun: () => void;
  disabled?: boolean;
}

/** Side panel showing the result of a manual monitor test run. */
export function MonitorTestPanel({ result, error, pending, onRun, disabled }: MonitorTestPanelProps) {
  const { t } = useTranslation();
  const metricEntries = result ? Object.entries(result.metrics) : [];

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="flex items-center gap-2">
          <ClipboardList className="h-4 w-4 text-[var(--brand)]" aria-hidden />
          {t('monitorForm.testResult')}
        </CardTitle>
        <Button size="sm" variant="outline" loading={pending} onClick={onRun} disabled={disabled}>
          {!pending ? <Play className="h-3.5 w-3.5" aria-hidden /> : null}
          {pending ? t('monitorForm.testing') : t('monitorForm.testRun')}
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {pending ? (
          <div className="flex items-center gap-2 py-4 text-sm text-[var(--muted-foreground)]">
            <Spinner size="sm" />
            {t('monitorForm.testing')}
          </div>
        ) : error ? (
          <Alert tone="danger" title={t('monitorForm.testFailed')}>
            {errorMessage(error)}
          </Alert>
        ) : !result ? (
          <p className="py-2 text-sm text-[var(--muted-foreground)]">{t('monitorForm.testChannelHint')}</p>
        ) : (
          <>
            <Alert
              tone={result.ok ? 'success' : 'danger'}
              title={result.ok ? t('monitorForm.testSuccess') : t('monitorForm.testFailed')}
            >
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <Badge tone={statusTone(result.status)}>{t(`status.${result.status}`)}</Badge>
                {result.httpStatus !== null && result.httpStatus !== undefined ? (
                  <span>
                    {t('monitorForm.httpStatus')}: <strong>{result.httpStatus}</strong>
                  </span>
                ) : null}
                <span>
                  {t('monitorForm.duration')}: <strong>{formatMs(result.durationMs)}</strong>
                </span>
              </span>
            </Alert>

            {result.error ? (
              <Alert tone="warning" title={t('monitorDetail.lastError')}>
                {result.error}
              </Alert>
            ) : null}

            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                {t('monitorForm.metricsResult')}
              </p>
              {metricEntries.length === 0 ? (
                <p className="text-sm text-[var(--muted-foreground)]">{t('monitorForm.noMetrics')}</p>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {metricEntries.map(([key, metric]) => (
                    <div key={key} className="rounded-lg border border-[var(--border)] px-2.5 py-1.5">
                      <p className="truncate text-xs text-[var(--muted-foreground)]">{metric.label || key}</p>
                      <p className="truncate text-sm font-semibold">{formatMetricValue(metric)}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                {t('monitorForm.evaluations')}
              </p>
              {result.evaluations.length === 0 ? (
                <p className="text-sm text-[var(--muted-foreground)]">{t('monitorForm.noRules')}</p>
              ) : (
                <ul className="space-y-1.5">
                  {result.evaluations.map((evaluation) => (
                    <li
                      key={`${evaluation.ruleId}-${evaluation.metricKey}`}
                      className="flex items-start gap-2 rounded-lg border border-[var(--border)] px-2.5 py-1.5 text-sm"
                    >
                      <Badge tone={LEVEL_TONES[evaluation.level] ?? 'neutral'}>
                        {t(`severity.${evaluation.level === 'ok' ? 'success' : evaluation.level}`)}
                      </Badge>
                      <div className="min-w-0 flex-1">
                        <p className="truncate font-medium">{evaluation.metricKey}</p>
                        <p className="truncate text-xs text-[var(--muted-foreground)]">
                          {evaluation.message || formatMetricValue(evaluation.value)}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <details className="rounded-lg border border-[var(--border)]">
              <summary className="flex cursor-pointer items-center gap-1.5 px-2.5 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                <Terminal className="h-3.5 w-3.5" aria-hidden />
                {t('monitorForm.logs')}
              </summary>
              <div className="max-h-48 overflow-auto border-t border-[var(--border)] bg-[var(--surface-muted)] p-2.5 font-mono text-xs">
                {result.logs.length === 0 ? (
                  <p className="text-[var(--muted-foreground)]">{t('monitorForm.noLogs')}</p>
                ) : (
                  result.logs.map((line, index) => (
                    <p key={index} className="whitespace-pre-wrap break-words">
                      {line}
                    </p>
                  ))
                )}
              </div>
            </details>

            <details className="rounded-lg border border-[var(--border)]">
              <summary className="flex cursor-pointer items-center gap-1.5 px-2.5 py-2 text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">
                <ChevronRight className="h-3.5 w-3.5" aria-hidden />
                {t('monitorForm.rawResponse')}
              </summary>
              <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-words border-t border-[var(--border)] bg-[var(--surface-muted)] p-2.5 font-mono text-xs">
                {result.rawText
                  ? result.rawText
                  : result.rawBody !== undefined
                    ? prettyJson(result.rawBody)
                    : t('monitorForm.noData')}
              </pre>
            </details>
          </>
        )}
        {error ? (
          <p className="flex items-center gap-1 text-xs text-[var(--danger)]">
            <AlertTriangle className="h-3.5 w-3.5" aria-hidden />
            {t('monitorForm.testFailed')}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
