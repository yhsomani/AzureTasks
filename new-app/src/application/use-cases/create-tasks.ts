/**
 * Create Tasks Use Case
 * Orchestrates the complete task creation workflow for one or more people
 */

import * as readline from 'node:readline/promises';
import { logger } from '../../infrastructure/logging/logger.js';
import { WorkItemRepository, JournalRepository, LockRepository, AppConfig } from '../../domain/ports/repositories.js';
import { Person, matchesPerson } from '../../domain/entities/person.js';
import { 
  DiscoveredTask, 
  WorkItem, 
  CreatedTask,
  parseTitleDate,
  validateSourceTaskOwnership,
  matchesTaskSeries,
  extractTitlePrefix,
  filterCopyableRelations,
  WorkItemRelation,
} from '../../domain/entities/task.js';
import { 
  TaskDiscoveryService, 
  DuplicateDetector, 
  FieldCopyService, 
  RelationCopyService,
  DatePlanningService,
  TaskExecutionService,
  TaskExecutionContext
} from '../../domain/services/task-services.js';
import { 
  PlannedDate,
  validateNotPastDate,
  formatTitleDate,
  zonedTimeToUtcIso,
} from '../../domain/value-objects/date-window.js';

export interface CreateTasksInput {
  personKeys?: string[];      // Specific people to process (empty = all)
  all?: boolean;              // Process all enabled people
  dryRun?: boolean;           // Preview only
  asOf?: string;              // Simulate as specific date
  thursdayMode?: 'CURRENT' | 'FOLLOWING';
  yes?: boolean;              // Skip confirmation
}

export interface CreateAdHocTaskInput {
  personKey: string;
  targetIsoDate: string;      // YYYY-MM-DD
  customTitle?: string;
  sourceTaskId?: number;
  originalEstimate?: number;
  activity?: string;
  description?: string;
  bypassDuplicateCheck?: boolean;
}

export interface CreateAdHocTaskOutput {
  success: boolean;
  task?: CreatedTask;
  sourceTaskId?: number;
  relationResult?: { copiedCount: number; failedCount: number; totalRelations: number };
  auditWarning?: string;
  error?: string;
}

export interface PersonExecutionPlan {
  person: Person;
  sourceTask: DiscoveredTask | null;
  status: 'READY' | 'SOURCE_NOT_FOUND' | 'FUTURE_TASK_WARN' | 'NO_TASKS_NEEDED';
  statusMessage?: string;
  effectiveStartDate: string;
  nextThursday: string;
  plannedDates: PlannedDate[];
}

export interface PersonExecutionResult {
  person: Person;
  sourceTaskId?: number;
  sourceTaskDate?: string;
  status: 'SUCCESS' | 'PARTIAL' | 'SOURCE_FAILED' | 'FAILED' | 'SKIPPED';
  createdTasks: CreatedTask[];
  duplicateSkips: PlannedDate[];
  weekendSkips: PlannedDate[];
  failedTasks: PlannedDate[];
  relationsProcessed: number;
  relationsFailed: number;
  auditWarnings?: string[];
}

export interface CreateTasksOutput {
  peopleProcessedCount: number;
  totalCreatedCount: number;
  totalDuplicateCount: number;
  totalWeekendSkipCount: number;
  totalSourceFailureCount: number;
  totalTaskFailureCount: number;
  totalRelationFailureCount: number;
  personResults: PersonExecutionResult[];
}

export interface ProgressEvent {
  type: 'progress' | 'task_created' | 'task_failed' | 'done';
  message: string;
  data?: any;
  timestamp: string;
}

export class CreateTasksUseCase {
  private readonly discovery: TaskDiscoveryService;
  private readonly duplicateDetector: DuplicateDetector;
  private readonly fieldCopy: FieldCopyService;
  private readonly relationCopy: RelationCopyService;
  private readonly datePlanning: DatePlanningService;
  private readonly execution: TaskExecutionService;

  constructor(
    private readonly workItemRepo: WorkItemRepository,
    private readonly journalRepo: JournalRepository,
    private readonly lockRepo: LockRepository,
    private readonly config: AppConfig
  ) {
    this.discovery = new TaskDiscoveryService(workItemRepo);
    this.duplicateDetector = new DuplicateDetector();
    this.fieldCopy = new FieldCopyService();
    this.relationCopy = new RelationCopyService(workItemRepo);
    this.datePlanning = new DatePlanningService();
    this.execution = new TaskExecutionService(workItemRepo, this.fieldCopy, this.relationCopy);
  }

