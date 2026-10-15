/**
 * Multi-person task creation orchestrator coordinating pre-flight validation,
 * independent per-person discovery, date planning, duplicate prevention,
 * dry-run, execution, and aggregate summary reporting.
 */

import { AzureDevOpsClient } from '../azure/client.js';
import { WiqlService } from '../azure/wiql-service.js';
import { WorkItemService } from '../azure/work-item-service.js';
import { AppConfig, CliOptions, PersonConfig } from '../config/config.js';
import { addDays, getDayOfWeek, getNextThursdayIso, getTodayIso, planCreationDates } from '../date/date-engine.js';
import { formatTitleDate } from '../date/parser.js';
import { PlannedTaskDate, TaskExecutionStatus } from '../date/types.js';
import { selectPeople } from '../people/person-service.js';
import { ExecutionLock } from '../utils/lock.js';
import { logger } from '../utils/logger.js';
import { promptConfirm } from '../utils/prompt.js';
import { buildFieldPatchOperations } from './field-copy.js';
import { TaskJournal } from './journal.js';
import { copyTaskRelations } from './relation-copy.js';
import { DiscoveredTask, TaskDiscoveryService } from './task-discovery.js';

export function isDuplicateStatus(status: TaskExecutionStatus): boolean {
  return (
    status === 'DUPLICATE' ||
    status === 'DUPLICATE_ALREADY_EXISTS' ||
    status === 'MULTIPLE_EXISTING_TASKS'
  );
}

export interface PersonExecutionPlan {
  person: PersonConfig;
  sourceTask: DiscoveredTask | null;
  status: 'READY' | 'SOURCE_NOT_FOUND' | 'FUTURE_TASK_WARN' | 'NO_TASKS_NEEDED';
  statusMessage?: string;
  effectiveStartDate: string;
  nextThursday: string;
  plannedDates: PlannedTaskDate[];
}

export interface PersonExecutionResult {
  person: PersonConfig;
  sourceTaskId?: number;
  sourceTaskDate?: string;
  status: 'SUCCESS' | 'PARTIAL' | 'SOURCE_FAILED' | 'FAILED' | 'SKIPPED';
  createdTasks: Array<{ id: number; title: string; isoDate: string }>;
  duplicateSkips: PlannedTaskDate[];
  weekendSkips: PlannedTaskDate[];
  failedTasks: PlannedTaskDate[];
  relationsProcessed: number;
  relationsFailed: number;
}

export interface MultiPersonAggregateResult {
  peopleProcessedCount: number;
  totalCreatedCount: number;
  totalDuplicateCount: number;
  totalWeekendSkipCount: number;
  totalSourceFailureCount: number;
  totalTaskFailureCount: number;
  totalRelationFailureCount: number;
  personResults: PersonExecutionResult[];
}

export class TaskOrchestrator {
  private wiqlService: WiqlService;
  private workItemService: WorkItemService;
  private discoveryService: TaskDiscoveryService;

  constructor(
    private readonly client: AzureDevOpsClient,
    private readonly config: AppConfig,
    private readonly options: CliOptions
  ) {
    this.wiqlService = new WiqlService(this.client);
    this.workItemService = new WorkItemService(this.client);
    this.discoveryService = new TaskDiscoveryService(this.wiqlService, this.workItemService);
  }

