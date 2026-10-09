/**
 * Domain Services
 * Pure business logic operating on domain entities
 */

import { WorkItemRepository } from '../ports/repositories.js';
import { Person, PersonConfig } from '../entities/person.js';
import { 
  WorkItem, 
  DiscoveredTask, 
  CreatedTask,
  filterCopyableRelations,
  WorkItemRelation,
  parseTitleDate
} from '../entities/task.js';
import { 
  planCreationDates, 
  DatePlan, 
  DatePlanInput, 
  PlannedDate,
  getTodayIso,
  getNextThursdayIso,
  validateNotPastDate,
  zonedTimeToUtcIso
} from '../value-objects/date-window.js';
import { COPYABLE_RELATION_TYPES } from '../entities/task.js';

/**
 * Task Discovery Service
 * Finds source tasks for people
 */
export class TaskDiscoveryService {
  constructor(private readonly repo: WorkItemRepository) {}

  async discoverForPeople(
    project: string,
    workItemType: string,
    titlePrefix: string,
    people: Person[],
    sourceTaskIdOverride?: number,
    defaultSourceTaskId?: number
  ): Promise<Map<string, DiscoveredTask>> {
    return this.repo.discoverLatestTasksForPeople(
      project,
      workItemType,
      titlePrefix,
      people,
      sourceTaskIdOverride,
      defaultSourceTaskId
    );
  }

  async getExistingTasksMap(
    project: string,
    workItemType: string,
    titlePrefix: string,
    person: Person,
    startDate: string,
    endDate: string
  ): Promise<Map<string, { id: number; title: string; isoDate: string; count?: number }>> {
    return this.repo.getExistingTasksForPerson(
      project,
      workItemType,
      titlePrefix,
      person.assignedTo,
      startDate,
      endDate
    );
  }
}

/**
 * Duplicate Detection Service
 * Determines if a task already exists for a person on a given date
 */
export class DuplicateDetector {
  private personDateMaps: Map<string, Map<string, { id: number; title: string; isoDate: string; count?: number }>> = new Map();

  setPersonDateMap(personKey: string, dateMap: Map<string, { id: number; title: string; isoDate: string; count?: number }>): void {
    this.personDateMaps.set(personKey, dateMap);
  }

  getPersonDateMap(person: Person): Map<string, { id: number; title: string; isoDate: string; count?: number }> {
    return this.personDateMaps.get(person.getRunKey()) ?? new Map();
  }

  getPersonKey(person: Person): string {
    return person.getRunKey();
  }

  isDuplicate(person: Person, isoDate: string): boolean {
    const dateMap = this.getPersonDateMap(person);
    return dateMap.has(isoDate);
  }

  getExistingTask(person: Person, isoDate: string): { id: number; title: string; isoDate: string; count?: number } | undefined {
    const dateMap = this.getPersonDateMap(person);
    return dateMap.get(isoDate);
  }
}

/**
 * Field Copy Service
 * Builds field patch operations for task creation
 */
export interface FieldPatchOperation {
  op: 'add' | 'replace' | 'remove';
  path: string;
  value?: any;
}

export interface BuildFieldOpsInput {
  sourceWorkItem: WorkItem;
  newTitle: string;
  targetIsoDate: string;
  assignedTo: string;
  startTime: string;
  timezone: string;
  copyEstimates: boolean;
  resetActualWork: boolean;
  defaultState: string;
}

