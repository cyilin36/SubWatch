import { z } from 'zod';
import {
  CHANNEL_TYPE_VALUES,
  CYCLE_VALUES,
  DEFAULT_CURRENCY,
  DEFAULT_LOCALE,
  DEFAULT_REMINDER_OFFSETS,
  DEFAULT_REMINDER_TIME,
  DEFAULT_TIMEZONE,
  DEFAULT_LOCALE_VALUES,
  DEFAULT_MAX_RESPONSE_BYTES,
  DEFAULT_MONITOR_INTERVAL_SECONDS,
  EVENT_TYPES,
  FIELD_TYPE_VALUES,
  MAX_JS_CODE_BYTES,
  MAX_RESPONSE_BYTES,
  MONITOR_TYPE_VALUES,
  OPERATOR_VALUES,
  SECRET_KEEP,
  THEME_VALUES,
} from './constants.js';
import { isDateOnly } from './dates.js';

export const localeSchema = z.enum(DEFAULT_LOCALE_VALUES);
export const cycleSchema = z.enum(CYCLE_VALUES);
export const operatorSchema = z.enum(OPERATOR_VALUES);
export const dateOnlySchema = z
  .string()
  .refine(isDateOnly, { message: 'Expected a valid YYYY-MM-DD date' });
export const idSchema = z.string().min(1).max(64);
export const idListSchema = z.array(idSchema).max(100).default([]);
export const reminderOffsetsSchema = z
  .array(z.number().int().min(0).max(3650))
  .max(20)
  .default([...DEFAULT_REMINDER_OFFSETS]);
export const currencySchema = z.string().regex(/^[A-Z]{3}$/, 'Expected ISO-4217 currency code');
export const amountCentsSchema = z.number().int().min(0).max(1_000_000_000_000).nullable();

// ---------------------------------------------------------------------------
// Monitoring
// ---------------------------------------------------------------------------

export const monitorTypeSchema = z.enum(MONITOR_TYPE_VALUES);
export const httpMethodSchema = z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD']);

export const headerSchema = z.object({
  key: z.string().min(1).max(200),
  value: z.string().max(8000),
  secret: z.boolean().default(false),
});

export const queryParamSchema = z.object({
  key: z.string().min(1).max(200),
  value: z.string().max(8000),
});

export const authSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('none') }),
  z.object({
    type: z.literal('basic'),
    username: z.string().max(200).default(''),
    password: z.string().max(8000).default(''),
  }),
  z.object({
    type: z.literal('bearer'),
    token: z.string().max(8000).default(''),
  }),
]);

export const httpRequestSchema = z.object({
  url: z.string().url().max(2000),
  method: httpMethodSchema.default('GET'),
  headers: z.array(headerSchema).max(50).default([]),
  query: z.array(queryParamSchema).max(50).default([]),
  bodyType: z.enum(['none', 'json', 'raw', 'form']).default('none'),
  body: z.string().max(100_000).default(''),
  auth: authSchema.default({ type: 'none' }),
  timeoutMs: z.number().int().min(1000).max(60_000).default(10_000),
  followRedirects: z.boolean().default(true),
  verifyTls: z.boolean().default(true),
  maxResponseBytes: z
    .number()
    .int()
    .min(1024)
    .max(MAX_RESPONSE_BYTES)
    .default(DEFAULT_MAX_RESPONSE_BYTES),
});

export const jsonMetricSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(100)
    .regex(/^[a-zA-Z_][a-zA-Z0-9_.-]*$/, 'Metric key must start with a letter or underscore'),
  label: z.string().max(100).default(''),
  path: z.string().min(1).max(500),
  unit: z.string().max(20).default(''),
  scale: z.number().finite().optional(),
  offset: z.number().finite().optional(),
});

export const extractorSchema = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('json'),
    metrics: z.array(jsonMetricSchema).min(1).max(50),
  }),
  z.object({
    mode: z.literal('javascript'),
    code: z.string().min(1).max(MAX_JS_CODE_BYTES),
  }),
]);

