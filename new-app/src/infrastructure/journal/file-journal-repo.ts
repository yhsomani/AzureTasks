/**
 * File-based Journal Repository
 * Persists execution audit trail with log rotation
 */

import * as fs from 'fs';
import * as path from 'path';
import { JournalRepository, JournalEntry } from '../../domain/ports/repositories.js';

const MAX_JOURNAL_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_ENTRIES = 10000;

export class FileJournalRepository implements JournalRepository {
  private readonly journalPath: string;
  private readonly archiveDir: string;

  constructor(journalPath?: string) {
    this.journalPath = journalPath 
      ? path.resolve(process.cwd(), journalPath)
      : path.resolve(process.cwd(), '.task-journal.json');
    this.archiveDir = path.join(path.dirname(this.journalPath), '.journal-archives');
  }

  async record(entry: JournalEntry): Promise<void> {
    // Ensure archive directory exists
    if (!fs.existsSync(this.archiveDir)) {
      fs.mkdirSync(this.archiveDir, { recursive: true });
    }

    // Validate the existing audit trail BEFORE any write or rotation. Never
    // silently replace corrupt evidence with an empty journal.
    const existing = this.readEntriesFrom(this.journalPath);
    await this.rotateIfNeeded(existing.length >= MAX_ENTRIES);
    const entries = this.readEntriesFrom(this.journalPath);
    entries.push(entry);
    this.writeEntriesAtomically(entries);
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
    note: string
  ): Promise<boolean> {
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
        // API-level relation repair is not an independent work-item read-back.
        verified: false,
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
      const str = String(val).replace(/"/g, '""');
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
    fs.mkdirSync(path.dirname(filename), { recursive: true });
    const tmpPath = `${filename}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(entries, null, 2), { encoding: 'utf-8', flag: 'wx', mode: 0o600 });
    fs.renameSync(tmpPath, filename);
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
}