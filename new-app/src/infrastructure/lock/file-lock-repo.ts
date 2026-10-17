/**
 * Single-host exclusive file lock.
 * A live owner never expires by elapsed time alone. A release from another
 * instance cannot remove the owner's lock.
 *
 * Not a distributed lock: use shared coordination for multi-host deployments.
 */
import * as fs from 'fs';
import * as path from 'path';
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

    if (writeExclusive()) return true;
    // Refuse to overwrite unparseable locks. They might belong to a live
    // writer whose first write was interrupted, or to an unknown process.
    const existing = this.getLockInfo();
    if (!existing?.stale) return false;

    // Best-effort single-host stale reclamation. Must not be used for
    // multi-host scheduling where PID evidence is not authoritative.
    try {
      const current = this.getLockInfo();
      if (!current?.stale || current.pid !== existing.pid ||
          current.acquiredAt !== existing.acquiredAt) return false;
      fs.unlinkSync(this.lockPath);
      return writeExclusive();
    } catch {
      return false;
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
    if (!fs.existsSync(this.lockPath)) return false;
    const info = this.getLockInfo();
    // Fail closed when metadata is malformed.
    return info === null || !info.stale;
  }

  getLockInfo(): LockInfo | null {
    if (!fs.existsSync(this.lockPath)) return null;
    try {
      const value: unknown = JSON.parse(fs.readFileSync(this.lockPath, 'utf-8'));
      if (!value || typeof value !== 'object') return null;
      const info = value as OwnedLockInfo;
      if (!Number.isSafeInteger(info.pid) || info.pid <= 0 ||
          typeof info.acquiredAt !== 'string' ||
          !Number.isFinite(new Date(info.acquiredAt).getTime())) return null;
      return { ...info, stale: !this.isProcessAlive(info.pid) };
    } catch {
      return null;
    }
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
