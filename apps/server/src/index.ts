import { loadConfig } from './config.js';
import { createLogger } from './lib/logger.js';
import { loadSecretKey, SecretBox } from './lib/crypto.js';
import { openDatabase, closeDatabase } from './db/connection.js';
import { SettingsService } from './settings/service.js';
import { buildApp } from './app.js';
import { createNotificationModule } from './notifications/index.js';
import { createMonitorModule } from './monitors/index.js';
import { createSubscriptionModule } from './subscriptions/index.js';
import { acquireDataDirLock } from './lib/lock.js';
import type { AppModules, CoreContext } from './context.js';

async function main(): Promise<void> {
  const config = loadConfig();
  if (!process.env.TZ) process.env.TZ = config.defaultTimezone;
  const logger = createLogger(config.logLevel);
  const releaseLock = acquireDataDirLock(config.dataDir);
  let db: ReturnType<typeof openDatabase> | undefined;
  let app: Awaited<ReturnType<typeof buildApp>> | undefined;
  let modules: AppModules | undefined;

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, 'shutting down SubWatch');
    try {
      if (modules) {
        await modules.monitors.stop();
        await modules.subscriptions.stop();
        await modules.notifications.stop();
      }
      if (app) await app.close();
      if (db) closeDatabase(db);
    } catch (error) {
      logger.error({ err: error }, 'error during shutdown');
    } finally {
      releaseLock();
      process.exit(0);
    }
  };

  try {
    const secretKey = loadSecretKey(config.dataDir, config.secretKey);
    const secretBox = new SecretBox(secretKey);
    db = openDatabase(config.dataDir);
    const settings = new SettingsService(db, secretBox, {
      timezone: config.defaultTimezone,
      baseUrl: config.baseUrl,
    });
    if (settings.ensureInitialPassword(config.adminPassword)) {
      logger.info('admin password initialized from SUBWATCH_ADMIN_PASSWORD');
    }

    const context: CoreContext = { config, db, logger, secretBox, settings };
    const notifications = createNotificationModule(context);
    modules = {
      notifications,
      monitors: createMonitorModule({ ...context, notifications }),
      subscriptions: createSubscriptionModule({ ...context, notifications }),
    };

    app = await buildApp(context, modules);
    modules.notifications.start();
    modules.monitors.start();
    modules.subscriptions.start();

    await app.listen({ port: config.port, host: config.host });
    logger.info(
      {
        url: `http://${config.host === '0.0.0.0' ? 'localhost' : config.host}:${config.port}`,
        dataDir: config.dataDir,
        webDir: config.webDir,
        setupRequired: settings.isSetupRequired(),
      },
      'SubWatch started',
    );

    process.on('SIGINT', () => void shutdown('SIGINT'));
    process.on('SIGTERM', () => void shutdown('SIGTERM'));
  } catch (error) {
    logger.error({ err: error }, 'failed to start SubWatch');
    try {
      if (app) await app.close();
      if (db) closeDatabase(db);
    } catch {
      // ignore cleanup failure
    }
    releaseLock();
    process.exitCode = 1;
  }
}

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection', reason);
});

void main();
