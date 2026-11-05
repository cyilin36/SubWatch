import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import {
  templateInputSchema,
  type TemplateDto,
  type TemplateField,
  type TemplateInput,
} from '@subwatch/shared';
import type { CoreContext } from '../context.js';
import { createRequireAuth } from '../auth/guard.js';
import { all, fromBool, nowIso, one, parseJson, run, toJson, withTransaction } from '../db/helpers.js';
import { BadRequestError, NotFoundError } from '../lib/errors.js';

export interface TemplateRow {
  id: string;
  builtin_key: string | null;
  name: string;
  description: string;
  icon: string;
  color: string;
  category: string;
  fields: string;
  default_cycle: string;
  default_cycle_days: number | null;
  default_amount_cents: number | null;
  default_currency: string;
  default_reminder_offsets: string;
  is_builtin: number;
  created_at: string;
  updated_at: string;
}

export interface BuiltinTemplateDefinition {
  builtinKey: string;
  id: string;
  input: TemplateInput;
}

/**
 * The eight built-in templates. Definitions are re-applied (idempotently) on
 * every boot so definition fixes ship with the code, while custom templates and
 * clones are never touched.
 */
export const BUILTIN_TEMPLATES: readonly BuiltinTemplateDefinition[] = [
  {
    builtinKey: 'vps',
    id: 'tpl_builtin_vps',
    input: templateInputSchema.parse({
      name: '云服务器 / VPS',
      description: '云主机、VPS 的续费日期、登录信息与控制台链接',
      icon: '🖥️',
      color: '#0ea5e9',
      category: 'cloud',
      fields: [
        {
          key: 'provider',
          label: '服务商',
          type: 'text',
          required: true,
          placeholder: '阿里云 / 腾讯云 / Vultr / DigitalOcean',
        },
        { key: 'host', label: 'IP / 主机名', type: 'text', required: true, placeholder: '203.0.113.10' },
        { key: 'region', label: '机房 / 区域', type: 'text', placeholder: '香港 / 东京 / 硅谷' },
        { key: 'os', label: '操作系统', type: 'text', placeholder: 'Ubuntu 24.04' },
        { key: 'spec', label: '配置', type: 'textarea', placeholder: '2 vCPU / 4 GB / 80 GB SSD' },
        { key: 'purchaseDate', label: '购买日期', type: 'date' },
        { key: 'monthlyTrafficGb', label: '月流量 (GB)', type: 'number', placeholder: '1000' },
        { key: 'autoRenew', label: '自动续费', type: 'switch', defaultValue: false },
        { key: 'consoleUrl', label: '控制台链接', type: 'url', placeholder: 'https://console.example.com' },
        { key: 'rootPassword', label: 'root 密码 / 登录密钥', type: 'secret', help: '加密存储，接口只返回掩码' },
      ],
      defaultCycle: 'month',
      defaultAmountCents: 5000,
      defaultCurrency: 'CNY',
      defaultReminderOffsets: [7, 3, 1, 0],
    }),
  },
  {
    builtinKey: 'domain',
    id: 'tpl_builtin_domain',
    input: templateInputSchema.parse({
      name: '域名',
      description: '域名注册、DNS 服务商与转移授权码',
      icon: '🌐',
      color: '#8b5cf6',
      category: 'domain',
      fields: [
        { key: 'domain', label: '域名', type: 'text', required: true, placeholder: 'example.com' },
        {
          key: 'registrar',
          label: '注册商',
          type: 'select',
          options: [
            { label: '阿里云', value: 'aliyun' },
            { label: '腾讯云', value: 'tencent' },
            { label: 'Cloudflare', value: 'cloudflare' },
            { label: 'Namecheap', value: 'namecheap' },
            { label: 'GoDaddy', value: 'godaddy' },
            { label: '其他', value: 'other' },
          ],
          defaultValue: 'aliyun',
        },
        { key: 'dnsProvider', label: 'DNS 服务商', type: 'text', placeholder: 'Cloudflare' },
        { key: 'registrationDate', label: '注册日期', type: 'date' },
        { key: 'autoRenew', label: '自动续费', type: 'switch', defaultValue: false },
        { key: 'transferLock', label: '转移锁', type: 'switch', defaultValue: true },
        { key: 'renewUrl', label: '续费链接', type: 'url', placeholder: 'https://example.com/renew' },
        { key: 'authCode', label: '转移授权码', type: 'secret' },
        { key: 'notes', label: '备注', type: 'textarea' },
      ],
      defaultCycle: 'year',
      defaultAmountCents: 8000,
      defaultCurrency: 'CNY',
      defaultReminderOffsets: [30, 14, 7, 3, 1, 0],
    }),
  },
  {
    builtinKey: 'chatgpt_plus',
    id: 'tpl_builtin_chatgpt_plus',
    input: templateInputSchema.parse({
      name: 'ChatGPT Plus',
      description: 'ChatGPT Plus / Pro 订阅账号与账单信息',
      icon: '🤖',
      color: '#10a37f',
      category: 'ai',
      fields: [
        { key: 'account', label: '账号', type: 'text', required: true, placeholder: '邮箱 / 用户名' },
        {
          key: 'plan',
          label: '套餐',
          type: 'select',
          options: [
            { label: 'Plus', value: 'plus' },
            { label: 'Pro', value: 'pro' },
            { label: 'Team', value: 'team' },
            { label: 'Enterprise', value: 'enterprise' },
          ],
          defaultValue: 'plus',
        },
        { key: 'email', label: '绑定邮箱', type: 'text', placeholder: 'you@example.com' },
        { key: 'password', label: '登录密码', type: 'secret' },
        { key: 'billingUrl', label: '账单管理', type: 'url', defaultValue: 'https://chatgpt.com/' },
        { key: 'autoRenew', label: '自动续费', type: 'switch', defaultValue: true },
        { key: 'notes', label: '备注', type: 'textarea' },
      ],
      defaultCycle: 'month',
      defaultAmountCents: 2000,
      defaultCurrency: 'CNY',
      defaultReminderOffsets: [7, 3, 1, 0],
    }),
  },
  {
    builtinKey: 'claude_pro',
    id: 'tpl_builtin_claude_pro',
    input: templateInputSchema.parse({
      name: 'Claude Pro',
      description: 'Claude Pro / Max 订阅账号与账单信息',
      icon: '🧠',
      color: '#d97757',
      category: 'ai',
      fields: [
        { key: 'account', label: '账号', type: 'text', required: true, placeholder: '邮箱 / 用户名' },
        {
          key: 'plan',
          label: '套餐',
          type: 'select',
          options: [
            { label: 'Pro', value: 'pro' },
            { label: 'Max 5x', value: 'max_5x' },
            { label: 'Max 20x', value: 'max_20x' },
          ],
          defaultValue: 'pro',
        },
        { key: 'email', label: '绑定邮箱', type: 'text', placeholder: 'you@example.com' },
        { key: 'password', label: '登录密码', type: 'secret' },
        { key: 'billingUrl', label: '账单管理', type: 'url', defaultValue: 'https://claude.ai/' },
        { key: 'autoRenew', label: '自动续费', type: 'switch', defaultValue: true },
        { key: 'notes', label: '备注', type: 'textarea' },
      ],
      defaultCycle: 'month',
      defaultAmountCents: 2000,
      defaultCurrency: 'CNY',
      defaultReminderOffsets: [7, 3, 1, 0],
    }),
  },
  {
    builtinKey: 'netflix',
    id: 'tpl_builtin_netflix',
    input: templateInputSchema.parse({
      name: 'Netflix',
      description: 'Netflix 会员套餐、车位与登录信息',
      icon: '🎬',
      color: '#e50914',
      category: 'streaming',
      fields: [
        { key: 'account', label: '账号', type: 'text', required: true, placeholder: '邮箱 / 用户名' },
        {
          key: 'plan',
          label: '套餐',
          type: 'select',
          options: [
            { label: '广告版', value: 'ad' },
            { label: '标准', value: 'standard' },
            { label: '高级', value: 'premium' },
          ],
          defaultValue: 'standard',
        },
        {
          key: 'region',
          label: '地区',
          type: 'select',
          options: [
            { label: '香港', value: 'hk' },
            { label: '台湾', value: 'tw' },
            { label: '美国', value: 'us' },
            { label: '日本', value: 'jp' },
            { label: '新加坡', value: 'sg' },
            { label: '其他', value: 'other' },
          ],
          defaultValue: 'hk',
        },
        { key: 'seats', label: '子账号数', type: 'number', defaultValue: 1 },
        { key: 'password', label: '登录密码', type: 'secret' },
        { key: 'profileUrl', label: '账号链接', type: 'url', placeholder: 'https://www.netflix.com/' },
        { key: 'autoRenew', label: '自动续费', type: 'switch', defaultValue: true },
        { key: 'notes', label: '备注', type: 'textarea' },
      ],
      defaultCycle: 'month',
      defaultAmountCents: 6500,
      defaultCurrency: 'CNY',
      defaultReminderOffsets: [7, 3, 1, 0],
    }),
  },
  {
    builtinKey: 'spotify',
    id: 'tpl_builtin_spotify',
    input: templateInputSchema.parse({
      name: 'Spotify',
      description: 'Spotify 会员套餐与家庭组信息',
      icon: '🎵',
      color: '#1db954',
      category: 'streaming',
      fields: [
        { key: 'account', label: '账号', type: 'text', required: true, placeholder: '邮箱 / 用户名' },
        {
          key: 'plan',
          label: '套餐',
          type: 'select',
          options: [
            { label: 'Free', value: 'free' },
            { label: 'Premium', value: 'premium' },
            { label: 'Duo', value: 'duo' },
            { label: 'Family', value: 'family' },
            { label: 'Student', value: 'student' },
          ],
          defaultValue: 'premium',
        },
        { key: 'region', label: '地区', type: 'text', placeholder: 'HK / US' },
        { key: 'familyMembers', label: '家庭成员数', type: 'number' },
        { key: 'password', label: '登录密码', type: 'secret' },
        { key: 'webUrl', label: '账号链接', type: 'url', placeholder: 'https://open.spotify.com/' },
        { key: 'autoRenew', label: '自动续费', type: 'switch', defaultValue: true },
        { key: 'notes', label: '备注', type: 'textarea' },
      ],
      defaultCycle: 'month',
      defaultAmountCents: 1100,
      defaultCurrency: 'CNY',
      defaultReminderOffsets: [7, 3, 1, 0],
    }),
  },
  {
    builtinKey: 'icloud_plus',
    id: 'tpl_builtin_icloud_plus',
    input: templateInputSchema.parse({
      name: 'iCloud+',
      description: 'Apple iCloud+ 存储方案与 Apple ID 信息',
      icon: '☁️',
      color: '#3b82f6',
      category: 'storage',
      fields: [
        { key: 'account', label: 'Apple ID', type: 'text', required: true, placeholder: 'you@icloud.com' },
        {
          key: 'plan',
          label: '存储方案',
          type: 'select',
          options: [
            { label: '50 GB', value: '50gb' },
            { label: '200 GB', value: '200gb' },
            { label: '2 TB', value: '2tb' },
            { label: '6 TB', value: '6tb' },
            { label: '12 TB', value: '12tb' },
          ],
          defaultValue: '200gb',
        },
        { key: 'storageUsedGb', label: '已用空间 (GB)', type: 'number' },
        { key: 'password', label: 'App 专用密码', type: 'secret' },
        {
          key: 'manageUrl',
          label: '存储管理',
          type: 'url',
          defaultValue: 'https://www.icloud.com/settings/',
        },
        { key: 'autoRenew', label: '自动续费', type: 'switch', defaultValue: true },
        { key: 'notes', label: '备注', type: 'textarea' },
      ],
      defaultCycle: 'month',
      defaultAmountCents: 600,
      defaultCurrency: 'CNY',
      defaultReminderOffsets: [7, 3, 1, 0],
    }),
  },
  {
    builtinKey: 'custom',
    id: 'tpl_builtin_custom',
    input: templateInputSchema.parse({
      name: '自定义',
      description: '从空白开始，字段自由填写',
      icon: '✨',
      color: '#6b7280',
      category: 'other',
      fields: [],
      defaultCycle: 'month',
      defaultAmountCents: null,
      defaultCurrency: 'CNY',
      defaultReminderOffsets: [7, 3, 1, 0],
    }),
  },
];