  public async buildPlan(): Promise<{
    personPlans: PersonExecutionPlan[];
    todayIso: string;
    nextThursdayIso: string;
    discoveryResult: any;
  }> {
    const { project, workItemType, titlePrefix, timezone } = this.config;
    const { sourceTaskId } = this.options;

    // 1. Pre-flight validations
    await this.workItemService.validateProject(project);
    await this.workItemService.validateWorkItemType(project, workItemType);

    // 2. Select people to process
    const selectedPeople = selectPeople(this.config.people, this.options);

    // 3. Discover source tasks for all selected people
    const discoveryResult = await this.discoveryService.discoverForPeople(
      project,
      workItemType,
      titlePrefix,
      selectedPeople,
      sourceTaskId,
      this.config.defaultSourceTaskId
    );

    const actualTodayIso = getTodayIso(timezone);
    const configuredTodayIso = this.options.todayOverride || this.options.asOf || actualTodayIso;
    
    // Strict requirement: Prohibit past dates (unless explicit todayOverride is provided for simulation/testing). 
    if (!this.options.todayOverride && configuredTodayIso < actualTodayIso) {
      throw new Error(
        `Validation Error: The requested task creation date (${configuredTodayIso}) is in the past. Tasks must only be created for the current date (${actualTodayIso}) or future dates.`
      );
    }
    
    const todayIso = configuredTodayIso;
    const nextThursdayIso = getNextThursdayIso(todayIso, this.config.thursdayMode);

    // 4. Build independent plan for each person
    const personPlans: PersonExecutionPlan[] = [];

    for (const person of selectedPeople) {
      const pKey = discoveryResult.duplicateDetector.getPersonKey(person);
      const personDisc = discoveryResult.personDiscoveries.get(pKey);

      if (!personDisc || !personDisc.sourceTask) {
        const errorMsg = personDisc?.errorMessage || `No valid source task found for ${person.name}.`;
        logger.warn(`[WARN] ${person.name}: ${errorMsg}`);
        personPlans.push({
          person,
          sourceTask: null,
          status: 'SOURCE_NOT_FOUND',
          statusMessage: errorMsg,
          effectiveStartDate: todayIso,
          nextThursday: nextThursdayIso,
          plannedDates: [],
        });
        continue;
      }

      const source = personDisc.sourceTask;
      const latestDate = source.parsedDate.isoDate;

      // Plan dates for this person using that person's duplicate map
      const personDupMap = discoveryResult.duplicateDetector.getPersonDateMap(person);
      const plan = planCreationDates({
        todayIso,
        latestExistingTaskIso: latestDate,
        latestExistingTaskId: source.workItem.id,
        existingTasksMap: personDupMap,
        titlePrefix,
        thursdayMode: this.config.thursdayMode,
      });

      const toCreate = plan.plannedDates.filter((p) => p.status === 'PLANNED');

      let planStatus: PersonExecutionPlan['status'] = toCreate.length > 0 ? 'READY' : 'NO_TASKS_NEEDED';
      let statusMsg = plan.warningMessage;
      if (toCreate.length === 0 && !statusMsg) {
        statusMsg = `All working dates up to date (latest task: ${source.parsedDate.formattedTitleDate}).`;
      }

      if (latestDate > nextThursdayIso && toCreate.length === 0) {
        planStatus = 'FUTURE_TASK_WARN';
        statusMsg = `Latest task date (${latestDate}) is ahead of creation window ending on Thursday (${nextThursdayIso}). Task creation skipped for ${person.name}.`;
        logger.warn(`[WARN] ${person.name}: ${statusMsg}`);
      }

      personPlans.push({
        person,
        sourceTask: source,
        status: planStatus,
        statusMessage: statusMsg,
        effectiveStartDate: plan.effectiveStartDate,
        nextThursday: plan.nextThursday,
        plannedDates: plan.plannedDates,
      });
    }

    return {
      personPlans,
      todayIso,
      nextThursdayIso,
      discoveryResult,
    };
  }

