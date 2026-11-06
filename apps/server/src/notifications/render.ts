import { formatDateTime, type Locale, type NotificationEventType } from '@subwatch/shared';
import type { NotificationPayload, NotificationSeverity } from '../context.js';

interface Localized {
  zh: string;
  en: string;
}

const EVENT_COPY: Record<NotificationEventType, { title: Localized; message: Localized }> = {
  'monitor.firing': {
    title: { zh: '监控告警', en: 'Monitor alert' },
    message: {
      zh: '监控规则已触发，请及时检查服务状态。',
      en: 'A monitor rule has fired. Please check the service.',
    },
  },
  'monitor.resolved': {
    title: { zh: '监控恢复', en: 'Monitor resolved' },
    message: {
      zh: '监控告警已恢复。',
      en: 'The monitor alert has been resolved.',
    },
  },
  'monitor.down': {
    title: { zh: '监控宕机', en: 'Monitor down' },
    message: {
      zh: '监控目标当前无法访问。',
      en: 'The monitored target is currently unreachable.',
    },
  },
  'monitor.recovered': {
    title: { zh: '监控恢复', en: 'Monitor recovered' },
    message: {
      zh: '监控目标已恢复访问。',
      en: 'The monitored target has recovered.',
    },
  },
  'monitor.test': {
    title: { zh: '监控测试通知', en: 'Monitor test notification' },
    message: {
      zh: '这是一条监控测试通知。',
      en: 'This is a monitor test notification.',
    },
  },
  'subscription.expiring': {
    title: { zh: '订阅即将到期', en: 'Subscription expiring soon' },
    message: {
      zh: '订阅即将到期，请及时续费。',
      en: 'A subscription is expiring soon. Please renew it in time.',
    },
  },
  'subscription.expired': {
    title: { zh: '订阅已过期', en: 'Subscription expired' },
    message: {
      zh: '订阅已过期，请及时处理。',
      en: 'A subscription has expired. Please take action.',
    },
  },
  'subscription.renewed': {
    title: { zh: '订阅已续期', en: 'Subscription renewed' },
    message: {
      zh: '订阅已成功续期。',
      en: 'A subscription has been renewed successfully.',
    },
  },
  'subscription.test': {
    title: { zh: '订阅测试提醒', en: 'Subscription test reminder' },
    message: {
      zh: '这是一条订阅提醒测试。',
      en: 'This is a subscription reminder test.',
    },
  },
  'channel.test': {
    title: { zh: 'SubWatch 测试通知', en: 'SubWatch test notification' },
    message: {
      zh: '这是一条来自 SubWatch 的测试通知，收到即表示通知频道配置正确。',
      en: 'This is a test notification from SubWatch. Receiving it means the channel is configured correctly.',
    },
  },
};

const SEVERITY_LABELS: Record<NotificationSeverity, Localized> = {
  info: { zh: '信息', en: 'Info' },
  success: { zh: '成功', en: 'Success' },
  warning: { zh: '警告', en: 'Warning' },
  critical: { zh: '严重', en: 'Critical' },
};

const SEVERITY_COLORS: Record<NotificationSeverity, string> = {
  info: '#2563eb',
  success: '#16a34a',
  warning: '#d97706',
  critical: '#dc2626',
};

const DATA_LABELS: Record<string, Localized> = {
  name: { zh: '名称', en: 'Name' },
  monitorName: { zh: '监控', en: 'Monitor' },
  monitorId: { zh: '监控 ID', en: 'Monitor ID' },
  monitorUrl: { zh: '监控地址', en: 'Monitor URL' },
  subscriptionName: { zh: '订阅', en: 'Subscription' },
  subscriptionId: { zh: '订阅 ID', en: 'Subscription ID' },
  channelName: { zh: '频道', en: 'Channel' },
  status: { zh: '状态', en: 'Status' },
  severity: { zh: '级别', en: 'Severity' },
  metric: { zh: '指标', en: 'Metric' },
  metricKey: { zh: '指标键', en: 'Metric key' },
  metricLabel: { zh: '指标', en: 'Metric' },
  ruleId: { zh: '规则 ID', en: 'Rule ID' },
  value: { zh: '当前值', en: 'Current value' },
  unit: { zh: '单位', en: 'Unit' },
  threshold: { zh: '阈值', en: 'Threshold' },
  warningValue: { zh: '警告阈值', en: 'Warning threshold' },
  criticalValue: { zh: '严重阈值', en: 'Critical threshold' },
  url: { zh: '地址', en: 'URL' },
  expiryDate: { zh: '到期日', en: 'Expiry date' },
  daysLeft: { zh: '剩余天数', en: 'Days left' },
  cycle: { zh: '周期', en: 'Cycle' },
  error: { zh: '错误', en: 'Error' },
};