  /**
   * A successful PATCH is not independent verification. Read back the Azure
   * work item and check identity, type, state, planned start, and copied links.
   * Unknown/missing fields or incomplete relations must remain unverified.
   */
  private async verifyCreatedTask(
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

  async execute(input: CreateTasksInput, onProgress?: (event: ProgressEvent) => void): Promise<CreateTasksOutput> {
    const runId = `run-${Date.now()}`;
    
    // Acquire lock for non-dry-run
    if (!input.dryRun) {
      if (!this.lockRepo.acquire()) {
        throw new Error('Another execution is already running. Please wait for it to complete.');
      }
    }

    try {
      // Load people
      const people = this.selectPeople(input);
      if (people.length === 0) {
        throw new Error('No people selected for task creation');
      }

      onProgress?.({ type: 'progress', message: 'Connecting to Azure DevOps...', timestamp: new Date().toISOString() });

      // Validate project and work item type
      await this.workItemRepo.validateProject(this.config.project);
      await this.workItemRepo.validateWorkItemType(this.config.project, this.config.workItemType);

      // Determine dates
      const actualTodayIso = this.datePlanning.getTodayIso(this.config.timezone);
      const configuredTodayIso = input.asOf || actualTodayIso;
      
      // Validate not past date
      validateNotPastDate(configuredTodayIso, actualTodayIso);
      
      const todayIso = configuredTodayIso;
      // Effective window mode: request override wins over persisted config.
      const thursdayMode = input.thursdayMode ?? this.config.thursdayMode;
      const nextThursdayIso = this.datePlanning.getNextThursdayIso(todayIso, thursdayMode, this.config.stopDayOfWeek);

      onProgress?.({ type: 'progress', message: 'Discovering source tasks...', timestamp: new Date().toISOString() });

      // Discover source tasks
      const discoveredTasks = await this.discovery.discoverForPeople(
        this.config.project,
        this.config.workItemType,
        this.config.titlePrefix,
        people,
        undefined, // sourceTaskIdOverride handled per-person
        this.config.defaultSourceTaskId
      );

      // Build execution plans
      const plans = await this.buildPlans(people, discoveredTasks, todayIso, thursdayMode);

      // Get existing tasks for duplicate detection
      await this.populateDuplicateMaps(people, todayIso, nextThursdayIso);

      // Recalculate plans with duplicate info
      const finalPlans = this.recalculatePlans(plans, todayIso, thursdayMode);

      // Dry run - just return plans
      if (input.dryRun) {
        return this.buildOutput(finalPlans, new Map());
      }

      // Check if anything to do
      const totalToCreate = finalPlans.reduce(
        (sum, p) => sum + p.plannedDates.filter(d => d.status === 'PLANNED').length,
        0
      );

      if (totalToCreate === 0) {
        onProgress?.({ type: 'progress', message: 'No new tasks required to create.', timestamp: new Date().toISOString() });
        return this.buildOutput(finalPlans, new Map());
      }

      // Print plan and get confirmation
      if (!input.yes) {
        this.printPlan(finalPlans, totalToCreate);
        const confirmed = await this.promptConfirm('Proceed with creation?');
        if (!confirmed) {
          onProgress?.({ type: 'progress', message: 'Execution cancelled by user.', timestamp: new Date().toISOString() });
          return this.buildOutput(finalPlans, new Map());
        }
      }

      // Validate the local audit store before any remote mutation.
      await this.journalRepo.getEntries(1);

      // Execute
      onProgress?.({ type: 'progress', message: `Creating ${totalToCreate} tasks...`, timestamp: new Date().toISOString() });

      const resultsMap = await this.executePlans(
        finalPlans, 
        discoveredTasks, 
        runId,
        onProgress
      );

      const output = this.buildOutput(finalPlans, resultsMap);
      
      onProgress?.({ 
        type: 'done', 
        message: `Completed: ${output.totalCreatedCount} created, ${output.totalTaskFailureCount} failed`, 
        data: output,
        timestamp: new Date().toISOString()
      });

      return output;
    } finally {
      if (!input.dryRun) {
        this.lockRepo.release();
      }
    }
  }

  /**
   * Execute an ad-hoc single task creation for a specific person, date, or custom parameters.
   */
  async executeAdHocTask(input: CreateAdHocTaskInput): Promise<CreateAdHocTaskOutput> {
    if (!input.personKey || !input.targetIsoDate) {
      throw new Error('Both personKey and targetIsoDate (YYYY-MM-DD) are required.');
    }
    const date = new Date(`${input.targetIsoDate}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.targetIsoDate) ||
      Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== input.targetIsoDate) {
      throw new Error('targetIsoDate must be a valid YYYY-MM-DD date.');
    }
    validateNotPastDate(input.targetIsoDate, this.datePlanning.getTodayIso(this.config.timezone));
    if (this.config.skipWeekends && [0, 6].includes(date.getUTCDay())) {
      throw new Error('Weekend task creation is disabled in project settings.');
    }
    if (input.bypassDuplicateCheck) {
      throw new Error('Bypassing duplicate detection is disabled for task safety.');
    }

    const personConfig = this.config.people.find(p => 
      p.key === input.personKey || p.assignedTo.toLowerCase() === input.personKey.toLowerCase()
    );
    if (!personConfig || personConfig.enabled === false) {
      throw new Error(`Person "${input.personKey}" is not an enabled configured team member.`);
    }
    const person = new Person(personConfig);

    // Concurrency lock
    if (!this.lockRepo.acquire()) {
      const lock = this.lockRepo.getLockInfo();
      throw new Error(`Cannot run task creation: another process (PID ${lock?.pid}) is executing.`);
    }

    const runId = `adhoc-${Date.now()}`;
    try {
      await this.journalRepo.getEntries(1);
      // 1. Resolve source task
      const memberPrefix = person.titlePrefix || this.config.titlePrefix;
      let sourceTask: DiscoveredTask | null = null;
      if (input.sourceTaskId) {
        const item = await this.workItemRepo.getWorkItem(input.sourceTaskId);
        const parsedDate = validateSourceTaskOwnership(
          item, this.config.project, this.config.workItemType, memberPrefix, person.assignedTo
        );
        sourceTask = {
          workItem: item,
          parsedDate,
          key: person.key,
        };
      } else {
        sourceTask = await this.workItemRepo.findLatestTaskForPerson(
          this.config.project,
          this.config.workItemType,
          memberPrefix,
          person.assignedTo,
          personConfig.sourceTaskId ?? this.config.defaultSourceTaskId
        );
      }

      if (!sourceTask) {
        throw new Error(`Could not locate a reference source task for ${person.name} to copy fields & relations from.`);
      }

      // 2. Determine Title
      const effectivePrefix = person.titlePrefix || extractTitlePrefix(sourceTask.workItem.fields['System.Title'] || '') || this.config.titlePrefix;
      const fullTitle = input.customTitle?.trim() 
        || `${effectivePrefix} ${formatTitleDate(input.targetIsoDate)}`;
      if (!matchesTaskSeries(fullTitle, effectivePrefix) ||
          parseTitleDate(fullTitle, effectivePrefix, true).isoDate !== input.targetIsoDate) {
        throw new Error('Task title must use the configured series and match the selected date.');
      }

      // 3. Duplicate check unless bypassed
      if (!input.bypassDuplicateCheck) {
        const existingMap = await this.discovery.getExistingTasksMap(
          this.config.project,
          this.config.workItemType,
          effectivePrefix,
          person,
          input.targetIsoDate,
          input.targetIsoDate
        );
        if (existingMap.has(input.targetIsoDate)) {
          const ex = existingMap.get(input.targetIsoDate)!;
          throw new Error(`Duplicate task already exists for ${person.name} on ${input.targetIsoDate} (#${ex.id}: "${ex.title}").`);
        }
      }

      // 4. Build field operations
      const plannedDate: PlannedDate = {
        isoDate: input.targetIsoDate,
        formattedTitleDate: formatTitleDate(input.targetIsoDate),
        fullTitle,
        status: 'PLANNED',
      };

      // Custom fields overrides on cloned source task
      const clonedSourceItem: WorkItem = JSON.parse(JSON.stringify(sourceTask.workItem));
      if (input.originalEstimate !== undefined) {
        clonedSourceItem.fields['Microsoft.VSTS.Scheduling.OriginalEstimate'] = input.originalEstimate;
        clonedSourceItem.fields['Microsoft.VSTS.Scheduling.RemainingWork'] = input.originalEstimate;
      }
      if (input.activity) {
        clonedSourceItem.fields['Microsoft.VSTS.Common.Activity'] = input.activity;
      }
      if (input.description) {
        clonedSourceItem.fields['System.Description'] = input.description;
      }

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

      const { task, relationResult } = await this.execution.executeTask(
        execContext,
        { ...sourceTask, workItem: clonedSourceItem },
        plannedDate,
        person
      );

      // A successful Azure write must never be relabeled as a creation failure
      // because local journaling or the verification read-back failed.
      const verified = await this.verifyCreatedTask(
        task.id, fullTitle, person, relationResult.failedCount, input.targetIsoDate,
        sourceTask.workItem.relations
      );
      let auditWarning: string | undefined;
      try {
        await this.journalRepo.record({
          runId,
          timestamp: new Date().toISOString(),
          personKey: person.key,
          personName: person.name,
          assignedTo: person.assignedTo,
          targetIsoDate: input.targetIsoDate,
          title: fullTitle,
          sourceTaskId: sourceTask.workItem.id,
          createdWorkItemId: task.id,
          fieldCopyStatus: 'SUCCESS',
          relationCopyStatus: relationResult.failedCount === 0 ? 'SUCCESS' : 'PARTIAL',
          verified,
          error: verified ? undefined : 'Azure creation accepted, but complete independent read-back / relation verification is pending.',
        });
      } catch (err) {
        auditWarning = `Created Azure task #${task.id}, but local journal write failed: ${err instanceof Error ? err.message : String(err)}`;
        logger.error(auditWarning);
      }

      return { success: true, task, sourceTaskId: sourceTask.workItem.id, relationResult, auditWarning };
    } finally {
      this.lockRepo.release();
    }
  }

