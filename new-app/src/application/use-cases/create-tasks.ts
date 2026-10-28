/**
 * Create Tasks Use Case
 * Orchestrates the complete task creation workflow for one or more people
 */

import * as readline from 'node:readline/promises';
import { logger } from '../../infrastructure/logging/logger.js';
import { WorkItemRepository, JournalRepository, LockRepository, AppConfig } from '../../domain/ports/repositories.js';
import { Person } from '../../domain/entities/person.js';
import { 
  DiscoveredTask, 
  CreatedTask,
  parseTitleDate,
  validateSourceTaskOwnership,
  matchesTaskSeries,
  extractTitlePrefix,
} from '../../domain/entities/task.js';
import { 
  TaskDiscoveryService, 
  FieldCopyService, 
  RelationCopyService,
} from '../../domain/services/task-services.js';
import { 
  PlannedDate,
  validateNotPastDate,
  formatTitleDate,
} from '../../domain/value-objects/date-window.js';
import { TaskPlanBuilder, PersonExecutionPlan } from './task-plan-builder.js';
import { TaskExecutor } from './task-executor.js';
import { TaskResultAggregator, PersonExecutionResult, CreateTasksOutput } from './task-result-aggregator.js';

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

export interface ProgressEvent {
  type: 'progress' | 'task_created' | 'task_failed' | 'done';
  message: string;
  data?: unknown;
  timestamp: string;
}

export class CreateTasksUseCase {
  private readonly discovery: TaskDiscoveryService;
  private readonly planBuilder: TaskPlanBuilder;
  private readonly executor: TaskExecutor;
  private readonly resultAggregator: TaskResultAggregator;
  private readonly fieldCopy: FieldCopyService;
  private readonly relationCopy: RelationCopyService;

  constructor(
    private readonly workItemRepo: WorkItemRepository,
    private readonly journalRepo: JournalRepository,
    private readonly lockRepo: LockRepository,
    private readonly config: AppConfig
  ) {
    this.discovery = new TaskDiscoveryService(workItemRepo);
    this.fieldCopy = new FieldCopyService();
    this.relationCopy = new RelationCopyService(workItemRepo);
    this.planBuilder = new TaskPlanBuilder(this.discovery, config);
    this.executor = new TaskExecutor(workItemRepo, config);
    this.resultAggregator = new TaskResultAggregator();
  }

  /**
   * Execute main task creation workflow
   */
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
      const people = this.planBuilder.selectPeople(input.personKeys, input.all);
      if (people.length === 0) {
        throw new Error('No people selected for task creation');
      }

      onProgress?.({ type: 'progress', message: 'Connecting to Azure DevOps...', timestamp: new Date().toISOString() });

      // Validate project and work item type
      await this.workItemRepo.validateProject(this.config.project);
      await this.workItemRepo.validateWorkItemType(this.config.project, this.config.workItemType);

      // Determine dates
      const datePlanning = this.planBuilder.getDatePlanningService();
      const actualTodayIso = datePlanning.getTodayIso(this.config.timezone);
      const configuredTodayIso = input.asOf || actualTodayIso;
      
      // Validate not past date
      validateNotPastDate(configuredTodayIso, actualTodayIso);
      
      const todayIso = configuredTodayIso;
      const thursdayMode = input.thursdayMode ?? this.config.thursdayMode;
      const nextThursdayIso = datePlanning.getNextThursdayIso(todayIso, thursdayMode, this.config.stopDayOfWeek);

      onProgress?.({ type: 'progress', message: 'Discovering source tasks...', timestamp: new Date().toISOString() });

      // Discover source tasks
      const discoveredTasks = await this.discovery.discoverForPeople(
        this.config.project,
        this.config.workItemType,
        this.config.titlePrefix,
        people,
        undefined,
        this.config.defaultSourceTaskId
      );

      // Build execution plans
      const plans = await this.planBuilder.buildPlans(people, discoveredTasks, todayIso, thursdayMode);

      // Get existing tasks for duplicate detection
      await this.planBuilder.populateDuplicateMaps(people, todayIso, nextThursdayIso);

      // Recalculate plans with duplicate info
      const finalPlans = this.planBuilder.recalculatePlans(plans, todayIso, thursdayMode);

      // Dry run - just return plans
      if (input.dryRun) {
        return this.resultAggregator.buildOutput(finalPlans, new Map());
      }

      // Check if anything to do
      const totalToCreate = finalPlans.reduce(
        (sum, p) => sum + p.plannedDates.filter(d => d.status === 'PLANNED').length,
        0
      );

      if (totalToCreate === 0) {
        onProgress?.({ type: 'progress', message: 'No new tasks required to create.', timestamp: new Date().toISOString() });
        return this.resultAggregator.buildOutput(finalPlans, new Map());
      }

      // Print plan and get confirmation
      if (!input.yes) {
        console.log(this.resultAggregator.formatPlan(finalPlans, totalToCreate, this.config.startTime, this.config.timezone));
        const confirmed = await this.promptConfirm('Proceed with creation?');
        if (!confirmed) {
          onProgress?.({ type: 'progress', message: 'Execution cancelled by user.', timestamp: new Date().toISOString() });
          return this.resultAggregator.buildOutput(finalPlans, new Map());
        }
      }

      // Validate the local audit store before any remote mutation.
      await this.journalRepo.getEntries(1);

      // Execute
      onProgress?.({ type: 'progress', message: `Creating ${totalToCreate} tasks...`, timestamp: new Date().toISOString() });

      const resultsMap = await this.executePlans(
        finalPlans, 
        runId,
        onProgress
      );

      const output = this.resultAggregator.buildOutput(finalPlans, resultsMap);
      
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
   * Execute an ad-hoc single task creation
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
    
    const datePlanning = this.planBuilder.getDatePlanningService();
    validateNotPastDate(input.targetIsoDate, datePlanning.getTodayIso(this.config.timezone));
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
          item, this.config.project, this.config.workItemType, memberPrefix, person
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
      const clonedSourceItem = JSON.parse(JSON.stringify(sourceTask.workItem));
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

      const { task, relationResult } = await this.executor.createWorkItems(
        { ...sourceTask, workItem: clonedSourceItem },
        plannedDate,
        person
      );

      // Verify creation
      const verified = await this.executor.verifyCreatedTask(
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

  /**
   * Execute all planned tasks
   */
  private async executePlans(
    plans: PersonExecutionPlan[],
    runId: string,
    onProgress?: (event: ProgressEvent) => void
  ): Promise<Map<string, PersonExecutionResult>> {
    const resultsMap = new Map<string, PersonExecutionResult>();
    const duplicateDetector = this.planBuilder.getDuplicateDetector();

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
        // Double-check duplicate prevention before creation
        if (duplicateDetector.isDuplicate(person, item.isoDate)) {
          const existing = duplicateDetector.getExistingTask(person, item.isoDate);
          item.status = 'DUPLICATE_ALREADY_EXISTS';
          item.skipReason = existing?.count && existing.count > 1
            ? `${existing.count} tasks already exist for this date`
            : `Task already exists (#${existing?.id ?? 'existing'})`;
          continue;
        }

        onProgress?.({ type: 'progress', message: `Creating task for ${person.name} on ${item.formattedTitleDate}...`, timestamp: new Date().toISOString() });

        try {
          const { task, relationResult } = await this.executor.createWorkItems(sourceTask, item, person);

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

          const verified = await this.executor.verifyCreatedTask(
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

  private async promptConfirm(message: string): Promise<boolean> {
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

export type { CreateTasksOutput, PersonExecutionPlan };
