import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { FileConfigRepository } from '../../src/infrastructure/config/file-config-repo.js';
import { NodeSchedulerRepository } from '../../src/infrastructure/scheduler/node-scheduler-repo.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('independent automation opt-ins', () => {
  it('does not opt new configuration into activation or closure', async () => {
    const root = mkdtempSync(join(tmpdir(), 'studio-defaults-'));
    roots.push(root);
    const config = await new FileConfigRepository(join(root, 'missing.json')).load();
    expect(config.schedulerEnabled).toBe(false);
    expect(config.schedulerAutoStart).toBe(false);
    expect(config.autoActive).toBe(false);
    expect(config.autoClose).toBe(false);
  });

  it('treats omitted activation as disabled independently of creation', () => {
    const scheduler = new NodeSchedulerRepository({
      timezone: 'UTC', startTime: '09:30', schedulerEnabled: true,
    });
    expect(scheduler.getStatus().autoActiveEnabled).toBe(false);
    expect(scheduler.getStatus().autoCloseEnabled).toBe(false);
  });

  it('preserves explicit activation opt-in', () => {
    const scheduler = new NodeSchedulerRepository({ timezone: 'UTC', startTime: '09:30', autoActive: true });
    expect(scheduler.getStatus().autoActiveEnabled).toBe(true);
  });
});