/**
 * Scheduler Repository
 * Manages background scheduled execution:
 * 1. Morning task creation (default 09:30 in configured timezone).
 * 2. Evening task auto-closure with randomized jitter (default 18:15 - 18:45).
 */

import { SchedulerRepository, SchedulerStatus, AppConfig, ConfigRepository } from '../../domain/ports/repositories.js';
import { addDays, getDayOfWeek, zonedTimeToUtcIso } from '../../domain/value-objects/date-window.js';
import { logger } from '../logging/logger.js';

export class NodeSchedulerRepository implements SchedulerRepository {
  private timer: NodeJS.Timeout | null = null;
  private autoCloseTimer: NodeJS.Timeout | null = null;
  private status: SchedulerStatus;
  private scheduleFn: (() => Promise<void>) | null = null;
  private autoCloseFn: (() => Promise<void>) | null = null;
  private timezoneOverride?: string;
  private startTimeOverride?: string;
  private autoStartOverride?: boolean;
  private autoCloseEnabledOverride?: boolean;
  private autoCloseStartTimeOverride?: string;
  private autoCloseEndTimeOverride?: string;
  private isExecuting = false;
  private isAutoCloseExecuting = false;

  constructor(
    private readonly config: Pick<
      AppConfig,
      | 'timezone'
      | 'startTime'
      | 'scheduleTime'
      | 'schedulerEnabled'
      | 'schedulerAutoStart'
      | 'autoClose'
      | 'autoCloseStartTime'
      | 'autoCloseEndTime'
      | 'lastAutoClose'
    > = {
      timezone: 'Asia/Kolkata',
      startTime: '09:30',
      scheduleTime: '09:30',
      schedulerEnabled: false,
      schedulerAutoStart: false,
      autoClose: true,
      autoCloseStartTime: '18:15',
      autoCloseEndTime: '18:45',
    },
    private readonly configRepo?: ConfigRepository
  ) {
    this.status = {
      running: false,
      timezone: config.timezone,
      startTime: config.scheduleTime || config.startTime || '09:30',
      autoStart: Boolean(config.schedulerAutoStart ?? config.schedulerEnabled),
      autoCloseEnabled: config.autoClose !== false,
      lastAutoClose: config.lastAutoClose,
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

  /** Auto-close enabled setting */
  private get autoCloseEnabled(): boolean {
    return this.autoCloseEnabledOverride ?? (this.config.autoClose !== false);
  }

  private get autoCloseStartTime(): string {
    return this.autoCloseStartTimeOverride ?? this.config.autoCloseStartTime ?? '18:15';
  }

  private get autoCloseEndTime(): string {
    return this.autoCloseEndTimeOverride ?? this.config.autoCloseEndTime ?? '18:45';
  }

  getStatus(): SchedulerStatus {
    return {
      ...this.status,
      timezone: this.timezone,
      startTime: this.startTime,
      autoStart: this.autoStart,
      autoCloseEnabled: this.autoCloseEnabled,
      autoCloseStartTime: this.autoCloseStartTime,
      autoCloseEndTime: this.autoCloseEndTime,
    };
  }

  async start(persist: boolean = false): Promise<void> {
    if (this.timer || this.autoCloseTimer) return; // Already running

    this.status.running = true;
    this.scheduleDaily();
    if (this.autoCloseEnabled) {
      this.scheduleAutoCloseDaily();
    }
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
    if (this.autoCloseTimer) {
      clearTimeout(this.autoCloseTimer);
      this.autoCloseTimer = null;
    }
    this.status.running = false;
    this.status.nextRun = undefined;
    this.status.nextAutoClose = undefined;
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

  async configure(options: {
    startTime?: string;
    timezone?: string;
    autoStart?: boolean;
    autoClose?: boolean;
    autoCloseStartTime?: string;
    autoCloseEndTime?: string;
  }): Promise<void> {
    if (options.timezone) this.timezoneOverride = options.timezone;
    if (options.startTime) this.startTimeOverride = options.startTime;
    if (options.autoStart !== undefined) this.autoStartOverride = options.autoStart;
    if (options.autoClose !== undefined) this.autoCloseEnabledOverride = options.autoClose;
    if (options.autoCloseStartTime) this.autoCloseStartTimeOverride = options.autoCloseStartTime;
    if (options.autoCloseEndTime) this.autoCloseEndTimeOverride = options.autoCloseEndTime;

    this.status.startTime = this.startTime;
    this.status.timezone = this.timezone;
    this.status.autoStart = this.autoStart;
    this.status.autoCloseEnabled = this.autoCloseEnabled;

    if (this.configRepo) {
      try {
        await this.configRepo.saveSettings({
          scheduleTime: this.startTime,
          timezone: this.timezone,
          schedulerAutoStart: this.autoStart,
          autoClose: this.autoCloseEnabled,
          autoCloseStartTime: this.autoCloseStartTime,
          autoCloseEndTime: this.autoCloseEndTime,
        });
      } catch (err: any) {
        logger.warn(`Failed to persist scheduler configuration: ${err.message}`);
      }
    }

    this.restartIfRunning();
    logger.info(
      `Scheduler reconfigured: run time = ${this.startTime}, timezone = ${this.timezone}, autoStart = ${this.autoStart}, autoClose = ${this.autoCloseEnabled} (${this.autoCloseStartTime}-${this.autoCloseEndTime})`
    );
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

  async triggerAutoCloseNow(): Promise<{ success: boolean; message: string }> {
    if (this.isAutoCloseExecuting) {
      return { success: false, message: 'Auto-close execution is already in progress.' };
    }
    if (!this.autoCloseFn) {
      return { success: false, message: 'No auto-close function registered.' };
    }

    logger.info('Manual auto-close trigger requested.');
    void this.runAutoCloseScheduled();
    return { success: true, message: 'EOD task closure triggered immediately.' };
  }

  setScheduleFunction(fn: () => Promise<void>): void {
    this.scheduleFn = fn;
  }

  setAutoCloseFunction(fn: () => Promise<void>): void {
    this.autoCloseFn = fn;
  }

  private restartIfRunning(): void {
    if (this.status.running) {
      if (this.timer) {
        clearTimeout(this.timer);
        this.timer = null;
      }
      if (this.autoCloseTimer) {
        clearTimeout(this.autoCloseTimer);
        this.autoCloseTimer = null;
      }
      this.scheduleDaily();
      if (this.autoCloseEnabled) {
        this.scheduleAutoCloseDaily();
      }
      logger.info(`Scheduler rescheduled. Next run: ${this.status.nextRun} (${this.timezone} @ ${this.startTime}).`);
    }
  }

  private scheduleDaily(): void {
    const now = new Date();
    const target = this.getNextRunTime(now, this.startTime);
    this.status.nextRun = target.toISOString();
    const delay = Math.max(0, target.getTime() - now.getTime());

    this.timer = setTimeout(() => {
      this.timer = null;
      void this.runScheduled().finally(() => {
        if (this.status.running) this.scheduleDaily();
      });
    }, delay);
  }

  private scheduleAutoCloseDaily(): void {
    const now = new Date();
    const { target, timeStr } = this.getNextAutoCloseTarget(now);
    this.status.nextAutoClose = target.toISOString();
    const delay = Math.max(0, target.getTime() - now.getTime());

    logger.info(`Scheduler: Next EOD task auto-close scheduled for ${this.status.nextAutoClose} (${this.timezone} randomized @ ${timeStr}).`);

    this.autoCloseTimer = setTimeout(() => {
      this.autoCloseTimer = null;
      void this.runAutoCloseScheduled().finally(() => {
        if (this.status.running && this.autoCloseEnabled) {
          this.scheduleAutoCloseDaily();
        }
      });
    }, delay);
  }

  /**
   * Calculates the next auto-close instant.
   * If the server boots/restarts in the middle of the active window on a weekday,
   * schedules within the remaining window rather than skipping to tomorrow.
   */
  private getNextAutoCloseTarget(from: Date): { target: Date; timeStr: string } {
    const tz = this.timezone;
    const nowLocalDateIso = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(from);

    const nowLocalTimeParts = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(from).split(':').map(n => parseInt(n, 10) || 0);

    const nowSeconds = nowLocalTimeParts[0] * 3600 + nowLocalTimeParts[1] * 60 + nowLocalTimeParts[2];
    const [startH, startM] = this.autoCloseStartTime.split(':').map(n => parseInt(n, 10) || 0);
    const [endH, endM] = this.autoCloseEndTime.split(':').map(n => parseInt(n, 10) || 0);
    const startSeconds = startH * 3600 + startM * 60;
    const endSeconds = endH * 3600 + endM * 60;

    const dow = getDayOfWeek(nowLocalDateIso);
    const isWeekend = dow === 0 || dow === 6;

    const lastRunToday = this.status.lastAutoClose
      ? new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(this.status.lastAutoClose)) === nowLocalDateIso
      : false;

    // 1. If it is a weekday and today's auto-close has NOT run yet:
    if (!isWeekend && !lastRunToday) {
      // 1a. If currently inside the active window (e.g. 18:15 - 18:45):
      // schedule within the remaining window minutes today
      if (nowSeconds >= startSeconds && nowSeconds < endSeconds) {
        const minSeconds = nowSeconds + 5;
        const diff = Math.max(0, endSeconds - minSeconds);
        const randomOffset = Math.floor(Math.random() * (diff + 1));
        const targetSeconds = minSeconds + randomOffset;
        const h = Math.floor(targetSeconds / 3600);
        const m = Math.floor((targetSeconds % 3600) / 60);
        const s = targetSeconds % 60;
        const timeStr = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        const target = new Date(zonedTimeToUtcIso(nowLocalDateIso, timeStr, tz));
        return { target, timeStr };
      }

      // 1b. If after the active window today (e.g. after 18:45):
      // DO NOT DEFER TODAY'S TASKS TO TOMORROW! Execute closure for today's tasks immediately.
      if (nowSeconds >= endSeconds) {
        const target = new Date(from.getTime() + 5000); // Trigger in 5s
        const timeStr = 'Immediate (Catching up today)';
        logger.info(`Scheduler: Today's auto-close window (${this.autoCloseStartTime}-${this.autoCloseEndTime}) has passed but tasks were not closed yet today. Triggering immediate closure for today...`);
        return { target, timeStr };
      }

      // 1c. If before the active window today (e.g. morning/afternoon before 18:15):
      // Schedule for today's randomized window
      const timeStr = this.computeRandomizedTime(this.autoCloseStartTime, this.autoCloseEndTime);
      const target = new Date(zonedTimeToUtcIso(nowLocalDateIso, timeStr, tz));
      return { target, timeStr };
    }

    // 2. If already run today OR it's a weekend:
    // Schedule for the next weekday's window
    const timeStr = this.computeRandomizedTime(this.autoCloseStartTime, this.autoCloseEndTime);
    const target = this.getNextRunTime(from, timeStr);
    return { target, timeStr };
  }

  /**
   * Computes a randomized HH:mm:ss wall-clock time between start (e.g. 18:15) and end (e.g. 18:45)
   */
  private computeRandomizedTime(startHhmm: string, endHhmm: string): string {
    const [startH, startM] = startHhmm.split(':').map(n => parseInt(n, 10) || 0);
    const [endH, endM] = endHhmm.split(':').map(n => parseInt(n, 10) || 0);

    const startSeconds = startH * 3600 + startM * 60;
    const endSeconds = endH * 3600 + endM * 60;
    const diff = Math.max(0, endSeconds - startSeconds);

    const randomOffset = Math.floor(Math.random() * (diff + 1));
    const targetSeconds = startSeconds + randomOffset;

    const h = Math.floor(targetSeconds / 3600);
    const m = Math.floor((targetSeconds % 3600) / 60);
    const s = targetSeconds % 60;

    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  /**
   * Next weekday wall-clock instant in the configured timezone.
   */
  private getNextRunTime(from: Date, timeStr: string): Date {
    const tz = this.timezone;
    let dateIso = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(from);

    for (let i = 0; i < 8; i++) {
      const target = new Date(zonedTimeToUtcIso(dateIso, timeStr, tz));
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

  private async runAutoCloseScheduled(): Promise<void> {
    if (!this.autoCloseFn) {
      logger.warn('Scheduler: no auto-close function configured');
      return;
    }
    if (this.isAutoCloseExecuting) {
      logger.warn('Scheduler: auto-close already in progress, skipping parallel execution');
      return;
    }

    this.isAutoCloseExecuting = true;
    logger.info(`Scheduler: running automated EOD task closure (window: ${this.autoCloseStartTime}-${this.autoCloseEndTime}, tz: ${this.timezone})...`);
    try {
      await this.autoCloseFn();
      this.status.lastAutoClose = new Date().toISOString();
      this.status.lastAutoCloseResult = 'success';
      if (this.configRepo) {
        try {
          await this.configRepo.saveSettings({
            lastAutoClose: this.status.lastAutoClose,
          });
        } catch (err: any) {
          logger.warn(`Failed to persist lastAutoClose: ${err.message}`);
        }
      }
      logger.success('Scheduler: EOD task auto-close completed successfully.');
    } catch (error: any) {
      this.status.lastAutoClose = new Date().toISOString();
      this.status.lastAutoCloseResult = 'failure';
      logger.error(`Scheduler: EOD task auto-close failed: ${error?.message || error}`);
    } finally {
      this.isAutoCloseExecuting = false;
    }
  }
}