const META_KEYS = new Set(['title', 'message', 'appUrl', 'source', 'data']);

export interface RenderEnvironment {
  locale: Locale;
  appName: string;
  appUrl: string;
  timezone: string;
}

export interface RenderedNotification {
  eventType: NotificationEventType;
  title: string;
  message: string;
  severity: NotificationSeverity;
  timestamp: string;
  data: Record<string, unknown>;
  appUrl: string;
  subject: string;
  html: string;
  text: string;
}

function pick(locale: Locale, localized: Localized): string {
  return locale === 'en' ? localized.en : localized.zh;
}

function cleanText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Escape user/event supplied text before embedding it in the HTML email. */
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function defaultSeverity(eventType: NotificationEventType): NotificationSeverity {
  switch (eventType) {
    case 'monitor.down':
    case 'subscription.expired':
      return 'critical';
    case 'monitor.firing':
    case 'subscription.expiring':
      return 'warning';
    case 'monitor.resolved':
    case 'monitor.recovered':
    case 'subscription.renewed':
      return 'success';
    default:
      return 'info';
  }
}

function isHttpUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function formatDataValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (typeof value === 'bigint') return value.toString();
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

interface DetailEntry {
  key: string;
  label: string;
  value: string;
}

function buildDetailEntries(
  data: Record<string, unknown>,
  locale: Locale,
): DetailEntry[] {
  const entries: DetailEntry[] = [];
  for (const [key, rawValue] of Object.entries(data)) {
    if (META_KEYS.has(key)) continue;
    const localized = DATA_LABELS[key];
    const label = localized ? pick(locale, localized) : key;
    entries.push({ key, label, value: formatDataValue(rawValue) });
  }
  return entries;
}

function renderHtml(input: {
  appName: string;
  title: string;
  message: string;
  severity: NotificationSeverity;
  severityLabel: string;
  timestamp: string;
  timeLabel: string;
  entries: DetailEntry[];
  appUrl: string;
  footerNote: string;
}): string {
  const color = SEVERITY_COLORS[input.severity];
  const details =
    input.entries.length === 0
      ? ''
      : `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;margin:16px 0 4px;border-collapse:collapse;font-size:14px;">${input.entries
          .map(
            (entry) =>
              `<tr><td style="padding:6px 12px 6px 0;color:#6b7280;white-space:nowrap;vertical-align:top;">${escapeHtml(
                entry.label,
              )}</td><td style="padding:6px 0;color:#111827;word-break:break-word;">${escapeHtml(
                entry.value,
              )}</td></tr>`,
          )
          .join('')}</table>`;
  const messageHtml = escapeHtml(input.message).replace(/\r?\n/g, '<br>');
  const link =
    input.appUrl && isHttpUrl(input.appUrl)
      ? `<p style="margin:20px 0 0;"><a href="${escapeHtml(
          input.appUrl,
        )}" style="display:inline-block;background:${color};color:#ffffff;text-decoration:none;font-size:14px;padding:9px 18px;border-radius:6px;">${escapeHtml(
          input.footerNote,
        )}</a></p>`
      : '';
  return `<!doctype html>
<html>
  <body style="margin:0;padding:0;background-color:#f5f7fa;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#f5f7fa;">
      <tr>
        <td align="center" style="padding:24px 12px;">
          <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background-color:#ffffff;border:1px solid #e5e7eb;border-radius:8px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Helvetica Neue',Arial,'PingFang SC','Microsoft YaHei',sans-serif;">
            <tr>
              <td style="padding:20px 24px;border-bottom:1px solid #e5e7eb;">
                <div style="font-size:13px;color:#6b7280;letter-spacing:0.02em;">${escapeHtml(
                  input.appName,
                )}</div>
                <div style="margin-top:6px;font-size:20px;font-weight:600;color:#111827;">${escapeHtml(
                  input.title,
                )}</div>
                <div style="margin-top:10px;">
                  <span style="display:inline-block;background:${color};color:#ffffff;font-size:12px;font-weight:600;padding:3px 10px;border-radius:999px;">${escapeHtml(
                    input.severityLabel,
                  )}</span>
                  <span style="margin-left:10px;font-size:12px;color:#9ca3af;">${escapeHtml(
                    input.timeLabel,
                  )}: ${escapeHtml(input.timestamp)}</span>
                </div>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 24px;color:#374151;font-size:14px;line-height:1.65;">
                <p style="margin:0;">${messageHtml}</p>
                ${details}
                ${link}
              </td>
            </tr>
            <tr>
              <td style="padding:16px 24px;border-top:1px solid #e5e7eb;color:#9ca3af;font-size:12px;line-height:1.6;">
                ${escapeHtml(input.footerNote)} · ${escapeHtml(input.appName)}
                ${
                  input.appUrl && isHttpUrl(input.appUrl)
                    ? `<br><a href="${escapeHtml(
                        input.appUrl,
                      )}" style="color:#6b7280;text-decoration:none;">${escapeHtml(input.appUrl)}</a>`
                    : ''
                }
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

