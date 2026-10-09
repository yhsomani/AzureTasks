/**
 * Repair Relations Use Case
 * Re-copies only the relations missing on previously created tasks whose
 * relation copy was recorded as PARTIAL or FAILED. Idempotent.
 */

import { WorkItemRepository, JournalRepository, JournalEntry } from '../../domain/ports/repositories.js';
import { RelationCopyService } from '../../domain/services/task-services.js';

export interface RepairRow {
  entry: JournalEntry;
  status: 'REPAIRED' | 'PARTIAL' | 'FAILED' | 'SKIPPED';
  copiedCount: number;
  failedCount: number;
  message: string;
}

export interface RepairReport {
  total: number;
  repaired: number;
  partial: number;
  failed: number;
  skipped: number;
  rows: RepairRow[];
}

export class RepairRelationsUseCase {
  private readonly relationCopy: RelationCopyService;

  constructor(
    private readonly workItemRepo: WorkItemRepository,
    private readonly journal: JournalRepository
  ) {
    this.relationCopy = new RelationCopyService(workItemRepo);
  }

  async execute(): Promise<RepairReport> {
    const entries = await this.journal.getUnfinishedRelations();
    const rows: RepairRow[] = [];

    for (const entry of entries) {
      if (!entry.createdWorkItemId) {
        rows.push({
          entry,
          status: 'SKIPPED',
          copiedCount: 0,
          failedCount: 0,
          message: 'No created work item id recorded; nothing to repair.',
        });
        continue;
      }

      try {
        const [source, target] = await Promise.all([
          this.workItemRepo.getWorkItem(entry.sourceTaskId),
          this.workItemRepo.getWorkItem(entry.createdWorkItemId),
        ]);

        const result = await this.relationCopy.repairRelations(source, target);
        const complete = result.failedCount === 0;
        const note = complete
          ? `Repaired: +${result.copiedCount} relation(s) copied.`
          : `Repair incomplete: +${result.copiedCount} copied, ${result.failedCount} still failing.`;

        await this.journal.markRepaired(entry, complete ? 'SUCCESS' : 'PARTIAL', note);

        rows.push({
          entry,
          status: complete ? 'REPAIRED' : 'PARTIAL',
          copiedCount: result.copiedCount,
          failedCount: result.failedCount,
          message: note,
        });
      } catch (err: any) {
        rows.push({
          entry,
          status: 'FAILED',
          copiedCount: 0,
          failedCount: 0,
          message: err?.message || String(err),
        });
      }
    }

    return {
      total: entries.length,
      repaired: rows.filter(r => r.status === 'REPAIRED').length,
      partial: rows.filter(r => r.status === 'PARTIAL').length,
      failed: rows.filter(r => r.status === 'FAILED').length,
      skipped: rows.filter(r => r.status === 'SKIPPED').length,
      rows,
    };
  }
}
