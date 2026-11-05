import type { FastifyInstance } from 'fastify';
import {
  daysLeft,
  todayInZone,
  type DashboardAlert,
  type DashboardDto,
  type DashboardExpiring,
  type DashboardMonitorCard,
  type MetricValue,
  type MonitorStatus,
  type NotificationDto,
  type SubscriptionStatus,
} from '@subwatch/shared';
import type { CoreContext } from '../context.js';
import { createRequireAuth } from '../auth/guard.js';
import { all, parseJson } from '../db/helpers.js';

interface MonitorRow {
  id: string;
  name: string;
  enabled: number;
  last_status: string;
  last_metrics: string;
  last_checked_at: string | null;
}

interface AlertRow {
  monitor_id: string;
  monitor_name: string;
  rule_id: string;
  state: string;
  severity: string | null;
  value: number | null;
  since: string;
  metric_key: string | null;
  metric_label: string | null;
}

interface SubscriptionRow {
  id: string;
  name: string;
  template_id: string | null;
  template_name: string | null;
  expiry_date: string;
  amount_cents: number | null;
  currency: string;
  cycle: string;
  cycle_days: number | null;
  paused: number;
  archived: number;
}

interface NotificationRow {
  id: string;
  event_type: string;
  event_key: string;
  channel_id: string | null;
  channel_name: string | null;
  status: string;
  attempts: number;
  last_error: string | null;
  payload: string;
  created_at: string;
  sent_at: string | null;
}

function normalizeMonitorStatus(enabled: boolean, raw: string): MonitorStatus {
  if (!enabled) return 'paused';
  const allowed: MonitorStatus[] = ['unknown', 'up', 'warning', 'critical', 'down'];
  return allowed.includes(raw as MonitorStatus) ? (raw as MonitorStatus) : 'unknown';
}

function deriveSubscriptionStatus(row: SubscriptionRow, timezone: string, maxOffset: number): SubscriptionStatus {
  if (row.archived) return 'archived';
  if (row.paused) return 'paused';
  const left = daysLeft(row.expiry_date, timezone);
  if (left < 0) return 'expired';
  if (left <= Math.max(maxOffset, 7)) return 'expiring';
  return 'active';
}

function monthlyCostCents(row: SubscriptionRow): number {
  const amount = row.amount_cents ?? 0;
  if (amount === 0) return 0;
  switch (row.cycle) {
    case 'day':
      return amount * 30.44;
    case 'week':
      return amount * 4.345;
    case 'month':
      return amount;
    case 'quarter':
      return amount / 3;
    case 'year':
      return amount / 12;
    case 'custom_days':
      return row.cycle_days && row.cycle_days > 0 ? (amount * 30.44) / row.cycle_days : amount;
    default:
      return amount;
  }
}