  public async run(progressCallback?: (event: any) => void): Promise<MultiPersonAggregateResult> {
    const { organization, project, workItemType, startTime, timezone } = this.config;
    const { dryRun, yes } = this.options;

    // Concurrency Lock: Prevent multiple processes running concurrently
    const lock = new ExecutionLock();
    if (!dryRun) {
      lock.acquire();
    }

    const journal = new TaskJournal();
    const runId = `run-${Date.now()}`;

    try {
      logger.info(`Connecting to Azure DevOps organization '${organization}'...`);
      progressCallback?.({ type: 'progress', message: `Connecting to ${organization}...` });

      const { personPlans, todayIso, nextThursdayIso, discoveryResult } = await this.buildPlan();

      const selectedPeople = personPlans.map((p) => p.person);
      logger.info(
        `Today (${timezone}): ${todayIso} (${formatTitleDate(todayIso)}) | Rolling Window ends on Thursday: ${nextThursdayIso} (${formatTitleDate(nextThursdayIso)})`
      );

      // 5. Total tasks to create across all people
      const totalToCreate = personPlans.reduce(
        (sum, p) => sum + p.plannedDates.filter((d) => d.status === 'PLANNED').length,
        0
      );

      // 6. Handle Dry-Run Mode
      if (dryRun) {
        this.printDryRun(personPlans, startTime, timezone);
        return this.buildAggregateResult(personPlans, new Map());
      }

    if (totalToCreate === 0) {
      logger.info('No new tasks required to create for any person in the current creation window.');
      return this.buildAggregateResult(personPlans, new Map());
    }

    // 7. Interactive Confirmation
    logger.raw('\n========================================');
    logger.raw('TASK CREATION PLAN');
    logger.raw('========================================');
    logger.raw(`People: ${selectedPeople.length}`);
    logger.raw(`Tasks to create: ${totalToCreate}\n`);

    for (const plan of personPlans) {
      const createList = plan.plannedDates.filter((d) => d.status === 'PLANNED');
      if (createList.length > 0) {
        logger.raw(`${plan.person.name} (${plan.person.assignedTo}):`);
        for (const item of createList) {
          logger.raw(`  - ${item.fullTitle} (${startTime} ${timezone})`);
        }
      } else {
        logger.raw(`${plan.person.name}: 0 tasks (${plan.statusMessage || 'All dates up to date'})`);
      }
    }
    logger.raw('========================================\n');

    if (!yes) {
      const confirmed = await promptConfirm('Proceed with creation?', false);
      if (!confirmed) {
        logger.warn('Execution cancelled by user. No work items were created.');
        return this.buildAggregateResult(personPlans, new Map());
      }
    }

    // 8. Multi-Person Execution (Each person processed independently)
    const personResultsMap = new Map<string, PersonExecutionResult>();

    for (const plan of personPlans) {
      const { person, sourceTask } = plan;
      const pKey = discoveryResult.duplicateDetector.getPersonKey(person);

      if (plan.status !== 'READY' || !sourceTask) {
        personResultsMap.set(pKey, {
          person,
          sourceTaskId: sourceTask?.workItem.id,
          sourceTaskDate: sourceTask?.parsedDate.formattedTitleDate,
          status: plan.status === 'SOURCE_NOT_FOUND' ? 'SOURCE_FAILED' : 'SKIPPED',
          createdTasks: [],
          duplicateSkips: plan.plannedDates.filter((d) => isDuplicateStatus(d.status)),
          weekendSkips: plan.plannedDates.filter((d) => d.status === 'WEEKEND_SKIP'),
          failedTasks: [],
          relationsProcessed: 0,
          relationsFailed: 0,
        });
        continue;
      }

      logger.info(`\n[INFO] Processing ${person.name} (${person.assignedTo})...`);
      const toCreate = plan.plannedDates.filter((d) => d.status === 'PLANNED');
      const createdTasks: Array<{ id: number; title: string; isoDate: string }> = [];
      const failedTasks: PlannedTaskDate[] = [];
      let relsProcessed = 0;
      let relsFailed = 0;

      for (const item of toCreate) {
        logger.info(`Creating task for ${person.name} on ${item.formattedTitleDate}...`);

        // Phase 1: Create work item with field overrides including System.AssignedTo
        const fieldOps = buildFieldPatchOperations({
          sourceWorkItem: sourceTask.workItem,
          newTitle: item.fullTitle,
          targetIsoDate: item.isoDate,
          assignedTo: person.assignedTo,
          startTime,
          timezone,
        });

        let createdItem;
        try {
          createdItem = await this.workItemService.createWorkItemWithReconciliation(
            project,
            workItemType,
            fieldOps,
            { title: item.fullTitle, assignedTo: person.assignedTo }
          );
          item.createdWorkItemId = createdItem.id;
          item.status = 'CREATED';
          createdTasks.push({
            id: createdItem.id,
            title: item.fullTitle,
            isoDate: item.isoDate,
          });
          logger.success(`Created #${createdItem.id} for ${person.name} - ${item.fullTitle}`);
          progressCallback?.({
            type: 'task_created',
            message: `Created #${createdItem.id} for ${person.name} - ${item.fullTitle}`,
            data: { id: createdItem.id, person, item },
            timestamp: new Date().toISOString(),
          });
        } catch (createErr) {
          item.status = 'FAILED';
          item.errorMessage = createErr instanceof Error ? createErr.message : String(createErr);
          failedTasks.push(item);
          logger.error(`Failed to create task for ${person.name} on ${item.formattedTitleDate}: ${item.errorMessage}`);
          progressCallback?.({
            type: 'task_failed',
            message: `Failed to create task for ${person.name} on ${item.formattedTitleDate}: ${item.errorMessage}`,
            data: { person, item, error: item.errorMessage },
            timestamp: new Date().toISOString(),
          });
          journal.recordEntry({
            runId,
            timestamp: new Date().toISOString(),
            personKey: person.key,
            personName: person.name,
            assignedTo: person.assignedTo,
            targetIsoDate: item.isoDate,
            title: item.fullTitle,
            sourceTaskId: sourceTask.workItem.id,
            fieldCopyStatus: 'FAILED',
            error: item.errorMessage,
            verified: false,
          });
          // Continue with remaining dates for this person
          continue;
        }

        // Phase 2: Copy relationships from source task
        let relationStatus: 'SUCCESS' | 'PARTIAL' | 'FAILED' = 'SUCCESS';
        try {
          relsProcessed++;
          const relResult = await copyTaskRelations(
            this.workItemService,
            sourceTask.workItem,
            createdItem.id
          );

          if (relResult.failedCount > 0) {
            item.relationCopyStatus = 'PARTIAL';
            relationStatus = 'PARTIAL';
            item.failedRelationsCount = relResult.failedCount;
            relsFailed += relResult.failedCount;
            logger.warn(
              `Task #${createdItem.id} (${person.name}): ${relResult.failedCount} of ${relResult.totalRelations} relationships could not be copied.`
            );
          } else {
            item.relationCopyStatus = 'SUCCESS';
          }
        } catch (relErr) {
          relsFailed++;
          relationStatus = 'FAILED';
          item.relationCopyStatus = 'FAILED';
          logger.warn(
            `Task #${createdItem.id} (${person.name}): Relation copy error: ${relErr instanceof Error ? relErr.message : String(relErr)}`
          );
        }

        // Post-creation verification (Section 31)
        const isVerified =
          createdItem.id > 0 &&
          createdItem.fields &&
          createdItem.fields['System.Title'] === item.fullTitle;
        if (isVerified) {
          item.status = relationStatus === 'SUCCESS' ? 'CREATED_VERIFIED' : 'CREATED_RELATIONS_PARTIAL';
        }

        // Record in execution journal (Section 30)
        journal.recordEntry({
          runId,
          timestamp: new Date().toISOString(),
          personKey: person.key,
          personName: person.name,
          assignedTo: person.assignedTo,
          targetIsoDate: item.isoDate,
          title: item.fullTitle,
          sourceTaskId: sourceTask.workItem.id,
          createdWorkItemId: createdItem.id,
          fieldCopyStatus: 'SUCCESS',
          relationCopyStatus: relationStatus,
          verified: isVerified,
        });
      }

      let personStatus: PersonExecutionResult['status'] = 'SUCCESS';
      if (failedTasks.length > 0 && createdTasks.length > 0) {
        personStatus = 'PARTIAL';
      } else if (failedTasks.length > 0 && createdTasks.length === 0) {
        personStatus = 'FAILED';
      }

      personResultsMap.set(pKey, {
        person,
        sourceTaskId: sourceTask.workItem.id,
        sourceTaskDate: sourceTask.parsedDate.formattedTitleDate,
        status: personStatus,
        createdTasks,
        duplicateSkips: plan.plannedDates.filter((d) => isDuplicateStatus(d.status)),
        weekendSkips: plan.plannedDates.filter((d) => d.status === 'WEEKEND_SKIP'),
        failedTasks,
        relationsProcessed: relsProcessed,
        relationsFailed: relsFailed,
      });
    }

    const aggregateResult = this.buildAggregateResult(personPlans, personResultsMap);

    progressCallback?.({
      type: 'done',
      message: 'Completed processing all tasks.',
      data: aggregateResult,
      timestamp: new Date().toISOString(),
    });

    // 9. Print Aggregate Multi-Person Summary
    this.printSummary(aggregateResult, todayIso, nextThursdayIso);

    return aggregateResult;
    } finally {
      lock.release();
    }
  }