  private selectPeople(input: CreateTasksInput): Person[] {
    const allPeople = this.config.people
      .filter(p => p.enabled !== false)
      .map(p => new Person(p));

    if (input.all || (!input.personKeys && !input.all)) {
      return allPeople;
    }

    if (input.personKeys && input.personKeys.length > 0) {
      const selected = allPeople.filter(p => input.personKeys!.includes(p.key));
      if (selected.length !== input.personKeys.length) {
        const found = selected.map(p => p.key);
        const missing = input.personKeys.filter(k => !found.includes(k));
        throw new Error(`People not found: ${missing.join(', ')}`);
      }
      return selected;
    }

    return [];
  }

  private async buildPlans(
    people: Person[],
    discoveredTasks: Map<string, DiscoveredTask>,
    todayIso: string,
    thursdayMode: 'CURRENT' | 'FOLLOWING'
  ): Promise<PersonExecutionPlan[]> {
    const nextThursdayIso = this.datePlanning.getNextThursdayIso(todayIso, thursdayMode, this.config.stopDayOfWeek);
    const plans: PersonExecutionPlan[] = [];

    for (const person of people) {
      const discovered = discoveredTasks.get(person.key);
      
      if (!discovered) {
        plans.push({
          person,
          sourceTask: null,
          status: 'SOURCE_NOT_FOUND',
          statusMessage: `No valid source task found for ${person.name}.`,
          effectiveStartDate: todayIso,
          nextThursday: nextThursdayIso,
          plannedDates: [],
        });
        continue;
      }

      const personPrefix = person.titlePrefix || extractTitlePrefix(discovered.workItem.fields['System.Title'] || '') || this.config.titlePrefix;
      const plan = this.datePlanning.planForPerson(
        person,
        discovered,
        todayIso,
        personPrefix,
        thursdayMode,
        this.config.skipWeekends,
        this.config.stopDayOfWeek,
        this.duplicateDetector
      );

      const toCreate = plan.plannedDates.filter(d => d.status === 'PLANNED');
      let status: PersonExecutionPlan['status'] = toCreate.length > 0 ? 'READY' : 'NO_TASKS_NEEDED';
      let statusMsg = plan.warningMessage;

      if (toCreate.length === 0 && !statusMsg) {
        statusMsg = `All working dates up to date (latest task: ${discovered.parsedDate.formattedTitleDate}).`;
      }

      if (discovered.parsedDate.isoDate > nextThursdayIso && toCreate.length === 0) {
        status = 'FUTURE_TASK_WARN';
        statusMsg = `Latest task date (${discovered.parsedDate.isoDate}) is ahead of creation window ending on Thursday (${nextThursdayIso}).`;
      }

      plans.push({
        person,
        sourceTask: discovered,
        status,
        statusMessage: statusMsg,
        effectiveStartDate: plan.effectiveStartDate,
        nextThursday: plan.nextThursday,
        plannedDates: plan.plannedDates,
      });
    }

    return plans;
  }

