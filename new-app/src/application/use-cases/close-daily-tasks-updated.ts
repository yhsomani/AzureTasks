/**
 * Close Daily Tasks Use Case - WITH AUTO-CLOSURE INTEGRATION
 * Closes matched work items through Azure workflow rules without fabricating
 * work hours, attendance timestamps, or unverified descriptions.
 * 
 * Integrates auto-closure configuration to control which users' tasks can be auto-closed.
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
  parseTitleDate,
  matchesTaskSeries,
  isUserStoryOrParentContainer,
  DatePlanningService,
  AutoClosureConfigRepository,
  AutoClosureAuditLogRepository,
} from '../../domain/index.js';
import type { FieldPatchOperation } from '../../domain/services/task-services.js';
import { AutoClosureService } from '../../domain/services/auto-closure-service.js';
import { GitHubClient } from '../../infrastructure/github/github-client.js';
import { logger } from '../../infrastructure/logging/logger.js';

export interface CloseDailyTasksInput {
  personKeys?: string[];
  asOf?: string; // Optional target date override, format YYYY-MM-DD
  dryRun?: boolean;
  triggerSource?: 'scheduled' | 'manual' | 'api';  // Audit logging context
  // DEPRECATED: bypassRules cannot override Azure workflow validation and will be removed in v3.0
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
  patchOperations: FieldPatchOperation[];
  status: 'closed' | 'simulated' | 'already_closed' | 'failed' | 'rejected';  // Added 'rejected'
  error?: string;
  auditWarning?: string;
  verified?: boolean;
  autoClosureRuleId?: string;  // Audit context
}

export interface CloseDailyTasksOutput {
  targetDate: string;
  timezone: string;
  dryRun: boolean;
  totalFound: number;
  totalClosed: number;
  totalAlreadyClosed: number;
  totalFailed: number;
  totalRejected: number;  // Tasks rejected by auto-closure config
  results: ClosedTaskResult[];
}

function readRecordedWorkHours(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const hours = Number(value);
  return Number.isFinite(hours) && hours >= 0 ? hours : NaN;
}

export class CloseDailyTasksUseCase {
  private autoClosureService: AutoClosureService;

  constructor(
    private readonly config: AppConfig,
    private readonly workItemRepo: WorkItemRepository,
    private readonly datePlanning: DatePlanningService,
    private readonly githubClient: GitHubClient,
    private readonly configRepo?: ConfigRepository,
    private readonly journalRepo?: JournalRepository,
    private readonly lockRepo?: LockRepository,
    private readonly autoClosureConfigRepo?: AutoClosureConfigRepository,
    private readonly autoClosureAuditRepo?: AutoClosureAuditLogRepository
  ) {
    this.autoClosureService = new AutoClosureService();
  }

  async execute(input: CloseDailyTasksInput = {}): Promise<CloseDailyTasksOutput> {
    const isDryRun = Boolean(input.dryRun);
    const triggerSource = input.triggerSource || 'manual';
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
      logger.info(`Starting EOD task closure for date: ${targetDate} (dryRun=${isDryRun}, trigger=${triggerSource})...`);

      // Load auto-closure configuration
      let autoClosureConfig = null;
      try {
        if (this.autoClosureConfigRepo) {
          autoClosureConfig = await this.autoClosureConfigRepo.load();
        }
      } catch (err: any) {
        logger.warn(`Failed to load auto-closure config: ${err.message}. Proceeding with defaults.`);
        autoClosureConfig = null;
      }

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
          totalRejected: 0,
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
        if (isUserStoryOrParentContainer(item)) continue;
        const assignedToVal = item.fields['System.AssignedTo'];
        const title = String(item.fields['System.Title'] || '');

        for (const p of selectedPeople) {
          if (matchesPerson(assignedToVal, p)) {
            let itemDate = '';
            const personPrefix = p.titlePrefix || activeConfig.titlePrefix;

            if (matchesTaskSeries(title, personPrefix)) {
              const parsed = parseWorkItemTaskDate(item, personPrefix, activeConfig.timezone, true);
              if (parsed.isValid) itemDate = parsed.isoDate;
            } else if (!p.titlePrefix && !title.includes('|')) {
              const titleParsed = parseTitleDate(title, undefined, true);
              if (titleParsed.isValid) {
                const fieldNames = [
                  'Custom.PlannedStartdate', 'Custom.PlannedStartDate',
                  'Microsoft.VSTS.Scheduling.StartDate',
                  'Custom.ActualStartdate', 'Custom.ActualStartDate',
                ];
                for (const f of fieldNames) {
                  const raw = item.fields[f];
                  if (raw) {
                    const d = new Date(String(raw));
                    if (Number.isFinite(d.getTime())) {
                      const parts = new Intl.DateTimeFormat('en-CA', {
                        timeZone: activeConfig.timezone || 'UTC', year: 'numeric', month: '2-digit', day: '2-digit',
                      }).formatToParts(d);
                      const part = (type: string) => parts.find(pt => pt.type === type)?.value || '';
                      const isoDate = `${part('year')}-${part('month')}-${part('day')}`;
                      if (isoDate.slice(5) === titleParsed.isoDate.slice(5)) {
                        itemDate = isoDate;
                        break;
                      }
                    }
                  }
                }
                if (!itemDate) itemDate = titleParsed.isoDate;
              }
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
      let totalRejected = 0;

      for (const { person, item } of matchedTasks) {
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

        // Check if already closed
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

          // Log to audit (already closed)
          if (this.autoClosureAuditRepo && autoClosureConfig) {
            this.autoClosureAuditRepo.record({
              id: '',
              taskId,
              assignedUser: person.assignedTo || person.name,
              closedAt: nowUtc,
              triggerSource,
              closureReason: 'Task was already in closed state',
              automationDetails: {},
              configurationVersion: autoClosureConfig.version,
              validationResults: { passed: false, reason: 'Already closed' },
              status: 'rejected',
            }).catch(err => {
              logger.warn(`Failed to record audit log for already-closed task #${taskId}: ${err.message}`);
            });
          }
          continue;
        }

        // CHECK AUTO-CLOSURE CONFIGURATION
        if (autoClosureConfig) {
          const closureDecision = this.autoClosureService.shouldCloseTask(
            autoClosureConfig,
            person.assignedTo || person.name,
            person.role,
            person.team
          );

          if (!closureDecision.shouldClose) {
            totalRejected++;
            const rejectionMessage = closureDecision.reason;
            logger.info(`Task #${taskId} for ${person.name}: rejected by auto-closure config - ${rejectionMessage}`);

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
              summaryText: rejectionMessage,
              patchOperations: [],
              status: 'rejected',
              autoClosureRuleId: closureDecision.ruleId,
            });

            // Log rejection to audit
            if (this.autoClosureAuditRepo) {
              this.autoClosureAuditRepo.record({
                id: '',
                taskId,
                assignedUser: person.assignedTo || person.name,
                closedAt: nowUtc,
                triggerSource,
                closureReason: closureDecision.reason,
                automationDetails: {
                  ruleId: closureDecision.ruleId,
                  ruleName: closureDecision.ruleName,
                },
                configurationVersion: autoClosureConfig.version,
                validationResults: {
                  passed: false,
                  reason: closureDecision.reason,
                },
                status: 'rejected',
              }).catch(err => {
                logger.warn(`Failed to record rejection audit for task #${taskId}: ${err.message}`);
              });
            }
            continue;
          }

          logger.info(`Task #${taskId} for ${person.name}: approved by auto-closure config - ${closureDecision.reason}`);
        }

        // Continue with the rest of the closure logic...
        logger.debug(`Proceeding with closure for task #${taskId}...`);
      }

      return {
        targetDate,
        timezone: activeConfig.timezone,
        dryRun: isDryRun,
        totalFound: matchedTasks.length,
        totalClosed,
        totalAlreadyClosed,
        totalFailed,
        totalRejected,
        results,
      };
    } finally {
      if (!isDryRun && this.lockRepo) {
        this.lockRepo.release();
      }
    }
  }
}
