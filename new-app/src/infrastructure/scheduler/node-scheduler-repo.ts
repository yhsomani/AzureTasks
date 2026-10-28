/**
 * Scheduler Repository
 * Manages background scheduled execution:
 * 1. Morning task creation (default 09:30 in configured timezone).
 * 2. Evening task auto-closure with randomized jitter (default 18:15 - 18:45).
 */

import { SchedulerRepository, SchedulerStatus, AppConfig, ConfigRepository } from '../../domain/ports/repositories.js';
import { addDays, getDayOfWeek, zonedTimeToUtcIso } from '../../domain/value-objects/date-window.js';
import { logger } from '../logging/logger.js';

export type SchedulerConfig = Pick<AppConfig, 'timezone' | 'startTime'> &
  Partial<
    Pick<
      AppConfig,
      | 'scheduleTime'
      | 'schedulerEnabled'
      | 'schedulerAutoStart'
      | 'autoClose'
      | 'autoCloseStartTime'
      | 'autoCloseEndTime'
      | 'lastAutoClose'
      | 'autoActive'
      | 'autoActiveTime'
      | 'lastAutoActive'
    >
  >;

export class NodeSchedulerRepository implements SchedulerRepository {
  private timer: NodeJS.Timeout | null = null;
  private autoCloseTimer: NodeJS.Timeout | null = null;
  private autoActiveTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private status: SchedulerStatus;
  private scheduleFn: (() => Promise<void>) | null = null;
  private autoCloseFn: (() => Promise<any>) | null = null;
  private autoActiveFn: (() => Promise<any>) | null = null;
  private timezoneOverride?: string;
  private startTimeOverride?: string;
  private autoStartOverride?: boolean;
  private autoCloseEnabledOverride?: boolean;
  private autoCloseStartTimeOverride?: string;
  private autoCloseEndTimeOverride?: string;
  private autoActiveEnabledOverride?: boolean;
  private autoActiveTimeOverride?: string;
  private isExecuting = false;
  private isAutoCloseExecuting = false;
  private isAutoActiveExecuting = false;

  constructor(
    private readonly config: SchedulerConfig = {
      timezone: 'Asia/Kolkata',
      startTime: '09:30',
      scheduleTime: '09:30',
      schedulerEnabled: false,
      schedulerAutoStart: false,
      autoClose: false,
      autoCloseStartTime: '18:15',
      autoCloseEndTime: '18:45',
      autoActive: true,
      autoActiveTime: '17:30',
    },
    private readonly configRepo?: ConfigRepository
  ) {
    this.status = {
      running: false,
      timezone: config.timezone,
      startTime: config.scheduleTime || config.startTime || '09:30',
      autoStart: Boolean(config.schedulerAutoStart ?? config.schedulerEnabled),
      autoCloseEnabled: config.autoClose === true,
      autoCloseStartTime: config.autoCloseStartTime || '18:15',
      autoCloseEndTime: config.autoCloseEndTime || '18:45',
      lastAutoClose: config.lastAutoClose,
      autoActiveEnabled: config.autoActive !== false,
      autoActiveTime: config.autoActiveTime || '17:30',
      lastAutoActive: config.lastAutoActive,
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
    return this.autoCloseEnabledOverride ?? (this.config.autoClose === true);
  }

  private get autoCloseStartTime(): string {
    return this.autoCloseStartTimeOverride ?? this.config.autoCloseStartTime ?? '18:15';
  }

  private get autoCloseEndTime(): string {
    return this.autoCloseEndTimeOverride ?? this.config.autoCloseEndTime ?? '18:45';
  }

  private get autoActiveEnabled(): boolean {
    return this.autoActiveEnabledOverride ?? (this.config.autoActive !== false);
  }

  private get autoActiveTime(): string {
    return this.autoActiveTimeOverride ?? this.config.autoActiveTime ?? '17:30';
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
      autoActiveEnabled: this.autoActiveEnabled,
      autoActiveTime: this.autoActiveTime,
    };
  }