  private async populateDuplicateMaps(
    people: Person[],
    startDate: string,
    endDate: string
  ): Promise<void> {
    for (const person of people) {
      const personPrefix = person.titlePrefix || this.config.titlePrefix;
      const existingMap = await this.discovery.getExistingTasksMap(
        this.config.project,
        this.config.workItemType,
        personPrefix,
        person,
        startDate,
        endDate
      );
      this.duplicateDetector.setPersonDateMap(person.key, existingMap);
    }
  }

  private recalculatePlans(plans: PersonExecutionPlan[], todayIso: string, thursdayMode: 'CURRENT' | 'FOLLOWING'): PersonExecutionPlan[] {
    return plans.map(plan => {
      if (!plan.sourceTask) return plan;
      
      const personPrefix = plan.person.titlePrefix || extractTitlePrefix(plan.sourceTask.workItem.fields['System.Title'] || '') || this.config.titlePrefix;
      const newPlan = this.datePlanning.planForPerson(
        plan.person,
        plan.sourceTask,
        todayIso,
        personPrefix,
        thursdayMode,
        this.config.skipWeekends,
        this.config.stopDayOfWeek,
        this.duplicateDetector
      );
      
      const toCreate = newPlan.plannedDates.filter(d => d.status === 'PLANNED');
      let status: PersonExecutionPlan['status'] = toCreate.length > 0 ? 'READY' : 'NO_TASKS_NEEDED';
      let statusMsg = newPlan.warningMessage;

      if (toCreate.length === 0 && !statusMsg) {
        statusMsg = `All working dates up to date (latest task: ${plan.sourceTask.parsedDate.formattedTitleDate}).`;
      }

      if (plan.sourceTask.parsedDate.isoDate > plan.nextThursday && toCreate.length === 0) {
        status = 'FUTURE_TASK_WARN';
        statusMsg = `Latest task date (${plan.sourceTask.parsedDate.isoDate}) is ahead of creation window ending on Thursday (${plan.nextThursday}).`;
      }

      return {
        ...plan,
        status,
        statusMessage: statusMsg,
        plannedDates: newPlan.plannedDates,
        effectiveStartDate: newPlan.effectiveStartDate,
      };
    });
  }

