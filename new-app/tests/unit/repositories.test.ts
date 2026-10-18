import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FileLockRepository } from '../../src/infrastructure/lock/file-lock-repo';
import { FileJournalRepository } from '../../src/infrastructure/journal/file-journal-repo';
import { FileConfigRepository } from '../../src/infrastructure/config/file-config-repo';
import { NodeSchedulerRepository } from '../../src/infrastructure/scheduler/node-scheduler-repo';
import { buildApp } from '../../src/container';
import { JournalEntry } from '../../src/domain/ports/repositories';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'app-test-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('FileLockRepository', () => {
  it('acquires and releases a lock', () => {
    const lock = new FileLockRepository(path.join(dir, '.lock.json'));
    expect(lock.acquire()).toBe(true);
    expect(lock.isLocked()).toBe(true);
    lock.release();
    expect(lock.isLocked()).toBe(false);
  });

  it('treats a lock held by a dead PID as stale and reclaims it', () => {
    const lockPath = path.join(dir, '.lock.json');
    fs.writeFileSync(lockPath, JSON.stringify({
      pid: 999999,
      acquiredAt: new Date().toISOString(),
      stale: false,
    }));
    const lock = new FileLockRepository(lockPath);
    expect(lock.getLockInfo()?.stale).toBe(true);
    expect(lock.acquire()).toBe(true);
  });

  it('does not expire a long-running lock while its owner is still alive', () => {
    const lockPath = path.join(dir, '.lock.json');
    const old = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, acquiredAt: old, stale: false }));
    const lock = new FileLockRepository(lockPath);
    expect(lock.getLockInfo()?.stale).toBe(false);
    expect(lock.acquire()).toBe(false);
  });

  it('does not let another instance release a lock it never acquired', () => {
    const filename = path.join(dir, '.lock.json');
    const owner = new FileLockRepository(filename);
    const observer = new FileLockRepository(filename);
    expect(owner.acquire()).toBe(true);
    expect(observer.acquire()).toBe(false);
    observer.release();
    expect(owner.isLocked()).toBe(true);
    owner.release();
    expect(owner.isLocked()).toBe(false);
  });

  it('does not reclaim a malformed lock file without ownership evidence', () => {
    const filename = path.join(dir, '.lock.json');
    fs.writeFileSync(filename, '{not-valid-json');
    const lock = new FileLockRepository(filename);
    expect(lock.acquire()).toBe(false);
    expect(fs.readFileSync(filename, 'utf8')).toBe('{not-valid-json');
  });
});

