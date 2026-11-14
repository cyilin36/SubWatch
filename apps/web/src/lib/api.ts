import type { z } from 'zod';
import type {
  AppMeta,
  AuthStatusDto,
  ChannelDto,
  ChannelInput,
  EmailChannelConfig,
  MonitorDto,
  MonitorInput,
  MonitorRunDto,
  MonitorTestResult,
  NotificationDto,
  Paginated,
  SettingsDto,
  SubscriptionDto,
  SubscriptionInput,
  ApiErrorBody,
  MonitorConfig,
  MetricValue,
  RuleInput,
  TemplateDto,
  TemplateKind,
  TemplateRenderResultDto,
  TemplateSourceAvailableDto,
  TemplateSourceDetailDto,
  TemplateSourceDto,
  TemplateSourceInput,
  TemplateSourceSyncResultDto,
  TemplateSummaryDto,
} from '@subwatch/shared';
import type {
  changePasswordSchema,
  renewInputSchema,
  settingsUpdateSchema,
  templateExportEnvelopeSchema,
  templateInputSchema,
} from '@subwatch/shared';

export type RenewInput = z.input<typeof renewInputSchema>;
export type SettingsPatch = z.input<typeof settingsUpdateSchema>;
export type ChangePasswordInput = z.input<typeof changePasswordSchema>;
/** Template create/update body; schema defaults fill omitted optional attributes. */
export type TemplateInput = z.input<typeof templateInputSchema>;
/** Shareable template envelope returned by the export endpoint. */
export type TemplateExportEnvelope = z.input<typeof templateExportEnvelopeSchema>;

export interface MonitorTestInput {
  config: MonitorConfig;
  rules: RuleInput[];
}

export interface MonitorMetricsPoint {
  at: string;
  metrics: Record<string, MetricValue>;
}

export interface MonitorMetricsResponse {
  points: MonitorMetricsPoint[];
}

export interface MonitorRunResponse {
  run: MonitorRunDto;
  monitor: MonitorDto;
}

export interface HealthDto {
  ok: boolean;
  version: string;
  uptimeSeconds: number;
}

export interface MonitorMetaDto extends AppMeta {
  setupRequired: boolean;
}

export interface PushTokenResult {
  pushToken: string;
  pushTokenPrefix: string;
}

export type MonitorCreateResult = MonitorDto & { pushToken?: string };

export interface ChannelTestResult {
  ok: boolean;
  error?: string | null;
}

export interface NotificationListParams {
  status?: string;
  eventType?: string;
  limit?: number;
  offset?: number;
}

const BASE = '/api';

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError;
}

function queryString(params: Record<string, string | number | boolean | undefined | null> | undefined): string {
  if (!params) return '';
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }
  const query = search.toString();
  return query ? `?${query}` : '';
}

/**
 * Generic JSON request helper.
 * - always same-origin credentials (session cookie)
 * - adds `X-Requested-With: subwatch` to every non-GET request (CSRF guard)
 * - throws {@link ApiError} with backend code/message/details on failure
 * - broadcasts a global 401 event so the auth provider can redirect to /login
 */
export async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const method = (init.method ?? 'GET').toUpperCase();
  const headers = new Headers(init.headers);
  if (init.body !== undefined && init.body !== null && typeof init.body === 'string' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (method !== 'GET' && method !== 'HEAD') {
    headers.set('X-Requested-With', 'subwatch');
  }

  let response: Response;
  try {
    response = await fetch(`${BASE}${path}`, {
      ...init,
      method,
      headers,
      credentials: 'same-origin',
    });
  } catch {
    throw new ApiError(0, 'network_error', 'Network request failed');
  }

  if (response.status === 401 && !path.startsWith('/auth/')) {
    window.dispatchEvent(new Event('subwatch:unauthorized'));
  }

  const text = await response.text();
  let data: unknown = undefined;
  if (text.length > 0) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!response.ok) {
    const body = data as Partial<ApiErrorBody> | null;
    const error = body && typeof body === 'object' ? body.error : undefined;
    throw new ApiError(
      response.status,
      error?.code ?? `http_${response.status}`,
      error?.message ?? (response.statusText || 'Request failed'),
      error?.details,
    );
  }

  return data as T;
}

function post<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function put<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, { method: 'PUT', body: JSON.stringify(body) });
}

function patch<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
}

function del<T>(path: string): Promise<T> {
  return request<T>(path, { method: 'DELETE' });
}