/** Idempotently upsert built-in template definitions, keyed by `builtin_key`. */
export function seedBuiltinTemplates(ctx: CoreContext): void {
  const now = nowIso();
  withTransaction(ctx.db, () => {
    for (const definition of BUILTIN_TEMPLATES) {
      const existing = one<{ id: string; is_builtin: number }>(
        ctx.db,
        'SELECT id, is_builtin FROM templates WHERE builtin_key = ?',
        [definition.builtinKey],
      );
      if (!existing) {
        run(
          ctx.db,
          `INSERT INTO templates (
             id, builtin_key, name, description, icon, color, category, fields,
             default_cycle, default_cycle_days, default_amount_cents, default_currency,
             default_reminder_offsets, is_builtin, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
          [
            definition.id,
            definition.builtinKey,
            definition.input.name,
            definition.input.description,
            definition.input.icon,
            definition.input.color,
            definition.input.category,
            toJson(definition.input.fields),
            definition.input.defaultCycle,
            definition.input.defaultCycleDays,
            definition.input.defaultAmountCents,
            definition.input.defaultCurrency,
            toJson(definition.input.defaultReminderOffsets),
            now,
            now,
          ],
        );
        continue;
      }
      if (!fromBool(existing.is_builtin)) continue;
      const current = one<TemplateRow>(ctx.db, 'SELECT * FROM templates WHERE id = ?', [existing.id]);
      const next = {
        name: definition.input.name,
        description: definition.input.description,
        icon: definition.input.icon,
        color: definition.input.color,
        category: definition.input.category,
        fields: toJson(definition.input.fields),
        default_cycle: definition.input.defaultCycle,
        default_cycle_days: definition.input.defaultCycleDays,
        default_amount_cents: definition.input.defaultAmountCents,
        default_currency: definition.input.defaultCurrency,
        default_reminder_offsets: toJson(definition.input.defaultReminderOffsets),
      };
      const unchanged =
        current !== undefined &&
        current.name === next.name &&
        current.description === next.description &&
        current.icon === next.icon &&
        current.color === next.color &&
        current.category === next.category &&
        current.fields === next.fields &&
        current.default_cycle === next.default_cycle &&
        current.default_cycle_days === next.default_cycle_days &&
        current.default_amount_cents === next.default_amount_cents &&
        current.default_currency === next.default_currency &&
        current.default_reminder_offsets === next.default_reminder_offsets;
      if (unchanged) continue;
      run(
        ctx.db,
        `UPDATE templates SET
           name = ?, description = ?, icon = ?, color = ?, category = ?, fields = ?,
           default_cycle = ?, default_cycle_days = ?, default_amount_cents = ?, default_currency = ?,
           default_reminder_offsets = ?, is_builtin = 1, updated_at = ?
         WHERE id = ?`,
        [
          next.name,
          next.description,
          next.icon,
          next.color,
          next.category,
          next.fields,
          next.default_cycle,
          next.default_cycle_days,
          next.default_amount_cents,
          next.default_currency,
          next.default_reminder_offsets,
          now,
          existing.id,
        ],
      );
    }
  });
}

export function parseTemplateFields(raw: string | null): TemplateField[] | null {
  if (!raw) return null;
  const parsed = parseJson<TemplateField[]>(raw, []);
  if (!Array.isArray(parsed) || parsed.length === 0) return null;
  return parsed;
}

export function mapTemplateRow(row: TemplateRow): TemplateDto {
  return {
    id: row.id,
    builtinKey: row.builtin_key,
    name: row.name,
    description: row.description,
    icon: row.icon,
    color: row.color,
    category: row.category,
    fields: parseJson<TemplateField[]>(row.fields, []),
    defaultCycle: row.default_cycle as TemplateDto['defaultCycle'],
    defaultCycleDays: row.default_cycle_days,
    defaultAmountCents: row.default_amount_cents,
    defaultCurrency: row.default_currency,
    defaultReminderOffsets: parseJson<number[]>(row.default_reminder_offsets, []),
    isBuiltin: fromBool(row.is_builtin),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function listTemplateRows(db: CoreContext['db']): TemplateRow[] {
  return all<TemplateRow>(
    db,
    'SELECT * FROM templates ORDER BY is_builtin DESC, category ASC, id ASC',
  );
}

export function getTemplateRow(db: CoreContext['db'], id: string): TemplateRow | undefined {
  return one<TemplateRow>(db, 'SELECT * FROM templates WHERE id = ?', [id]);
}

export function requireTemplateRow(db: CoreContext['db'], id: string): TemplateRow {
  const row = getTemplateRow(db, id);
  if (!row) throw new NotFoundError('Template not found');
  return row;
}

function insertTemplate(
  ctx: CoreContext,
  values: {
    id: string;
    builtinKey: string | null;
    input: TemplateInput;
    isBuiltin: boolean;
    createdAt: string;
    updatedAt: string;
  },
): void {
  run(
    ctx.db,
    `INSERT INTO templates (
       id, builtin_key, name, description, icon, color, category, fields,
       default_cycle, default_cycle_days, default_amount_cents, default_currency,
       default_reminder_offsets, is_builtin, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      values.id,
      values.builtinKey,
      values.input.name,
      values.input.description,
      values.input.icon,
      values.input.color,
      values.input.category,
      toJson(values.input.fields),
      values.input.defaultCycle,
      values.input.defaultCycleDays,
      values.input.defaultAmountCents,
      values.input.defaultCurrency,
      toJson(values.input.defaultReminderOffsets),
      values.isBuiltin ? 1 : 0,
      values.createdAt,
      values.updatedAt,
    ],
  );
}

export function registerTemplateRoutes(app: FastifyInstance, ctx: CoreContext): void {
  const requireAuth = createRequireAuth(ctx);

  app.get('/api/templates', { preHandler: requireAuth }, async (): Promise<TemplateDto[]> => {
    return listTemplateRows(ctx.db).map(mapTemplateRow);
  });

  app.get('/api/templates/:id', { preHandler: requireAuth }, async (request): Promise<TemplateDto> => {
    const { id } = request.params as { id: string };
    return mapTemplateRow(requireTemplateRow(ctx.db, id));
  });

  app.post('/api/templates', { preHandler: requireAuth }, async (request, reply): Promise<TemplateDto> => {
    const input = templateInputSchema.parse(request.body ?? {});
    const now = nowIso();
    const id = randomUUID();
    insertTemplate(ctx, { id, builtinKey: null, input, isBuiltin: false, createdAt: now, updatedAt: now });
    reply.code(201);
    return mapTemplateRow(requireTemplateRow(ctx.db, id));
  });

  app.put('/api/templates/:id', { preHandler: requireAuth }, async (request): Promise<TemplateDto> => {
    const { id } = request.params as { id: string };
    const existing = requireTemplateRow(ctx.db, id);
    if (fromBool(existing.is_builtin)) {
      throw new BadRequestError('Built-in templates cannot be modified; clone it first');
    }
    const input = templateInputSchema.parse(request.body ?? {});
    run(
      ctx.db,
      `UPDATE templates SET
         name = ?, description = ?, icon = ?, color = ?, category = ?, fields = ?,
         default_cycle = ?, default_cycle_days = ?, default_amount_cents = ?, default_currency = ?,
         default_reminder_offsets = ?, updated_at = ?
       WHERE id = ?`,
      [
        input.name,
        input.description,
        input.icon,
        input.color,
        input.category,
        toJson(input.fields),
        input.defaultCycle,
        input.defaultCycleDays,
        input.defaultAmountCents,
        input.defaultCurrency,
        toJson(input.defaultReminderOffsets),
        nowIso(),
        id,
      ],
    );
    return mapTemplateRow(requireTemplateRow(ctx.db, id));
  });

  app.delete('/api/templates/:id', { preHandler: requireAuth }, async (request): Promise<{ ok: true }> => {
    const { id } = request.params as { id: string };
    const existing = requireTemplateRow(ctx.db, id);
    if (fromBool(existing.is_builtin)) {
      throw new BadRequestError('Built-in templates cannot be deleted');
    }
    run(ctx.db, 'DELETE FROM templates WHERE id = ?', [id]);
    return { ok: true };
  });

  app.post('/api/templates/:id/clone', { preHandler: requireAuth }, async (request, reply): Promise<TemplateDto> => {
    const { id } = request.params as { id: string };
    const source = requireTemplateRow(ctx.db, id);
    const general = ctx.settings.getGeneral();
    const suffix = general.locale === 'en' ? ' (Copy)' : '（副本）';
    const baseName = source.name.slice(0, Math.max(1, 100 - suffix.length));
    const now = nowIso();
    const cloneId = randomUUID();
    const input = templateInputSchema.parse({
      name: `${baseName}${suffix}`,
      description: source.description,
      icon: source.icon,
      color: source.color,
      category: source.category,
      fields: parseJson<TemplateField[]>(source.fields, []),
      defaultCycle: source.default_cycle,
      defaultCycleDays: source.default_cycle_days,
      defaultAmountCents: source.default_amount_cents,
      defaultCurrency: source.default_currency,
      defaultReminderOffsets: parseJson<number[]>(source.default_reminder_offsets, []),
    });
    insertTemplate(ctx, {
      id: cloneId,
      builtinKey: null,
      input,
      isBuiltin: false,
      createdAt: now,
      updatedAt: now,
    });
    reply.code(201);
    return mapTemplateRow(requireTemplateRow(ctx.db, cloneId));
  });
}
