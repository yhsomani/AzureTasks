import { logger } from '../logging/logger.js';
import { metricsRegistry } from '../telemetry/metrics.js';
import { ILockManager } from '../../domain/ports/repositories.js';

export interface WorkerJob {
  id: string;
  name: string;
  scheduleTime?: string; // HH:MM
  intervalMs?: number;
  handler: () => Promise<void>;
  maxRetries?: number;
}

export interface DlqEntry {
  id: string;
  name: string;
  payload?: any;
  error: string;
  failedAt: string;
  retryCount: number;
}

export interface WorkerDaemonOptions {
  lockManager?: ILockManager;
  timezone?: string;
  heartbeatIntervalMs?: number;
}

export class WorkerDaemon {
  private isRunning = false;
  private isDraining = false;
  private activeJobs = 0;
  private timers: NodeJS.Timeout[] = [];
  private jobs: WorkerJob[] = [];
  private dlq: DlqEntry[] = [];
  private readonly lockManager?: ILockManager;
  private readonly timezone: string;

  constructor(options: WorkerDaemonOptions = {}) {
    this.lockManager = options.lockManager;
    this.timezone = options.timezone || 'UTC';
  }

  public registerJob(job: WorkerJob): void {
    this.jobs.push(job);
  }

  public getDlq(): DlqEntry[] {
    return [...this.dlq];
  }

  public getActiveJobsCount(): number {
    return this.activeJobs;
  }

  public isHealthy(): boolean {
    return this.isRunning && !this.isDraining;
  }

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    this.isDraining = false;
    logger.info(`WorkerDaemon started (timezone: ${this.timezone}). Registered jobs: ${this.jobs.length}`);

    // Register recurring interval/schedule checks for jobs
    for (const job of this.jobs) {
      if (job.intervalMs && job.intervalMs > 0) {
        const timer = setInterval(() => {
          if (!this.isDraining && this.isRunning) {
            this.runJobWithRetry(job).catch((err) => {
              logger.error(`Unhandled error running job ${job.name}: ${err.message}`);
            });
          }
        }, job.intervalMs);
        this.timers.push(timer);
      }
    }
  }

  public async runJobWithRetry(job: WorkerJob): Promise<boolean> {
    if (this.isDraining || !this.isRunning) {
      return false;
    }

    // Clustered worker job deduplication check via distributed lock
    const today = new Date().toISOString().slice(0, 10);
    const lockKey = `workops:worker:dedup:${job.id}:${today}`;
    let lockHandle: any = null;

    if (this.lockManager) {
      lockHandle = await this.lockManager.acquire(lockKey, 60000);
      if (!lockHandle) {
        logger.info(`Job '${job.name}' skipped: already acquired/running on another worker replica.`);
        return false;
      }
    }

    this.activeJobs++;
    metricsRegistry.setActiveJobs(this.activeJobs);
    const maxRetries = job.maxRetries ?? 3;
    let attempt = 0;
    let lastError = '';

    try {
      while (attempt <= maxRetries) {
        try {
          attempt++;
          logger.info(`Running worker job '${job.name}' (attempt ${attempt}/${maxRetries + 1})...`);
          await job.handler();
          logger.info(`Worker job '${job.name}' completed successfully.`);
          return true;
        } catch (err: any) {
          lastError = err.message || String(err);
          logger.warn(`Worker job '${job.name}' failed on attempt ${attempt}: ${lastError}`);
          if (attempt <= maxRetries) {
            const backoffDelay = Math.pow(2, attempt - 1) * 1000;
            await new Promise((r) => setTimeout(r, backoffDelay));
          }
        }
      }

      // Max retries exhausted -> Move to Dead Letter Queue (DLQ)
      logger.error(`Worker job '${job.name}' failed after ${maxRetries + 1} attempts. Moving to DLQ.`);
      this.dlq.push({
        id: `${job.id}_${Date.now()}`,
        name: job.name,
        error: lastError,
        failedAt: new Date().toISOString(),
        retryCount: maxRetries + 1,
      });
      return false;
    } finally {
      this.activeJobs--;
      metricsRegistry.setActiveJobs(this.activeJobs);
      if (lockHandle && this.lockManager) {
        await this.lockManager.release(lockHandle);
      }
    }
  }

  public async stop(): Promise<void> {
    logger.info('WorkerDaemon received shutdown signal. Draining active jobs...');
    this.isDraining = true;
    for (const timer of this.timers) {
      clearInterval(timer);
    }
    this.timers = [];

    // Wait up to 10 seconds for in-flight jobs to drain
    const start = Date.now();
    while (this.activeJobs > 0 && Date.now() - start < 10000) {
      await new Promise((r) => setTimeout(r, 50));
    }

    this.isRunning = false;
    logger.info('WorkerDaemon shut down cleanly.');
  }

  public setupSignalHandlers(): void {
    const handleShutdown = async (signal: string) => {
      logger.info(`Received ${signal}. Starting graceful shutdown...`);
      await this.stop();
      process.exit(0);
    };

    process.once('SIGTERM', () => handleShutdown('SIGTERM'));
    process.once('SIGINT', () => handleShutdown('SIGINT'));
  }
}