export const api = {
  meta: () => request<MonitorMetaDto>('/meta'),
  health: () => request<HealthDto>('/health'),

  auth: {
    status: () => request<AuthStatusDto>('/auth/status'),
    setup: (password: string) => post<AuthStatusDto>('/auth/setup', { password }),
    login: (password: string) => post<AuthStatusDto>('/auth/login', { password }),
    logout: () => post<{ ok: boolean }>('/auth/logout'),
    me: () => request<AuthStatusDto>('/auth/me'),
    changePassword: (body: ChangePasswordInput) => post<{ ok: boolean }>('/auth/password', body),
  },

  monitors: {
    list: () => request<MonitorDto[]>('/monitors'),
    get: (id: string) => request<MonitorDto>(`/monitors/${encodeURIComponent(id)}`),
    create: (input: MonitorInput) => post<MonitorCreateResult>('/monitors', input),
    update: (id: string, input: MonitorInput) => put<MonitorDto>(`/monitors/${encodeURIComponent(id)}`, input),
    remove: (id: string) => del<undefined>(`/monitors/${encodeURIComponent(id)}`),
    run: (id: string) => post<MonitorRunResponse>(`/monitors/${encodeURIComponent(id)}/run`),
    test: (input: MonitorTestInput) => post<MonitorTestResult>('/monitors/test', input),
    runs: (id: string, limit = 50, offset = 0) =>
      request<Paginated<MonitorRunDto>>(
        `/monitors/${encodeURIComponent(id)}/runs${queryString({ limit, offset })}`,
      ),
    metrics: (id: string, range: '24h' | '7d' | '30d', metric?: string) =>
      request<MonitorMetricsResponse>(
        `/monitors/${encodeURIComponent(id)}/metrics${queryString({ range, metric })}`,
      ),
    rotatePushToken: (id: string) =>
      post<PushTokenResult>(`/monitors/${encodeURIComponent(id)}/push-token/rotate`),
  },

  subscriptions: {
    list: (search?: string) =>
      request<SubscriptionDto[]>(`/subscriptions${queryString(search ? { search } : undefined)}`),
    get: (id: string) => request<SubscriptionDto>(`/subscriptions/${encodeURIComponent(id)}`),
    create: (input: SubscriptionInput) => post<SubscriptionDto>('/subscriptions', input),
    update: (id: string, input: SubscriptionInput) =>
      put<SubscriptionDto>(`/subscriptions/${encodeURIComponent(id)}`, input),
    remove: (id: string) => del<{ ok: boolean }>(`/subscriptions/${encodeURIComponent(id)}`),
    renew: (id: string, input: RenewInput) =>
      post<SubscriptionDto>(`/subscriptions/${encodeURIComponent(id)}/renew`, input),
    pause: (id: string) => post<SubscriptionDto>(`/subscriptions/${encodeURIComponent(id)}/pause`),
    resume: (id: string) => post<SubscriptionDto>(`/subscriptions/${encodeURIComponent(id)}/resume`),
    testReminder: (id: string) =>
      post<ChannelTestResult>(`/subscriptions/${encodeURIComponent(id)}/test-reminder`),
  },

  templates: {
    list: (kind?: TemplateKind) => request<TemplateSummaryDto[]>(`/templates${queryString({ kind })}`),
    get: (id: string) => request<TemplateDto>(`/templates/${encodeURIComponent(id)}`),
    create: (input: TemplateInput) => post<TemplateDto>('/templates', input),
    update: (id: string, input: TemplateInput) =>
      put<TemplateDto>(`/templates/${encodeURIComponent(id)}`, input),
    remove: (id: string) => del<undefined>(`/templates/${encodeURIComponent(id)}`),
    render: (id: string, values: Record<string, unknown>) =>
      post<TemplateRenderResultDto>(`/templates/${encodeURIComponent(id)}/render`, { values }),
    export: (id: string) =>
      request<TemplateExportEnvelope>(`/templates/${encodeURIComponent(id)}/export`),
    import: (envelope: TemplateExportEnvelope) =>
      post<TemplateDto>('/templates/import', envelope),
  },

  templateSources: {
    list: () => request<TemplateSourceDto[]>('/template-sources'),
    get: (id: string) => request<TemplateSourceDetailDto>(`/template-sources/${encodeURIComponent(id)}`),
    create: (input: TemplateSourceInput) => post<TemplateSourceDto>('/template-sources', input),
    update: (id: string, input: TemplateSourceInput) =>
      put<TemplateSourceDto>(`/template-sources/${encodeURIComponent(id)}`, input),
    remove: (id: string) => del<undefined>(`/template-sources/${encodeURIComponent(id)}`),
    available: (id: string) =>
      request<TemplateSourceAvailableDto>(`/template-sources/${encodeURIComponent(id)}/available`),
    sync: (id: string, paths?: string[]) =>
      post<TemplateSourceSyncResultDto>(
        `/template-sources/${encodeURIComponent(id)}/sync`,
        paths ? { paths } : {},
      ),
    uninstall: (id: string, paths: string[]) =>
      post<{ removed: number }>(`/template-sources/${encodeURIComponent(id)}/uninstall`, { paths }),
  },

  channels: {
    list: () => request<ChannelDto[]>('/channels'),
    create: (input: ChannelInput) => post<ChannelDto>('/channels', input),
    update: (id: string, input: ChannelInput) => put<ChannelDto>(`/channels/${encodeURIComponent(id)}`, input),
    remove: (id: string) => del<{ ok: boolean }>(`/channels/${encodeURIComponent(id)}`),
    test: (id: string) => post<ChannelTestResult>(`/channels/${encodeURIComponent(id)}/test`),
    testConfig: (input: { type: string; config: Record<string, unknown>; id?: string }) =>
      post<ChannelTestResult>('/channels/test', input),
  },

  notifications: {
    list: (params: NotificationListParams = {}) =>
      request<Paginated<NotificationDto>>(`/notifications${queryString(params as Record<string, string | number>)}`),
    retry: (id: string) => post<{ ok: boolean }>(`/notifications/${encodeURIComponent(id)}/retry`),
  },

  settings: {
    get: () => request<SettingsDto>('/settings'),
    patch: (body: SettingsPatch) => patch<SettingsDto>('/settings', body),
    testSmtp: (config?: EmailChannelConfig) =>
      post<ChannelTestResult>('/settings/smtp/test', config ? { config } : {}),
  },
};
