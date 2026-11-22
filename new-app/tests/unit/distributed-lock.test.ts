import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createDatabase, WorkOpsDb } from '../../src/infrastructure/persistence/database.js';
import {
  SqliteLockManager,
  PostgresLockManager,
  RedisLockManager,
  createLockManager,
} from '../../src/infrastructure/lock/distributed-lock-manager.js';

describe('Milestone 3 — Feature 22: Distributed Execution Locking', () => {
  let tempDir: string;
  let sqlitePath: string;
  let db: WorkOpsDb;
  let sqliteLock: SqliteLockManager;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workops-lock-test-'));
    sqlitePath = path.join(tempDir, 'lock-test.db');
    db = createDatabase({ sqlitePath, engine: 'sqlite' });
    sqliteLock = new SqliteLockManager((db as any).sqlite);
  });

  afterEach(() => {
    if (db && db.engine === 'sqlite') {
      db.close();
    }
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('SqliteLockManager', () => {
    it('acquires lock on unheld resource and prevents concurrent acquisition', async () => {
      const resource = 'resource-task-1';
      const handle1 = await sqliteLock.acquire(resource, 30000, 'owner-alpha');

      expect(handle1).not.toBeNull();
      expect(handle1?.resource).toBe(resource);
      expect(handle1?.ownerToken).toBe('owner-alpha');

      // Second node tries to acquire same resource -> must be denied (null)
      const handle2 = await sqliteLock.acquire(resource, 30000, 'owner-beta');
      expect(handle2).toBeNull();

      expect(await sqliteLock.isLocked(resource)).toBe(true);
    });

    it('releases lock only when provided correct owner token', async () => {
      const resource = 'resource-task-2';
      const handle = await sqliteLock.acquire(resource, 30000, 'owner-alpha');
      expect(handle).not.toBeNull();

      // Release attempt with wrong owner token must fail
      const badRelease = await sqliteLock.release(resource, 'owner-wrong');
      expect(badRelease).toBe(false);
      expect(await sqliteLock.isLocked(resource)).toBe(true);

      // Release with correct owner handle must succeed
      const goodRelease = await sqliteLock.release(handle!);
      expect(goodRelease).toBe(true);
      expect(await sqliteLock.isLocked(resource)).toBe(false);
    });

    it('extends heartbeat lease duration for long-running operations', async () => {
      const resource = 'resource-task-3';
      const handle = await sqliteLock.acquire(resource, 10000, 'owner-alpha');
      expect(handle).not.toBeNull();

      const extended = await sqliteLock.extend(handle!, 60000);
      expect(extended).toBe(true);

      // Cannot extend with wrong token
      const badExtend = await sqliteLock.extend(resource, 60000, 'owner-wrong');
      expect(badExtend).toBe(false);
    });

    it('automatically reclaims expired lock after lease TTL has elapsed', async () => {
      const resource = 'resource-task-4';
      // Acquire lock with 1ms TTL
      const handle1 = await sqliteLock.acquire(resource, 1, 'owner-alpha');
      expect(handle1).not.toBeNull();

      // Wait 10ms for lease to expire
      await new Promise((r) => setTimeout(r, 10));

      expect(await sqliteLock.isLocked(resource)).toBe(false);

      // Second node should now be able to acquire
      const handle2 = await sqliteLock.acquire(resource, 30000, 'owner-beta');
      expect(handle2).not.toBeNull();
      expect(handle2?.ownerToken).toBe('owner-beta');
    });
  });

  describe('PostgresLockManager', () => {
    it('executes atomic acquisition with row-level locks and commit/rollback', async () => {
      let lockRow: any = null;
      const mockClient = {
        query: vi.fn().mockImplementation(async (sql: string, params?: any[]) => {
          if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') return {};
          if (sql.includes('SELECT owner_token')) {
            if (lockRow && lockRow.expires_at > Date.now()) {
              return { rows: [lockRow] };
            }
            return { rows: [] };
          }
          if (sql.includes('INSERT INTO distributed_locks')) {
            lockRow = { lock_key: params![0], owner_token: params![1], expires_at: params![2] };
            return { rowCount: 1 };
          }
          if (sql.includes('DELETE FROM distributed_locks')) {
            if (lockRow && lockRow.owner_token === params![1]) {
              lockRow = null;
              return { rowCount: 1 };
            }
            return { rowCount: 0 };
          }
          return { rows: [] };
        }),
        release: vi.fn(),
      };

      const mockPool = {
        connect: vi.fn().mockResolvedValue(mockClient),
        query: mockClient.query,
      };

      const pgLock = new PostgresLockManager(mockPool);
      const handle = await pgLock.acquire('pg-resource-1', 30000, 'pg-owner-1');
      expect(handle).not.toBeNull();
      expect(handle?.ownerToken).toBe('pg-owner-1');

      // Concurrent acquire
      const handle2 = await pgLock.acquire('pg-resource-1', 30000, 'pg-owner-2');
      expect(handle2).toBeNull();

      // Release
      const released = await pgLock.release(handle!);
      expect(released).toBe(true);
    });
  });

  describe('RedisLockManager', () => {
    it('executes atomic set NX/PX and Lua script release and extend', async () => {
      const store = new Map<string, string>();
      const mockRedis = {
        set: vi.fn().mockImplementation(async (key: string, val: string, _mode: string, _ttl: number, flag: string) => {
          if (flag === 'NX' && store.has(key)) return null;
          store.set(key, val);
          return 'OK';
        }),
        eval: vi.fn().mockImplementation(async (_script: string, _numkeys: number, key: string, token: string) => {
          if (store.get(key) === token) {
            store.delete(key);
            return 1;
          }
          return 0;
        }),
        exists: vi.fn().mockImplementation(async (key: string) => (store.has(key) ? 1 : 0)),
      };

      const redisLock = new RedisLockManager(mockRedis);
      const handle = await redisLock.acquire('redis-resource-1', 30000, 'redis-owner-1');
      expect(handle).not.toBeNull();
      expect(mockRedis.set).toHaveBeenCalledWith('redis-resource-1', 'redis-owner-1', 'PX', 30000, 'NX');

      // Second acquire fails
      const handle2 = await redisLock.acquire('redis-resource-1', 30000, 'redis-owner-2');
      expect(handle2).toBeNull();

      // Release via Lua script
      const released = await redisLock.release(handle!);
      expect(released).toBe(true);
    });
  });

  describe('createLockManager factory', () => {
    it('creates appropriate lock manager based on engine and options', () => {
      const sqliteMgr = createLockManager(db);
      expect(sqliteMgr).toBeInstanceOf(SqliteLockManager);

      const redisMgr = createLockManager(undefined, {} as any);
      expect(redisMgr).toBeInstanceOf(RedisLockManager);
    });
  });
});