export class FieldCopyService {
  buildFieldPatchOperations(input: BuildFieldOpsInput): FieldPatchOperation[] {
    const { sourceWorkItem, newTitle, targetIsoDate, assignedTo, startTime, timezone, copyEstimates, resetActualWork, defaultState } = input;
    const ops: FieldPatchOperation[] = [];

    // Title override (mandatory)
    ops.push({ op: 'add', path: '/fields/System.Title', value: newTitle });

    // Assignee override (mandatory)
    ops.push({ op: 'add', path: '/fields/System.AssignedTo', value: assignedTo });

    // State
    ops.push({ op: 'add', path: '/fields/System.State', value: defaultState });

    // Start Date - 09:30 wall-clock in the configured timezone, stored as UTC
    const startDateTime = zonedTimeToUtcIso(targetIsoDate, startTime, timezone);
    ops.push({ op: 'add', path: '/fields/Microsoft.VSTS.Scheduling.StartDate', value: startDateTime });

    // Copy estimates if enabled
    if (copyEstimates) {
      const originalEstimate = sourceWorkItem.fields['Microsoft.VSTS.Scheduling.OriginalEstimate'];
      if (originalEstimate != null) {
        ops.push({ op: 'add', path: '/fields/Microsoft.VSTS.Scheduling.OriginalEstimate', value: originalEstimate });
      }
    }

    // Reset actual work if enabled
    if (resetActualWork) {
      ops.push({ op: 'add', path: '/fields/Microsoft.VSTS.Scheduling.CompletedWork', value: 0 });
      ops.push({ op: 'add', path: '/fields/Microsoft.VSTS.Scheduling.RemainingWork', value: sourceWorkItem.fields['Microsoft.VSTS.Scheduling.OriginalEstimate'] ?? 0 });
    }

    // Copy Area Path
    const areaPath = sourceWorkItem.fields['System.AreaPath'];
    if (areaPath) {
      ops.push({ op: 'add', path: '/fields/System.AreaPath', value: areaPath });
    }

    // Copy Iteration Path
    const iterationPath = sourceWorkItem.fields['System.IterationPath'];
    if (iterationPath) {
      ops.push({ op: 'add', path: '/fields/System.IterationPath', value: iterationPath });
    }

    // Copy custom fields (exclude system-managed and read-only fields).
    // Mirrors the legacy SYSTEM_EXCLUDED_FIELDS list: copying read-only fields
    // such as System.Watermark / System.TeamProject / System.AreaId causes Azure
    // to reject the create payload.
    const excludedFields = new Set([
      // Identity, versioning and structural (read-only / derived)
      'System.Id', 'System.Rev', 'System.Watermark', 'System.TeamProject',
      'System.WorkItemType', 'System.NodeName', 'System.AreaId', 'System.IterationId',
      'System.PersonId', 'System.Reason',
      // Audit / lifecycle timestamps and authors
      'System.AuthorizedDate', 'System.RevisedDate', 'System.AuthorizedAs',
      'System.CreatedDate', 'System.CreatedBy', 'System.ChangedDate', 'System.ChangedBy',
      // Overridden or managed explicitly
      'System.Title', 'System.State', 'System.AssignedTo',
      'System.AreaPath', 'System.IterationPath', 'System.Tags', 'System.History',
      // Board / state metadata
      'System.BoardColumn', 'System.BoardColumnDone', 'System.BoardLane',
      // Link and attachment counters
      'System.CommentCount', 'System.AttachedFileCount', 'System.ExternalLinkCount',
      'System.HyperLinkCount', 'System.RelatedLinkCount',
      // Lifecycle tracking
      'Microsoft.VSTS.Common.ActivatedDate', 'Microsoft.VSTS.Common.ActivatedBy',
      'Microsoft.VSTS.Common.ClosedDate', 'Microsoft.VSTS.Common.ClosedBy',
      'Microsoft.VSTS.Common.ResolvedDate', 'Microsoft.VSTS.Common.ResolvedBy',
      'Microsoft.VSTS.Common.ResolvedReason', 'Microsoft.VSTS.Common.StateChangeDate',
      // Scheduling (handled explicitly or intentionally not carried over)
      'Microsoft.VSTS.Scheduling.StartDate', 'Microsoft.VSTS.Scheduling.FinishDate',
      'Microsoft.VSTS.Scheduling.TargetDate',
      'Microsoft.VSTS.Scheduling.OriginalEstimate', 'Microsoft.VSTS.Scheduling.RemainingWork',
      'Microsoft.VSTS.Scheduling.CompletedWork', 'Microsoft.VSTS.Scheduling.Effort',
    ]);

    for (const [key, value] of Object.entries(sourceWorkItem.fields)) {
      if (value == null) continue;
      if (excludedFields.has(key)) continue;
      if (key.startsWith('WEF_') || key.startsWith('Custom.')) continue;
      
      // Only copy scalar values and simple objects
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        ops.push({ op: 'add', path: `/fields/${key}`, value });
      }
    }

    return ops;
  }
}

/**
 * Relation Copy Service
 * Handles copying relations between work items
 */
export class RelationCopyService {
  constructor(private readonly repo: WorkItemRepository) {}

