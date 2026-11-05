import type { MonitorDto, MonitorInput } from '@subwatch/shared';

/** Build a full monitor input payload from a DTO (PUT requires the whole object). */
export function monitorInputFromDto(monitor: MonitorDto): MonitorInput {
  return {
    name: monitor.name,
    description: monitor.description,
    config: structuredClone(monitor.config),
    intervalSeconds: monitor.intervalSeconds,
    failureThreshold: monitor.failureThreshold,
    staleAfterSeconds: monitor.staleAfterSeconds,
    channelIds: [...monitor.channelIds],
    tags: [...monitor.tags],
    enabled: monitor.enabled,
    rules: monitor.rules.map((rule) => ({
      id: rule.id,
      metricKey: rule.metricKey,
      label: rule.label,
      unit: rule.unit,
      operator: rule.operator,
      warningValue: rule.warningValue,
      criticalValue: rule.criticalValue,
      durationChecks: rule.durationChecks,
      cooldownSeconds: rule.cooldownSeconds,
      repeatIntervalSeconds: rule.repeatIntervalSeconds,
      recoveryOperator: rule.recoveryOperator,
      recoveryValue: rule.recoveryValue,
      recoveryChecks: rule.recoveryChecks,
      enabled: rule.enabled,
    })),
  };
}

/** Label for a monitor status including the paused state (server keeps lastStatus). */
export function monitorEffectiveStatus(monitor: Pick<MonitorDto, 'enabled' | 'lastStatus'>): string {
  return monitor.enabled ? monitor.lastStatus : 'paused';
}
