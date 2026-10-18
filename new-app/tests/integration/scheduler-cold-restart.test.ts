import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';

describe('Scheduler process-boundary checkpoint recovery', () => {
  it('retains one EOD attempt through a real second Node process', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workday-cold-restart-'));
    const configFile = path.join(root, 'people.json');
    const markerFile = path.join(root, 'attempts.log');
    const probe = path.resolve(process.cwd(), 'tests/fixtures/scheduler-restart-probe.mjs');
    try {
      fs.writeFileSync(configFile, JSON.stringify({
        people: [], timezone: 'UTC', autoClose: true,
        autoCloseStartTime: '00:00', autoCloseEndTime: '23:59',
        schedulerEnabled: false, schedulerAutoStart: false,
      }));
      const run = (mode: string) => spawnSync(
        process.execPath,
        ['--import', 'tsx', probe, configFile, markerFile, mode],
        { cwd: process.cwd(), encoding: 'utf8', timeout: 25000 }
      );
      const first = run('attempt');
      expect(first.status, first.stderr).toBe(0);
      const persisted = JSON.parse(fs.readFileSync(configFile, 'utf8'));
      expect(new Date(persisted.lastAutoClose).getTime()).toBeGreaterThan(0);
      const restarted = run('restart');
      expect(restarted.status, restarted.stderr).toBe(0);
      expect(fs.readFileSync(markerFile, 'utf8')).toBe('attempt\n');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