  private buildAggregateResult(
    plans: PersonExecutionPlan[],
    resultsMap: Map<string, PersonExecutionResult>
  ): MultiPersonAggregateResult {
    let totalCreated = 0;
    let totalDuplicates = 0;
    let totalWeekends = 0;
    let totalSourceFailures = 0;
    let totalTaskFailures = 0;
    let totalRelationFailures = 0;

    const personResults: PersonExecutionResult[] = [];

    for (const plan of plans) {
      const pKey = plan.person.assignedTo.toLowerCase().trim();
      const res = resultsMap.get(pKey);

      if (plan.status === 'SOURCE_NOT_FOUND') {
        totalSourceFailures++;
      }

      const dupCount = plan.plannedDates.filter((d) => isDuplicateStatus(d.status)).length;
      const wCount = plan.plannedDates.filter((d) => d.status === 'WEEKEND_SKIP').length;
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
          duplicateSkips: plan.plannedDates.filter((d) => isDuplicateStatus(d.status)),
          weekendSkips: plan.plannedDates.filter((d) => d.status === 'WEEKEND_SKIP'),
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

  private printDryRun(plans: PersonExecutionPlan[], startTime: string, timezone: string): void {
    logger.raw('\n========================================');
    logger.raw('DRY RUN MODE — MULTI-PERSON');
    logger.raw('========================================');
    logger.raw(`People configured : ${plans.length}`);

    for (const plan of plans) {
      logger.raw(`\n----------------------------------------`);
      logger.raw(`Person : ${plan.person.name} (${plan.person.assignedTo})`);
      if (plan.sourceTask) {
        logger.raw(`Source : #${plan.sourceTask.workItem.id} - ${plan.sourceTask.parsedDate.formattedTitleDate} ${plan.sourceTask.parsedDate.year}`);
      } else {
        logger.raw(`Source : NONE (${plan.statusMessage})`);
      }

      const toCreate = plan.plannedDates.filter((d) => d.status === 'PLANNED');
      if (toCreate.length > 0) {
        logger.raw('Would create:');
        for (const item of toCreate) {
          logger.raw(`  [+] #? ${item.fullTitle} (Start: ${item.formattedTitleDate} ${startTime} ${timezone}, State: New)`);
        }
      } else {
        logger.raw(`Would create: None (${plan.statusMessage || 'All dates up to date'})`);
      }

      const skips = plan.plannedDates.filter((d) => d.status !== 'PLANNED');
      if (skips.length > 0) {
        logger.raw('Skipped:');
        for (const s of skips) {
          logger.raw(`  [-] ${s.formattedTitleDate} - ${s.skipReason}`);
        }
      }
    }

    logger.raw('\nNo Azure DevOps changes were made.');
    logger.raw('========================================\n');
  }

  private printSummary(
    aggregate: MultiPersonAggregateResult,
    startDate: string,
    endDate: string
  ): void {
    logger.raw('\n===================================================');
    logger.raw('AZURE DEVOPS MULTI-USER TASK AUTOMATION');
    logger.raw('===================================================');
    logger.raw(`Organization: ${this.config.organization}`);
    logger.raw(`Project: ${this.config.project}`);
    logger.raw(`Work Item: ${this.config.workItemType}`);
    logger.raw(`Date Range: ${formatTitleDate(startDate)} ${startDate.slice(0, 4)} - ${formatTitleDate(endDate)} ${endDate.slice(0, 4)}`);
    logger.raw(`People Processed: ${aggregate.peopleProcessedCount}`);

    // Working dates and weekend stats across the window
    let workingDatesCount = 0;
    let weekendDatesCount = 0;
    let curr = startDate;
    while (curr <= endDate) {
      const dow = getDayOfWeek(curr);
      if (dow === 0 || dow === 6) {
        weekendDatesCount++;
      } else {
        workingDatesCount++;
      }
      curr = addDays(curr, 1);
    }

    logger.raw(`Eligible Working Dates: ${workingDatesCount}`);
    logger.raw(`Weekend Calendar Dates Skipped: ${weekendDatesCount}`);
    logger.raw('---------------------------------------------------');
    logger.raw('SUMMARY');
    logger.raw('---------------------------------------------------');
    const totalCombinations = aggregate.peopleProcessedCount * workingDatesCount;
    logger.raw(`Planned Person-Date Combinations : ${totalCombinations}`);
    logger.raw(`Already Existing Tasks           : ${aggregate.totalDuplicateCount}`);
    logger.raw(`New Tasks Created                : ${aggregate.totalCreatedCount}`);
    logger.raw(`Failed Task Creations            : ${aggregate.totalTaskFailureCount}`);
    logger.raw(`Ambiguous Tasks                  : 0`);
    logger.raw(`Partial Relation Copies          : ${aggregate.totalRelationFailureCount}`);
    logger.raw('---------------------------------------------------');
    logger.raw('PER-PERSON SUMMARY');
    logger.raw('---------------------------------------------------');

    for (const res of aggregate.personResults) {
      logger.raw(`${res.person.name}: Created ${res.createdTasks.length} Skipped ${res.duplicateSkips.length}`);
    }

    logger.raw('===================================================');

    // Display created work items with Azure DevOps URLs
    if (aggregate.totalCreatedCount > 0) {
      logger.raw('\nCREATED WORK ITEMS:');
      for (const res of aggregate.personResults) {
        if (res.createdTasks.length > 0) {
          logger.raw(`\n${res.person.name} (${res.person.assignedTo}):`);
          for (const t of res.createdTasks) {
            const url = `${this.config.baseUrl}/${this.config.organization}/${this.config.project}/_workitems/edit/${t.id}`;
            logger.raw(`  [#${t.id}] ${t.title} -> ${url}`);
          }
        }
      }
      logger.raw('');
    }
  }

  /**
   * Safe repair routine: checks local execution journal for tasks with partial/failed relation copies
   * and attempts to re-apply missing relations safely.
   */
  public async repair(): Promise<void> {
    const journal = new TaskJournal();
    const unfinished = journal.getUnfinishedRelations();
    if (unfinished.length === 0) {
      logger.info('No tasks with incomplete relations found in local execution journal.');
      return;
    }

    logger.info(`Found ${unfinished.length} task(s) with incomplete relations to repair.`);
    for (const item of unfinished) {
      if (!item.createdWorkItemId || !item.sourceTaskId) continue;
      logger.info(
        `Repairing relations for task #${item.createdWorkItemId} (${item.title}) from source #${item.sourceTaskId}...`
      );
      try {
        const sourceWorkItem = await this.workItemService.getWorkItem(item.sourceTaskId);
        const result = await copyTaskRelations(
          this.workItemService,
          sourceWorkItem,
          item.createdWorkItemId
        );
        logger.success(
          `Repaired task #${item.createdWorkItemId}: ${result.copiedCount} relations copied.`
        );
        item.relationCopyStatus = result.failedCount === 0 ? 'SUCCESS' : 'PARTIAL';
      } catch (err: any) {
        logger.error(`Failed to repair relations for task #${item.createdWorkItemId}: ${err.message}`);
      }
    }
  }
}
