/**
 * Execution lock utility to prevent concurrent runs of the task creator.
 * Stores process PID, host, and start timestamp. Detects and cleans up stale locks.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { logger } from './logger.js';

export interface LockInfo {
  pid: number;
  hostname: string;
  user: string;
  timestamp: string;
}

export class ExecutionLock {
  private lockFilePath: string;
  private acquired = false;

  constructor(lockFilePath = '.task-creator.lock') {
    this.lockFilePath = path.resolve(process.cwd(), lockFilePath);
  }

  /**
   * Checks if a process with the given PID is currently active.
   */
  private isProcessRunning(pid: number): boolean {
    try {
      // Signal 0 tests for process existence without killing it
      process.kill(pid, 0);
      return true;
    } catch (e: any) {
      return e.code === 'EPERM'; // EPERM means exists but owned by another user
    }
  }

  /**
   * Acquires the execution lock. Throws if another active process holds the lock.
   */
  public acquire(): void {
    if (fs.existsSync(this.lockFilePath)) {
      try {
        const raw = fs.readFileSync(this.lockFilePath, 'utf-8');
        const info: LockInfo = JSON.parse(raw);

        if (this.isProcessRunning(info.pid)) {
          throw new Error(
            `CONCURRENT_EXECUTION: Another instance of Azure DevOps Task Creator is running (PID: ${info.pid}, started: ${info.timestamp} by ${info.user}). Simultaneous execution is blocked.`
          );
        } else {
          // Stale lock from a crashed process
          logger.warn(
            `Found stale lock from terminated process (PID: ${info.pid}). Removing stale lock.`
          );
          fs.unlinkSync(this.lockFilePath);
        }
      } catch (err: any) {
        if (err.message?.includes('CONCURRENT_EXECUTION')) {
          throw err;
        }
        // If file was corrupted or unreadable, remove it
        try {
          fs.unlinkSync(this.lockFilePath);
        } catch {
          // ignore
        }
      }
    }

    const lockData: LockInfo = {
      pid: process.pid,
      hostname: os.hostname(),
      user: os.userInfo().username,
      timestamp: new Date().toISOString(),
    };

    fs.writeFileSync(this.lockFilePath, JSON.stringify(lockData, null, 2), { flag: 'wx' });
    this.acquired = true;

    // Register exit handlers
    const cleanup = () => this.release();
    process.once('exit', cleanup);
    process.once('SIGINT', cleanup);
    process.once('SIGTERM', cleanup);
  }

  /**
   * Releases the execution lock if held by this instance.
   */
  public release(): void {
    if (!this.acquired) {
      return;
    }
    try {
      if (fs.existsSync(this.lockFilePath)) {
        fs.unlinkSync(this.lockFilePath);
      }
      this.acquired = false;
    } catch {
      // ignore
    }
  }
}
