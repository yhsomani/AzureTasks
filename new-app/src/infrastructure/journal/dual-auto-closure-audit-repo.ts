/**
 * Dual Auto-Closure Audit Log Repository
 * Implements AutoClosureAuditLogRepository with relational database as primary storage
 * and automatic fallback to JSON file storage (.auto-closure-audit.json).
 */

import {
  AutoClosureAuditLogRepository,
  AutoClosureAuditLog,
  AutoClosureAuditFilter,
} from '../../domain/ports/repositories.js';
import { RelationalAutoClosureAuditRepository } from './relational-auto-closure-audit-repo.js';
import { FileAutoClosureAuditRepository } from './file-auto-closure-audit-repo.js';
import { logger } from '../logging/logger.js';

export class DualAutoClosureAuditRepository implements AutoClosureAuditLogRepository {
  constructor(
    public readonly relational: RelationalAutoClosureAuditRepository | undefined,
    public readonly file: FileAutoClosureAuditRepository
  ) {}

  async record(entry: AutoClosureAuditLog): Promise<void> {
    if (this.relational) {
      try {
        await this.relational.record(entry);
      } catch (err: any) {
        logger.warn(`Relational auto-closure audit write failed; falling back to file: ${err.message}`);
      }
    }
    await this.file.record(entry);
  }

  async getEntries(
    limit?: number,
    filters?: AutoClosureAuditFilter
  ): Promise<AutoClosureAuditLog[]> {
    if (this.relational) {
      try {
        const entries = await this.relational.getEntries(limit, filters);
        if (entries && entries.length > 0) {
          return entries;
        }
      } catch (err: any) {
        logger.warn(`Relational auto-closure audit read failed; falling back to file: ${err.message}`);
      }
    }
    return this.file.getEntries(limit, filters);
  }

  async getEntriesByTask(taskId: number): Promise<AutoClosureAuditLog[]> {
    if (this.relational) {
      try {
        const entries = await this.relational.getEntriesByTask(taskId);
        if (entries && entries.length > 0) {
          return entries;
        }
      } catch (err: any) {
        logger.warn(`Relational getEntriesByTask failed; falling back to file: ${err.message}`);
      }
    }
    return this.file.getEntriesByTask(taskId);
  }

  async getEntriesByUser(userId: string, limit?: number): Promise<AutoClosureAuditLog[]> {
    if (this.relational) {
      try {
        const entries = await this.relational.getEntriesByUser(userId, limit);
        if (entries && entries.length > 0) {
          return entries;
        }
      } catch (err: any) {
        logger.warn(`Relational getEntriesByUser failed; falling back to file: ${err.message}`);
      }
    }
    return this.file.getEntriesByUser(userId, limit);
  }

  async exportCsv(): Promise<string> {
    if (this.relational) {
      try {
        return await this.relational.exportCsv();
      } catch (err: any) {
        logger.warn(`Relational auto-closure audit exportCsv failed; falling back to file: ${err.message}`);
      }
    }
    return this.file.exportCsv();
  }

  async exportJson(): Promise<string> {
    if (this.relational) {
      try {
        return await this.relational.exportJson();
      } catch (err: any) {
        logger.warn(`Relational auto-closure audit exportJson failed; falling back to file: ${err.message}`);
      }
    }
    return this.file.exportJson();
  }

  async cleanup(beforeDate: string): Promise<number> {
    let deleted = 0;
    if (this.relational) {
      try {
        deleted += await this.relational.cleanup(beforeDate);
      } catch (err: any) {
        logger.warn(`Relational auto-closure audit cleanup failed: ${err.message}`);
      }
    }
    const fileDeleted = await this.file.cleanup(beforeDate);
    return Math.max(deleted, fileDeleted);
  }
}
