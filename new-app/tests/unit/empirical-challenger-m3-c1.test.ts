import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { fork } from 'child_process';
import { randomUUID } from 'node:crypto';
import { FileLockRepository } from '../../src/infrastructure/lock/file-lock-repo.js';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'challenger-lock-test-'));
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('Empirical Challenger M3-C1: Corrupted Lock Files', () => {
  it('handles 0-byte lock file: treated as stale immediately, can be acquired', () => {
    const lockPath = path.join(dir, '.lock.json');
    fs.writeFileSync(lockPath, '');
    expect(fs.statSync(lockPath).size).toBe(0);

    const lock = new FileLockRepository(lockPath);
    // isLocked should return false for 0-byte file
    expect(lock.isLocked()).toBe(false);

    const info = lock.getLockInfo();
    expect(info).not.toBeNull();
    expect(info?.pid).toBe(0);
    expect(info?.stale).toBe(true);

    // Acquire should succeed and replace 0-byte file with valid JSON lock
    expect(lock.acquire()).toBe(true);
    expect(lock.isLocked()).toBe(true);

    const newContent = JSON.parse(fs.readFileSync(lockPath, 'utf-8'));
    expect(newContent.pid).toBe(process.pid);
    expect(newContent.stale).toBe(false);
    expect(typeof newContent.ownerToken).toBe('string');
  });

  it('handles truncated JSON: fails closed when < 60s old, reclaims when >= 60s old', () => {
    const lockPath = path.join(dir, '.lock.json');
    const truncatedJson = '{"pid": 12345, "acquiredAt": "2026-10-20T00:00:00';
    fs.writeFileSync(lockPath, truncatedJson);

    // Test Case 1: Fresh corrupted lock (< 60s) -> must fail closed!
    const freshLock = new FileLockRepository(lockPath);
    expect(freshLock.isLocked()).toBe(true);
    expect(freshLock.getLockInfo()?.stale).toBe(false);
    expect(freshLock.acquire()).toBe(false);
    // File content must remain unchanged
    expect(fs.readFileSync(lockPath, 'utf-8')).toBe(truncatedJson);

    // Test Case 2: Aged corrupted lock (aged 61s) -> must be reclaimed!
    const past = new Date(Date.now() - 61_000);
    fs.utimesSync(lockPath, past, past);

    const agedLock = new FileLockRepository(lockPath);
    expect(agedLock.isLocked()).toBe(false);
    expect(agedLock.getLockInfo()?.stale).toBe(true);
    expect(agedLock.acquire()).toBe(true);
    expect(agedLock.isLocked()).toBe(true);
  });

  it('handles random binary garbage: fails closed when < 60s old, reclaims when >= 60s old', () => {
    const lockPath = path.join(dir, '.lock.json');
    const binaryGarbage = Buffer.from([0x00, 0xff, 0xfe, 0xde, 0xad, 0xbe, 0xef, 0x01, 0x02, 0x03]);
    fs.writeFileSync(lockPath, binaryGarbage);

    // Case 1: Fresh binary garbage (< 60s) -> fails closed
    const freshLock = new FileLockRepository(lockPath);
    expect(freshLock.isLocked()).toBe(true);
    expect(freshLock.getLockInfo()?.stale).toBe(false);
    expect(freshLock.acquire()).toBe(false);

    // Case 2: Aged binary garbage (aged 70s) -> reclaims
    const past = new Date(Date.now() - 70_000);
    fs.utimesSync(lockPath, past, past);

    const agedLock = new FileLockRepository(lockPath);
    expect(agedLock.isLocked()).toBe(false);
    expect(agedLock.getLockInfo()?.stale).toBe(true);
    expect(agedLock.acquire()).toBe(true);
    expect(agedLock.isLocked()).toBe(true);
  });

  it('handles malformed JSON types (arrays, primitives, invalid schemas)', () => {
    const malformedPayloads = [
      '[]',
      '["pid", 123]',
      '"just a string"',
      '42',
      'true',
      'null',
      '{"pid": "not-a-number", "acquiredAt": "2026-10-20T00:00:00.000Z"}',
      '{"pid": -5, "acquiredAt": "2026-10-20T00:00:00.000Z"}',
      '{"pid": 1.23, "acquiredAt": "2026-10-20T00:00:00.000Z"}',
      '{"pid": 999999}', // missing acquiredAt
      '{"pid": 999999, "acquiredAt": "invalid-date-string"}',
      '{"acquiredAt": "2026-10-20T00:00:00.000Z"}', // missing pid
    ];

    for (const payload of malformedPayloads) {
      const lockPath = path.join(dir, `.lock-${randomUUID()}.json`);
      fs.writeFileSync(lockPath, payload);

      // Fresh: must fail closed
      const lockFresh = new FileLockRepository(lockPath);
      const freshInfo = lockFresh.getLockInfo();
      expect(lockFresh.isLocked(), `Payload failed to fail closed: ${payload}`).toBe(true);
      expect(freshInfo?.stale, `Payload reported stale when fresh: ${payload}`).toBe(false);
      expect(lockFresh.acquire(), `Payload acquired when fresh: ${payload}`).toBe(false);

      // Aged > 60s: must be reclaimable
      const past = new Date(Date.now() - 65_000);
      fs.utimesSync(lockPath, past, past);

      const lockAged = new FileLockRepository(lockPath);
      expect(lockAged.isLocked(), `Payload failed to unlock when aged: ${payload}`).toBe(false);
      expect(lockAged.getLockInfo()?.stale, `Payload failed to report stale when aged: ${payload}`).toBe(true);
      expect(lockAged.acquire(), `Payload failed to acquire when aged: ${payload}`).toBe(true);
      expect(lockAged.isLocked()).toBe(true);
    }
  });

  it('verifies exact 60-second boundary precision', () => {
    const lockPath = path.join(dir, '.lock-boundary.json');
    fs.writeFileSync(lockPath, '{"broken":');

    // 59 seconds ago -> must fail closed (< 60s)
    const subBoundary = new Date(Date.now() - 59_000);
    fs.utimesSync(lockPath, subBoundary, subBoundary);
    const lockSub = new FileLockRepository(lockPath);
    expect(lockSub.getLockInfo()?.stale).toBe(false);
    expect(lockSub.acquire()).toBe(false);

    // 61 seconds ago -> must be stale (>= 60s)
    const overBoundary = new Date(Date.now() - 61_000);
    fs.utimesSync(lockPath, overBoundary, overBoundary);
    const lockOver = new FileLockRepository(lockPath);
    expect(lockOver.getLockInfo()?.stale).toBe(true);
    expect(lockOver.acquire()).toBe(true);
  });
});

