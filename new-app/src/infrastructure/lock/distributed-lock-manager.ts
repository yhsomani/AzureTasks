import crypto from 'node:crypto';
import { ILockManager, LockHandle } from '../../domain/ports/repositories.js';
import { WorkOpsDb } from '../persistence/database.js';

export class SqliteLockManager implements ILockManager {
  constructor(private readonly sqlite: any) {}

  async acquire(resource: string, ttlMs = 30000, ownerToken?: string): Promise<LockHandle | null> {
    const token = ownerToken || crypto.randomUUID();
    const now = Date.now();
    const expiresAt = now + ttlMs;

    try {
      this.sqlite.exec('BEGIN IMMEDIATE;');
      const existing = this.sqlite
        .prepare('SELECT owner_token, expires_at FROM distributed_locks WHERE lock_key = ?')
        .get(resource) as any;

      if (existing && Number(existing.expires_at) > now && existing.owner_token !== token) {
        this.sqlite.exec('COMMIT;');
        return null; // Lock held by another node
      }

      this.sqlite
        .prepare(
          `INSERT INTO distributed_locks (lock_key, owner_token, expires_at)
           VALUES (?, ?, ?)
           ON CONFLICT(lock_key) DO UPDATE SET
             owner_token = excluded.owner_token,
             expires_at = excluded.expires_at`
        )
        .run(resource, token, expiresAt);

      this.sqlite.exec('COMMIT;');
      return { resource, ownerToken: token, expiresAt };
    } catch {
      try {
        this.sqlite.exec('ROLLBACK;');
      } catch {
        // ignore
      }
      return null;
    }
  }

  async release(handleOrResource: LockHandle | string, ownerToken?: string): Promise<boolean> {
    const resource = typeof handleOrResource === 'string' ? handleOrResource : handleOrResource.resource;
    const token = typeof handleOrResource === 'string' ? ownerToken : handleOrResource.ownerToken;

    if (!token) return false;

    try {
      const res = this.sqlite
        .prepare('DELETE FROM distributed_locks WHERE lock_key = ? AND owner_token = ?')
        .run(resource, token);
      return res.changes > 0;
    } catch {
      return false;
    }
  }

  async extend(handleOrResource: LockHandle | string, additionalMs: number, ownerToken?: string): Promise<boolean> {
    const resource = typeof handleOrResource === 'string' ? handleOrResource : handleOrResource.resource;
    const token = typeof handleOrResource === 'string' ? ownerToken : handleOrResource.ownerToken;

    if (!token) return false;

    const newExpiresAt = Date.now() + additionalMs;
    try {
      const res = this.sqlite
        .prepare(
          `UPDATE distributed_locks
           SET expires_at = ?
           WHERE lock_key = ? AND owner_token = ? AND expires_at > ?`
        )
        .run(newExpiresAt, resource, token, Date.now());
      return res.changes > 0;
    } catch {
      return false;
    }
  }

  async isLocked(resource: string): Promise<boolean> {
    try {
      const row = this.sqlite
        .prepare('SELECT expires_at FROM distributed_locks WHERE lock_key = ?')
        .get(resource) as any;
      if (!row) return false;
      return Number(row.expires_at) > Date.now();
    } catch {
      return false;
    }
  }

  async checkHealth(): Promise<{ healthy: boolean; error?: string }> {
    try {
      this.sqlite.prepare('SELECT 1 FROM distributed_locks LIMIT 1;').get();
      return { healthy: true };
    } catch (err: any) {
      return { healthy: false, error: err?.message || String(err) };
    }
  }
}

export class PostgresLockManager implements ILockManager {
  constructor(private readonly pool: any) {}