export const httpMonitorConfigSchema = z.object({
  type: z.literal('http'),
  request: httpRequestSchema,
  extract: extractorSchema,
});

export const pushMonitorConfigSchema = z.object({
  type: z.literal('push'),
});

export const monitorConfigSchema = z.discriminatedUnion('type', [
  httpMonitorConfigSchema,
  pushMonitorConfigSchema,
]);

export const ruleInputSchema = z
  .object({
    id: z.string().min(1).max(64).optional(),
    metricKey: z.string().min(1).max(100),
    label: z.string().max(100).default(''),
    unit: z.string().max(20).default(''),
    operator: operatorSchema,
    warningValue: z.number().finite().nullable().default(null),
    criticalValue: z.number().finite().nullable().default(null),
    durationChecks: z.number().int().min(1).max(100).default(1),
    cooldownSeconds: z.number().int().min(0).max(2_592_000).default(3600),
    repeatIntervalSeconds: z.number().int().min(0).max(2_592_000).default(0),
    recoveryOperator: operatorSchema.nullable().default(null),
    recoveryValue: z.number().finite().nullable().default(null),
    recoveryChecks: z.number().int().min(1).max(100).default(1),
    enabled: z.boolean().default(true),
  })
  .superRefine((rule, ctx) => {
    if (rule.warningValue === null && rule.criticalValue === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['warningValue'],
        message: 'At least one warning or critical threshold is required',
      });
    }
    if ((rule.recoveryOperator === null) !== (rule.recoveryValue === null)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['recoveryValue'],
        message: 'recoveryOperator and recoveryValue must be set together',
      });
    }
    if (
      rule.warningValue !== null &&
      rule.criticalValue !== null &&
      !thresholdOrderIsSane(rule.operator, rule.warningValue, rule.criticalValue)
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['criticalValue'],
        message: 'Critical threshold must be more severe than the warning threshold',
      });
    }
  });

function thresholdOrderIsSane(operator: (typeof OPERATOR_VALUES)[number], warning: number, critical: number): boolean {
  switch (operator) {
    case 'gt':
    case 'gte':
      return critical >= warning;
    case 'lt':
    case 'lte':
      return critical <= warning;
    default:
      return true;
  }
}

export const monitorInputSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().max(500).default(''),
  config: monitorConfigSchema,
  intervalSeconds: z
    .number()
    .int()
    .min(30)
    .max(31 * 24 * 3600)
    .default(DEFAULT_MONITOR_INTERVAL_SECONDS),
  failureThreshold: z.number().int().min(1).max(20).default(2),
  staleAfterSeconds: z.number().int().min(60).max(31 * 24 * 3600).default(3600),
  channelIds: idListSchema,
  tags: z.array(z.string().min(1).max(50)).max(20).default([]),
  enabled: z.boolean().default(true),
  rules: z.array(ruleInputSchema).max(50).default([]),
});

export const monitorTestSchema = z.object({
  config: monitorConfigSchema,
  rules: z.array(ruleInputSchema).max(50).default([]),
});

export const pushMetricSchema = z.object({
  value: z.union([z.number().finite(), z.string().max(2000), z.boolean()]),
  label: z.string().max(100).optional(),
  unit: z.string().max(20).optional(),
});

export const pushPayloadSchema = z.object({
  status: z.enum(['up', 'down']).optional(),
  metrics: z.record(pushMetricSchema).optional(),
  message: z.string().max(2000).optional(),
  timestamp: z.string().datetime().optional(),
});

export const pushTokenRegenerateSchema = z.object({}).default({});

// ---------------------------------------------------------------------------
// Subscription templates & subscriptions
// ---------------------------------------------------------------------------

export const fieldTypeSchema = z.enum(FIELD_TYPE_VALUES);