  private async executePlans(
    plans: PersonExecutionPlan[],
    discoveredTasks: Map<string, DiscoveredTask>,
    runId: string,
    onProgress?: (event: ProgressEvent) => void
  ): Promise<Map<string, PersonExecutionResult>> {
    const resultsMap = new Map<string, PersonExecutionResult>();
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

    for (const plan of plans) {
      const { person, sourceTask } = plan;
      const personKey = person.key;

      if (plan.status !== 'READY' || !sourceTask) {
        resultsMap.set(personKey, {
          person,
          sourceTaskId: sourceTask?.workItem.id,
          sourceTaskDate: sourceTask?.parsedDate.formattedTitleDate,
          status: plan.status === 'SOURCE_NOT_FOUND' ? 'SOURCE_FAILED' : 'SKIPPED',
          createdTasks: [],
          duplicateSkips: plan.plannedDates.filter(d => ['DUPLICATE', 'DUPLICATE_ALREADY_EXISTS', 'MULTIPLE_EXISTING_TASKS'].includes(d.status)),
          weekendSkips: plan.plannedDates.filter(d => d.status === 'WEEKEND_SKIP'),
          failedTasks: [],
          relationsProcessed: 0,
          relationsFailed: 0,
        });
        continue;
      }

      onProgress?.({ type: 'progress', message: `Processing ${person.name}...`, timestamp: new Date().toISOString() });

      const toCreate = plan.plannedDates.filter(d => d.status === 'PLANNED');
      const createdTasks: CreatedTask[] = [];
      const failedTasks: PlannedDate[] = [];
      const auditWarnings: string[] = [];
      let relsProcessed = 0;
      let relsFailed = 0;

      for (const item of toCreate) {
        onProgress?.({ type: 'progress', message: `Creating task for ${person.name} on ${item.formattedTitleDate}...`, timestamp: new Date().toISOString() });

        try {
          const { task, relationResult } = await this.execution.executeTask(
            execContext,
            sourceTask,
            item,
            person
          );

          item.createdWorkItemId = task.id;
          item.status = 'CREATED';
          createdTasks.push(task);
          relsProcessed++;
          relsFailed += relationResult.failedCount;

          onProgress?.({
            type: 'task_created',
            message: `Created #${task.id} for ${person.name} - ${task.title}`,
            data: { id: task.id, person, item },
            timestamp: new Date().toISOString(),
          });

          const verified = await this.verifyCreatedTask(
            task.id, item.fullTitle, person, relationResult.failedCount, item.isoDate,
            sourceTask.workItem.relations
          );
          if (!verified) {
            auditWarnings.push(`Task #${task.id} was created but Azure field/relation read-back is not verified.`);
          }
          try {
            await this.journalRepo.record({
              runId,
              timestamp: new Date().toISOString(),
              personKey: person.key,
              personName: person.name,
              assignedTo: person.assignedTo,
              targetIsoDate: item.isoDate,
              title: item.fullTitle,
              sourceTaskId: sourceTask.workItem.id,
              createdWorkItemId: task.id,
              fieldCopyStatus: 'SUCCESS',
              relationCopyStatus: relationResult.failedCount === 0 ? 'SUCCESS' : 'PARTIAL',
              verified,
              error: verified ? undefined : 'Independent Azure field/relation verification pending.',
            });
          } catch (journalError) {
            const warning = `Azure task #${task.id} was created, but local audit journal write failed: ${journalError instanceof Error ? journalError.message : String(journalError)}`;
            auditWarnings.push(warning);
            logger.error(warning);
            onProgress?.({ type: 'progress', message: warning, timestamp: new Date().toISOString() });
          }
        } catch (error) {
          item.status = 'FAILED';
          item.errorMessage = error instanceof Error ? error.message : String(error);
          failedTasks.push(item);

          onProgress?.({
            type: 'task_failed',
            message: `Failed to create task for ${person.name} on ${item.formattedTitleDate}: ${item.errorMessage}`,
            data: { person, item, error: item.errorMessage },
            timestamp: new Date().toISOString(),
          });

          try {
            await this.journalRepo.record({
              runId,
              timestamp: new Date().toISOString(),
              personKey: person.key,
              personName: person.name,
              assignedTo: person.assignedTo,
              targetIsoDate: item.isoDate,
              title: item.fullTitle,
              sourceTaskId: sourceTask.workItem.id,
              fieldCopyStatus: 'FAILED',
              relationCopyStatus: 'FAILED',
              verified: false,
              error: item.errorMessage,
            });
          } catch (journalError) {
            const warning = `Could not audit failed task plan for ${person.name} on ${item.isoDate}: ${journalError instanceof Error ? journalError.message : String(journalError)}`;
            auditWarnings.push(warning);
            logger.error(warning);
          }
        }
      }

      let status: PersonExecutionResult['status'] = 'SUCCESS';
      if (failedTasks.length > 0 && createdTasks.length > 0) status = 'PARTIAL';
      else if (failedTasks.length > 0 && createdTasks.length === 0) status = 'FAILED';
      else if (auditWarnings.length > 0 || relsFailed > 0) status = 'PARTIAL';

      resultsMap.set(personKey, {
        person,
        sourceTaskId: sourceTask.workItem.id,
        sourceTaskDate: sourceTask.parsedDate.formattedTitleDate,
        status,
        createdTasks,
        duplicateSkips: plan.plannedDates.filter(d => ['DUPLICATE', 'DUPLICATE_ALREADY_EXISTS', 'MULTIPLE_EXISTING_TASKS'].includes(d.status)),
        weekendSkips: plan.plannedDates.filter(d => d.status === 'WEEKEND_SKIP'),
        failedTasks,
        relationsProcessed: relsProcessed,
        relationsFailed: relsFailed,
        auditWarnings,
      });
    }

    return resultsMap;
  }

