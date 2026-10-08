import * as fs from 'fs';
import * as path from 'path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TaskScheduler } from '../src/task/scheduler.js';
import { AppConfig } from '../src/config/config.js';

describe('TaskScheduler Suite', () => {
  const stateFile = path.resolve(process.cwd(), '.scheduler-state.json');

  beforeAll(() => {
    if (fs.existsSync(stateFile)) fs.unlinkSync(stateFile);
  });

  afterAll(() => {
    if (fs.existsSync(stateFile)) fs.unlinkSync(stateFile);
  });

  const dummyConfig: AppConfig = {
    organization: 'TestOrg',
    project: 'TestProject',
    workItemType: '3in1 Task',
    titlePrefix: '3in1_PWA_MyAccount | ',
    timezone: 'Asia/Kolkata',
    startTime: '09:30',
    thursdayMode: 'CURRENT',
    maxRetries: 1,
    retryDelayMs: 10,
    people: [
      { name: 'Dev User', assignedTo: 'dev@company.com' }
    ],
  };

  it('initializes with disabled status by default', () => {
    if (fs.existsSync(stateFile)) fs.unlinkSync(stateFile);
    const scheduler = new TaskScheduler(dummyConfig);
    const status = scheduler.getStatus();
    expect(status.enabled).toBe(false);
    expect(status.running).toBe(false);
    expect(status.targetTime).toBe('09:30');
    expect(status.timezone).toBe('Asia/Kolkata');
    expect(status.nextRunTime).toBeDefined();
    expect(status.nextRunTime).toContain('T09:30:00');
  });

  it('starts and stops gracefully', () => {
    const scheduler = new TaskScheduler(dummyConfig);
    scheduler.start();
    expect(scheduler.getStatus().enabled).toBe(true);

    scheduler.stop();
    expect(scheduler.getStatus().enabled).toBe(false);
  });

  it('handles multiple start or stop calls idempotently', () => {
    const scheduler = new TaskScheduler(dummyConfig);
    scheduler.start();
    scheduler.start();
    expect(scheduler.getStatus().enabled).toBe(true);

    scheduler.stop();
    scheduler.stop();
    expect(scheduler.getStatus().enabled).toBe(false);
  });

  it('returns appropriate failure if runNow called without PAT', async () => {
    const oldPat = process.env.AZURE_DEVOPS_PAT;
    delete process.env.AZURE_DEVOPS_PAT;
    try {
      const scheduler = new TaskScheduler(dummyConfig);
      const res = await scheduler.runNow();
      expect(res).toBeNull();
      const status = scheduler.getStatus();
      expect(status.lastRunStatus).toBe('FAILED');
      expect(status.lastRunSummary).toContain('PAT');
    } finally {
      if (oldPat) process.env.AZURE_DEVOPS_PAT = oldPat;
    }
  });

  it('persists and reloads scheduler state from state file', () => {
    const scheduler1 = new TaskScheduler(dummyConfig);
    scheduler1.start();
    expect(fs.existsSync(stateFile)).toBe(true);

    // Create a new instance simulating process restart
    const scheduler2 = new TaskScheduler(dummyConfig);
    expect(scheduler2.getStatus().enabled).toBe(true);

    scheduler2.stop();
    expect(scheduler2.getStatus().enabled).toBe(false);

    const scheduler3 = new TaskScheduler(dummyConfig);
    expect(scheduler3.getStatus().enabled).toBe(false);
  });
});
