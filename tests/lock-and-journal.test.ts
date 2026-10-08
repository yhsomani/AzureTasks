import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { ExecutionLock } from '../src/utils/lock.js';
import { TaskJournal } from '../src/task/journal.js';

describe('ExecutionLock & TaskJournal Services', () => {
  const testLockPath = '.test-lock.lock';
  const testJournalPath = '.test-journal.json';

  beforeEach(() => {
    if (fs.existsSync(testLockPath)) fs.unlinkSync(testLockPath);
    if (fs.existsSync(testJournalPath)) fs.unlinkSync(testJournalPath);
  });

  afterEach(() => {
    if (fs.existsSync(testLockPath)) fs.unlinkSync(testLockPath);
    if (fs.existsSync(testJournalPath)) fs.unlinkSync(testJournalPath);
  });

  it('ExecutionLock: acquires and releases lock successfully', () => {
    const lock = new ExecutionLock(testLockPath);
    expect(() => lock.acquire()).not.toThrow();
    expect(fs.existsSync(testLockPath)).toBe(true);

    // Second acquire by another instance should fail
    const lock2 = new ExecutionLock(testLockPath);
    expect(() => lock2.acquire()).toThrow(/CONCURRENT_EXECUTION/);

    // Release allows acquiring again
    lock.release();
    expect(fs.existsSync(testLockPath)).toBe(false);
    expect(() => lock2.acquire()).not.toThrow();
    lock2.release();
  });

  it('ExecutionLock: cleans up stale lock from terminated PID', () => {
    // Write fake stale lock with PID 99999999 (almost certainly non-existent)
    const staleData = {
      pid: 99999999,
      hostname: 'test-host',
      user: 'test-user',
      timestamp: new Date().toISOString(),
    };
    fs.writeFileSync(testLockPath, JSON.stringify(staleData));

    const lock = new ExecutionLock(testLockPath);
    // Should detect stale lock, unlink it, and acquire successfully
    expect(() => lock.acquire()).not.toThrow();
    lock.release();
  });

  it('TaskJournal: records entries and finds unfinished relations for repair', () => {
    const journal = new TaskJournal(testJournalPath);
    expect(journal.getEntries()).toHaveLength(0);

    journal.recordEntry({
      runId: 'run-1',
      timestamp: new Date().toISOString(),
      personName: 'Rahul',
      assignedTo: 'rahul@company.com',
      targetIsoDate: '2026-10-12',
      title: '3in1_PWA_MyAccount | 12 Oct',
      sourceTaskId: 1001,
      createdWorkItemId: 5001,
      fieldCopyStatus: 'SUCCESS',
      relationCopyStatus: 'PARTIAL', // Partial failure
      verified: true,
    });

    journal.recordEntry({
      runId: 'run-1',
      timestamp: new Date().toISOString(),
      personName: 'Priya',
      assignedTo: 'priya@company.com',
      targetIsoDate: '2026-10-12',
      title: '3in1_PWA_MyAccount | 12 Oct',
      sourceTaskId: 1002,
      createdWorkItemId: 5002,
      fieldCopyStatus: 'SUCCESS',
      relationCopyStatus: 'SUCCESS', // Full success
      verified: true,
    });

    const entries = journal.getEntries();
    expect(entries).toHaveLength(2);

    const unfinished = journal.getUnfinishedRelations();
    expect(unfinished).toHaveLength(1);
    expect(unfinished[0].createdWorkItemId).toBe(5001);
    expect(unfinished[0].personName).toBe('Rahul');
  });
});
