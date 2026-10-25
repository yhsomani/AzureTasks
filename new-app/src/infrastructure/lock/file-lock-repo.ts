/**
 * Single-host exclusive file lock.
 * A live owner never expires by elapsed time alone. A release from another
 * instance cannot remove the owner's lock.
 *
 * Not a distributed lock: use shared coordination for multi-host deployments.
 */
import * as fs from 'fs';
import * as path from 'path';
import { AtomicFileWriter } from '../persistence/atomic-file-writer.js';
import { randomUUID } from 'node:crypto';
import { LockRepository, LockInfo } from '../../domain/ports/repositories.js';

type OwnedLockInfo = LockInfo & { ownerToken?: string };

export class FileLockRepository implements LockRepository {
  private readonly lockPath: string;
  private ownerToken: string | null = null;

  constructor(lockPath?: string) {
    this.lockPath = lockPath
      ? path.resolve(process.cwd(), lockPath)
      : path.resolve(process.cwd(), '.execution-lock.json');
  }

  acquire(): boolean {
    if (this.ownerToken) return false;
    const token = randomUUID();
    const info: OwnedLockInfo = {
      pid: process.pid,
      acquiredAt: new Date().toISOString(),
      stale: false,
      ownerToken: token,
    };

    const writeExclusive = (): boolean => {
      try {
        fs.writeFileSync(this.lockPath, JSON.stringify(info, null, 2), { encoding: 'utf-8', flag: 'wx' });
        this.ownerToken = token;
        return true;
      } catch {
        return false;
      }
    };

    // Fast path: attempt atomic creation if lock does not exist
    if (writeExclusive()) return true;

    // Slow path: lock exists. Evaluate staleness.
    const existing = this.getLockInfo();
    if (!existing?.stale) return false;

    // Stale lock reclamation:
    // To mitigate multi-process races (TOCTOU) where multiple contenders concurrently
    // observe the same stale lock, we coordinate reclamation using an atomic companion
    // reclamation lock (`.reclaim.lock`) with flag 'wx'.
    //
    // CRITICAL MUTUAL EXCLUSION INVARIANT:
    // We NEVER move or vacate `this.lockPath`. Moving `this.lockPath` opens a window
    // where a newly arriving process's `writeExclusive` succeeds while contenders are
    // restoring files, leading to multiple simultaneous lock holders.
    // Instead, we replace `this.lockPath` atomically via `fs.renameSync(stagingPath, this.lockPath)`
    // only after acquiring the reclamation lock AND re-verifying that the lock on disk
    // is still the exact stale lock observed earlier.
    const reclaimPath = `${this.lockPath}.reclaim.lock`;

    const acquireReclaimLock = (): boolean => {
      try {
        fs.writeFileSync(
          reclaimPath,
          JSON.stringify({ pid: process.pid, acquiredAt: Date.now() }),
          { encoding: 'utf-8', flag: 'wx' }
        );
        return true;
      } catch {
        // Reclamation lock exists. Check if it is a stale leftover from an abruptly killed process.
        try {
          const stat = fs.statSync(reclaimPath);
          const ageMs = Date.now() - stat.mtimeMs;
          let isReclaimStale = ageMs > 5_000;
          if (!isReclaimStale) {
            try {
              const rec = JSON.parse(fs.readFileSync(reclaimPath, 'utf-8'));
              if (rec && typeof rec.pid === 'number' && !this.isProcessAlive(rec.pid)) {
                isReclaimStale = true;
              }
            } catch {
              if (ageMs > 2_000) isReclaimStale = true;
            }
          }
          if (isReclaimStale) {
            try { fs.unlinkSync(reclaimPath); } catch {}
            fs.writeFileSync(
              reclaimPath,
              JSON.stringify({ pid: process.pid, acquiredAt: Date.now() }),
              { encoding: 'utf-8', flag: 'wx' }
            );
            return true;
          }
        } catch {
          return false;
        }
        return false;
      }
    };

    if (!acquireReclaimLock()) {
      return false;
    }

    const stagingPath = `${this.lockPath}.${process.pid}.${randomUUID()}.tmp`;
    try {
      // Re-verify that the lock is STILL the exact stale lock observed earlier
      const current = this.readLockInfo(this.lockPath);
      if (current === null) {
        // Target lock was unlinked; attempt exclusive write
        if (writeExclusive()) return true;
        return false;
      }

      if (!current.stale || current.pid !== existing.pid || current.acquiredAt !== existing.acquiredAt) {
        // State changed between initial inspection and reclaim lock acquisition
        return false;
      }

      // Write candidate lock atomically using AtomicFileWriter
      AtomicFileWriter.writeJson(this.lockPath, info, { tempSuffix: `${process.pid}.${randomUUID()}` });
      this.ownerToken = token;
      return true;
    } catch {
      return false;
    } finally {
      try { fs.unlinkSync(stagingPath); } catch {}
      try { fs.unlinkSync(reclaimPath); } catch {}
    }
  }

  release(): void {
    if (!this.ownerToken) return;
    try {
      const current = JSON.parse(fs.readFileSync(this.lockPath, 'utf-8')) as OwnedLockInfo;
      if (current.ownerToken !== this.ownerToken || current.pid !== process.pid) return;
      fs.unlinkSync(this.lockPath);
    } catch {
      // A disappeared/replaced lock is not ours to remove.
    } finally {
      this.ownerToken = null;
    }
  }

  isLocked(): boolean {
    const info = this.getLockInfo();
    // Fail closed when metadata is malformed and not yet stale.
    // If info is null, the lock file does not exist on disk, so it is not locked.
    return info !== null && !info.stale;
  }

  getLockInfo(): LockInfo | null {
    return this.readLockInfo(this.lockPath);
  }

  private readLockInfo(targetPath: string): LockInfo | null {
    let stat: fs.Stats;
    try {
      stat = fs.statSync(targetPath);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
        return null;
      }
      return {
        pid: 0,
        acquiredAt: new Date().toISOString(),
        stale: false,
      };
    }

    // 0-byte lock files are immediately considered stale
    if (stat.size === 0) {
      return {
        pid: 0,
        acquiredAt: new Date(stat.mtimeMs).toISOString(),
        stale: true,
      };
    }

    try {
      const content = fs.readFileSync(targetPath, 'utf-8');
      const value: unknown = JSON.parse(content);
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        const info = value as OwnedLockInfo;
        if (Number.isSafeInteger(info.pid) && info.pid > 0 &&
            typeof info.acquiredAt === 'string' &&
            Number.isFinite(new Date(info.acquiredAt).getTime())) {
          return { ...info, stale: !this.isProcessAlive(info.pid) };
        }
      }
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
        return null;
      }
      // JSON parse error or non-ENOENT read error: fall through to age-based corruption check
    }

    // Unparseable / corrupted lock or primitive/array JSON payload:
    // Fail closed if fresh (< 60 seconds), allow reclamation if aged (>= 60 seconds)
    const ageMs = Date.now() - stat.mtimeMs;
    return {
      pid: 0,
      acquiredAt: new Date(stat.mtimeMs).toISOString(),
      stale: ageMs >= 60_000,
    };
  }

  private isProcessAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error: unknown) {
      // EPERM means that a process exists but is not visible to our user.
      return (error as NodeJS.ErrnoException)?.code === 'EPERM';
    }
  }
}