export const templateFieldSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(50)
    .regex(/^[a-zA-Z_][a-zA-Z0-9_-]*$/, 'Field key must start with a letter or underscore'),
  label: z.string().min(1).max(100),
  type: fieldTypeSchema,
  required: z.boolean().default(false),
  placeholder: z.string().max(200).default(''),
  help: z.string().max(500).default(''),
  options: z
    .array(z.object({ label: z.string().min(1).max(100), value: z.string().min(1).max(200) }))
    .max(100)
    .default([]),
  defaultValue: z.union([z.string().max(2000), z.number(), z.boolean()]).optional(),
});

export const templateInputSchema = z
  .object({
    name: z.string().min(1).max(100),
    description: z.string().max(500).default(''),
    icon: z.string().max(100).default(''),
    color: z.string().max(32).default(''),
    category: z.string().max(50).default(''),
    fields: z.array(templateFieldSchema).max(50).default([]),
    defaultCycle: cycleSchema.default('month'),
    defaultCycleDays: z.number().int().min(1).max(3650).nullable().default(null),
    defaultAmountCents: amountCentsSchema.default(null),
    defaultCurrency: currencySchema.default(DEFAULT_CURRENCY),
    defaultReminderOffsets: reminderOffsetsSchema,
  })
  .superRefine((template, ctx) => {
    const seen = new Set<string>();
    template.fields.forEach((field, index) => {
      if (seen.has(field.key)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['fields', index, 'key'],
          message: `Duplicate field key: ${field.key}`,
        });
      }
      seen.add(field.key);
      if (field.type === 'select' && field.options.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['fields', index, 'options'],
          message: 'Select fields require at least one option',
        });
      }
      if (template.defaultCycle === 'custom_days' && !template.defaultCycleDays) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['defaultCycleDays'],
          message: 'Custom day cycles require defaultCycleDays',
        });
      }
    });
  });

export const templateFieldsValuesSchema = z.record(
  z.union([z.string().max(10_000), z.number(), z.boolean(), z.null()]),
);

export const subscriptionInputSchema = z
  .object({
    name: z.string().min(1).max(100),
    templateId: idSchema.nullable().default(null),
    fields: templateFieldsValuesSchema.default({}),
    startDate: dateOnlySchema,
    expiryDate: dateOnlySchema,
    cycle: cycleSchema.default('month'),
    cycleDays: z.number().int().min(1).max(3650).nullable().default(null),
    amountCents: amountCentsSchema.default(null),
    currency: currencySchema.default(DEFAULT_CURRENCY),
    reminderOffsets: reminderOffsetsSchema,
    channelIds: idListSchema,
    linkedMonitorIds: idListSchema,
    notes: z.string().max(4000).default(''),
    paused: z.boolean().default(false),
    archived: z.boolean().default(false),
  })
  .superRefine((subscription, ctx) => {
    if (subscription.expiryDate <= subscription.startDate) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['expiryDate'],
        message: 'expiryDate must be after startDate',
      });
    }
    if (subscription.cycle === 'custom_days' && !subscription.cycleDays) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['cycleDays'],
        message: 'Custom day cycles require cycleDays',
      });
    }
  });

export const renewalModeSchema = z.enum(['cycle', 'custom']);
export const renewalBaseSchema = z.enum(['expiry', 'today']);

export const renewInputSchema = z
  .object({
    mode: renewalModeSchema.default('cycle'),
    base: renewalBaseSchema.default('expiry'),
    date: dateOnlySchema.optional(),
    amountCents: amountCentsSchema.optional(),
    currency: currencySchema.optional(),
    note: z.string().max(1000).default(''),
    expectedExpiryDate: dateOnlySchema,
  })
  .superRefine((renew, ctx) => {
    if (renew.mode === 'custom' && !renew.date) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['date'],
        message: 'Custom renewal mode requires a date',
      });
    }
  });

// ---------------------------------------------------------------------------
// Notification channels
// ---------------------------------------------------------------------------

