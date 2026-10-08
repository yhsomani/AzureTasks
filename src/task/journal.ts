/**
 * Non-authoritative execution journal for Azure DevOps daily task runs.
 * Tracks runs, created work items, and relation statuses to enable safe recovery/repairs.
 */

import * as fs from 'fs';
import * as path from 'path';

export interface JournalEntry {
  runId: string;
  timestamp: string;
  personKey?: string;
  personName: string;
  assignedTo: string;
  targetIsoDate: string;
  title: string;
  sourceTaskId?: number;
  sourceRev?: number;
  createdWorkItemId?: number;
  fieldCopyStatus: 'SUCCESS' | 'PARTIAL' | 'FAILED';
  relationCopyStatus?: 'SUCCESS' | 'PARTIAL' | 'FAILED' | 'NONE';
  error?: string;
  verified: boolean;
}

export class TaskJournal {
  private journalPath: string;

  constructor(journalFileName = '.task-journal.json') {
    this.journalPath = path.resolve(process.cwd(), journalFileName);
  }

  /**
   * Reads all journal entries safely.
   */
  public getEntries(): JournalEntry[] {
    if (!fs.existsSync(this.journalPath)) {
      return [];
    }
    try {
      const raw = fs.readFileSync(this.journalPath, 'utf-8');
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  /**
   * Records an execution entry atomically.
   */
  public recordEntry(entry: JournalEntry): void {
    const entries = this.getEntries();
    entries.push(entry);

    const tmpPath = `${this.journalPath}.${Date.now()}.tmp`;
    try {
      fs.writeFileSync(tmpPath, JSON.stringify(entries, null, 2), 'utf-8');
      fs.renameSync(tmpPath, this.journalPath);
    } catch {
      // Fallback direct write
      try {
        fs.writeFileSync(this.journalPath, JSON.stringify(entries, null, 2), 'utf-8');
      } catch {
        // Journal write error should not fail the task
      }
    } finally {
      if (fs.existsSync(tmpPath)) {
        try {
          fs.unlinkSync(tmpPath);
        } catch {
          // ignore
        }
      }
    }
  }

  /**
   * Finds created tasks that suffered partial or failed relation copies.
   */
  public getUnfinishedRelations(): JournalEntry[] {
    return this.getEntries().filter(
      (e) =>
        e.createdWorkItemId &&
        (e.relationCopyStatus === 'PARTIAL' || e.relationCopyStatus === 'FAILED')
    );
  }
}
