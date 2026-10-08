/**
 * Scheduler Repository
 * Manages background scheduled execution at 09:30 in the configured timezone.
 */

import { SchedulerRepository, SchedulerStatus } from '../../domain/ports/repositories.js';
import { addDays, getDayOfWeek, zonedTimeToUtcIso } from '../../domain/value-objects/date-window.js';
import { logger } from '../logging/logger.js';

export class NodeSchedulerRepository implements SchedulerRepository {
  private timer: NodeJS.Timeout | null = null;
  private status: SchedulerStatus;
  private scheduleFn: (() => Promise<void>) | null = null;
  private readonly runTime: string;

  constructor(
    private readonly defaultTimezone: string = 'Asia/Kolkata',
    runTime: string = '09:30'
  ) {
    this.runTime = runTime;
    this.status = { running: false, timezone: defaultTimezone };
  }

  getStatus(): SchedulerStatus {
    return { ...this.status };
  }

  start(): void {
    if (this.timer) return; // Already running

    this.status.running = true;
    this.scheduleDaily();
    logger.info(`Scheduler started. Next run: ${this.status.nextRun} (${this.status.timezone}).`);
  }

  stop(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.status.running = false;
    logger.info('Scheduler stopped.');
  }

  setSchedule(cron: string, timezone: string): void {
    // ponytail: fixed 09:30 daily schedule; parse cron only if multiple schedules are ever needed.
    this.status.timezone = timezone;
    this.restartIfRunning();
  }

  setScheduleFunction(fn: () => Promise<void>): void {
    this.scheduleFn = fn;
  }

  private restartIfRunning(): void {
    if (this.status.running) {
      this.stop();
      this.start();
    }
  }

  private scheduleDaily(): void {
    const now = new Date();
    const target = this.getNextRunTime(now);
    this.status.nextRun = target.toISOString();
    const delay = Math.max(0, target.getTime() - now.getTime());

    this.timer = setTimeout(() => {
      this.timer = null;
      void this.runScheduled().finally(() => {
        if (this.status.running) this.scheduleDaily();
      });
    }, delay);
  }

  /**
   * Next weekday 09:30 wall-clock instant in the configured timezone.
   */
  private getNextRunTime(from: Date): Date {
    const tz = this.status.timezone;
    let dateIso = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(from);

    for (let i = 0; i < 8; i++) {
      const target = new Date(zonedTimeToUtcIso(dateIso, this.runTime, tz));
      const dow = getDayOfWeek(dateIso); // 0=Sun, 6=Sat
      const isWeekend = dow === 0 || dow === 6;
      if (target.getTime() > from.getTime() && !isWeekend) return target;
      dateIso = addDays(dateIso, 1);
    }
    // Safety fallback: one day ahead at the same instant.
    return new Date(from.getTime() + 24 * 60 * 60 * 1000);
  }

  private async runScheduled(): Promise<void> {
    if (!this.scheduleFn) {
      logger.warn('Scheduler: no schedule function configured');
      return;
    }

    logger.info('Scheduler: running scheduled task creation...');
    try {
      await this.scheduleFn();
      this.status.lastRun = new Date().toISOString();
      this.status.lastRunResult = 'success';
      logger.success('Scheduler: run completed successfully.');
    } catch (error: any) {
      this.status.lastRun = new Date().toISOString();
      this.status.lastRunResult = 'failure';
      logger.error(`Scheduler run failed: ${error?.message || error}`);
    }
  }
}