export const emailChannelConfigSchema = z.object({
  host: z.string().min(1).max(255),
  port: z.number().int().min(1).max(65535).default(587),
  secure: z.boolean().default(false),
  requireTls: z.boolean().default(false),
  rejectUnauthorized: z.boolean().default(true),
  user: z.string().max(255).default(''),
  password: z.string().max(2000).default(''),
  from: z.string().min(1).max(255),
  fromName: z.string().max(200).default('SubWatch'),
  to: z.array(z.string().min(1).max(255)).min(1).max(50),
});

export const webhookChannelConfigSchema = z.object({
  url: z.string().url().max(2000),
  method: z.enum(['POST', 'PUT', 'PATCH']).default('POST'),
  headers: z.array(headerSchema).max(50).default([]),
  contentType: z.string().max(200).default('application/json'),
  bodyTemplate: z.string().max(100_000).default(''),
  signingSecret: z.string().max(2000).default(''),
  timeoutMs: z.number().int().min(1000).max(60_000).default(10_000),
});

export const channelInputBaseSchema = z.object({
  name: z.string().min(1).max(100),
  enabled: z.boolean().default(true),
});

export const emailChannelInputSchema = channelInputBaseSchema.extend({
  type: z.literal('email'),
  config: emailChannelConfigSchema,
});

export const webhookChannelInputSchema = channelInputBaseSchema.extend({
  type: z.literal('webhook'),
  config: webhookChannelConfigSchema,
});

export const channelInputSchema = z.discriminatedUnion('type', [
  emailChannelInputSchema,
  webhookChannelInputSchema,
]);

export const channelTypeSchema = z.enum(CHANNEL_TYPE_VALUES);

export const channelTestSchema = z.object({
  type: channelTypeSchema,
  config: z.record(z.unknown()),
});

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export const themeSchema = z.enum(THEME_VALUES);

export const generalSettingsSchema = z.object({
  appName: z.string().min(1).max(100).default('SubWatch'),
  locale: localeSchema.default(DEFAULT_LOCALE),
  timezone: z.string().min(1).max(100).default(DEFAULT_TIMEZONE),
  reminderTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected HH:mm')
    .default(DEFAULT_REMINDER_TIME),
  defaultReminderOffsets: reminderOffsetsSchema,
  runRetentionDays: z.number().int().min(1).max(3650).default(30),
  notificationRetentionDays: z.number().int().min(1).max(3650).default(90),
  baseUrl: z
    .string()
    .max(2000)
    .default('')
    .refine((value) => value === '' || /^https?:\/\//.test(value), {
      message: 'baseUrl must be empty or start with http(s)://',
    }),
  defaultChannelIds: idListSchema,
  theme: themeSchema.default('system'),
  currency: currencySchema.default(DEFAULT_CURRENCY),
});

export const generalSettingsPatchSchema = generalSettingsSchema.partial();

export const smtpSettingsPatchSchema = z.object({
  host: z.string().min(1).max(255).optional(),
  port: z.number().int().min(1).max(65535).optional(),
  secure: z.boolean().optional(),
  requireTls: z.boolean().optional(),
  rejectUnauthorized: z.boolean().optional(),
  user: z.string().max(255).optional(),
  password: z.string().max(2000).optional(),
  from: z.string().min(1).max(255).optional(),
  fromName: z.string().max(200).optional(),
  to: z.array(z.string().min(1).max(255)).max(50).optional(),
});

export const settingsUpdateSchema = z.object({
  general: generalSettingsPatchSchema.optional(),
  smtp: smtpSettingsPatchSchema.optional(),
});

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(200, 'Password is too long');

export const loginSchema = z.object({ password: z.string().min(1).max(200) });
export const setupSchema = z.object({ password: passwordSchema });
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: passwordSchema,
});

// ---------------------------------------------------------------------------
// Misc
// ---------------------------------------------------------------------------

export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(50),
  offset: z.coerce.number().int().min(0).max(1_000_000).default(0),
});

export const eventTypeSchema = z.enum(EVENT_TYPES);

export function isSecretKeep(value: unknown): boolean {
  return value === SECRET_KEEP;
}
