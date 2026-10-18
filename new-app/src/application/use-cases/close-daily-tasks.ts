/**
 * Close Daily Tasks Use Case
 * Closes matched work items through Azure workflow rules without fabricating
 * work hours, attendance timestamps, or unverified descriptions.
 */

import {
  WorkItemRepository,
  ConfigRepository,
  JournalRepository,
  LockRepository,
  AppConfig,
  Person,
  matchesPerson,
  parseWorkItemTaskDate,
  matchesTaskSeries,
  DatePlanningService,
} from '../../domain/index.js';
import { GitHubClient } from '../../infrastructure/github/github-client.js';
import { logger } from '../../infrastructure/logging/logger.js';

export interface CloseDailyTasksInput {
  personKeys?: string[];
  asOf?: string; // Optional target date override, format YYYY-MM-DD
  dryRun?: boolean;
  bypassRules?: boolean; // Legacy option cannot override Azure workflow validation
}

export interface ClosedTaskResult {
  personKey: string;
  personName: string;
  taskId: number;
  taskTitle: string;
  previousState: string;
  newState: string;
  plannedStartDate?: string;
  actualStartDate?: string;
  actualEndDate: string;
  remainingWork: number | null;
  completedWork: number | null;
  githubUsername?: string;
  prCount: number;
  prSourceDate: string;
  isTodayPr: boolean;
  htmlDescription: string;
  summaryText: string;
  patchOperations: any[];
  status: 'closed' | 'simulated' | 'already_closed' | 'failed';
  error?: string;
  auditWarning?: string;
  verified?: boolean;
}

export interface CloseDailyTasksOutput {
  targetDate: string;
  timezone: string;
  dryRun: boolean;
  totalFound: number;
  totalClosed: number;
  totalAlreadyClosed: number;
  totalFailed: number;
  results: ClosedTaskResult[];
}

function readRecordedWorkHours(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const hours = Number(value);
  return Number.isFinite(hours) && hours >= 0 ? hours : NaN;
}

export class CloseDailyTasksUseCase {
  constructor(
    private readonly config: AppConfig,
    private readonly workItemRepo: WorkItemRepository,
    private readonly datePlanning: DatePlanningService,
    private readonly githubClient: GitHubClient,
    private readonly configRepo?: ConfigRepository,
    private readonly journalRepo?: JournalRepository,
    private readonly lockRepo?: LockRepository
  ) {}