  private buildOutput(
    plans: PersonExecutionPlan[],
    resultsMap: Map<string, PersonExecutionResult>
  ): CreateTasksOutput {
    let totalCreated = 0;
    let totalDuplicates = 0;
    let totalWeekends = 0;
    let totalSourceFailures = 0;
    let totalTaskFailures = 0;
    let totalRelationFailures = 0;

    const personResults: PersonExecutionResult[] = [];

    for (const plan of plans) {
      const res = resultsMap.get(plan.person.key);

      if (plan.status === 'SOURCE_NOT_FOUND') {
        totalSourceFailures++;
      }

      const dupCount = plan.plannedDates.filter(d => 
        ['DUPLICATE', 'DUPLICATE_ALREADY_EXISTS', 'MULTIPLE_EXISTING_TASKS'].includes(d.status)
      ).length;
      const wCount = plan.plannedDates.filter(d => d.status === 'WEEKEND_SKIP').length;
      totalDuplicates += dupCount;
      totalWeekends += wCount;

      if (res) {
        totalCreated += res.createdTasks.length;
        totalTaskFailures += res.failedTasks.length;
        totalRelationFailures += res.relationsFailed;
        personResults.push(res);
      } else {
        personResults.push({
          person: plan.person,
          sourceTaskId: plan.sourceTask?.workItem.id,
          sourceTaskDate: plan.sourceTask?.parsedDate.formattedTitleDate,
          status: plan.status === 'SOURCE_NOT_FOUND' ? 'SOURCE_FAILED' : 'SKIPPED',
          createdTasks: [],
          duplicateSkips: plan.plannedDates.filter(d => 
            ['DUPLICATE', 'DUPLICATE_ALREADY_EXISTS', 'MULTIPLE_EXISTING_TASKS'].includes(d.status)
          ),
          weekendSkips: plan.plannedDates.filter(d => d.status === 'WEEKEND_SKIP'),
          failedTasks: [],
          relationsProcessed: 0,
          relationsFailed: 0,
        });
      }
    }

    return {
      peopleProcessedCount: plans.length,
      totalCreatedCount: totalCreated,
      totalDuplicateCount: totalDuplicates,
      totalWeekendSkipCount: totalWeekends,
      totalSourceFailureCount: totalSourceFailures,
      totalTaskFailureCount: totalTaskFailures,
      totalRelationFailureCount: totalRelationFailures,
      personResults,
    };
  }

