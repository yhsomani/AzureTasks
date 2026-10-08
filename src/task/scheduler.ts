import * as fs from 'fs';
import * as path from 'path';
import { AzureDevOpsClient } from '../azure/client.js';
import { AppConfig, loadConfig } from '../config/config.js';
import { getDayOfWeek, getTodayIso } from '../date/date-engine.js';
import { logger } from '../utils/logger.js';
import { MultiPersonAggregateResult, TaskOrchestrator } from './task-orchestrator.js';

export interface SchedulerStatus {
  enabled: boolean;
  running: boolean;
  targetTime: string; // "09:30"
  timezone: string; // "Asia/Kolkata"
  lastRunTime?: string;
  lastRunStatus?: 'SUCCESS' | 'FAILED' | 'SKIPPED';
  lastRunSummary?: string;
  nextRunTime?: string;
}

export class TaskScheduler {
  private timer: NodeJS.Timeout | null = null;
  private isProcessing = false;
  private status: SchedulerStatus;
  private stateFilePath: string;

  constructor(private config: AppConfig = loadConfig()) {
    this.stateFilePath = path.resolve(process.cwd(), '.scheduler-state.json');
    this.status = {
      enabled: false,
      running: false,
      targetTime: this.config.startTime || '09:30',
      timezone: this.config.timezone || 'Asia/Kolkata',
    };
    this.loadSavedState();
  }

  private loadSavedState(): void {
    if (fs.existsSync(this.stateFilePath)) {
      try {
        const raw = fs.readFileSync(this.stateFilePath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          if (parsed.lastRunTime) this.status.lastRunTime = parsed.lastRunTime;
          if (parsed.lastRunStatus) this.status.lastRunStatus = parsed.lastRunStatus;
          if (parsed.lastRunSummary) this.status.lastRunSummary = parsed.lastRunSummary;
          if (typeof parsed.enabled === 'boolean') this.status.enabled = parsed.enabled;
        }
      } catch {
        // Ignore read errors
      }
    }
  }

  private saveState(): void {
    try {
      const stateToSave = {
        enabled: this.status.enabled,
        targetTime: this.status.targetTime,
        timezone: this.status.timezone,
        lastRunTime: this.status.lastRunTime,
        lastRunStatus: this.status.lastRunStatus,
        lastRunSummary: this.status.lastRunSummary,
      };
      fs.writeFileSync(this.stateFilePath, JSON.stringify(stateToSave, null, 2), 'utf-8');
    } catch {
      // Ignore write errors
    }
  }

  public getStatus(): SchedulerStatus {
    return {
      ...this.status,
      nextRunTime: this.calculateNextRunIso(),
    };
  }

  public start(): void {
    if (this.timer) return;
    this.status.enabled = true;
    this.saveState();
    logger.info(`Daily Task Scheduler started for ${this.status.targetTime} (${this.status.timezone}).`);

    // Run immediate check in case it's already time today
    this.checkAndRun().catch(() => {});

    // Check every 30 seconds
    this.timer = setInterval(() => this.checkAndRun(), 30000);
  }

  public stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.status.enabled = false;
    this.saveState();
    logger.info('Daily Task Scheduler stopped.');
  }

  public async runNow(): Promise<MultiPersonAggregateResult | null> {
    const pat = process.env.AZURE_DEVOPS_PAT?.trim();
    if (!pat) {
      logger.error('Scheduler: AZURE_DEVOPS_PAT not configured.');
      this.status.lastRunStatus = 'FAILED';
      this.status.lastRunSummary = 'AZURE_DEVOPS_PAT not configured';
      return null;
    }

    this.isProcessing = true;
    this.status.running = true;

    try {
      this.config = loadConfig();
      const client = new AzureDevOpsClient({
        organization: this.config.organization,
        pat,
        baseUrl: this.config.baseUrl,
        maxRetries: this.config.maxRetries,
      });

      const orchestrator = new TaskOrchestrator(client, this.config, {
        dryRun: false,
        yes: true,
        all: true,
        verbose: false,
      });

      const result = await orchestrator.run();
      this.status.lastRunTime = new Date().toISOString();
      this.status.lastRunStatus = result.totalTaskFailureCount > 0 ? 'FAILED' : 'SUCCESS';
      this.status.lastRunSummary = `Created: ${result.totalCreatedCount}, Duplicates: ${result.totalDuplicateCount}`;
      this.saveState();
      return result;
    } catch (err: any) {
      this.status.lastRunTime = new Date().toISOString();
      this.status.lastRunStatus = 'FAILED';
      this.status.lastRunSummary = err.message || 'Execution failed';
      this.saveState();
      logger.error(`Scheduler run failed: ${err.message}`);
      return null;
    } finally {
      this.isProcessing = false;
      this.status.running = false;
    }
  }

  private async checkAndRun(): Promise<void> {
    if (!this.status.enabled || this.isProcessing) return;

    const todayIso = getTodayIso(this.status.timezone);
    const dow = getDayOfWeek(todayIso);

    // Skip weekends (Saturday=6, Sunday=0)
    if (dow === 0 || dow === 6) return;

    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone: this.status.timezone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
    const currentTime = formatter.format(now); // "HH:MM"

    if (currentTime >= this.status.targetTime) {
      // Check if we already ran today
      if (this.status.lastRunTime && this.status.lastRunTime.startsWith(todayIso)) {
        return; // Already executed today
      }

      logger.info(`Scheduler triggered at ${currentTime} ${this.status.timezone} for ${todayIso}.`);
      await this.runNow();
    }
  }

  private calculateNextRunIso(): string {
    const todayIso = getTodayIso(this.status.timezone);
    return `${todayIso}T${this.status.targetTime}:00`;
  }
}