describe('Empirical Challenger M3-C1: Stale Lock Race Conditions & TOCTOU Mitigation', () => {
  it('simulates 20 concurrent in-memory contenders racing for a stale dead-PID lock', () => {
    const lockPath = path.join(dir, '.lock.json');
    fs.writeFileSync(lockPath, JSON.stringify({
      pid: 999999,
      acquiredAt: new Date(Date.now() - 120_000).toISOString(),
      stale: true,
    }));

    const contenders = Array.from({ length: 20 }, () => new FileLockRepository(lockPath));

    // Verify all observe stale initially
    for (const c of contenders) {
      expect(c.getLockInfo()?.stale).toBe(true);
    }

    // All contenders race to acquire synchronously
    const results = contenders.map(c => c.acquire());

    // Exactly ONE winner
    const wins = results.filter(r => r === true);
    const losses = results.filter(r => r === false);
    expect(wins).toHaveLength(1);
    expect(losses).toHaveLength(19);

    // The lock file on disk must be valid and locked
    const winnerLock = contenders[results.indexOf(true)];
    expect(winnerLock.isLocked()).toBe(true);

    const onDisk = JSON.parse(fs.readFileSync(lockPath, 'utf-8'));
    expect(onDisk.pid).toBe(process.pid);
    expect(onDisk.stale).toBe(false);

    // No leftover .stale temp files in directory
    const files = fs.readdirSync(dir);
    const staleTemps = files.filter(f => f.includes('.stale'));
    expect(staleTemps).toEqual([]);
  });

  it('simulates 20 concurrent in-memory contenders racing for an aged corrupted lock', () => {
    const lockPath = path.join(dir, '.lock.json');
    fs.writeFileSync(lockPath, '{"broken": garbage, incomplete:');
    const past = new Date(Date.now() - 100_000);
    fs.utimesSync(lockPath, past, past);

    const contenders = Array.from({ length: 20 }, () => new FileLockRepository(lockPath));

    const results = contenders.map(c => c.acquire());

    const wins = results.filter(r => r === true);
    const losses = results.filter(r => r === false);
    expect(wins).toHaveLength(1);
    expect(losses).toHaveLength(19);

    const winner = contenders[results.indexOf(true)];
    expect(winner.isLocked()).toBe(true);

    const onDisk = JSON.parse(fs.readFileSync(lockPath, 'utf-8'));
    expect(onDisk.pid).toBe(process.pid);

    const files = fs.readdirSync(dir);
    const staleTemps = files.filter(f => f.includes('.stale'));
    expect(staleTemps).toEqual([]);
  });

  it('never unlinks active locks when contender races against an already-reclaimed lock', () => {
    const lockPath = path.join(dir, '.lock.json');
    // Lock was stale
    fs.writeFileSync(lockPath, JSON.stringify({
      pid: 999999,
      acquiredAt: new Date(Date.now() - 100_000).toISOString(),
      stale: true,
    }));

    const lockA = new FileLockRepository(lockPath);
    const lockB = new FileLockRepository(lockPath);

    // Both see stale
    const infoA = lockA.getLockInfo();
    const infoB = lockB.getLockInfo();
    expect(infoA?.stale).toBe(true);
    expect(infoB?.stale).toBe(true);

    // Lock A acquires successfully and writes active lock
    expect(lockA.acquire()).toBe(true);
    const activeLockInfo = JSON.parse(fs.readFileSync(lockPath, 'utf-8'));
    const activeToken = activeLockInfo.ownerToken;
    expect(activeToken).toBeTruthy();

    // Lock B tries to acquire now
    expect(lockB.acquire()).toBe(false);

    // Lock A's active lock must still be 100% intact!
    expect(fs.existsSync(lockPath)).toBe(true);
    const currentOnDisk = JSON.parse(fs.readFileSync(lockPath, 'utf-8'));
    expect(currentOnDisk.ownerToken).toBe(activeToken);
    expect(currentOnDisk.pid).toBe(process.pid);
    expect(lockA.isLocked()).toBe(true);
  });
});

