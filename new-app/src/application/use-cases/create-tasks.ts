/**
 * Create Tasks Use Case
 * Orchestrates the complete task creation workflow for one or more people
 */

import * as readline from 'node:readline/promises';
import { WorkItemRepository, JournalRepository, LockRepository, AppConfig } from '../../domain/ports/repositories.js';
import { Person, PersonConfig } from '../../domain/entities/person.js';
import { 
  DiscoveredTask, 
  WorkItem, 
  CreatedTask 
} from '../../domain/entities/task.js';
import { 
  TaskDiscoveryService, 
  DuplicateDetector, 
  FieldCopyService, 
  RelationCopyService,
  DatePlanningService,
  TaskExecutionService,
  TaskExecutionContext,
  FieldPatchOperation
} from '../../domain/services/task-services.js';
import { 
  planCreationDates, 
  DatePlan, 
  PlannedDate,
  getTodayIso,
  getNextThursdayIso,
  validateNotPastDate
} from '../../domain/value-objects/date-window.js';

export interface CreateTasksInput {
  personKeys?: string[];      // Specific people to process (empty = all)
  all?: boolean;              // Process all enabled people
  dryRun?: boolean;           // Preview only
  asOf?: string;              // Simulate as specific date
  thursdayMode?: 'CURRENT' | 'FOLLOWING';
  yes?: boolean;              // Skip confirmation
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

      const plan = this.datePlanning.planForPerson(
        person,
        discovered,
        todayIso,
        this.config.titlePrefix,
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
      const existingMap = await this.discovery.getExistingTasksMap(
        this.config.project,
        this.config.workItemType,
        this.config.titlePrefix,
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
      
      const newPlan = this.datePlanning.planForPerson(
        plan.person,
        plan.sourceTask,
        todayIso,
        this.config.titlePrefix,
        thursdayMode,
        this.config.skipWeekends,
        this.config.stopDayOfWeek,
        this.duplicateDetector
      );
      
      return {
        ...plan,
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

          // Record in journal
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
            verified: true,
          });
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
        }
      }

      let status: PersonExecutionResult['status'] = 'SUCCESS';
      if (failedTasks.length > 0 && createdTasks.length > 0) status = 'PARTIAL';
      else if (failedTasks.length > 0 && createdTasks.length === 0) status = 'FAILED';

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