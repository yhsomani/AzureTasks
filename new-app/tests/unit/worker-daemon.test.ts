import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { WorkerDaemon } from '../../src/infrastructure/scheduler/worker-daemon.js';
import { createWorkerDaemon, main } from '../../bin/worker.js';

describe('Milestone 3 — Feature 21: Decoupled Background Worker Daemon', () => {
  let daemon: WorkerDaemon;

  beforeEach(() => {
    daemon = new WorkerDaemon({ timezone: 'UTC' });
  });

  afterEach(async () => {
    if (daemon) {
      await daemon.stop();
    }
  });

  it('registers jobs, starts, and reports healthy status', () => {
    expect(daemon.isHealthy()).toBe(false);

    const mockJob = {
      id: 'test-job',
      name: 'Test Job',
      intervalMs: 10000,
      handler: vi.fn().mockResolvedValue(undefined),
    };

    daemon.registerJob(mockJob);
    daemon.start();

    expect(daemon.isHealthy()).toBe(true);
    expect(daemon.getActiveJobsCount()).toBe(0);
  });

  it('executes job handler successfully and increments/decrements active jobs count', async () => {
    let wasActiveDuringExecution = false;
    const mockJob = {
      id: 'success-job',
      name: 'Success Job',
      handler: vi.fn().mockImplementation(async () => {
        if (daemon.getActiveJobsCount() > 0) {
          wasActiveDuringExecution = true;
        }
      }),
    };

    daemon.registerJob(mockJob);
    daemon.start();

    const success = await daemon.runJobWithRetry(mockJob);
    expect(success).toBe(true);
    expect(mockJob.handler).toHaveBeenCalledTimes(1);
    expect(wasActiveDuringExecution).toBe(true);
    expect(daemon.getActiveJobsCount()).toBe(0);
  });

  it('retries failed jobs with exponential backoff and moves to DLQ when exhausted', async () => {
    let attempts = 0;
    const poisonPillJob = {
      id: 'poison-job',
      name: 'Poison Pill Job',
      maxRetries: 2,
      handler: vi.fn().mockImplementation(async () => {
        attempts++;
        throw new Error(`Transient failure attempt ${attempts}`);
      }),
    };

    daemon.registerJob(poisonPillJob);
    daemon.start();

    const success = await daemon.runJobWithRetry(poisonPillJob);
    expect(success).toBe(false);
    // Initial attempt + 2 retries = 3 attempts total
    expect(attempts).toBe(3);

    // Verify job moved to Dead Letter Queue (DLQ)
    const dlq = daemon.getDlq();
    expect(dlq.length).toBe(1);
    expect(dlq[0].name).toBe('Poison Pill Job');
    expect(dlq[0].retryCount).toBe(3);
    expect(dlq[0].error).toContain('Transient failure attempt 3');
  });

  it('deduplicates jobs across clustered worker instances via distributed lock', async () => {
    const mockLockManager = {
      acquire: vi.fn().mockResolvedValueOnce({ resource: 'lock', ownerToken: 'token', expiresAt: 999999999 })
        .mockResolvedValueOnce(null), // Second replica fails to acquire lock!
      release: vi.fn().mockResolvedValue(true),
      extend: vi.fn().mockResolvedValue(true),
      isLocked: vi.fn().mockResolvedValue(true),
    };

    const worker1 = new WorkerDaemon({ lockManager: mockLockManager });
    const worker2 = new WorkerDaemon({ lockManager: mockLockManager });

    const job = {
      id: 'shared-cron-job',
      name: 'Shared Cron Job',
      handler: vi.fn().mockResolvedValue(undefined),
    };

    worker1.start();
    worker2.start();

    // Worker 1 runs the job
    const run1 = await worker1.runJobWithRetry(job);
    expect(run1).toBe(true);
    expect(job.handler).toHaveBeenCalledTimes(1);

    // Worker 2 attempts same job on same day -> skipped due to lock contention
    const run2 = await worker2.runJobWithRetry(job);
    expect(run2).toBe(false);
    expect(job.handler).toHaveBeenCalledTimes(1);

    await worker1.stop();
    await worker2.stop();
  });

  it('performs graceful shutdown, draining in-flight jobs', async () => {
    let jobFinished = false;
    const longRunningJob = {
      id: 'long-job',
      name: 'Long Running Job',
      handler: vi.fn().mockImplementation(async () => {
        await new Promise((r) => setTimeout(r, 100));
        jobFinished = true;
      }),
    };

    daemon.start();
    const runPromise = daemon.runJobWithRetry(longRunningJob);

    // Trigger stop while job is active
    const stopPromise = daemon.stop();
    expect(daemon.isHealthy()).toBe(false);

    await Promise.all([runPromise, stopPromise]);
    expect(jobFinished).toBe(true);
    expect(daemon.getActiveJobsCount()).toBe(0);
  });

  it('bin/worker.ts createWorkerDaemon registers required background jobs', async () => {
    const worker = await createWorkerDaemon({
      sqlitePath: ':memory:',
    });

    expect(worker).toBeInstanceOf(WorkerDaemon);
    worker.start();
    expect(worker.isHealthy()).toBe(true);
    await worker.stop();
  });

  it('bin/worker.ts main runs with --run-once flag cleanly', async () => {
    await expect(
      main(['--sqlite-path', ':memory:', '--run-once'])
    ).resolves.toBeUndefined();
  });
});