describe('FileJournalRepository', () => {
  const entry = (over: Partial<JournalEntry> = {}): JournalEntry => ({
    runId: 'run-1',
    timestamp: new Date().toISOString(),
    personKey: 'p1',
    personName: 'A',
    assignedTo: 'a@b.com',
    targetIsoDate: '2026-10-08',
    title: 't',
    sourceTaskId: 1,
    fieldCopyStatus: 'SUCCESS',
    relationCopyStatus: 'SUCCESS',
    verified: true,
    ...over,
  });

  it('records and reads entries newest-first', () => {
    const journal = new FileJournalRepository(path.join(dir, '.journal.json'));
    return journal.record(entry({ title: 'first' }))
      .then(() => journal.record(entry({ title: 'second' })))
      .then(async () => {
        const entries = await journal.getEntries();
        expect(entries[0].title).toBe('second');
        expect(entries[1].title).toBe('first');
      });
  });

  it('finds unfinished relation copies that have a created work item', async () => {
    const journal = new FileJournalRepository(path.join(dir, '.journal.json'));
    await journal.record(entry({ relationCopyStatus: 'SUCCESS', createdWorkItemId: 1 }));
    await journal.record(entry({ relationCopyStatus: 'PARTIAL', createdWorkItemId: 2 }));
    await journal.record(entry({ relationCopyStatus: 'FAILED', createdWorkItemId: 3 }));
    const unfinished = await journal.getUnfinishedRelations();
    expect(unfinished).toHaveLength(2);
  });

  it('does not treat a task-creation failure (no work item) as repairable', async () => {
    const journal = new FileJournalRepository(path.join(dir, '.journal.json'));
    await journal.record(entry({ relationCopyStatus: 'FAILED', createdWorkItemId: undefined }));
    expect(await journal.getUnfinishedRelations()).toHaveLength(0);
  });

  it('amends an entry after a repair and clears it from the unfinished list', async () => {
    const journal = new FileJournalRepository(path.join(dir, '.journal.json'));
    const e = entry({ relationCopyStatus: 'PARTIAL', verified: false, createdWorkItemId: 7 });
    await journal.record(e);
    expect(await journal.getUnfinishedRelations()).toHaveLength(1);

    const updated = await journal.markRepaired(e, 'SUCCESS', 'Repaired: +1 relation(s) copied.');
    expect(updated).toBe(true);
    expect(await journal.getUnfinishedRelations()).toHaveLength(0);

    const [row] = await journal.getEntries();
    expect(row.relationCopyStatus).toBe('SUCCESS');
    expect(row.verified).toBe(true);
    expect(row.error).toContain('Repaired');
  });

  it('exports CSV with escaped values', async () => {
    const journal = new FileJournalRepository(path.join(dir, '.journal.json'));
    await journal.record(entry({ title: 'has "quotes"' }));
    const csv = await journal.exportCsv();
    expect(csv.split('\n')[0]).toContain('Timestamp');
    expect(csv).toContain('has ""quotes""');
  });

  it('preserves corrupt journal bytes and refuses writes or success-shaped reads', async () => {
    const filename = path.join(dir, '.journal.json');
    fs.writeFileSync(filename, '{not-json');
    const journal = new FileJournalRepository(filename);
    await expect(journal.getEntries()).rejects.toThrow(/unreadable or corrupt/);
    await expect(journal.record(entry())).rejects.toThrow(/unreadable or corrupt/);
    expect(fs.readFileSync(filename, 'utf8')).toBe('{not-json');
  });

  it('recovers partial relations from archives and updates the archived entry', async () => {
    const filename = path.join(dir, '.journal.json');
    const archiveDir = path.join(dir, '.journal-archives');
    fs.mkdirSync(archiveDir);
    const row = entry({ runId: 'archived', createdWorkItemId: 101, relationCopyStatus: 'PARTIAL' });
    const archive = path.join(archiveDir, 'task-journal-2026-10-01.json');
    fs.writeFileSync(archive, JSON.stringify([row]));
    const journal = new FileJournalRepository(filename);
    expect(await journal.getUnfinishedRelations()).toHaveLength(1);
    expect(await journal.markRepaired(row, 'SUCCESS', 'Verified repair')).toBe(true);
    expect(await journal.getUnfinishedRelations()).toHaveLength(0);
    expect(JSON.parse(fs.readFileSync(archive, 'utf8'))[0].relationCopyStatus).toBe('SUCCESS');
  });

  it('exports JSON', async () => {
    const journal = new FileJournalRepository(path.join(dir, '.journal.json'));
    await journal.record(entry());
    const json = JSON.parse(await journal.exportJson());
    expect(Array.isArray(json)).toBe(true);
    expect(json).toHaveLength(1);
  });
});

describe('External configuration bootstrap', () => {
  it('loads PAT from .env beside --config instead of only the process cwd', async () => {
    const configPath = path.join(dir, 'people.json');
    fs.writeFileSync(configPath, JSON.stringify({ people: [], schedulerEnabled: false, schedulerAutoStart: false }));
    fs.writeFileSync(path.join(dir, '.env'), 'AZURE_DEVOPS_PAT=test-custom-config-pat\\n'.replace('\\n', '\n'));
    const previous = process.env.AZURE_DEVOPS_PAT;
    try {
      delete process.env.AZURE_DEVOPS_PAT;
      await buildApp(configPath, { autoStartScheduler: false });
      expect(process.env.AZURE_DEVOPS_PAT).toBe('test-custom-config-pat');
    } finally {
      if (previous === undefined) delete process.env.AZURE_DEVOPS_PAT;
      else process.env.AZURE_DEVOPS_PAT = previous;
    }
  });
});

