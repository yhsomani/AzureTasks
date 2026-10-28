/**
 * Task Executor
 * Responsibilities: Azure API interactions, work item creation, relation copying
 * Extracted from CreateTasksUseCase (~250 LOC)
 */

import { WorkItemRepository, AppConfig } from '../../domain/ports/repositories.js';
import { Person, matchesPerson } from '../../domain/entities/person.js';
import { 
  DiscoveredTask, 
  CreatedTask,
  WorkItemRelation,
  filterCopyableRelations,
} from '../../domain/entities/task.js';
import { 
  TaskExecutionService,
  TaskExecutionContext,
  FieldCopyService,
  RelationCopyService,
} from '../../domain/services/task-services.js';
import { 
  PlannedDate,
  zonedTimeToUtcIso,
} from '../../domain/value-objects/date-window.js';
import { logger } from '../../infrastructure/logging/logger.js';

export interface ExecutionResult {
  task: CreatedTask;
  relationResult: { copiedCount: number; failedCount: number; totalRelations: number };
}

export class TaskExecutor {
  private readonly execution: TaskExecutionService;

  constructor(
    private readonly workItemRepo: WorkItemRepository,
    private readonly config: AppConfig
  ) {
    const fieldCopy = new FieldCopyService();
    const relationCopy = new RelationCopyService(workItemRepo);
    this.execution = new TaskExecutionService(workItemRepo, fieldCopy, relationCopy);
  }

  /**
   * Verify a created task by reading back from Azure DevOps
   * Checks identity, type, state, planned start, and copied links
   */
  async verifyCreatedTask(
    id: number,
    title: string,
    person: Person,
    relationFailures: number,
    targetIsoDate: string,
    sourceRelations: WorkItemRelation[] = []
  ): Promise<boolean> {
    if (relationFailures > 0) return false;
    try {
      const actual = await this.workItemRepo.getWorkItem(id);
      const expectedStart = zonedTimeToUtcIso(
        targetIsoDate, this.config.startTime, this.config.timezone
      );
      const actualStart = Date.parse(String(actual.fields['Microsoft.VSTS.Scheduling.StartDate'] || ''));
      const startMatches = Number.isFinite(actualStart) &&
        Math.abs(actualStart - Date.parse(expectedStart)) <= 1000;
      const actualRelations = new Set(
        (actual.relations ?? []).map(relation => `${relation.rel}:::${relation.url}`)
      );
      const linksMatch = filterCopyableRelations(sourceRelations).every(relation =>
        actualRelations.has(`${relation.rel}:::${relation.url}`)
      );
      return actual.id === id &&
        String(actual.fields['System.Title'] || '') === title &&
        matchesPerson(actual.fields['System.AssignedTo'], person) &&
        String(actual.fields['System.WorkItemType'] || '') === this.config.workItemType &&
        String(actual.fields['System.State'] || '').toLowerCase() === this.config.defaultState.toLowerCase() &&
        startMatches && linksMatch;
    } catch (error) {
      logger.warn(`Azure DevOps read-back unavailable for created work item #${id}: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  /**
   * Create work items for a planned date
   */
  async createWorkItems(
    sourceTask: DiscoveredTask,
    plannedDate: PlannedDate,
    person: Person
  ): Promise<ExecutionResult> {
    const execContext: TaskExecutionContext = {
      project: this.config.project,
      workItemType: this.config.workItemType,
      titlePrefix: this.config.titlePrefix,
      startTime: this.config.startTime,
      timezone: this.config.timezone,
      copyEstimates: this.config.copyEstimates,
      resetActualWork: this.config.resetActualWork,
      defaultState: this.config.defaultState,
    };

    return await this.execution.executeTask(
      execContext,
      sourceTask,
      plannedDate,
      person
    );
  }

  /**
   * Get the execution service
   */
  getExecutionService(): TaskExecutionService {
    return this.execution;
  }
}