describe('Empirical Challenger M3-C1: Multi-Process OS Concurrency Stress Harness', () => {
  it('coordinates 8 OS processes racing to reclaim the same stale lock via child_process.fork', async () => {
    const lockPath = path.join(dir, '.lock.json');
    // Write stale lock
    fs.writeFileSync(lockPath, JSON.stringify({
      pid: 999999,
      acquiredAt: new Date(Date.now() - 120_000).toISOString(),
      stale: true,
    }));

    // Create a worker helper script using compiled dist/ file
    const distRepoPath = path.resolve(process.cwd(), 'dist/infrastructure/lock/file-lock-repo.js');
    const workerScript = path.join(dir, 'worker.mjs');
    fs.writeFileSync(workerScript, `
      import { FileLockRepository } from '${distRepoPath}';
      const lockPath = process.argv[2];
      const repo = new FileLockRepository(lockPath);

      process.on('message', (msg) => {
        if (msg === 'START') {
          const acquired = repo.acquire();
          process.send({ acquired, pid: process.pid });
        }
      });
      process.send('READY');
    `);

    const numWorkers = 8;
    const workers: any[] = [];
    const readyPromises: Promise<void>[] = [];

    for (let i = 0; i < numWorkers; i++) {
      const w = fork(workerScript, [lockPath], { execArgv: [], stdio: ['inherit', 'inherit', 'inherit', 'ipc'] });
      workers.push(w);
      readyPromises.push(new Promise<void>(resolve => {
        w.once('message', (msg) => {
          if (msg === 'READY') resolve();
        });
      }));
    }

    // Wait for all workers to signal READY
    await Promise.all(readyPromises);

    // Send simultaneous START message to all child processes
    const outcomePromises = workers.map(w => {
      return new Promise<{ acquired: boolean; pid: number }>(resolve => {
        w.once('message', (res: any) => resolve(res));
        w.send('START');
      });
    });

    const outcomes = await Promise.all(outcomePromises);

    // Cleanup worker processes
    for (const w of workers) {
      w.kill();
    }

    const wins = outcomes.filter(o => o.acquired === true);
    const losses = outcomes.filter(o => o.acquired === false);

    expect(wins.length).toBe(1);
    expect(losses.length).toBe(numWorkers - 1);

    // Confirm that the lock on disk matches the PID of the winning process
    const winnerPid = wins[0].pid;
    const diskContent = JSON.parse(fs.readFileSync(lockPath, 'utf-8'));
    expect(diskContent.pid).toBe(winnerPid);
    expect(diskContent.stale).toBe(false);

    // Ensure no orphan .stale files
    const orphanFiles = fs.readdirSync(dir).filter(f => f.includes('.stale'));
    expect(orphanFiles).toEqual([]);
  });
});

