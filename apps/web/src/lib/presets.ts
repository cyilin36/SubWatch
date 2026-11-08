import {
  CYCLE_VALUES,
  OPERATOR_VALUES,
  THEME_VALUES,
  type Cycle,
  type Operator,
  type Theme,
} from '@subwatch/shared';

/** Common monitoring intervals, in seconds. */
export const INTERVAL_PRESETS: number[] = [
  30, 60, 120, 300, 600, 900, 1800, 3600, 10800, 21600, 43200, 86400,
];

/** Common reminder offsets (days before expiry). */
export const OFFSET_PRESETS: number[] = [0, 1, 3, 7, 14, 30];

const FALLBACK_TIMEZONES: string[] = [
  'UTC',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Asia/Seoul',
  'Asia/Singapore',
  'Asia/Hong_Kong',
  'Asia/Taipei',
  'Asia/Bangkok',
  'Asia/Kolkata',
  'Asia/Dubai',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Moscow',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Sao_Paulo',
  'Australia/Sydney',
  'Pacific/Auckland',
];

/** IANA timezones from the runtime when available, otherwise a curated list. */
export function getTimezoneOptions(): string[] {
  try {
    const supported = (
      Intl as unknown as { supportedValuesOf?: (key: string) => string[] }
    ).supportedValuesOf?.('timeZone');
    if (supported && supported.length > 0) return supported;
  } catch {
    // Fall back to the static list.
  }
  return FALLBACK_TIMEZONES;
}

export const CYCLE_OPTIONS: { value: Cycle; labelKey: string }[] = CYCLE_VALUES.map((cycle) => ({
  value: cycle,
  labelKey: `cycle.${cycle}`,
}));

export const OPERATOR_OPTIONS: { value: Operator; labelKey: string }[] = OPERATOR_VALUES.map(
  (operator) => ({ value: operator, labelKey: `operator.${operator}` }),
);

export const THEME_OPTIONS: { value: Theme; labelKey: string }[] = THEME_VALUES.map((theme) => ({
  value: theme,
  labelKey: `theme.${theme}`,
}));

/** Default JS extractor code shown in the monitor editor. */
export const JS_EXTRACT_EXAMPLE = `const used = ctx.num(ctx.get(ctx.data, 'usage.used'));
const limit = ctx.num(ctx.get(ctx.data, 'usage.limit'));

return {
  metrics: {
    remaining: {
      value: Math.max(0, 100 - (used / limit) * 100),
      label: 'remaining',
      unit: '%',
    },
  },
  status: 'up',
};
`;

export interface WebhookPresetHeader {
  key: string;
  value: string;
  secret: boolean;
}

export interface WebhookPreset {
  id: string;
  labelKey: string;
  hintKey: string;
  urlExample: string;
  method: 'POST' | 'PUT' | 'PATCH';
  contentType: string;
  bodyTemplate: string;
  headers: WebhookPresetHeader[];
}

export const WEBHOOK_PRESETS: WebhookPreset[] = [
  {
    id: 'general',
    labelKey: 'channels.presets.general',
    hintKey: 'channels.presetHints.general',
    urlExample: 'https://example.com/subwatch/webhook',
    method: 'POST',
    contentType: 'application/json',
    bodyTemplate: `{
  "source": "subwatch",
  "event": "{{event}}",
  "title": "{{title}}",
  "message": "{{message}}",
  "severity": "{{severity}}",
  "timestamp": "{{timestamp}}",
  "data": {{dataJson}},
  "appUrl": "{{appUrl}}"
}`,
    headers: [],
  },
  {
    id: 'discord',
    labelKey: 'channels.presets.discord',
    hintKey: 'channels.presetHints.discord',
    urlExample: 'https://discord.com/api/webhooks/<WEBHOOK_ID>/<WEBHOOK_TOKEN>',
    method: 'POST',
    contentType: 'application/json',
    bodyTemplate: `{
  "content": "**{{title}}**\\n{{message}}"
}`,
    headers: [],
  },
  {
    id: 'slack',
    labelKey: 'channels.presets.slack',
    hintKey: 'channels.presetHints.slack',
    urlExample: 'https://hooks.slack.com/services/<WORKSPACE>/<CHANNEL>/<TOKEN>',
    method: 'POST',
    contentType: 'application/json',
    bodyTemplate: `{
  "text": "*{{title}}*\\n{{message}}"
}`,
    headers: [],
  },
  {
    id: 'telegram',
    labelKey: 'channels.presets.telegram',
    hintKey: 'channels.presetHints.telegram',
    urlExample: 'https://api.telegram.org/bot<BOT_TOKEN>/sendMessage',
    method: 'POST',
    contentType: 'application/json',
    bodyTemplate: `{
  "chat_id": "<CHAT_ID>",
  "text": "{{title}}\\n{{message}}"
}`,
    headers: [],
  },
  {
    id: 'wecom',
    labelKey: 'channels.presets.wecom',
    hintKey: 'channels.presetHints.wecom',
    urlExample: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=<KEY>',
    method: 'POST',
    contentType: 'application/json',
    bodyTemplate: `{
  "msgtype": "text",
  "text": {
    "content": "{{title}}\\n{{message}}"
  }
}`,
    headers: [],
  },
  {
    id: 'dingtalk',
    labelKey: 'channels.presets.dingtalk',
    hintKey: 'channels.presetHints.dingtalk',
    urlExample: 'https://oapi.dingtalk.com/robot/send?access_token=<TOKEN>',
    method: 'POST',
    contentType: 'application/json',
    bodyTemplate: `{
  "msgtype": "text",
  "text": {
    "content": "{{title}}\\n{{message}}"
  }
}`,
    headers: [],
  },
  {
    id: 'feishu',
    labelKey: 'channels.presets.feishu',
    hintKey: 'channels.presetHints.feishu',
    urlExample: 'https://open.feishu.cn/open-apis/bot/v2/hook/<TOKEN>',
    method: 'POST',
    contentType: 'application/json',
    bodyTemplate: `{
  "msg_type": "text",
  "content": {
    "text": "{{title}}\\n{{message}}"
  }
}`,
    headers: [],
  },
  {
    id: 'bark',
    labelKey: 'channels.presets.bark',
    hintKey: 'channels.presetHints.bark',
    urlExample: 'https://api.day.app/<DEVICE_KEY>',
    method: 'POST',
    contentType: 'application/json',
    bodyTemplate: `{
  "title": "{{title}}",
  "body": "{{message}}",
  "group": "SubWatch"
}`,
    headers: [],
  },
  {
    id: 'astrbot-push-lite',
    labelKey: 'channels.presets.astrbotPushLite',
    hintKey: 'channels.presetHints.astrbotPushLite',
    urlExample: 'http://<astrbot-host>:9966/send',
    method: 'POST',
    contentType: 'application/json',
    bodyTemplate: `{
  "content": "{{title}}\\n{{message}}",
  "umo": "<UMO, run /sid in AstrBot>",
  "message_type": "text"
}`,
    headers: [{ key: 'Authorization', value: 'Bearer <API_TOKEN>', secret: true }],
  },
  {
    id: 'ntfy',
    labelKey: 'channels.presets.ntfy',
    hintKey: 'channels.presetHints.ntfy',
    urlExample: 'https://ntfy.sh/<TOPIC>',
    method: 'POST',
    contentType: 'text/plain',
    bodyTemplate: '{{title}}\n{{message}}',
    headers: [{ key: 'Title', value: '{{title}}', secret: false }],
  },
];