function renderText(input: {
  appName: string;
  title: string;
  message: string;
  severityLabel: string;
  timestamp: string;
  timeLabel: string;
  entries: DetailEntry[];
  appUrl: string;
  footerNote: string;
}): string {
  const details =
    input.entries.length === 0
      ? ''
      : `\n${input.entries.map((entry) => `${entry.label}: ${entry.value}`).join('\n')}\n`;
  const link = input.appUrl && isHttpUrl(input.appUrl) ? `\n${input.appUrl}\n` : '';
  return [
    `[${input.appName}] ${input.title}`,
    `${input.severityLabel} · ${input.timeLabel}: ${input.timestamp}`,
    '',
    input.message,
    details,
    link,
  ]
    .join('\n')
    .trim();
}

/**
 * Render a notification event for both email and webhook transports. The
 * subject/title/body are localized via `env.locale`; event-provided
 * `payload.title`/`payload.message` win over the built-in defaults.
 */
export function renderNotification(
  eventType: NotificationEventType,
  payload: NotificationPayload,
  env: RenderEnvironment,
  timestamp: string = new Date().toISOString(),
): RenderedNotification {
  const copy = EVENT_COPY[eventType] ?? {
    title: { zh: 'SubWatch 通知', en: 'SubWatch notification' },
    message: { zh: '您有一条新的通知。', en: 'You have a new notification.' },
  };
  const title = cleanText(payload.title) || pick(env.locale, copy.title);
  const message = cleanText(payload.message) || pick(env.locale, copy.message);
  const severity: NotificationSeverity =
    payload.severity && payload.severity in SEVERITY_LABELS
      ? payload.severity
      : defaultSeverity(eventType);
  const data =
    payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)
      ? (payload.data as Record<string, unknown>)
      : {};
  const appUrl = cleanText(payload.appUrl) || env.appUrl;
  const entries = buildDetailEntries(data, env.locale);
  const severityLabel = pick(env.locale, SEVERITY_LABELS[severity]);
  const timeLabel = env.locale === 'en' ? 'Time' : '时间';
  const footerNote = env.locale === 'en' ? 'Open SubWatch' : '打开 SubWatch';
  const formattedTimestamp = formatDateTime(timestamp, env.timezone, env.locale);

  return {
    eventType,
    title,
    message,
    severity,
    timestamp,
    data,
    appUrl,
    subject: `[${env.appName}] ${title}`,
    html: renderHtml({
      appName: env.appName,
      title,
      message,
      severity,
      severityLabel,
      timestamp: formattedTimestamp,
      timeLabel,
      entries,
      appUrl,
      footerNote,
    }),
    text: renderText({
      appName: env.appName,
      title,
      message,
      severityLabel,
      timestamp: formattedTimestamp,
      timeLabel,
      entries,
      appUrl,
      footerNote,
    }),
  };
}

/** Canonical payload for `channel.test` events (used by test-send routes). */
export function buildChannelTestPayload(locale: Locale): {
  title: string;
  message: string;
  severity: NotificationSeverity;
} {
  const copy = EVENT_COPY['channel.test'];
  return {
    title: pick(locale, copy.title),
    message: pick(locale, copy.message),
    severity: 'info',
  };
}