describe('Empirical Challenger M3-C1: Lock Release Invariants', () => {
  it('does not allow non-owner or different instances to release an active lock', () => {
    const lockPath = path.join(dir, '.lock.json');
    const owner = new FileLockRepository(lockPath);
    const nonOwner = new FileLockRepository(lockPath);

    expect(owner.acquire()).toBe(true);
    expect(owner.isLocked()).toBe(true);

    // Non-owner release attempt
    nonOwner.release();
    expect(owner.isLocked()).toBe(true);
    expect(fs.existsSync(lockPath)).toBe(true);

    // Owner releases
    owner.release();
    expect(owner.isLocked()).toBe(false);
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it('does not release lock if lock file was replaced by another owner on disk', () => {
    const lockPath = path.join(dir, '.lock.json');
    const owner = new FileLockRepository(lockPath);

    expect(owner.acquire()).toBe(true);

    // Simulate another process replacing the lock file on disk with a new token
    const foreignToken = randomUUID();
    fs.writeFileSync(lockPath, JSON.stringify({
      pid: process.pid,
      acquiredAt: new Date().toISOString(),
      stale: false,
      ownerToken: foreignToken,
    }));

    // Owner attempts release
    owner.release();

    // The replaced lock must NOT be deleted because token does not match!
    expect(fs.existsSync(lockPath)).toBe(true);
    const onDisk = JSON.parse(fs.readFileSync(lockPath, 'utf-8'));
    expect(onDisk.ownerToken).toBe(foreignToken);
  });

  it('does not release lock if PID in file does not match current process', () => {
    const lockPath = path.join(dir, '.lock.json');
    const owner = new FileLockRepository(lockPath);

    expect(owner.acquire()).toBe(true);

    // Read the owner token that was generated
    const originalContent = JSON.parse(fs.readFileSync(lockPath, 'utf-8'));
    const token = originalContent.ownerToken;

    // Overwrite lock with same token but different PID (e.g. 999998)
    fs.writeFileSync(lockPath, JSON.stringify({
      pid: 999998,
      acquiredAt: new Date().toISOString(),
      stale: false,
      ownerToken: token,
    }));

    // Owner attempts release
    owner.release();

    // Must not delete the file
    expect(fs.existsSync(lockPath)).toBe(true);
    const onDisk = JSON.parse(fs.readFileSync(lockPath, 'utf-8'));
    expect(onDisk.pid).toBe(999998);
  });

  it('handles multiple idempotent release() calls without error', () => {
    const lockPath = path.join(dir, '.lock.json');
    const owner = new FileLockRepository(lockPath);

    expect(owner.acquire()).toBe(true);
    expect(() => owner.release()).not.toThrow();
    expect(fs.existsSync(lockPath)).toBe(false);

    // Second release call should be a no-op
    expect(() => owner.release()).not.toThrow();
    expect(fs.existsSync(lockPath)).toBe(false);
  });

  it('prevents double-acquire on same repository instance without intervening release', () => {
    const lockPath = path.join(dir, '.lock.json');
    const owner = new FileLockRepository(lockPath);

    expect(owner.acquire()).toBe(true);
    // Double acquire on same instance must return false (already owned)
    expect(owner.acquire()).toBe(false);

    owner.release();
    // After release, can acquire again
    expect(owner.acquire()).toBe(true);
    owner.release();
  });
});
