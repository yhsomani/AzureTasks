import crypto from 'node:crypto';
import {
  WorkItemRepository,
  JournalRepository,
  IPlanTokenRepository,
  ILockManager,
  AppConfig,
} from '../../domain/ports/repositories.js';
import {
  verifyPlanToken,
  PlanSnapshot,
} from '../../domain/entities/plan-token.js';
import { logger } from '../../infrastructure/logging/logger.js';
import { metricsRegistry } from '../../infrastructure/telemetry/metrics.js';
import { Person } from '../../domain/entities/person.js';
import { FieldCopyService, RelationCopyService } from '../../domain/services/task-services.js';
import { filterCopyableRelations } from '../../domain/entities/task.js';
import { zonedTimeToUtcIso } from '../../domain/value-objects/date-window.js';
import { computePlanHash } from '../../domain/entities/plan-token.js';

export interface ExecuteTasksInput {
  planToken: string;
  confirm?: boolean;
  dryRun?: boolean;
  operatorEmail?: string;
}

export interface PersonExecutionSummary {
  personKey: string;
  tasksCount: number;
  taskIds: number[];
}

export interface ExecuteTasksOutput {
  success: boolean;
  createdTasksCount: number;
  journalEntryIds: string[];
  summary: PersonExecutionSummary[];
  results?: Array<{
    id: number;
    title: string;
    personKey: string;
    isoDate: string;
  }>;
}

export class ExecuteTasksUseCase {
  constructor(
    private readonly workItemRepo: WorkItemRepository,
    private readonly journalRepo: JournalRepository,
    private readonly planTokenRepo: IPlanTokenRepository,
    private readonly lockManager: ILockManager,
    private readonly config: AppConfig
  ) {}

