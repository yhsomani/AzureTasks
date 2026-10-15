/**
 * File-based Lock Repository
 * Prevents concurrent execution with PID-aware stale lock detection
 */

import * as fs from 'fs';
import * as path from 'path';
import { LockRepository, LockInfo } from '../../domain/ports/repositories.js';

export class FileLockRepository implements LockRepository {
  private readonly lockPath: string;
  private readonly staleThresholdMs = 5 * 60 * 1000; // 5 minutes

  constructor(lockPath?: string) {
    this.lockPath = lockPath 
      ? path.resolve(process.cwd(), lockPath)
      : path.resolve(process.cwd(), '.execution-lock.json');
  }

  acquire(): boolean {
    const lockInfo: LockInfo = {
      pid: process.pid,
      acquiredAt: new Date().toISOString(),
      stale: false,
    };

    try {
      // Atomic write using exclusive flag 'wx' (fails if file already exists)
      fs.writeFileSync(this.lockPath, JSON.stringify(lockInfo, null, 2), { encoding: 'utf-8', flag: 'wx' });
      return true;
    } catch (err: any) {
      if (err.code !== 'EEXIST') return false;

      // File exists - check if the holding process is dead or lock expired
      const existing = this.getLockInfo();
      if (!existing || existing.stale) {
        if (existing?.stale) {
          console.warn('Removing stale execution lock from PID', existing.pid);
        }
        this.release();
        // Retry atomic acquisition once
        try {
          fs.writeFileSync(this.lockPath, JSON.stringify(lockInfo, null, 2), { encoding: 'utf-8', flag: 'wx' });
          return true;
        } catch {
          return false;
        }
      }
      return false; // Active lock held by an alive process
    }
  }

  release(): void {
    if (fs.existsSync(this.lockPath)) {
      try {
        fs.unlinkSync(this.lockPath);
      } catch {
        // Ignore errors
      }
    }
  }

  isLocked(): boolean {
    if (!fs.existsSync(this.lockPath)) return false;
    const lockInfo = this.getLockInfo();
    return lockInfo !== null && !lockInfo.stale;
  }

  getLockInfo(): LockInfo | null {
    if (!fs.existsSync(this.lockPath)) return null;

    try {
      const raw = fs.readFileSync(this.lockPath, 'utf-8');
      const lockInfo = JSON.parse(raw) as LockInfo;
      
      // Check if stale (process dead or lock too old)
      const acquiredAt = new Date(lockInfo.acquiredAt).getTime();
      const now = Date.now();
      const isStale = (now - acquiredAt) > this.staleThresholdMs || !this.isProcessAlive(lockInfo.pid);
      
      return { ...lockInfo, stale: isStale };
    } catch {
      return null;
    }
  }

  private isProcessAlive(pid: number): boolean {
    try {
      // Signal 0 doesn't kill, just checks if process exists
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }
}