describe('FileConfigRepository', () => {
  it('loads a config file with people', async () => {
    const cfgPath = path.join(dir, 'people.json');
    fs.writeFileSync(cfgPath, JSON.stringify({
      project: 'MyProject',
      timezone: 'UTC',
      people: [{ key: 'p1', name: 'A', assignedTo: 'a@b.com' }],
    }));
    const repo = new FileConfigRepository(cfgPath);
    const config = await repo.load();
    expect(config.project).toBe('MyProject');
    expect(config.people).toHaveLength(1);
  });

  it('rejects duplicate identities', async () => {
    const cfgPath = path.join(dir, 'people.json');
    fs.writeFileSync(cfgPath, JSON.stringify({
      people: [
        { key: 'p1', name: 'A', assignedTo: 'a@b.com' },
        { key: 'p2', name: 'B', assignedTo: 'A@B.com' },
      ],
    }));
    const repo = new FileConfigRepository(cfgPath);
    await expect(repo.load()).rejects.toThrow(/Duplicate identity/);
  });

  it('falls back to defaults when the file is missing', async () => {
    const repo = new FileConfigRepository(path.join(dir, 'nope.json'));
    const config = await repo.load();
    expect(config.organization).toBeTruthy();
    expect(Array.isArray(config.people)).toBe(true);
  });

  it('keeps unattended creation and closure disabled on a fresh configuration', async () => {
    const config = await new FileConfigRepository(path.join(dir, 'fresh-install.json')).load();
    expect(config.schedulerEnabled).toBe(false);
    expect(config.schedulerAutoStart).toBe(false);
    expect(config.autoClose).toBe(false);
  });

  it('persists people updates', async () => {
    const cfgPath = path.join(dir, 'people.json');
    fs.writeFileSync(cfgPath, JSON.stringify({ people: [] }));
    const repo = new FileConfigRepository(cfgPath);
    await repo.savePeople([{ key: 'p1', name: 'A', assignedTo: 'a@b.com' }]);
    const reloaded = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
    expect(reloaded.people).toHaveLength(1);
  });

  it('preserves EOD checkpoint, unknown settings and no plaintext token on full save', async () => {
    const cfgPath = path.join(dir, 'people.json');
    fs.writeFileSync(cfgPath, JSON.stringify({
      lastAutoClose: '2026-10-16',
      extensionSetting: 'retained',
      githubToken: 'legacy-test-only-secret',
      people: [],
    }));
    const repo = new FileConfigRepository(cfgPath);
    const config = await repo.load();
    await repo.save(config);
    const persisted = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
    expect(persisted.lastAutoClose).toBe('2026-10-16');
    expect(persisted.extensionSetting).toBe('retained');
    expect(persisted.githubToken).toBeUndefined();
    expect(fs.readFileSync(path.join(dir, '.env'), 'utf-8')).toContain('legacy-test-only-secret');
  });

  it('refuses to destroy unreadable configuration on people or settings changes', async () => {
    const cfgPath = path.join(dir, 'people.json');
    fs.writeFileSync(cfgPath, '{broken');
    const repo = new FileConfigRepository(cfgPath);
    await expect(repo.savePeople([])).rejects.toThrow(/Refusing to overwrite/);
    await expect(repo.saveSettings({ timezone: 'UTC' })).rejects.toThrow(/Refusing to overwrite/);
    expect(fs.readFileSync(cfgPath, 'utf-8')).toBe('{broken');
  });

  it('keeps injected config tokens out of people.json and saves local secrets in a restricted file', async () => {
    const cfgPath = path.join(dir, 'people.json');
    const repo = new FileConfigRepository(cfgPath);
    const config = await repo.load();
    config.githubToken = 'runtime-test-only-token';
    await repo.save(config);
    expect(fs.readFileSync(cfgPath, 'utf-8')).not.toContain('runtime-test-only-token');
    await repo.saveSettings({ githubToken: 'new-test-only-token' });
    expect(fs.readFileSync(cfgPath, 'utf-8')).not.toContain('new-test-only-token');
    const env = path.join(dir, '.env');
    expect(fs.readFileSync(env, 'utf-8')).toContain('new-test-only-token');
    if (process.platform !== 'win32') {
      expect(fs.statSync(env).mode & 0o777).toBe(0o600);
    }
  });

  it('throws Configuration Error when config file exists but contains invalid JSON', async () => {
    const cfgPath = path.join(dir, 'people.json');
    fs.writeFileSync(cfgPath, '{ invalid json content');
    const repo = new FileConfigRepository(cfgPath);
    await expect(repo.load()).rejects.toThrow(/Configuration Error: Could not read or parse/);
  });
});