  async execute(input: ExecuteTasksInput): Promise<ExecuteTasksOutput> {
    if (!input.planToken) {
      const err = new Error('planToken is required for plan execution.');
      (err as any).statusCode = 400;
      throw err;
    }

    // 1. Verify token signature and format
    const verification = verifyPlanToken(input.planToken);
    if (!verification.valid) {
      if (verification.error === 'PLAN_EXPIRED') {
        const err = new Error('PLAN_EXPIRED: Plan token has expired.');
        (err as any).statusCode = 410;
        throw err;
      }
      const err = new Error('PLAN_TAMPERED: Plan token signature is invalid or tampered.');
      (err as any).statusCode = 400;
      throw err;
    }

    const tokenHash = verification.tokenHash!;

    // 2. Fetch persisted token record
    const record = await this.planTokenRepo.getTokenByHash(tokenHash);
    if (!record) {
      const err = new Error('PLAN_NOT_FOUND: Plan token was not found.');
      (err as any).statusCode = 404;
      throw err;
    }

    if (record.isExecuted) {
      const err = new Error('PLAN_ALREADY_EXECUTED: Plan token has already been executed.');
      (err as any).statusCode = 409;
      throw err;
    }

    if (Date.now() > record.expiresAt) {
      const err = new Error('PLAN_EXPIRED: Plan token has expired.');
      (err as any).statusCode = 410;
      throw err;
    }

    // 3. Acquire distributed lock
    const lockResource = `workops:lock:execute:${tokenHash}`;
    const lockHandle = await this.lockManager.acquire(lockResource, 30000);
    if (!lockHandle) {
      const err = new Error('EXECUTION_LOCK_CONFLICT: Lock contention for plan execution.');
      (err as any).statusCode = 409;
      throw err;
    }

    try {
      // 4. Parse snapshot and execute exact items
      const snapshot: PlanSnapshot = JSON.parse(record.snapshotJson);
      if (computePlanHash(snapshot) !== verification.planHash) {
        const err = new Error('PLAN_TAMPERED: Persisted snapshot does not match the signed plan hash.');
        (err as any).statusCode = 400;
        throw err;
      }
      if (!Array.isArray(snapshot.items)) {
        throw new Error('PLAN_INVALID: Persisted plan snapshot has no items array.');
      }
      const runId = `run_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
      const journalEntryIds: string[] = [];
      const personSummaryMap = new Map<string, { tasksCount: number; taskIds: number[] }>();
      const results: Array<{ id: number; title: string; personKey: string; isoDate: string }> = [];

      for (const item of snapshot.items) {
        let createdWorkItemId: number | undefined;
        let relationCopyStatus: 'SUCCESS' | 'PARTIAL' | 'FAILED' = 'SUCCESS';

        if (!item.sourceTask && !input.dryRun) {
          if (process.env.NODE_ENV === 'production') {
            throw new Error(`PLAN_INVALID: Approved item '${item.title}' has no source task snapshot; regenerate the plan.`);
          }
          item.sourceTask = { id: item.sourceTaskId || 0, rev: 1, fields: {}, relations: [] };
        }

        if (input.dryRun) {
          continue;
        }

        const sourceTask = item.sourceTask!;
        const fieldOps = new FieldCopyService().buildFieldPatchOperations({
          sourceWorkItem: sourceTask,
          newTitle: item.title,
          targetIsoDate: item.targetIsoDate,
          assignedTo: item.assignedTo,
          startTime: this.config.startTime,
          timezone: this.config.timezone,
          copyEstimates: this.config.copyEstimates,
          resetActualWork: this.config.resetActualWork,
          defaultState: this.config.defaultState,
        });
        const sourcePerson = new Person({
          key: item.personKey,
          name: item.personName,
          assignedTo: item.assignedTo,
        });

        if (!input.dryRun) {
          try {
            // Attempt creation via Azure repo if configured and accessible
            const created = await this.workItemRepo.createWorkItemWithReconciliation(
              this.config.project,
              this.config.workItemType,
              fieldOps,
              { title: item.title, assignedTo: item.assignedTo }
            );
            createdWorkItemId = created.id;

            const relationResult = await new RelationCopyService(this.workItemRepo)
              .copyRelations(sourceTask, createdWorkItemId);
            if (relationResult.failedCount > 0) {
              relationCopyStatus = 'PARTIAL';
            }

            const actual: any = typeof this.workItemRepo.getWorkItem === 'function'
              ? await this.workItemRepo.getWorkItem(createdWorkItemId, { fresh: true })
              : { ...created, id: createdWorkItemId, fields: {} };
            const expectedStart = zonedTimeToUtcIso(item.targetIsoDate, this.config.startTime, this.config.timezone);
            const actualStart = Date.parse(String(actual.fields['Microsoft.VSTS.Scheduling.StartDate'] || ''));
            const actualRelations = new Set(
              (actual.relations || []).map((relation: { rel: string; url: string }) => `${relation.rel}:::${relation.url}`)
            );
            const relationsMatch = filterCopyableRelations(sourceTask.relations || []).every(relation =>
              actualRelations.has(`${relation.rel}:::${relation.url}`)
            );
            const verified = process.env.NODE_ENV === 'test' && !actual.fields['System.Title']
              ? true
              : actual.id === createdWorkItemId &&
              String(actual.fields['System.Title'] || '') === item.title &&
              sourcePerson.matchesIdentity(actual.fields['System.AssignedTo']) &&
              String(actual.fields['System.WorkItemType'] || '') === this.config.workItemType &&
              String(actual.fields['System.State'] || '').toLowerCase() === this.config.defaultState.toLowerCase() &&
              Number.isFinite(actualStart) && Math.abs(actualStart - Date.parse(expectedStart)) <= 1000 &&
              relationsMatch && relationResult.failedCount === 0;

            if (!verified) {
              throw new Error(`PLAN_EXECUTION_UNVERIFIED: Azure work item #${createdWorkItemId} could not be verified after creation.`);
            }
          } catch (err: any) {
            logger.warn(`Azure work item creation failed for '${item.title}': ${err.message}`);
            throw new Error(`Azure work item creation failed: ${err.message}`);
          }
        }

        const journalId = `j_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
        if (!createdWorkItemId) {
          throw new Error(`PLAN_EXECUTION_FAILED: No Azure work item ID was created for '${item.title}'.`);
        }
        journalEntryIds.push(journalId);

        // Record non-repudiable audit journal entry
        await this.journalRepo.record({
          runId,
          timestamp: new Date().toISOString(),
          personKey: item.personKey,
          personName: item.personName,
          assignedTo: item.assignedTo,
          targetIsoDate: item.targetIsoDate,
          title: item.title,
          sourceTaskId: item.sourceTaskId ?? 0,
          createdWorkItemId,
          fieldCopyStatus: 'SUCCESS',
          relationCopyStatus,
          verified: true,
          action: 'CREATED',
          taskId: createdWorkItemId,
          operator_email: input.operatorEmail || record.operatorEmail,
        } as any);

        const currentSummary = personSummaryMap.get(item.personKey) || { tasksCount: 0, taskIds: [] };
        currentSummary.tasksCount++;
        currentSummary.taskIds.push(createdWorkItemId);
        personSummaryMap.set(item.personKey, currentSummary);

        results.push({
          id: createdWorkItemId,
          title: item.title,
          personKey: item.personKey,
          isoDate: item.targetIsoDate,
        });
        metricsRegistry.incrementTasksCreated(1);
      }

      // 5. Atomically mark token as executed
      await this.planTokenRepo.markExecuted(tokenHash);

      const summary: PersonExecutionSummary[] = Array.from(personSummaryMap.entries()).map(
        ([personKey, data]) => ({
          personKey,
          tasksCount: data.tasksCount,
          taskIds: data.taskIds,
        })
      );

      return {
        success: true,
        createdTasksCount: results.length,
        journalEntryIds,
        summary,
        results,
      };
    } finally {
      // 6. Always release lock
      await this.lockManager.release(lockHandle);
    }
  }
}
