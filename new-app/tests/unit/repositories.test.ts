import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { FileLockRepository } from '../../src/infrastructure/lock/file-lock-repo';
import { FileJournalRepository } from '../../src/infrastructure/journal/file-journal-repo';
import { FileConfigRepository } from '../../src/infrastructure/config/file-config-repo';
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

  it('treats an old lock as stale', () => {
    const lockPath = path.join(dir, '.lock.json');
    const old = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    fs.writeFileSync(lockPath, JSON.stringify({ pid: process.pid, acquiredAt: old, stale: false }));
    const lock = new FileLockRepository(lockPath);
    expect(lock.getLockInfo()?.stale).toBe(true);
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

  it('finds unfinished relation copies', async () => {
    const journal = new FileJournalRepository(path.join(dir, '.journal.json'));
    await journal.record(entry({ relationCopyStatus: 'SUCCESS' }));
    await journal.record(entry({ relationCopyStatus: 'PARTIAL' }));
    await journal.record(entry({ relationCopyStatus: 'FAILED' }));
    const unfinished = await journal.getUnfinishedRelations();
    expect(unfinished).toHaveLength(2);
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

  it('exports JSON', async () => {
    const journal = new FileJournalRepository(path.join(dir, '.journal.json'));
    await journal.record(entry());
    const json = JSON.parse(await journal.exportJson());
    expect(Array.isArray(json)).toBe(true);
    expect(json).toHaveLength(1);
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

  it('persists people updates', async () => {
    const cfgPath = path.join(dir, 'people.json');
    fs.writeFileSync(cfgPath, JSON.stringify({ people: [] }));
    const repo = new FileConfigRepository(cfgPath);
    await repo.savePeople([{ key: 'p1', name: 'A', assignedTo: 'a@b.com' }]);
    const reloaded = JSON.parse(fs.readFileSync(cfgPath, 'utf-8'));
    expect(reloaded.people).toHaveLength(1);
  });
});