  async copyRelations(
    sourceWorkItem: WorkItem,
    targetId: number
  ): Promise<{ copiedCount: number; failedCount: number; totalRelations: number }> {
    const relations = sourceWorkItem.relations ?? [];
    const copyable = filterCopyableRelations(relations);
    
    if (copyable.length === 0) {
      return { copiedCount: 0, failedCount: 0, totalRelations: 0 };
    }

    return this.repo.copyRelations(sourceWorkItem, targetId, [...COPYABLE_RELATION_TYPES]);
  }

  /**
   * Re-copy only the copyable relations that are missing on the target.
   * Idempotent: relations already present on the target are skipped, so
   * repairing a partially-copied task does not create duplicate links.
   */
  async repairRelations(
    source: WorkItem,
    target: WorkItem
  ): Promise<{ copiedCount: number; failedCount: number; totalRelations: number }> {
    const targetKeys = new Set(
      (target.relations ?? []).map(r => `${r.rel}:::${r.url}`)
    );
    const missing = filterCopyableRelations(source.relations ?? [])
      .filter(r => !targetKeys.has(`${r.rel}:::${r.url}`));

    if (missing.length === 0) {
      return { copiedCount: 0, failedCount: 0, totalRelations: 0 };
    }

    return this.repo.copyRelations(
      { ...source, relations: missing },
      target.id,
      [...COPYABLE_RELATION_TYPES]
    );
  }
}

/**
 * Date Planning Service
 * Pure domain service for planning task creation dates
 */
export class DatePlanningService {
  planForPerson(
    person: Person,
    sourceTask: DiscoveredTask,
    todayIso: string,
    titlePrefix: string,
    thursdayMode: 'CURRENT' | 'FOLLOWING',
    skipWeekends: boolean,
    stopDayOfWeek: number,
    duplicateDetector: DuplicateDetector
  ): DatePlan {
    const existingTasksMap = duplicateDetector.getPersonDateMap(person);
    
    return planCreationDates({
      todayIso,
      latestExistingTaskIso: sourceTask.parsedDate.isoDate,
      latestExistingTaskId: sourceTask.workItem.id,
      existingTasksMap,
      titlePrefix,
      thursdayMode,
      skipWeekends,
      stopDayOfWeek,
    });
  }

  getTodayIso(timezone: string): string {
    return getTodayIso(timezone);
  }

  getNextThursdayIso(todayIso: string, thursdayMode: 'CURRENT' | 'FOLLOWING', stopDayOfWeek: number = 4): string {
    return getNextThursdayIso(todayIso, thursdayMode, stopDayOfWeek);
  }

  validateNotPastDate(requestedIso: string, actualTodayIso: string): void {
    validateNotPastDate(requestedIso, actualTodayIso);
  }
}

/**
 * Task Execution Service
 * Orchestrates the actual task creation
 */
export interface TaskExecutionContext {
  project: string;
  workItemType: string;
  titlePrefix: string;
  startTime: string;
  timezone: string;
  copyEstimates: boolean;
  resetActualWork: boolean;
  defaultState: string;
}

export class TaskExecutionService {
  constructor(
    private readonly repo: WorkItemRepository,
    private readonly fieldCopy: FieldCopyService,
    private readonly relationCopy: RelationCopyService
  ) {}

  async executeTask(
    context: TaskExecutionContext,
    sourceTask: DiscoveredTask,
    plannedDate: PlannedDate,
    person: Person
  ): Promise<{ task: CreatedTask; relationResult: { copiedCount: number; failedCount: number; totalRelations: number } }> {
    // Build field operations
    const fieldOps = this.fieldCopy.buildFieldPatchOperations({
      sourceWorkItem: sourceTask.workItem,
      newTitle: plannedDate.fullTitle,
      targetIsoDate: plannedDate.isoDate,
      assignedTo: person.assignedTo,
      startTime: context.startTime,
      timezone: context.timezone,
      copyEstimates: context.copyEstimates,
      resetActualWork: context.resetActualWork,
      defaultState: context.defaultState,
    });

    // Create work item
    const created = await this.repo.createWorkItemWithReconciliation(
      context.project,
      context.workItemType,
      fieldOps,
      { title: plannedDate.fullTitle, assignedTo: person.assignedTo }
    );

    // Copy relations
    const relationResult = await this.relationCopy.copyRelations(sourceTask.workItem, created.id);

    return { task: created, relationResult };
  }
}