export async function registerDashboardRoutes(app: FastifyInstance, ctx: CoreContext): Promise<void> {
  const requireAuth = createRequireAuth(ctx);

  app.get('/api/dashboard', { preHandler: requireAuth }, async (): Promise<DashboardDto> => {
    const general = ctx.settings.getGeneral();
    const timezone = general.timezone;
    const today = todayInZone(timezone);

    const monitorRows = all<MonitorRow>(
      ctx.db,
      'SELECT id, name, enabled, last_status, last_metrics, last_checked_at FROM monitors ORDER BY name',
    );
    const counts = { total: monitorRows.length, up: 0, warning: 0, critical: 0, down: 0, unknown: 0, paused: 0 };
    const monitorCards: DashboardMonitorCard[] = [];
    for (const row of monitorRows) {
      const status = normalizeMonitorStatus(Boolean(row.enabled), row.last_status);
      counts[status] += 1;
      if (row.enabled) {
        monitorCards.push({
          id: row.id,
          name: row.name,
          status,
          metrics: parseJson<Record<string, MetricValue>>(row.last_metrics, {}),
          lastCheckedAt: row.last_checked_at,
        });
      }
    }
    monitorCards.sort((a, b) => {
      const rank: Record<MonitorStatus, number> = {
        critical: 0,
        down: 1,
        warning: 2,
        unknown: 3,
        up: 4,
        paused: 5,
      };
      return rank[a.status] - rank[b.status] || a.name.localeCompare(b.name);
    });

    const alertRows = all<AlertRow>(
      ctx.db,
      `SELECT a.monitor_id, m.name AS monitor_name, a.rule_id, a.state, a.severity, a.value, a.since,
              r.metric_key, r.label AS metric_label
         FROM alert_states a
         JOIN monitors m ON m.id = a.monitor_id
         LEFT JOIN monitor_rules r ON r.id = a.rule_id
        WHERE a.state IN ('warning', 'critical') AND m.enabled = 1
        ORDER BY CASE a.state WHEN 'critical' THEN 0 ELSE 1 END, a.since ASC
        LIMIT 20`,
    );
    const alerts: DashboardAlert[] = alertRows.map((row) => ({
      monitorId: row.monitor_id,
      monitorName: row.monitor_name,
      metricKey: row.metric_key,
      metricLabel: row.metric_label,
      severity:
        row.severity === 'critical' || row.severity === 'down'
          ? 'critical'
          : 'warning',
      value: row.value,
      since: row.since,
    }));

    const subscriptionRows = all<SubscriptionRow>(
      ctx.db,
      `SELECT s.id, s.name, s.template_id, t.name AS template_name, s.expiry_date, s.amount_cents,
              s.currency, s.cycle, s.cycle_days, s.paused, s.archived
         FROM subscriptions s
         LEFT JOIN templates t ON t.id = s.template_id
        WHERE s.archived = 0
        ORDER BY s.expiry_date ASC`,
    );
    const maxOffset = general.defaultReminderOffsets.reduce((max, value) => Math.max(max, value), 7);
    const expiring: DashboardExpiring[] = [];
    let totalCostCents = 0;
    let active = 0;
    let expiringCount = 0;
    let expired = 0;
    for (const row of subscriptionRows) {
      const status = deriveSubscriptionStatus(row, timezone, maxOffset);
      if (status === 'paused') continue;
      if (status === 'expired') {
        expired += 1;
        continue;
      }
      active += 1;
      totalCostCents += monthlyCostCents(row);
      const left = daysLeft(row.expiry_date, timezone);
      if (left <= 30) {
        if (status === 'expiring') expiringCount += 1;
        expiring.push({
          id: row.id,
          name: row.name,
          templateName: row.template_name,
          expiryDate: row.expiry_date,
          daysLeft: left,
          amountCents: row.amount_cents,
          currency: row.currency,
        });
      }
    }

    const notificationRows = all<NotificationRow>(
      ctx.db,
      `SELECT n.id, n.event_type, n.event_key, n.channel_id, c.name AS channel_name, n.status,
              n.attempts, n.last_error, n.payload, n.created_at, n.sent_at
         FROM notification_queue n
         LEFT JOIN channels c ON c.id = n.channel_id
        ORDER BY n.created_at DESC
        LIMIT 10`,
    );
    const recentNotifications: NotificationDto[] = notificationRows.map((row) => ({
      id: row.id,
      eventType: row.event_type as NotificationDto['eventType'],
      eventKey: row.event_key,
      channelId: row.channel_id,
      channelName: row.channel_name,
      status: row.status as NotificationDto['status'],
      attempts: row.attempts,
      lastError: row.last_error,
      payload: parseJson<unknown>(row.payload, null),
      createdAt: row.created_at,
      sentAt: row.sent_at,
    }));

    return {
      monitors: counts,
      subscriptions: {
        total: subscriptionRows.length,
        active,
        expiring: expiringCount,
        expired,
        monthlyCostCents: Math.round(totalCostCents),
        currency: general.currency,
      },
      alerts,
      expiring: expiring.slice(0, 10),
      recentNotifications,
      monitorCards: monitorCards.slice(0, 12),
    };
  });

  app.get('/api/dashboard/calendar', { preHandler: requireAuth }, async (request) => {
    const query = request.query as { days?: string };
    const days = Math.min(Math.max(Number(query.days ?? 60), 1), 365);
    const general = ctx.settings.getGeneral();
    const today = todayInZone(general.timezone);
    const rows = all<{ id: string; name: string; expiry_date: string; amount_cents: number | null; currency: string }>(
      ctx.db,
      `SELECT id, name, expiry_date, amount_cents, currency
         FROM subscriptions
        WHERE archived = 0 AND paused = 0 AND expiry_date >= ?
        ORDER BY expiry_date ASC`,
      [today],
    );
    return rows
      .map((row) => ({ ...row, daysLeft: daysLeft(row.expiry_date, general.timezone) }))
      .filter((row) => row.daysLeft <= days);
  });
}
