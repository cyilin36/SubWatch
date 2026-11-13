import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronRight, ClipboardList, Play, Terminal } from 'lucide-react';
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

/** Recessed glass disclosure used for logs and raw payloads. */
function OutputWell({
  label,
  icon,
  children,
  mono = false,
}: {
  label: string;
  icon?: ReactNode;
  children: ReactNode;
  mono?: boolean;
}) {
  return (
    <details className="glass-flat group overflow-hidden">
      <summary className="flex cursor-pointer list-none select-none items-center gap-2 px-4 py-2.5 text-moonlight transition-colors duration-500 ease-glass hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 [&::-webkit-details-marker]:hidden">
        <ChevronRight
          className="h-3.5 w-3.5 shrink-0 transition-transform duration-500 ease-glass group-open:rotate-90"
          aria-hidden
        />
        {icon}
        <span className="type-label min-w-0 flex-1 truncate">{label}</span>
      </summary>
      <div
        className={
          mono
            ? 'max-h-60 overflow-auto border-t border-white/10 px-4 py-3 font-mono text-xs leading-relaxed text-white/80'
            : 'max-h-48 overflow-auto border-t border-white/10 px-4 py-3 text-xs leading-relaxed text-white/80'
        }
      >
        {children}
      </div>
    </details>
  );
}

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
      <CardHeader className="flex-row items-center justify-between gap-3">
        <CardTitle className="flex items-center gap-2">
          <ClipboardList className="h-4 w-4 text-moonlight" aria-hidden />
          {t('monitorForm.testResult')}
        </CardTitle>
        <Button size="sm" variant="outline" loading={pending} onClick={onRun} disabled={disabled}>
          {!pending ? <Play className="h-3.5 w-3.5" aria-hidden /> : null}
          {pending ? t('monitorForm.testing') : t('monitorForm.testRun')}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {pending ? (
          <div className="glass-flat flex items-center gap-3 px-4 py-6 text-body text-moonlight">
            <Spinner size="sm" />
            {t('monitorForm.testing')}
          </div>
        ) : error ? (
          <Alert tone="danger" title={t('monitorForm.testFailed')}>
            {errorMessage(error)}
          </Alert>
        ) : !result ? (
          <p className="glass-flat px-4 py-6 text-center text-body text-moonlight">
            {t('monitorForm.testChannelHint')}
          </p>
        ) : (
          <>
            <div className="glass-flat flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
              <Badge tone={result.ok ? 'success' : 'danger'} dot>
                {result.ok ? t('monitorForm.testSuccess') : t('monitorForm.testFailed')}
              </Badge>
              <Badge tone={statusTone(result.status)}>{t(`status.${result.status}`)}</Badge>
              {result.httpStatus !== null && result.httpStatus !== undefined ? (
                <span className="text-xs text-moonlight">
                  {t('monitorForm.httpStatus')}{' '}
                  <strong className="font-medium text-white">{result.httpStatus}</strong>
                </span>
              ) : null}
              <span className="text-xs text-moonlight">
                {t('monitorForm.duration')}{' '}
                <strong className="font-medium text-white">{formatMs(result.durationMs)}</strong>
              </span>
            </div>

            {result.error ? (
              <Alert tone="warning" title={t('monitorDetail.lastError')}>
                {result.error}
              </Alert>
            ) : null}

            <div className="space-y-2">
              <p className="type-label">{t('monitorForm.metricsResult')}</p>
              {metricEntries.length === 0 ? (
                <p className="text-body text-moonlight">{t('monitorForm.noMetrics')}</p>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {metricEntries.map(([key, metric]) => (
                    <div key={key} className="glass-flat min-w-0 px-3 py-2">
                      <p className="truncate text-xs text-moonlight">{metric.label || key}</p>
                      <p className="mt-0.5 truncate text-sm font-medium text-white">
                        {formatMetricValue(metric)}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="space-y-2">
              <p className="type-label">{t('monitorForm.evaluations')}</p>
              {result.evaluations.length === 0 ? (
                <p className="text-body text-moonlight">{t('monitorForm.noRules')}</p>
              ) : (
                <ul className="space-y-2">
                  {result.evaluations.map((evaluation) => (
                    <li
                      key={`${evaluation.ruleId}-${evaluation.metricKey}`}
                      className="glass-flat flex items-start gap-3 px-3 py-2"
                    >
                      <Badge tone={LEVEL_TONES[evaluation.level] ?? 'neutral'}>
                        {t(`severity.${evaluation.level === 'ok' ? 'success' : evaluation.level}`)}
                      </Badge>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-white">{evaluation.metricKey}</p>
                        <p className="truncate text-xs text-moonlight">
                          {evaluation.message || formatMetricValue(evaluation.value)}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <OutputWell
              label={t('monitorForm.logs')}
              icon={<Terminal className="h-3.5 w-3.5" aria-hidden />}
              mono
            >
              {result.logs.length === 0 ? (
                <p className="text-moonlight/80">{t('monitorForm.noLogs')}</p>
              ) : (
                result.logs.map((line, index) => (
                  <p key={index} className="whitespace-pre-wrap break-words">
                    {line}
                  </p>
                ))
              )}
            </OutputWell>

            <OutputWell label={t('monitorForm.rawResponse')} mono>
              <pre className="whitespace-pre-wrap break-words font-mono text-xs">
                {result.rawText
                  ? result.rawText
                  : result.rawBody !== undefined
                    ? prettyJson(result.rawBody)
                    : t('monitorForm.noData')}
              </pre>
            </OutputWell>
          </>
        )}
      </CardContent>
    </Card>
  );
}
