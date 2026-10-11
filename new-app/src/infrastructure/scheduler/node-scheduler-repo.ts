/**
 * Scheduler Repository
 * Manages background scheduled execution at 09:30 in the configured timezone.
 */

import { SchedulerRepository, SchedulerStatus, AppConfig, ConfigRepository } from '../../domain/ports/repositories.js';
import { addDays, getDayOfWeek, zonedTimeToUtcIso } from '../../domain/value-objects/date-window.js';
import { logger } from '../logging/logger.js';

export class NodeSchedulerRepository implements SchedulerRepository {
  private timer: NodeJS.Timeout | null = null;
  private status: SchedulerStatus;
  private scheduleFn: (() => Promise<void>) | null = null;
  private timezoneOverride?: string;
  private startTimeOverride?: string;
  private autoStartOverride?: boolean;
  private isExecuting = false;

  constructor(
    private readonly config: Pick<AppConfig, 'timezone' | 'startTime' | 'scheduleTime' | 'schedulerEnabled' | 'schedulerAutoStart'> = {
      timezone: 'Asia/Kolkata',
      startTime: '09:30',
      scheduleTime: '09:30',
      schedulerEnabled: false,
      schedulerAutoStart: false,
    },
    private readonly configRepo?: ConfigRepository
  ) {
    this.status = {
      running: false,
      timezone: config.timezone,
      startTime: config.scheduleTime || config.startTime || '09:30',
      autoStart: Boolean(config.schedulerAutoStart ?? config.schedulerEnabled),
    };
  }

  /** Live timezone: an explicit configure/setSchedule call wins over the current config. */
  private get timezone(): string {
    return this.timezoneOverride ?? this.config.timezone ?? 'Asia/Kolkata';
  }

  /** Live start time: configured run time (HH:mm) */
  private get startTime(): string {
    return this.startTimeOverride ?? this.config.scheduleTime ?? this.config.startTime ?? '09:30';
  }

  /** Auto-start on boot setting */
  private get autoStart(): boolean {
    return this.autoStartOverride ?? Boolean(this.config.schedulerAutoStart ?? this.config.schedulerEnabled);
  }

  getStatus(): SchedulerStatus {
    return {
      ...this.status,
      timezone: this.timezone,
      startTime: this.startTime,
      autoStart: this.autoStart,
    };
  }

  async start(persist: boolean = false): Promise<void> {
    if (this.timer) return; // Already running

    this.status.running = true;
    this.scheduleDaily();
    logger.info(`Scheduler started. Next run: ${this.status.nextRun} (${this.timezone} @ ${this.startTime}).`);

    if (persist && this.configRepo) {
      try {
        await this.configRepo.saveSettings({
          schedulerEnabled: true,
          scheduleTime: this.startTime,
        });
      } catch (err: any) {
        logger.warn(`Failed to persist scheduler start setting: ${err.message}`);
      }
    }
  }

  async stop(persist: boolean = false): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.status.running = false;
    this.status.nextRun = undefined;
    logger.info('Scheduler stopped.');

    if (persist && this.configRepo) {
      try {
        await this.configRepo.saveSettings({
          schedulerEnabled: false,
        });
      } catch (err: any) {
        logger.warn(`Failed to persist scheduler stop setting: ${err.message}`);
      }
    }
  }

  setSchedule(_cron: string, timezone: string): void {
    this.timezoneOverride = timezone;
    this.restartIfRunning();
  }

  async configure(options: { startTime?: string; timezone?: string; autoStart?: boolean }): Promise<void> {
    if (options.timezone) this.timezoneOverride = options.timezone;
    if (options.startTime) this.startTimeOverride = options.startTime;
    if (options.autoStart !== undefined) this.autoStartOverride = options.autoStart;

    this.status.startTime = this.startTime;
    this.status.timezone = this.timezone;
    this.status.autoStart = this.autoStart;

    if (this.configRepo) {
      try {
        await this.configRepo.saveSettings({
          scheduleTime: this.startTime,
          timezone: this.timezone,
          schedulerAutoStart: this.autoStart,
        });
      } catch (err: any) {
        logger.warn(`Failed to persist scheduler configuration: ${err.message}`);
      }
    }

    this.restartIfRunning();
    logger.info(`Scheduler reconfigured: run time = ${this.startTime}, timezone = ${this.timezone}, autoStart = ${this.autoStart}`);
  }

  async triggerRunNow(): Promise<{ success: boolean; message: string }> {
    if (this.isExecuting) {
      return { success: false, message: 'Scheduler execution is already in progress.' };
    }
    if (!this.scheduleFn) {
      return { success: false, message: 'No schedule function registered.' };
    }

    logger.info('Manual scheduler trigger requested.');
    void this.runScheduled();
    return { success: true, message: 'Scheduled task creation triggered immediately.' };
  }

  setScheduleFunction(fn: () => Promise<void>): void {
    this.scheduleFn = fn;
  }

  private restartIfRunning(): void {
    if (this.status.running) {
      if (this.timer) {
        clearTimeout(this.timer);
        this.timer = null;
      }
      this.scheduleDaily();
      logger.info(`Scheduler rescheduled. Next run: ${this.status.nextRun} (${this.timezone} @ ${this.startTime}).`);
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
   * Next weekday wall-clock instant in the configured timezone.
   */
  private getNextRunTime(from: Date): Date {
    const tz = this.timezone;
    const time = this.startTime;
    let dateIso = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(from);

    for (let i = 0; i < 8; i++) {
      const target = new Date(zonedTimeToUtcIso(dateIso, time, tz));
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
    if (this.isExecuting) {
      logger.warn('Scheduler: already running, skipping parallel execution');
      return;
    }

    this.isExecuting = true;
    logger.info(`Scheduler: running scheduled task creation (time: ${this.startTime}, tz: ${this.timezone})...`);
    try {
      await this.scheduleFn();
      this.status.lastRun = new Date().toISOString();
      this.status.lastRunResult = 'success';
      logger.success('Scheduler: run completed successfully.');
    } catch (error: any) {
      this.status.lastRun = new Date().toISOString();
      this.status.lastRunResult = 'failure';
      logger.error(`Scheduler run failed: ${error?.message || error}`);
    } finally {
      this.isExecuting = false;
    }
  }
}