  private printPlan(plans: PersonExecutionPlan[], totalToCreate: number): void {
    console.log('\n========================================');
    console.log('TASK CREATION PLAN');
    console.log('========================================');
    console.log(`People: ${plans.length}`);
    console.log(`Tasks to create: ${totalToCreate}\n`);

    for (const plan of plans) {
      const createList = plan.plannedDates.filter(d => d.status === 'PLANNED');
      if (createList.length > 0) {
        console.log(`${plan.person.name} (${plan.person.assignedTo}):`);
        for (const item of createList) {
          console.log(`  - ${item.fullTitle} (${this.config.startTime} ${this.config.timezone})`);
        }
      } else {
        console.log(`${plan.person.name}: 0 tasks (${plan.statusMessage || 'All dates up to date'})`);
      }
    }
    console.log('========================================\n');
  }

  private async promptConfirm(message: string): Promise<boolean> {
    // Automation (API/daemon) always passes yes:true, so this only runs for an
    // interactive CLI `run` without --yes. Refuse rather than silently proceed
    // when there is no TTY to read from.
    if (!process.stdin.isTTY) {
      console.log('No interactive terminal detected. Re-run with --yes to confirm non-interactively.');
      return false;
    }

    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    try {
      const answer = (await rl.question(`${message} [y/N] `)).trim().toLowerCase();
      return answer === 'y' || answer === 'yes';
    } finally {
      rl.close();
    }
  }
}