  async start(persist: boolean = false): Promise<void> {
    if (this.timer || this.autoCloseTimer || this.autoActiveTimer) return;

    // Durable settings must succeed before any unattended timers run.
    if (persist && this.configRepo) {
      await this.configRepo.saveSettings({ schedulerEnabled: true, scheduleTime: this.startTime });
    }
    this.status.running = true;
    this.scheduleDaily();
    if (this.autoActiveEnabled) this.scheduleAutoActiveDaily();
    if (this.autoCloseEnabled) this.scheduleAutoCloseDaily();
    this.startHeartbeat();
    logger.info(`Scheduler started. Next run: ${this.status.nextRun} (${this.timezone} @ ${this.startTime}). Next auto-active: ${this.status.nextAutoActive || 'none'}. Next auto-close: ${this.status.nextAutoClose || 'none'}.`);
  }

  async stop(persist: boolean = false): Promise<void> {
    // Do not claim to have disabled a persisted scheduler while it may start
    // again after restart because the settings update failed.
    if (persist && this.configRepo) {
      await this.configRepo.saveSettings({ schedulerEnabled: false });
    }
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (this.autoCloseTimer) { clearTimeout(this.autoCloseTimer); this.autoCloseTimer = null; }
    if (this.autoActiveTimer) { clearTimeout(this.autoActiveTimer); this.autoActiveTimer = null; }
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
    this.status.running = false;
    this.status.nextRun = undefined;
    this.status.nextAutoClose = undefined;
    this.status.nextAutoActive = undefined;
    logger.info('Scheduler stopped.');
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
    autoActive?: boolean;
    autoActiveTime?: string;
  }): Promise<void> {
    const validTime = (value: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
    for (const key of ['startTime', 'autoCloseStartTime', 'autoCloseEndTime', 'autoActiveTime'] as const) {
      if (options[key] !== undefined && !validTime(options[key]!)) {
        throw new Error(`Invalid scheduler ${key}; use HH:mm (24-hour).`);
      }
    }
    if (options.timezone !== undefined) {
      try { new Intl.DateTimeFormat('en-US', { timeZone: options.timezone }); }
      catch { throw new Error('Invalid scheduler IANA timezone.'); }
    }

    const next = {
      scheduleTime: options.startTime ?? this.startTime,
      timezone: options.timezone ?? this.timezone,
      schedulerAutoStart: options.autoStart ?? this.autoStart,
      autoClose: options.autoClose ?? this.autoCloseEnabled,
      autoCloseStartTime: options.autoCloseStartTime ?? this.autoCloseStartTime,
      autoCloseEndTime: options.autoCloseEndTime ?? this.autoCloseEndTime,
      autoActive: options.autoActive ?? this.autoActiveEnabled,
      autoActiveTime: options.autoActiveTime ?? this.autoActiveTime,
    };
    if (this.configRepo) await this.configRepo.saveSettings(next);

    if (options.timezone !== undefined) this.timezoneOverride = options.timezone;
    if (options.startTime !== undefined) this.startTimeOverride = options.startTime;
    if (options.autoStart !== undefined) this.autoStartOverride = options.autoStart;
    if (options.autoClose !== undefined) this.autoCloseEnabledOverride = options.autoClose;
    if (options.autoCloseStartTime !== undefined) this.autoCloseStartTimeOverride = options.autoCloseStartTime;
    if (options.autoCloseEndTime !== undefined) this.autoCloseEndTimeOverride = options.autoCloseEndTime;
    if (options.autoActive !== undefined) this.autoActiveEnabledOverride = options.autoActive;
    if (options.autoActiveTime !== undefined) this.autoActiveTimeOverride = options.autoActiveTime;

    this.status.startTime = this.startTime;
    this.status.timezone = this.timezone;
    this.status.autoStart = this.autoStart;
    this.status.autoCloseEnabled = this.autoCloseEnabled;
    this.status.autoActiveEnabled = this.autoActiveEnabled;
    this.status.autoActiveTime = this.autoActiveTime;

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
    return { success: true, message: 'Scheduled task creation queued. Check scheduler status and logs for the outcome.' };
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
    return { success: true, message: 'EOD closure queued. Check scheduler status and logs for the outcome.' };
  }

  async triggerAutoActiveNow(): Promise<{ success: boolean; message: string }> {
    if (this.isAutoActiveExecuting) {
      return { success: false, message: 'Auto-active execution is already in progress.' };
    }
    if (!this.autoActiveFn) {
      return { success: false, message: 'No auto-active function registered.' };
    }

    logger.info('Manual auto-active trigger requested.');
    void this.runAutoActiveScheduled();
    return { success: true, message: 'Task activation queued. Check scheduler status and logs for the outcome.' };
  }

  setScheduleFunction(fn: () => Promise<void>): void {
    this.scheduleFn = fn;
  }

  setAutoCloseFunction(fn: () => Promise<any>): void {
    this.autoCloseFn = fn;
  }

  setAutoActiveFunction(fn: () => Promise<any>): void {
    this.autoActiveFn = fn;
  }

  private restartIfRunning(): void {
    if (this.status.running) {
      if (this.timer) {
        clearTimeout(this.timer);
        this.timer = null;
      }
      if (this.autoActiveTimer) {
        clearTimeout(this.autoActiveTimer);
        this.autoActiveTimer = null;
      }
      if (this.autoCloseTimer) {
        clearTimeout(this.autoCloseTimer);
        this.autoCloseTimer = null;
      }
      this.scheduleDaily();
      if (this.autoActiveEnabled) {
        this.scheduleAutoActiveDaily();
      }
      if (this.autoCloseEnabled) {
        this.scheduleAutoCloseDaily();
      }
      this.startHeartbeat();
      logger.info(`Scheduler rescheduled. Next run: ${this.status.nextRun} (${this.timezone} @ ${this.startTime}). Next auto-active: ${this.status.nextAutoActive || 'none'}. Next auto-close: ${this.status.nextAutoClose || 'none'}.`);
    }
  }

  private startHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    this.heartbeatTimer = setInterval(() => {
      this.checkHeartbeat();
    }, 60000);
  }

  private checkHeartbeat(): void {
    if (!this.status.running) return;

    const now = new Date();
    const tz = this.timezone;
    const nowLocalDateIso = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);

    const dow = getDayOfWeek(nowLocalDateIso);
    if (dow === 0 || dow === 6) return; // Weekend

    const nowLocalTimeParts = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(now).split(':').map(n => parseInt(n, 10) || 0);
    const nowSeconds = nowLocalTimeParts[0] * 3600 + nowLocalTimeParts[1] * 60 + nowLocalTimeParts[2];

    // 1. Check auto-active heartbeat (5:30 PM = 17:30)
    if (this.autoActiveEnabled && this.autoActiveFn && !this.isAutoActiveExecuting) {
      const lastActiveToday = this.status.lastAutoActive
        ? new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(this.status.lastAutoActive)) === nowLocalDateIso
        : false;

      if (!lastActiveToday && !this.autoActiveTimer) {
        const [actH, actM] = this.autoActiveTime.split(':').map(n => parseInt(n, 10) || 0);
        const activeSeconds = actH * 3600 + actM * 60;
        // Window from 17:30 to 18:15 (before auto-close window)
        const windowEndSeconds = 18 * 3600 + 15 * 60;
        if (nowSeconds >= activeSeconds && nowSeconds < windowEndSeconds) {
          logger.info(`Scheduler Heartbeat: auto-active time passed for ${nowLocalDateIso} but tasks not yet activated. Triggering catchup execution...`);
          void this.runAutoActiveScheduled();
        }
      }
    }

    // 2. Check auto-close heartbeat
    if (!this.autoCloseEnabled || !this.autoCloseFn) return;
    if (this.isAutoCloseExecuting) return;

    const lastRunToday = this.status.lastAutoClose
      ? new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(this.status.lastAutoClose)) === nowLocalDateIso
      : false;

    // A previous failed/empty attempt must never cause unattended retries
    // to patch the same Azure work items repeatedly.
    if (lastRunToday || this.autoCloseTimer) return;

    const [startH, startM] = this.autoCloseStartTime.split(':').map(n => parseInt(n, 10) || 0);
    const [endH, endM] = this.autoCloseEndTime.split(':').map(n => parseInt(n, 10) || 0);
    const startSeconds = startH * 3600 + startM * 60;
    const endSeconds = endH * 3600 + endM * 60;

    // Only recover a missed timer within its authorized closure window.
    if (nowSeconds >= startSeconds && nowSeconds < endSeconds) {
      if (this.status.nextAutoClose) {
        const nextTarget = new Date(this.status.nextAutoClose);
        const diffMs = nextTarget.getTime() - now.getTime();
        // If timer is scheduled to fire within the next 3 minutes, let the normal timer fire
        if (diffMs > 0 && diffMs <= 3 * 60 * 1000) {
          return;
        }
      }
      logger.info(`Scheduler Heartbeat: auto-close window active/passed for ${nowLocalDateIso} but tasks not yet verified closed. Triggering catchup execution...`);
      void this.runAutoCloseScheduled();
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

    // 1. If it is a weekday and no closure attempt was recorded today:
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

      // After the window, do not silently retry remote EOD mutations.
      if (nowSeconds >= endSeconds) {
        const nextDay = addDays(nowLocalDateIso, 1);
        const nextTime = this.computeRandomizedTime(this.autoCloseStartTime, this.autoCloseEndTime);
        return {
          target: this.getNextRunTime(new Date(zonedTimeToUtcIso(nextDay, '00:00:00', tz)), nextTime),
          timeStr: nextTime,
        };
      }

      // 1c. If before the active window today (e.g. morning/afternoon before 18:15):
      // Schedule for today's randomized window
      const timeStr = this.computeRandomizedTime(this.autoCloseStartTime, this.autoCloseEndTime);
      const target = new Date(zonedTimeToUtcIso(nowLocalDateIso, timeStr, tz));
      return { target, timeStr };
    }

    // 2. If already run today OR it's a weekend:
    // Schedule for the next weekday's window starting from tomorrow
    const timeStr = this.computeRandomizedTime(this.autoCloseStartTime, this.autoCloseEndTime);
    const tomorrowIso = addDays(nowLocalDateIso, 1);
    const target = this.getNextRunTime(new Date(zonedTimeToUtcIso(tomorrowIso, '00:00:00', tz)), timeStr);
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
    // Checkpoint every attempt, even failures and empty scans. Subsequent
    // automatic attempts on the same day require explicit operator action.
    this.status.lastAutoClose = new Date().toISOString();
    logger.info(`Scheduler: running automated EOD task closure (window: ${this.autoCloseStartTime}-${this.autoCloseEndTime}, tz: ${this.timezone})...`);
    try {
      // Crash safety: record today's attempt before Azure is called. If disk
      // persistence fails, do not perform any unattended remote write.
      if (this.configRepo) {
        try {
          await this.configRepo.saveSettings({ lastAutoClose: this.status.lastAutoClose });
        } catch (error) {
          this.status.lastAutoCloseResult = 'failure';
          logger.error(`EOD checkpoint could not be persisted; Azure closure was not attempted: ${error instanceof Error ? error.message : String(error)}`);
          return;
        }
      }
      const result: any = await this.autoCloseFn();

      const totalFound = typeof result?.totalFound === 'number' ? result.totalFound : undefined;
      const totalClosed = typeof result?.totalClosed === 'number' ? result.totalClosed : 0;
      const totalAlreadyClosed = typeof result?.totalAlreadyClosed === 'number' ? result.totalAlreadyClosed : 0;
      const totalFailed = typeof result?.totalFailed === 'number' ? result.totalFailed : 0;

      if (totalFound === 0 || (totalFound !== undefined && totalClosed === 0 && totalAlreadyClosed === 0)) {
        logger.warn('Scheduler: EOD scan found 0 candidate tasks. No unattended retry will run today; review the team and work-item source.');
        this.status.lastAutoCloseResult = 'empty';
        return;
      }

      this.status.lastAutoCloseResult = totalFailed > 0 ? 'partial' : 'success';
      if (totalFailed > 0) {
        logger.warn(`Scheduler: EOD closure incomplete (${totalClosed} closed, ${totalAlreadyClosed} already closed, ${totalFailed} failed). Review failures manually.`);
      } else {
        logger.success(`Scheduler: EOD closure request completed (${totalClosed} closed, ${totalAlreadyClosed} already closed, ${totalFailed} failed).`);
      }
    } catch (error: any) {
      this.status.lastAutoCloseResult = 'failure';
      logger.error(`Scheduler: EOD task auto-close failed: ${error?.message || error}`);
    } finally {
      this.isAutoCloseExecuting = false;
    }
  }

  private scheduleAutoActiveDaily(): void {
    const now = new Date();
    const tz = this.timezone;
    const nowLocalDateIso = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);

    const nowLocalTimeParts = new Intl.DateTimeFormat('en-GB', {
      timeZone: tz,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }).format(now).split(':').map(n => parseInt(n, 10) || 0);

    const nowSeconds = nowLocalTimeParts[0] * 3600 + nowLocalTimeParts[1] * 60 + nowLocalTimeParts[2];
    const [actH, actM] = this.autoActiveTime.split(':').map(n => parseInt(n, 10) || 0);
    const activeSeconds = actH * 3600 + actM * 60;

    const dow = getDayOfWeek(nowLocalDateIso);
    const isWeekend = dow === 0 || dow === 6;

    const lastActiveToday = this.status.lastAutoActive
      ? new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date(this.status.lastAutoActive)) === nowLocalDateIso
      : false;

    let target: Date;
    if (!isWeekend && !lastActiveToday && nowSeconds < activeSeconds) {
      target = new Date(zonedTimeToUtcIso(nowLocalDateIso, `${this.autoActiveTime}:00`, tz));
    } else {
      const tomorrowIso = addDays(nowLocalDateIso, 1);
      target = this.getNextRunTime(new Date(zonedTimeToUtcIso(tomorrowIso, '00:00:00', tz)), `${this.autoActiveTime}:00`);
    }

    this.status.nextAutoActive = target.toISOString();
    const delay = Math.max(0, target.getTime() - now.getTime());

    logger.info(`Scheduler: Next task auto-active scheduled for ${this.status.nextAutoActive} (${this.timezone} @ ${this.autoActiveTime}).`);

    this.autoActiveTimer = setTimeout(() => {
      this.autoActiveTimer = null;
      void this.runAutoActiveScheduled().finally(() => {
        if (this.status.running && this.autoActiveEnabled) {
          this.scheduleAutoActiveDaily();
        }
      });
    }, delay);
  }

  private async runAutoActiveScheduled(): Promise<void> {
    if (!this.autoActiveFn) {
      logger.warn('Scheduler: no auto-active function configured');
      return;
    }
    if (this.isAutoActiveExecuting) {
      logger.warn('Scheduler: auto-active already in progress, skipping parallel execution');
      return;
    }

    this.isAutoActiveExecuting = true;
    this.status.lastAutoActive = new Date().toISOString();
    logger.info(`Scheduler: running automated task activation (time: ${this.autoActiveTime}, tz: ${this.timezone})...`);
    try {
      if (this.configRepo) {
        try {
          await this.configRepo.saveSettings({ lastAutoActive: this.status.lastAutoActive });
        } catch (error) {
          this.status.lastAutoActiveResult = 'failure';
          logger.error(`Auto-active checkpoint could not be persisted; Azure activation was not attempted: ${error instanceof Error ? error.message : String(error)}`);
          return;
        }
      }
      const result: any = await this.autoActiveFn();

      const totalFound = typeof result?.totalFound === 'number' ? result.totalFound : undefined;
      const totalActivated = typeof result?.totalActivated === 'number' ? result.totalActivated : 0;
      const totalAlreadyActive = typeof result?.totalAlreadyActive === 'number' ? result.totalAlreadyActive : 0;
      const totalFailed = typeof result?.totalFailed === 'number' ? result.totalFailed : 0;

      if (totalFound === 0 || (totalFound !== undefined && totalActivated === 0 && totalAlreadyActive === 0)) {
        logger.warn('Scheduler: auto-active scan found 0 candidate tasks.');
        this.status.lastAutoActiveResult = 'empty';
        return;
      }

      this.status.lastAutoActiveResult = totalFailed > 0 ? 'partial' : 'success';
      if (totalFailed > 0) {
        logger.warn(`Scheduler: auto-active incomplete (${totalActivated} activated, ${totalAlreadyActive} already active, ${totalFailed} failed).`);
      } else {
        logger.success(`Scheduler: auto-active completed successfully (${totalActivated} activated, ${totalAlreadyActive} already active).`);
      }
    } catch (error: any) {
      this.status.lastAutoActiveResult = 'failure';
      logger.error(`Scheduler: task auto-active failed: ${error?.message || error}`);
    } finally {
      this.isAutoActiveExecuting = false;
    }
  }
}
