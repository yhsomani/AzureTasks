/**
 * Repair Relations Use Case
 * Re-copies only the relations missing on previously created tasks whose
 * relation copy was recorded as PARTIAL or FAILED. Idempotent.
 */

import {
  WorkItemRepository,
  JournalRepository,
  JournalEntry,
  LockRepository,
} from '../../domain/ports/repositories.js';
import { RelationCopyService } from '../../domain/services/task-services.js';
import { filterCopyableRelations, WorkItem, matchesTaskSeries } from '../../domain/entities/task.js';

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

export interface OrphanTaskItem {
  id: number;
  title: string;
  assignedTo?: string;
  state: string;
  hasParent: boolean;
  parentRelationUrl?: string;
  status: 'DETECTED' | 'REPAIRED' | 'UNRESOLVED' | 'SKIPPED';
  message: string;
}

export interface ExtendedRepairReport extends RepairReport {
  orphans?: OrphanTaskItem[];
}

export interface RepairRelationsOptions {
  candidateTasks?: WorkItem[];
  referenceSourceTask?: WorkItem;
  titlePrefix?: string;
}

export class RepairRelationsUseCase {
  private readonly relationCopy: RelationCopyService;

  constructor(
    private readonly workItemRepo: WorkItemRepository,
    private readonly journal: JournalRepository,
    private readonly lockRepo?: LockRepository
  ) {
    this.relationCopy = new RelationCopyService(workItemRepo);
  }

  /**
   * Identifies candidate tasks matching the series pattern that lack a parent link
   */
  async detectOrphanTasks(candidateTasks: WorkItem[], titlePrefix?: string): Promise<OrphanTaskItem[]> {
    const orphans: OrphanTaskItem[] = [];
    for (const candidate of candidateTasks) {
      const title = String(candidate.fields?.['System.Title'] || '');
      if (titlePrefix && !matchesTaskSeries(title, titlePrefix)) {
        continue;
      }

      let fullItem = candidate;
      if (!candidate.relations) {
        try {
          fullItem = await this.workItemRepo.getWorkItem(candidate.id);
        } catch {
          continue;
        }
      }

      const relations = fullItem.relations ?? [];
      const hasParent = relations.some(r => r.rel === 'System.LinkTypes.Hierarchy-Reverse');
      if (!hasParent) {
        orphans.push({
          id: fullItem.id,
          title: String(fullItem.fields?.['System.Title'] || ''),
          assignedTo: typeof fullItem.fields?.['System.AssignedTo'] === 'string'
            ? fullItem.fields['System.AssignedTo']
            : (fullItem.fields?.['System.AssignedTo'] as any)?.displayName,
          state: String(fullItem.fields?.['System.State'] || ''),
          hasParent: false,
          status: 'DETECTED',
          message: 'Missing System.LinkTypes.Hierarchy-Reverse (Parent) relation.',
        });
      }
    }
    return orphans;
  }

  /**
   * Applies parent relation from the reference source task to the detected orphans
   */
  async repairOrphanTasks(
    orphans: OrphanTaskItem[],
    referenceSourceTask: WorkItem
  ): Promise<OrphanTaskItem[]> {
    let fullReference = referenceSourceTask;
    if (!fullReference.relations) {
      try {
        fullReference = await this.workItemRepo.getWorkItem(referenceSourceTask.id);
      } catch {
        // use candidate as-is
      }
    }

    const parentRel = (fullReference.relations ?? []).find(
      r => r.rel === 'System.LinkTypes.Hierarchy-Reverse'
    );

    if (!parentRel) {
      return orphans.map(o => ({
        ...o,
        status: 'UNRESOLVED',
        message: `Reference source task #${referenceSourceTask.id} does not have a parent relation to copy.`,
      }));
    }

    const results: OrphanTaskItem[] = [];
    for (const orphan of orphans) {
      try {
        await this.workItemRepo.copyRelations(
          { ...fullReference, relations: [parentRel] },
          orphan.id,
          ['System.LinkTypes.Hierarchy-Reverse']
        );

        const readBack = await this.workItemRepo.getWorkItem(orphan.id, { fresh: true });
        const verified = (readBack.relations ?? []).some(
          r => r.rel === 'System.LinkTypes.Hierarchy-Reverse' && r.url === parentRel.url
        );

        results.push({
          ...orphan,
          hasParent: verified,
          parentRelationUrl: verified ? parentRel.url : undefined,
          status: verified ? 'REPAIRED' : 'UNRESOLVED',
          message: verified
            ? `Successfully linked to parent: ${parentRel.url}`
            : 'Parent relation copy failed read-back verification.',
        });
      } catch (err: any) {
        results.push({
          ...orphan,
          status: 'UNRESOLVED',
          message: `Failed to attach parent relation: ${err?.message || String(err)}`,
        });
      }
    }
    return results;
  }

  async execute(options?: RepairRelationsOptions): Promise<ExtendedRepairReport> {
    if (this.lockRepo && !this.lockRepo.acquire()) {
      const lock = this.lockRepo.getLockInfo();
      throw new Error(`Cannot run relation repair: another process (PID ${lock?.pid}) is executing.`);
    }

    try {
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
          const required = filterCopyableRelations(source.relations ?? []);
          const readBack = await this.workItemRepo.getWorkItem(entry.createdWorkItemId, { fresh: true });
          const actual = new Set((readBack.relations ?? []).map(r => `${r.rel}:::${r.url}`));
          const verified = readBack.id === target.id &&
            required.every(r => actual.has(`${r.rel}:::${r.url}`));
          const complete = result.failedCount === 0 && verified;
          const note = complete
            ? `Repaired and independently verified: +${result.copiedCount} relation(s) copied.`
            : `Repair incomplete or unverified: +${result.copiedCount} copied, ${result.failedCount} patch failures; read-back matched: ${verified}.`;

          const persisted = await this.journal.markRepaired(entry, complete ? 'SUCCESS' : 'PARTIAL', note, verified);
          if (!persisted) throw new Error('Azure relations were processed but the local audit entry could not be found for reconciliation.');

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

      let orphanResults: OrphanTaskItem[] | undefined;
      if (options?.candidateTasks) {
        const detected = await this.detectOrphanTasks(options.candidateTasks, options.titlePrefix);
        if (options.referenceSourceTask) {
          orphanResults = await this.repairOrphanTasks(detected, options.referenceSourceTask);
        } else {
          orphanResults = detected;
        }
      }

      return {
        total: entries.length,
        repaired: rows.filter(r => r.status === 'REPAIRED').length,
        partial: rows.filter(r => r.status === 'PARTIAL').length,
        failed: rows.filter(r => r.status === 'FAILED').length,
        skipped: rows.filter(r => r.status === 'SKIPPED').length,
        rows,
        ...(orphanResults !== undefined ? { orphans: orphanResults } : {}),
      };
    } finally {
      this.lockRepo?.release();
    }
  }
}
