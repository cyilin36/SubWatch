import type { ModuleContext } from '../context.js';
import * as repo from './repository.js';
import { executeMonitorRun, markPushStaleDown } from './engine.js';

const TICK_MS = 5_000;
const MAX_CONCURRENT_RUNS = 4;
const STOP_TIMEOUT_MS = 10_000;
const DUE_QUERY_LIMIT = 32;
const HISTORY_PRUNE_INTERVAL_MS = 6 * 3600 * 1000;

/**
 * Periodic monitor scheduler.
 *
 * Every tick it (a) runs HTTP monitors whose `next_run_at` has passed, keeping
 * at most four checks in flight, and (b) flags push monitors that stopped
 * reporting. Timers and in-flight tasks are cleaned up by `stop()`.
 */
export class MonitorScheduler {
  private timer: NodeJS.Timeout | null = null;
  private kickTimer: NodeJS.Timeout | null = null;
  private stopped = true;
  private ticking = false;
  private lastPruneAt = 0;
  private readonly inflight = new Map<string, Promise<void>>();

  constructor(private readonly ctx: ModuleContext) {}

  start(): void {
    if (!this.stopped) return; // idempotent
    this.stopped = false;
    this.timer = setInterval(() => {
      void this.tick();
    }, TICK_MS);
    this.timer.unref?.();
    this.ctx.logger.info('monitor scheduler started');
    // Run overdue monitors (and stale push detection) right away after boot.
    void this.tick();
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.kickTimer) {
      clearTimeout(this.kickTimer);
      this.kickTimer = null;
    }
    const pending = [...this.inflight.values()];
    if (pending.length === 0) return;
    this.ctx.logger.info({ count: pending.length }, 'waiting for running monitor checks to finish');
    let timeout: NodeJS.Timeout | undefined;
    const guard = new Promise<void>((resolve) => {
      timeout = setTimeout(resolve, STOP_TIMEOUT_MS);
      timeout.unref?.();
    });
    try {
      await Promise.race([Promise.allSettled(pending).then(() => undefined), guard]);
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  /** Ask the scheduler to scan for due monitors on the next event-loop turn. */
  kick(): void {
    if (this.stopped || this.kickTimer) return;
    this.kickTimer = setTimeout(() => {
      this.kickTimer = null;
      void this.tick();
    }, 0);
    this.kickTimer.unref?.();
  }

  private async tick(): Promise<void> {
    if (this.stopped || this.ticking) return;
    this.ticking = true;
    try {
      this.pruneHistory();
      this.checkStalePushMonitors();

      const capacity = MAX_CONCURRENT_RUNS - this.inflight.size;
      if (capacity > 0) {
        const dueRows = repo.listDueHttpMonitors(this.ctx, new Date().toISOString(), DUE_QUERY_LIMIT);
        for (const row of dueRows) {
          if (this.stopped) break;
          if (this.inflight.size >= MAX_CONCURRENT_RUNS) break;
          if (this.inflight.has(row.id)) continue;
          this.startRun(row);
        }
      }
    } catch (error) {
      this.ctx.logger.error({ err: error }, 'monitor scheduler tick failed');
    } finally {
      this.ticking = false;
    }
  }

  private startRun(row: repo.MonitorRow): void {
    const task = this.executeOne(row)
      .catch((error) => {
        this.ctx.logger.error({ err: error, monitorId: row.id }, 'scheduled monitor check failed');
      })
      .finally(() => {
        this.inflight.delete(row.id);
      });
    this.inflight.set(row.id, task);
  }

  private async executeOne(row: repo.MonitorRow): Promise<void> {
    // Re-read the row so a concurrent edit (delete/disable) is observed.
    const current = repo.getMonitorRow(this.ctx.db, row.id);
    if (!current || !current.enabled || current.type !== 'http') return;
    const rules = repo.listRuleDtos(this.ctx.db, current.id);
    await executeMonitorRun(this.ctx, current, rules, {
      trigger: 'schedule',
      persist: true,
      scheduleNext: true,
    });
  }

  private checkStalePushMonitors(): void {
    const rows = repo.listEnabledPushMonitors(this.ctx);
    if (rows.length === 0) return;
    const now = Date.now();
    for (const row of rows) {
      const lastSeenRaw = row.last_checked_at ?? row.created_at;
      const lastSeen = Date.parse(lastSeenRaw);
      if (!Number.isFinite(lastSeen)) continue;
      const staleAfterMs = Math.max(60, Number(row.stale_after_seconds) || 3600) * 1000;
      if (now - lastSeen < staleAfterMs) continue;
      try {
        markPushStaleDown(this.ctx, row);
      } catch (error) {
        this.ctx.logger.error({ err: error, monitorId: row.id }, 'failed to mark stale push monitor down');
      }
    }
  }

  private pruneHistory(): void {
    const now = Date.now();
    if (now - this.lastPruneAt < HISTORY_PRUNE_INTERVAL_MS) return;
    this.lastPruneAt = now;
    try {
      const retentionDays = this.ctx.settings.getGeneral().runRetentionDays;
      const removed = repo.pruneRuns(this.ctx, retentionDays);
      if (removed > 0) this.ctx.logger.info({ removed, retentionDays }, 'pruned old monitor runs');
    } catch (error) {
      this.ctx.logger.warn({ err: error }, 'failed to prune monitor run history');
    }
  }

  /** Number of checks currently in flight (used by tests/diagnostics). */
  get runningCount(): number {
    return this.inflight.size;
  }
}