  async acquire(resource: string, ttlMs = 30000, ownerToken?: string): Promise<LockHandle | null> {
    const token = ownerToken || crypto.randomUUID();
    const now = Date.now();
    const expiresAt = now + ttlMs;

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const selectRes = await client.query(
        'SELECT owner_token, expires_at FROM distributed_locks WHERE lock_key = $1 FOR UPDATE',
        [resource]
      );

      if (selectRes.rows.length > 0) {
        const row = selectRes.rows[0];
        if (Number(row.expires_at) > now && row.owner_token !== token) {
          await client.query('COMMIT');
          return null; // Lock held by another node
        }
      }

      await client.query(
        `INSERT INTO distributed_locks (lock_key, owner_token, expires_at)
         VALUES ($1, $2, $3)
         ON CONFLICT (lock_key) DO UPDATE SET
           owner_token = EXCLUDED.owner_token,
           expires_at = EXCLUDED.expires_at`,
        [resource, token, expiresAt]
      );

      await client.query('COMMIT');
      return { resource, ownerToken: token, expiresAt };
    } catch {
      await client.query('ROLLBACK');
      return null;
    } finally {
      client.release();
    }
  }

  async release(handleOrResource: LockHandle | string, ownerToken?: string): Promise<boolean> {
    const resource = typeof handleOrResource === 'string' ? handleOrResource : handleOrResource.resource;
    const token = typeof handleOrResource === 'string' ? ownerToken : handleOrResource.ownerToken;

    if (!token) return false;

    const res = await this.pool.query(
      'DELETE FROM distributed_locks WHERE lock_key = $1 AND owner_token = $2',
      [resource, token]
    );
    return (res.rowCount ?? 0) > 0;
  }

  async extend(handleOrResource: LockHandle | string, additionalMs: number, ownerToken?: string): Promise<boolean> {
    const resource = typeof handleOrResource === 'string' ? handleOrResource : handleOrResource.resource;
    const token = typeof handleOrResource === 'string' ? ownerToken : handleOrResource.ownerToken;

    if (!token) return false;

    const newExpiresAt = Date.now() + additionalMs;
    const res = await this.pool.query(
      `UPDATE distributed_locks
       SET expires_at = $1
       WHERE lock_key = $2 AND owner_token = $3 AND expires_at > $4`,
      [newExpiresAt, resource, token, Date.now()]
    );
    return (res.rowCount ?? 0) > 0;
  }

  async isLocked(resource: string): Promise<boolean> {
    const res = await this.pool.query(
      'SELECT expires_at FROM distributed_locks WHERE lock_key = $1',
      [resource]
    );
    if (res.rows.length === 0) return false;
    return Number(res.rows[0].expires_at) > Date.now();
  }

  async checkHealth(): Promise<{ healthy: boolean; error?: string }> {
    try {
      await this.pool.query('SELECT 1 FROM distributed_locks LIMIT 1;');
      return { healthy: true };
    } catch (err: any) {
      return { healthy: false, error: err?.message || String(err) };
    }
  }
}

export class RedisLockManager implements ILockManager {
  private static readonly RELEASE_LUA = `
    if redis.call("get", KEYS[1]) == ARGV[1] then
      return redis.call("del", KEYS[1])
    else
      return 0
    end
  `;

  private static readonly EXTEND_LUA = `
    if redis.call("get", KEYS[1]) == ARGV[1] then
      return redis.call("pexpire", KEYS[1], ARGV[2])
    else
      return 0
    end
  `;

  constructor(private readonly redis: any) {}

  async acquire(resource: string, ttlMs = 30000, ownerToken?: string): Promise<LockHandle | null> {
    const token = ownerToken || crypto.randomUUID();
    const result = await this.redis.set(resource, token, 'PX', ttlMs, 'NX');
    if (result === 'OK') {
      return { resource, ownerToken: token, expiresAt: Date.now() + ttlMs };
    }
    return null;
  }

  async release(handleOrResource: LockHandle | string, ownerToken?: string): Promise<boolean> {
    const resource = typeof handleOrResource === 'string' ? handleOrResource : handleOrResource.resource;
    const token = typeof handleOrResource === 'string' ? ownerToken : handleOrResource.ownerToken;

    if (!token) return false;

    const res = await this.redis.eval(RedisLockManager.RELEASE_LUA, 1, resource, token);
    return res === 1;
  }

  async extend(handleOrResource: LockHandle | string, additionalMs: number, ownerToken?: string): Promise<boolean> {
    const resource = typeof handleOrResource === 'string' ? handleOrResource : handleOrResource.resource;
    const token = typeof handleOrResource === 'string' ? ownerToken : handleOrResource.ownerToken;

    if (!token) return false;

    const res = await this.redis.eval(RedisLockManager.EXTEND_LUA, 1, resource, token, additionalMs);
    return res === 1;
  }

  async isLocked(resource: string): Promise<boolean> {
    const exists = await this.redis.exists(resource);
    return exists === 1;
  }

  async checkHealth(): Promise<{ healthy: boolean; error?: string }> {
    try {
      const res = await this.redis.ping();
      return { healthy: res === 'PONG' || res === true };
    } catch (err: any) {
      return { healthy: false, error: err?.message || String(err) };
    }
  }
}

export function createLockManager(db?: WorkOpsDb, redisClient?: any): ILockManager {
  if (redisClient) {
    return new RedisLockManager(redisClient);
  }
  if (db?.engine === 'postgres') {
    return new PostgresLockManager(db.pool);
  }
  if (db?.engine === 'sqlite') {
    return new SqliteLockManager(db.sqlite);
  }
  throw new Error('No database or Redis connection available for DistributedLockManager');
}