  async execute(input: CloseDailyTasksInput = {}): Promise<CloseDailyTasksOutput> {
    const isDryRun = Boolean(input.dryRun);
    const targetDate = input.asOf || this.datePlanning.getTodayIso(this.config.timezone);
    const nowUtc = new Date().toISOString();
    const runId = `close-${Date.now()}`;

    // Acquire concurrency lock for non-dry-run operations
    if (!isDryRun && this.lockRepo) {
      if (!this.lockRepo.acquire()) {
        throw new Error('Another execution is already running. Please wait for it to complete.');
      }
    }

    try {
      logger.info(`Starting EOD task closure for date: ${targetDate} (dryRun=${isDryRun})...`);

      // 1. Resolve eligible team members
      const activeConfig = this.configRepo ? await this.configRepo.load() : this.config;
      let selectedPeople = activeConfig.people
        .filter(p => p.enabled !== false)
        .map(p => new Person(p));

      if (input.personKeys !== undefined) {
        if (!Array.isArray(input.personKeys) || input.personKeys.length === 0) {
          throw new Error('EOD closure requires at least one member when personKeys is provided.');
        }
        const keys = new Set(input.personKeys.map(k => k.trim().toLowerCase()));
        selectedPeople = selectedPeople.filter(p => keys.has(p.key.toLowerCase()));
        if (selectedPeople.length !== keys.size) {
          throw new Error('EOD closure selected unknown or disabled members. Refresh the team list.');
        }
      }

      if (selectedPeople.length === 0) {
        logger.warn('No enabled people found for EOD task closure.');
        return {
          targetDate,
          timezone: activeConfig.timezone,
          dryRun: isDryRun,
          totalFound: 0,
          totalClosed: 0,
          totalAlreadyClosed: 0,
          totalFailed: 0,
          results: [],
        };
      }

    // 2. Discover candidate work items for the team
    const candidateWorkItems = await this.workItemRepo.findCandidateTasks(
      activeConfig.project,
      activeConfig.workItemType,
      activeConfig.titlePrefix,
      targetDate,
      targetDate,
      Array.from(new Set(selectedPeople.flatMap(p => [p.assignedTo, p.name].filter(Boolean) as string[])))
    );

    // 3. Match work items to each person for the target date
    const matchedTasks: Array<{ person: Person; item: any }> = [];
    const seenTaskIds = new Set<number>();

    for (const item of candidateWorkItems) {
      if (seenTaskIds.has(item.id)) continue;
      const assignedToVal = item.fields['System.AssignedTo'];
      const title = String(item.fields['System.Title'] || '');

      for (const p of selectedPeople) {
        if (matchesPerson(assignedToVal, p)) {
          const personPrefix = p.titlePrefix || activeConfig.titlePrefix;
          // Never close an unrelated work item merely because its date matches.
          if (!matchesTaskSeries(title, personPrefix)) continue;
          const parsed = parseWorkItemTaskDate(item, personPrefix, activeConfig.timezone);
          let itemDate = parsed.isValid ? parsed.isoDate : '';

          if (!itemDate && item.fields['Microsoft.VSTS.Scheduling.StartDate']) {
            itemDate = String(item.fields['Microsoft.VSTS.Scheduling.StartDate']).split('T')[0];
          }
          if (!itemDate && item.fields['Custom.PlannedStartdate']) {
            itemDate = String(item.fields['Custom.PlannedStartdate']).split('T')[0];
          }
          if (!itemDate && item.fields['Custom.ActualStartdate']) {
            itemDate = String(item.fields['Custom.ActualStartdate']).split('T')[0];
          }

          if (itemDate === targetDate) {
            seenTaskIds.add(item.id);
            matchedTasks.push({ person: p, item });
            break;
          }
        }
      }
    }

    const results: ClosedTaskResult[] = [];
    let totalClosed = 0;
    let totalAlreadyClosed = 0;
    let totalFailed = 0;

    for (const { person, item } of matchedTasks) {
      // Report only dates actually stored in Azure; a failed PATCH does not close a task.
      const recordedActualEnd = String(
        item.fields['Microsoft.VSTS.Common.ClosedDate'] ||
        item.fields['Custom.ActualClosedDate'] ||
        item.fields['Custom.ActualEnddate'] ||
        item.fields['Custom.ActualEndDate'] || ''
      );
      const currentState = String(item.fields['System.State'] || 'New');
      const taskId = item.id;
      const taskTitle = String(item.fields['System.Title'] || `Task #${taskId}`);

      const stateLower = currentState.trim().toLowerCase();
      const isClosedState = ['closed', 'done', 'resolved', 'completed'].includes(stateLower);
      const hasClosedDate = Boolean(
        item.fields['Microsoft.VSTS.Common.ClosedDate']
      );

      // Check if already closed: by terminal state or by existing closed/actual-end dates
      if (isClosedState || hasClosedDate) {
        totalAlreadyClosed++;
        results.push({
          personKey: person.key,
          personName: person.name,
          taskId,
          taskTitle,
          previousState: currentState,
          newState: currentState,
          actualEndDate: recordedActualEnd,
          remainingWork: readRecordedWorkHours(item.fields['Microsoft.VSTS.Scheduling.RemainingWork']),
          completedWork: readRecordedWorkHours(item.fields['Microsoft.VSTS.Scheduling.CompletedWork']),
          prCount: 0,
          prSourceDate: targetDate,
          isTodayPr: false,
          htmlDescription: String(item.fields['System.Description'] || ''),
          summaryText: 'Task is already closed.',
          patchOperations: [],
          status: 'already_closed',
        });
        continue;
      }

      try {
        // Resolve GitHub username
        let githubUser = person.githubUsername;
        if (!githubUser) {
          githubUser = (await this.githubClient.resolveUserByEmail(person.assignedTo, activeConfig.githubUserSuffix)) || undefined;
        }

        // Fetch PR deliverables and format description
        let prDeliverables;
        if (githubUser) {
          prDeliverables = await this.githubClient.getPrDeliverablesForDate(
            githubUser,
            targetDate,
            activeConfig.timezone,
            {
              org: activeConfig.githubOrg,
              role: person.role,
              repositories: person.githubRepositories,
              branches: person.githubBranches,
            }
          );
        } else {
          // Standard fallback when GitHub username cannot be resolved
          prDeliverables = {
            username: person.name,
            sourceDate: targetDate,
            isToday: false,
            pullRequests: [],
            htmlDescription: `<div><p>No verified GitHub PR evidence for ${targetDate}; work completion requires manual verification.</p></div>`,
            summaryText: 'GitHub identity unavailable; no work evidence verified.',
          };
        }

        const plannedStart =
          item.fields['Custom.PlannedStartdate'] ||
          item.fields['Custom.PlannedStartDate'] ||
          item.fields['Microsoft.VSTS.Scheduling.StartDate'] || '';
        const actualStart = item.fields['Custom.ActualStartdate'] ||
          item.fields['Custom.ActualStartDate'] || '';
        const actualEnd = item.fields['Custom.ActualEnddate'] ||
          item.fields['Custom.ActualEndDate'] || '';

        // Closing is not evidence of 8 hours worked. Preserve actuals already
        // recorded in Azure DevOps rather than fabricating a full workday.
        const completedWork = readRecordedWorkHours(item.fields['Microsoft.VSTS.Scheduling.CompletedWork']);
        const remainingWork = readRecordedWorkHours(item.fields['Microsoft.VSTS.Scheduling.RemainingWork']);
        if ((completedWork !== null && Number.isNaN(completedWork)) ||
            (remainingWork !== null && Number.isNaN(remainingWork))) {
          throw new Error('Invalid Azure work tracking values; closure requires review.');
        }
        // Preserve the Azure-authored description, recorded hours and actual
        // work dates. Azure owns the ClosedDate, Reason and workflow transition.
        const ops: any[] = [
          {
            op: 'add',
            path: '/fields/System.History',
            value: `EOD closure requested at ${nowUtc}. Existing Completed Work: ${completedWork === null ? 'not recorded' : `${completedWork}h`}; Remaining Work: ${remainingWork === null ? 'not recorded' : `${remainingWork}h`} (both unchanged). ${prDeliverables.summaryText}`,
          },
          { op: 'add', path: '/fields/System.State', value: 'Closed' },
        ];

        let auditWarning: string | undefined;
        let verified = false;
        if (!isDryRun) {
          // Never bypass tenant workflow constraints, regardless of entry point.
          await this.workItemRepo.patchWorkItem(taskId, ops, { bypassRules: false });
          logger.info(`Closed task #${taskId} for ${person.name}; preserved Azure recorded work hours.`);
          totalClosed++;

          // Treat the PATCH as accepted but separately verify the resulting state.
          // A read-back failure must not turn an accepted write into a failed write.
          try {
            const current = await this.workItemRepo.getWorkItem(taskId);
            verified = current.id === taskId &&
              String(current.fields['System.State'] || '').trim().toLowerCase() === 'closed' &&
              matchesPerson(current.fields['System.AssignedTo'], person);
            if (!verified) auditWarning = `Azure accepted closure of #${taskId}, but final state and assignee could not be verified.`;
          } catch (readbackError) {
            auditWarning = `Azure accepted closure of #${taskId}, but read-back failed: ${readbackError instanceof Error ? readbackError.message : String(readbackError)}`;
          }
          if (auditWarning) logger.warn(auditWarning);

          // Record in Journal for persistent audit trail
          if (this.journalRepo) {
            try {
              await this.journalRepo.record({
                runId,
                timestamp: nowUtc,
                personKey: person.key,
                personName: person.name,
                assignedTo: person.assignedTo,
                targetIsoDate: targetDate,
                title: taskTitle,
                sourceTaskId: taskId,
                createdWorkItemId: taskId,
                fieldCopyStatus: 'SUCCESS',
                relationCopyStatus: 'SUCCESS',
                verified,
                error: verified ? undefined : 'Closure accepted; independent final-state verification incomplete.',
              });
            } catch (jErr: any) {
              const journalWarning = `Azure task #${taskId} was closed, but recording the local audit journal failed: ${jErr instanceof Error ? jErr.message : String(jErr)}`;
              auditWarning = auditWarning ? `${auditWarning} ${journalWarning}` : journalWarning;
              logger.warn(auditWarning);
            }
          }
        }

        results.push({
          personKey: person.key,
          personName: person.name,
          taskId,
          taskTitle,
          previousState: currentState,
          newState: 'Closed',
          plannedStartDate: String(plannedStart),
          actualStartDate: String(actualStart),
          actualEndDate: String(actualEnd),
          remainingWork,
          completedWork,
          githubUsername: githubUser,
          prCount: prDeliverables.pullRequests.length,
          prSourceDate: prDeliverables.sourceDate,
          isTodayPr: prDeliverables.isToday,
          htmlDescription: prDeliverables.htmlDescription,
          summaryText: prDeliverables.summaryText,
          patchOperations: ops,
          status: isDryRun ? 'simulated' : 'closed',
          auditWarning,
          verified: isDryRun ? false : verified,
        });
      } catch (err: any) {
        totalFailed++;
        logger.error(`Failed to close task #${taskId} for ${person.name}: ${err.message}`);
        results.push({
          personKey: person.key,
          personName: person.name,
          taskId,
          taskTitle,
          previousState: currentState,
          newState: currentState,
          actualEndDate: recordedActualEnd,
          remainingWork: readRecordedWorkHours(item.fields['Microsoft.VSTS.Scheduling.RemainingWork']),
          completedWork: readRecordedWorkHours(item.fields['Microsoft.VSTS.Scheduling.CompletedWork']),
          prCount: 0,
          prSourceDate: targetDate,
          isTodayPr: false,
          htmlDescription: '',
          summaryText: 'Failed to close task',
          patchOperations: [],
          status: 'failed',
          error: err.message,
        });
      }
    }

    return {
      targetDate,
      timezone: activeConfig.timezone,
      dryRun: isDryRun,
      totalFound: matchedTasks.length,
      totalClosed: isDryRun ? matchedTasks.length - totalAlreadyClosed - totalFailed : totalClosed,
      totalAlreadyClosed,
      totalFailed,
      results,
    };
    } finally {
      if (!isDryRun && this.lockRepo) {
        this.lockRepo.release();
      }
    }
  }
}
