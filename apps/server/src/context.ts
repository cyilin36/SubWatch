import type { FastifyInstance } from 'fastify';
import type { DatabaseSync } from 'node:sqlite';
import type { EmailChannelConfig, NotificationEventType } from '@subwatch/shared';
import type { Config } from './config.js';
import type { SecretBox } from './lib/crypto.js';
import type { Logger } from './lib/logger.js';
import type { SettingsService } from './settings/service.js';

export interface CoreContext {
  config: Config;
  db: DatabaseSync;
  logger: Logger;
  secretBox: SecretBox;
  settings: SettingsService;
}

export type NotificationSeverity = 'info' | 'success' | 'warning' | 'critical';

export interface NotificationPayload {
  title: string;
  message: string;
  severity?: NotificationSeverity;
  data?: Record<string, unknown>;
  appUrl?: string;
}

export interface NotificationEnqueueInput {
  eventType: NotificationEventType;
  /** Stable key used to deduplicate delivery across restarts/retries. */
  eventKey: string;
  /** Entity-selected channel ids. Falls back to global defaults when empty. */
  channelIds: string[];
  payload: NotificationPayload;
  monitorId?: string | null;
  subscriptionId?: string | null;
}

export interface NotificationService {
  enqueue(input: NotificationEnqueueInput): void;
}

export interface NotificationModule extends NotificationService {
  registerRoutes(app: FastifyInstance): void;
  start(): void;
  stop(): Promise<void>;
  testEmail(config: EmailChannelConfig): Promise<{ ok: boolean; error?: string }>;
}

export interface MonitorModule {
  registerRoutes(app: FastifyInstance): void;
  start(): void;
  stop(): Promise<void>;
  /** Nudge the scheduler to look for due monitors immediately. */
  kick(): void;
}

export interface SubscriptionModule {
  registerRoutes(app: FastifyInstance): void;
  start(): void;
  stop(): Promise<void>;
  /** Rebuild pending reminder schedules after timezone/reminder settings change. */
  rescheduleAll(): void;
}

export interface AppModules {
  notifications: NotificationModule;
  monitors: MonitorModule;
  subscriptions: SubscriptionModule;
}

export interface ModuleContext extends CoreContext {
  notifications: NotificationService;
}

export interface AppDependencies {
  context: CoreContext;
  modules: AppModules;
}