describe('NodeSchedulerRepository', () => {
  it('reflects timezone changes from the live config', () => {
    const config = { timezone: 'UTC', startTime: '09:30' };
    const scheduler = new NodeSchedulerRepository(config);
    expect(scheduler.getStatus().timezone).toBe('UTC');

    config.timezone = 'Asia/Kolkata';
    expect(scheduler.getStatus().timezone).toBe('Asia/Kolkata');
  });

  it('lets an explicit setSchedule timezone override the config', () => {
    const scheduler = new NodeSchedulerRepository({ timezone: 'UTC', startTime: '09:30' });
    scheduler.setSchedule('0 9 * * 1-5', 'Europe/London');
    expect(scheduler.getStatus().timezone).toBe('Europe/London');
  });

  it('persists schedulerEnabled on start(true) and stop(true)', async () => {
    const cfgPath = path.join(dir, 'people.json');
    fs.writeFileSync(cfgPath, JSON.stringify({ people: [] }));
    const configRepo = new FileConfigRepository(cfgPath);

    const scheduler = new NodeSchedulerRepository(
      { timezone: 'UTC', startTime: '10:00', scheduleTime: '10:00' },
      configRepo
    );

    await scheduler.start(true);
    expect(scheduler.getStatus().running).toBe(true);
    let saved = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
    expect(saved.schedulerEnabled).toBe(true);

    await scheduler.stop(true);
    expect(scheduler.getStatus().running).toBe(false);
    saved = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
    expect(saved.schedulerEnabled).toBe(false);
  });

  it('configures schedule time and auto-start persistently', async () => {
    const cfgPath = path.join(dir, 'people.json');
    fs.writeFileSync(cfgPath, JSON.stringify({ people: [] }));
    const configRepo = new FileConfigRepository(cfgPath);

    const scheduler = new NodeSchedulerRepository(
      { timezone: 'Asia/Kolkata', startTime: '09:30', scheduleTime: '09:30' },
      configRepo
    );

    await scheduler.configure({ startTime: '11:15', timezone: 'UTC', autoStart: true });
    const status = scheduler.getStatus();
    expect(status.startTime).toBe('11:15');
    expect(status.timezone).toBe('UTC');
    expect(status.autoStart).toBe(true);

    const saved = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
    expect(saved.scheduleTime).toBe('11:15');
    expect(saved.schedulerAutoStart).toBe(true);
    expect(saved.timezone).toBe('UTC');
  });

  it('triggers immediate execution via triggerRunNow', async () => {
    let executed = false;
    const scheduler = new NodeSchedulerRepository({ timezone: 'UTC', startTime: '09:30' });
    scheduler.setScheduleFunction(async () => {
      executed = true;
    });

    const res = await scheduler.triggerRunNow();
    expect(res.success).toBe(true);
    // Allow promise tick for async execution
    await new Promise(r => setTimeout(r, 50));
    expect(executed).toBe(true);
    expect(scheduler.getStatus().lastRunResult).toBe('success');
  });

  it('schedules next auto-close for tomorrow or next weekday when lastAutoClose is already today', () => {
    const todayIso = new Date().toLocaleDateString('en-CA');
    const scheduler = new NodeSchedulerRepository({
      timezone: 'UTC',
      startTime: '09:30',
      autoClose: true,
      autoCloseStartTime: '18:15',
      autoCloseEndTime: '18:45',
      lastAutoClose: todayIso,
    });
    const res = (scheduler as any).getNextAutoCloseTarget();
    expect(res).not.toBeNull();
    const targetIso = new Intl.DateTimeFormat('en-CA', { timeZone: 'UTC' }).format(res.target);
    expect(targetIso > todayIso).toBe(true);
  });

  it('does not mark lastAutoClose as success when autoCloseFn finds 0 tasks', async () => {
    const cfgPath = path.join(dir, 'people.json');
    fs.writeFileSync(cfgPath, JSON.stringify({ people: [], autoClose: true }));
    const configRepo = new FileConfigRepository(cfgPath);

    const scheduler = new NodeSchedulerRepository(
      { timezone: 'UTC', startTime: '09:30', autoClose: true },
      configRepo
    );

    scheduler.setAutoCloseFunction(async () => {
      return {
        targetDate: '2026-10-16',
        totalFound: 0,
        totalClosed: 0,
        totalAlreadyClosed: 0,
        totalFailed: 0,
      };
    });

    await (scheduler as any).runAutoCloseScheduled();
    const reloaded = await configRepo.load();
    expect(reloaded.lastAutoClose).toBeUndefined();
    expect(scheduler.getStatus().lastAutoCloseResult).toBe('empty');
  });

  it('persists lastAutoClose as success when autoCloseFn closes or finds tasks', async () => {
    const cfgPath = path.join(dir, 'people.json');
    fs.writeFileSync(cfgPath, JSON.stringify({ people: [], autoClose: true }));
    const configRepo = new FileConfigRepository(cfgPath);

    const scheduler = new NodeSchedulerRepository(
      { timezone: 'UTC', startTime: '09:30', autoClose: true },
      configRepo
    );

    scheduler.setAutoCloseFunction(async () => {
      return {
        targetDate: '2026-10-16',
        totalFound: 4,
        totalClosed: 4,
        totalAlreadyClosed: 0,
        totalFailed: 0,
      };
    });

    await (scheduler as any).runAutoCloseScheduled();
    const reloaded = await configRepo.load();
    expect(reloaded.lastAutoClose).toBeDefined();
    expect(scheduler.getStatus().lastAutoCloseResult).toBe('success');
  });

  it('starts and stops the heartbeat timer with the scheduler', async () => {
    const scheduler = new NodeSchedulerRepository({ timezone: 'UTC', startTime: '09:30', autoClose: true });
    expect((scheduler as any).heartbeatTimer).toBeNull();
    await scheduler.start(false);
    expect((scheduler as any).heartbeatTimer).not.toBeNull();
    await scheduler.stop(false);
    expect((scheduler as any).heartbeatTimer).toBeNull();
  });
});
