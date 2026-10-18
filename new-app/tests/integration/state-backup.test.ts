import { describe, expect, it } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';

const script = path.resolve(process.cwd(), 'scripts/state-backup.mjs');
function run(command: string, options: string[]) {
  return spawnSync(process.execPath, [script, command, ...options], {
    encoding: 'utf8', timeout: 15000,
  });
}
function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'workday-recovery-'));
  const state = path.join(root, 'state');
  const backup = path.join(root, 'backup');
  const restore = path.join(root, 'restored');
  fs.mkdirSync(state);
  fs.mkdirSync(path.join(state, '.journal-archives'));
  fs.writeFileSync(path.join(state, 'people.json'), JSON.stringify({ people: [{ key: 'p' }] }));
  fs.writeFileSync(path.join(state, '.task-journal.json'), JSON.stringify([{ runId: 'recent' }]));
  fs.writeFileSync(path.join(state, '.journal-archives', 'task-journal-2026-10-01.json'),
    JSON.stringify([{ runId: 'archived' }]));
  fs.writeFileSync(path.join(state, '.env'), 'AZURE_DEVOPS_PAT=secret-do-not-copy\n');
  return { root, state, backup, restore };
}
describe('offline state backup and restore', () => {
  it('backs up nonsecret files, verifies hashes, and restores to a new directory', () => {
    const { root, state, backup, restore } = setup();
    try {
      const created = run('backup', ['--state-dir', state, '--backup-dir', backup, '--offline-confirm']);
      expect(created.status).toBe(0);
      expect(fs.existsSync(path.join(backup, '.env'))).toBe(false);
      expect(fs.existsSync(path.join(backup, '.task-journal.json'))).toBe(true);
      expect(fs.existsSync(path.join(backup, '.journal-archives', 'task-journal-2026-10-01.json'))).toBe(true);
      expect(run('verify', ['--backup-dir', backup]).status).toBe(0);
      const restored = run('restore', ['--state-dir', restore, '--backup-dir', backup, '--offline-confirm']);
      expect(restored.status).toBe(0);
      expect(JSON.parse(fs.readFileSync(path.join(restore, 'people.json'), 'utf8')).people).toHaveLength(1);
      expect(fs.existsSync(path.join(restore, '.env'))).toBe(false);
      expect(run('restore', ['--state-dir', restore, '--backup-dir', backup, '--offline-confirm']).status)
        .not.toBe(0);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
  it('fails closed on tampered backup files and refuses unconfirmed recovery', () => {
    const { root, state, backup, restore } = setup();
    try {
      expect(run('backup', ['--state-dir', state, '--backup-dir', backup]).status).not.toBe(0);
      expect(run('backup', ['--state-dir', state, '--backup-dir', backup, '--offline-confirm']).status).toBe(0);
      fs.writeFileSync(path.join(backup, 'people.json'), '{"people":[]}\n');
      const checked = run('verify', ['--backup-dir', backup]);
      expect(checked.status).not.toBe(0);
      expect(checked.stderr).toContain('checksum/length mismatch');
      expect(run('restore', ['--state-dir', restore, '--backup-dir', backup, '--offline-confirm']).status)
        .not.toBe(0);
      expect(fs.existsSync(path.join(restore, 'people.json'))).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
