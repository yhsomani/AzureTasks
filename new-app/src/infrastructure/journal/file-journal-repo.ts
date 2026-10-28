/**
 * File-based Journal Repository
 * Persists execution audit trail with log rotation
 */

import * as fs from 'fs';
import * as path from 'path';
import { AtomicFileWriter } from '../persistence/atomic-file-writer.js';
import { JournalRepository, JournalEntry } from '../../domain/ports/repositories.js';

const MAX_JOURNAL_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_ENTRIES = 10000;

export class FileJournalRepository implements JournalRepository {
  private readonly journalPath: string;
  private readonly archiveDir: string;
  private readonly writeBuffer: JournalEntry[] = [];
  private flushPromise: Promise<void> | null = null;
  private storageFailure: unknown;

  constructor(journalPath?: string) {
    this.journalPath = journalPath 
      ? path.resolve(process.cwd(), journalPath)
      : path.resolve(process.cwd(), '.task-journal.json');
    this.archiveDir = path.join(path.dirname(this.journalPath), '.journal-archives');
  }

  async record(entry: JournalEntry): Promise<void> {
    if (this.storageFailure) throw this.storageFailure;
    this.writeBuffer.push(entry);
    await this.flushBuffer();
  }

  private flushBuffer(): Promise<void> {
    if (this.storageFailure) return Promise.reject(this.storageFailure);
    if (this.flushPromise) return this.flushPromise;
    this.flushPromise = Promise.resolve().then(async () => {
      while (this.writeBuffer.length > 0) {
        fs.mkdirSync(this.archiveDir, { recursive: true, mode: 0o700 });
        const entriesToWrite = this.writeBuffer.slice();
        const existing = this.readEntriesFrom(this.journalPath);
        await this.rotateIfNeeded(existing.length + entriesToWrite.length >= MAX_ENTRIES);
        const entries = this.readEntriesFrom(this.journalPath);
        entries.push(...entriesToWrite);
        this.writeEntriesAtomically(entries);
        this.writeBuffer.splice(0, entriesToWrite.length);
      }
    }).catch(error => {
      this.storageFailure = error;
      throw error;
    }).finally(() => {
      this.flushPromise = null;
    });
    return this.flushPromise;
  }

  private readEntriesFrom(filename: string): JournalEntry[] {
    if (!fs.existsSync(filename)) return [];
    try {
      const entries: unknown = JSON.parse(fs.readFileSync(filename, 'utf-8'));
      if (!Array.isArray(entries)) throw new Error('Expected an array of journal entries.');
      return entries as JournalEntry[];
    } catch (error) {
      throw new Error(`Audit journal at "${filename}" is unreadable or corrupt. Preserve the file and restore from backup before writing: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private listArchiveFiles(): string[] {
    return fs.existsSync(this.archiveDir)
      ? fs.readdirSync(this.archiveDir)
          .filter(name => /^task-journal-.*\.json$/.test(name))
          .sort().reverse()
          .map(name => path.join(this.archiveDir, name))
      : [];
  }

  async getEntries(limit?: number): Promise<JournalEntry[]> {
    if (this.writeBuffer.length > 0 || this.flushPromise) {
      await this.flushBuffer();
    }
    // Newest segment first; never silently omit rotated history from
    // the UI, CSV export or audit search.
    const entries = this.readEntriesFrom(this.journalPath).reverse();
    const max = limit && limit > 0 ? limit : Infinity;
    for (const archive of this.listArchiveFiles()) {
      if (entries.length >= max) break;
      entries.push(...this.readEntriesFrom(archive).reverse());
    }
    return entries.slice(0, max);
  }

  async getUnfinishedRelations(): Promise<JournalEntry[]> {
    const entries = await this.getEntries();
    return entries.filter(e =>
      e.createdWorkItemId != null &&
      (e.relationCopyStatus === 'PARTIAL' || e.relationCopyStatus === 'FAILED')
    );
  }

  async markRepaired(
    entry: JournalEntry,
    status: JournalEntry['relationCopyStatus'],
    note: string,
    verified = false
  ): Promise<boolean> {
    await this.flushBuffer();
    const files = [this.journalPath, ...this.listArchiveFiles()];
    for (const filename of files) {
      const entries = this.readEntriesFrom(filename);
      const index = entries.findIndex(e =>
        e.runId === entry.runId && e.timestamp === entry.timestamp &&
        e.createdWorkItemId === entry.createdWorkItemId
      );
      if (index === -1) continue;
      entries[index] = {
        ...entries[index],
        relationCopyStatus: status,
        // Caller must independently read back target relations first.
        verified,
        error: note || entries[index].error,
      };
      this.writeEntriesAtomically(entries, filename);
      return true;
    }
    return false;
  }

  async exportCsv(): Promise<string> {
    const entries = await this.getEntries();
    
    const headers = [
      'Timestamp',
      'RunId',
      'PersonName',
      'AssignedTo',
      'TargetIsoDate',
      'Title',
      'SourceTaskId',
      'CreatedWorkItemId',
      'FieldStatus',
      'RelationStatus',
      'Verified',
      'Error',
    ];

    const escapeCsv = (val: any): string => {
      if (val === undefined || val === null) return '""';
      // Quoted CSV values can still execute formulas in spreadsheet clients.
      // Prefix spreadsheet control characters before escaping embedded quotes.
      const plain = String(val);
      const safe = /^(?:[=+@-]|\t|\r|\n)/.test(plain) ? "'" + plain : plain;
      const str = safe.replace(/"/g, '""');
      return `"${str}"`;
    };

    const rows = entries.map(e => [
      escapeCsv(e.timestamp),
      escapeCsv(e.runId),
      escapeCsv(e.personName),
      escapeCsv(e.assignedTo),
      escapeCsv(e.targetIsoDate),
      escapeCsv(e.title),
      escapeCsv(e.sourceTaskId),
      escapeCsv(e.createdWorkItemId),
      escapeCsv(e.fieldCopyStatus),
      escapeCsv(e.relationCopyStatus),
      escapeCsv(e.verified),
      escapeCsv(e.error || ''),
    ].join(','));

    return [headers.join(','), ...rows].join('\n');
  }

  async exportJson(): Promise<string> {
    const entries = await this.getEntries();
    return JSON.stringify(entries, null, 2);
  }

  private writeEntriesAtomically(entries: JournalEntry[], filename = this.journalPath): void {
    AtomicFileWriter.writeJson(filename, entries, { ensureDir: true, mode: 0o600 }, 2);
  }

  private async rotateIfNeeded(force = false): Promise<void> {
    if (!fs.existsSync(this.journalPath)) return;

    const stats = fs.statSync(this.journalPath);
    if (!force && stats.size < MAX_JOURNAL_SIZE) return;

    // Archive current journal
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const archivePath = path.join(this.archiveDir, `task-journal-${timestamp}.json`);
    
    fs.renameSync(this.journalPath, archivePath);
    
    // Do not automatically prune audit evidence. Operators must configure
    // retention/backup policies and remove historical archives explicitly.
  }

  async close(): Promise<void> {
    await this.flushBuffer();
  }

}
