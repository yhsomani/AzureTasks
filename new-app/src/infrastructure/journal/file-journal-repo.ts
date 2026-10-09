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
    this.archiveDir = path.resolve(process.cwd(), '.journal-archives');
  }

  async record(entry: JournalEntry): Promise<void> {
    // Ensure archive directory exists
    if (!fs.existsSync(this.archiveDir)) {
      fs.mkdirSync(this.archiveDir, { recursive: true });
    }

    // Check if rotation needed
    await this.rotateIfNeeded();

    let entries: JournalEntry[] = [];
    if (fs.existsSync(this.journalPath)) {
      try {
        const raw = fs.readFileSync(this.journalPath, 'utf-8');
        entries = JSON.parse(raw);
        if (!Array.isArray(entries)) entries = [];
      } catch {
        entries = [];
      }
    }

    entries.push(entry);

    // Trim if too many entries
    if (entries.length > MAX_ENTRIES) {
      entries = entries.slice(-MAX_ENTRIES);
    }

    fs.writeFileSync(this.journalPath, JSON.stringify(entries, null, 2), 'utf-8');
  }

  async getEntries(limit?: number): Promise<JournalEntry[]> {
    if (!fs.existsSync(this.journalPath)) {
      return [];
    }

    try {
      const raw = fs.readFileSync(this.journalPath, 'utf-8');
      const entries = JSON.parse(raw);
      if (!Array.isArray(entries)) return [];
      
      if (limit && limit > 0) {
        return entries.slice(-limit).reverse(); // Newest first
      }
      return entries.reverse(); // Newest first
    } catch {
      return [];
    }
  }

  async getUnfinishedRelations(): Promise<JournalEntry[]> {
    const entries = await this.getEntries();
    // Only entries that actually produced a work item can have missing relations
    // to repair. A task-creation failure has no target and is not repairable.
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
    if (!fs.existsSync(this.journalPath)) return false;

    let entries: JournalEntry[];
    try {
      const parsed = JSON.parse(fs.readFileSync(this.journalPath, 'utf-8'));
      if (!Array.isArray(parsed)) return false;
      entries = parsed;
    } catch {
      return false;
    }

    // A recorded entry is uniquely identified by its run + timestamp.
    const index = entries.findIndex(
      e => e.runId === entry.runId && e.timestamp === entry.timestamp &&
           e.createdWorkItemId === entry.createdWorkItemId
    );
    if (index === -1) return false;

    entries[index] = {
      ...entries[index],
      relationCopyStatus: status,
      verified: status === 'SUCCESS',
      error: note || entries[index].error,
    };
    fs.writeFileSync(this.journalPath, JSON.stringify(entries, null, 2), 'utf-8');
    return true;
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

  private async rotateIfNeeded(): Promise<void> {
    if (!fs.existsSync(this.journalPath)) return;

    const stats = fs.statSync(this.journalPath);
    if (stats.size < MAX_JOURNAL_SIZE) return;

    // Archive current journal
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const archivePath = path.join(this.archiveDir, `task-journal-${timestamp}.json`);
    
    fs.renameSync(this.journalPath, archivePath);
    
    // Clean old archives (keep last 10)
    const archives = fs.readdirSync(this.archiveDir)
      .filter(f => f.startsWith('task-journal-') && f.endsWith('.json'))
      .sort()
      .reverse();
    
    for (const archive of archives.slice(10)) {
      fs.unlinkSync(path.join(this.archiveDir, archive));
    }
  }
}