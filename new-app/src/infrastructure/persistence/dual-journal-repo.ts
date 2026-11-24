/**
 * Dual Journal Repository
 * Implements JournalRepository with relational database as primary storage
 * and automatic fallback to JSON file storage (.task-journal.json).
 */

import {
  JournalRepository,
  JournalEntry,
} from '../../domain/ports/repositories.js';
import { RelationalJournalRepository } from './relational-journal-repo.js';
import { FileJournalRepository } from '../journal/file-journal-repo.js';
import { logger } from '../logging/logger.js';

export class DualJournalRepository implements JournalRepository {
  constructor(
    public readonly relational: RelationalJournalRepository,
    public readonly file: FileJournalRepository
  ) {}

  async record(entry: JournalEntry): Promise<void> {
    const results = await Promise.allSettled([
      this.relational.record(entry),
      this.file.record(entry),
    ]);
    const relResult = results[0];
    if (relResult.status === 'rejected') {
      logger.warn(`Relational journal write failed, recorded to file: ${relResult.reason?.message || relResult.reason}`);
    }
  }

  async getEntries(limit?: number): Promise<JournalEntry[]> {
    try {
      const relEntries = await this.relational.getEntries(limit);
      if (relEntries && relEntries.length > 0) return relEntries;
    } catch (err: any) {
      logger.warn(`Relational journal read failed, falling back to file: ${err.message}`);
    }
    return this.file.getEntries(limit);
  }

  async getUnfinishedRelations(): Promise<JournalEntry[]> {
    try {
      return await this.relational.getUnfinishedRelations();
    } catch (err: any) {
      logger.warn(`Relational getUnfinishedRelations failed, falling back to file: ${err.message}`);
      return this.file.getUnfinishedRelations();
    }
  }

  async markRepaired(
    entry: JournalEntry,
    status: JournalEntry['relationCopyStatus'],
    note: string,
    verified = false
  ): Promise<boolean> {
    const [relResult, fileResult] = await Promise.allSettled([
      this.relational.markRepaired(entry, status, note, verified),
      this.file.markRepaired(entry, status, note, verified),
    ]);
    return (
      (relResult.status === 'fulfilled' && relResult.value) ||
      (fileResult.status === 'fulfilled' && fileResult.value)
    );
  }

  async exportCsv(): Promise<string> {
    try {
      return await this.relational.exportCsv();
    } catch (err: any) {
      logger.warn(`Relational journal exportCsv failed, falling back to file: ${err.message}`);
      return this.file.exportCsv();
    }
  }

  async exportJson(): Promise<string> {
    try {
      return await this.relational.exportJson();
    } catch (err: any) {
      logger.warn(`Relational journal exportJson failed, falling back to file: ${err.message}`);
      return this.file.exportJson();
    }
  }
}
