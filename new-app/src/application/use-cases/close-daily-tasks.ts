/**
 * Close Daily Tasks Use Case
 * Closes matched work items through Azure workflow rules without fabricating
 * work hours, attendance timestamps, or unverified descriptions.
 */

import {
  WorkItemRepository,
  ConfigRepository,
  JournalRepository,
  AutoClosureAuditLogRepository,
  LockRepository,
  AppConfig,
  Person,
  matchesPerson,
  parseWorkItemTaskDate,
  parseTitleDate,
  matchesTaskSeries,
  isUserStoryOrParentContainer,
  extractWorkItemPlannedStartDate,
  extractWorkItemRecordedDate,
  DatePlanningService,
  IGitHubClient,
} from '../../domain/index.js';
import type { FieldPatchOperation } from '../../domain/services/task-services.js';
import { logger } from '../../infrastructure/logging/logger.js';
import { VerifiedAutoClosurePolicyEngine, ClosureDecision } from '../../domain/services/policy-engine.js';
import { Role, AuthenticatedUser } from '../../infrastructure/auth/rbac.js';

export interface CloseDailyTasksInput {
  personKeys?: string[];
  asOf?: string; // Optional target date override, format YYYY-MM-DD
  dryRun?: boolean;
  operatorEmail?: string;
  enforcePolicyGating?: boolean;
  manualOverride?: {
    allowed?: boolean;
    reason?: string;
    overrideRole?: string;
    operatorEmail?: string;
    operatorUser?: AuthenticatedUser;
  };
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
  status: 'closed' | 'simulated' | 'already_closed' | 'failed' | 'needs_review';
  policyStatus?: string;
  manualOverrideAttribution?: any;
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
  totalNeedsReview?: number;
  totalFailed: number;
  results: ClosedTaskResult[];
}

function readRecordedWorkHours(value: unknown): number | null {
  if (value === undefined || value === null || value === '') return null;
  const hours = Number(value);
  return Number.isFinite(hours) && hours >= 0 ? hours : NaN;
}

function getAzureRequiredEvidenceError(error: unknown): string | null {
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (!/TF401320/i.test(message)) return null;
  const field = message.match(/Rule Error for field\s+(.+?)\.\s+Error code:/i)?.[1]?.trim();
  return field
    ? `REQUIRED_EVIDENCE_MISSING: Azure requires a verified value for "${field}" before task closure.`
    : `REQUIRED_EVIDENCE_MISSING: Azure process rules blocked task closure. ${message}`;
}

function getClosureTriggerSource(operatorEmail?: string): 'scheduled' | 'manual' {
  return operatorEmail?.startsWith('system-') ? 'scheduled' : 'manual';
}

export class CloseDailyTasksUseCase {
  private readonly policyEngine: VerifiedAutoClosurePolicyEngine;

  constructor(
    private readonly config: AppConfig,
    private readonly workItemRepo: WorkItemRepository,
    private readonly datePlanning: DatePlanningService,
    private readonly githubClient: IGitHubClient,
    private readonly configRepo?: ConfigRepository,
    private readonly journalRepo?: JournalRepository,
    private readonly lockRepo?: LockRepository,
    private readonly autoClosureConfigRepo?: any,
    private readonly autoClosureAuditRepo?: AutoClosureAuditLogRepository,
    policyEngine?: VerifiedAutoClosurePolicyEngine
  ) {
    this.policyEngine = policyEngine || new VerifiedAutoClosurePolicyEngine();
  }

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
        // Explicit key selection: respect the caller's list regardless of autoCloseEnabled.
        if (!Array.isArray(input.personKeys) || input.personKeys.length === 0) {
          throw new Error('EOD closure requires at least one member when personKeys is provided.');
        }
        const keys = new Set(input.personKeys.map(k => k.trim().toLowerCase()));
        selectedPeople = selectedPeople.filter(p => keys.has(p.key.toLowerCase()));
        if (selectedPeople.length !== keys.size) {
          throw new Error('EOD closure selected unknown or disabled members. Refresh the team list.');
        }
      } else {
        // All-members mode (scheduled or manual "all"): skip people who opted out of auto-close.
        const excluded = selectedPeople.filter(p => !p.autoCloseEnabled).map(p => p.name);
        if (excluded.length > 0) {
          logger.info(`EOD auto-close: excluding ${excluded.length} member(s) with autoCloseEnabled=false: ${excluded.join(', ')}`);
        }
        selectedPeople = selectedPeople.filter(p => p.autoCloseEnabled);
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
          totalNeedsReview: 0,
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
      // Exclude User Stories and parent containers from daily closure
      if (isUserStoryOrParentContainer(item)) continue;
      const assignedToVal = item.fields['System.AssignedTo'];
      const title = String(item.fields['System.Title'] || '');

      for (const p of selectedPeople) {
        if (matchesPerson(assignedToVal, p)) {
          let itemDate = '';
          const personPrefix = p.titlePrefix || activeConfig.titlePrefix;

          // Check if matches person or default series prefix
          const matchesSeries = matchesTaskSeries(title, personPrefix);
          const isNonPipe = !p.titlePrefix && !title.includes('|');

          // If task belongs to series or is a valid non-pipe task, consider Planned Start Date
          if (matchesSeries || isNonPipe) {
            const plannedDate = extractWorkItemPlannedStartDate(item, activeConfig.timezone);
            if (plannedDate) {
              // Verify title does not contradict planned date (if title has a date, month/day must match)
              const titleParsed = parseTitleDate(title, personPrefix, isNonPipe);
              if (!titleParsed.isValid || titleParsed.isoDate.slice(5) === plannedDate.isoDate.slice(5)) {
                itemDate = plannedDate.isoDate;
              }
            }
          }

          if (!itemDate && matchesSeries) {
            const parsed = parseWorkItemTaskDate(item, personPrefix, activeConfig.timezone, true);
            if (parsed.isValid) itemDate = parsed.isoDate;
          } else if (!itemDate && isNonPipe) {
            // Non-pipe task formats (e.g. "My Account Task - 19th Oct", "23 Oct 26 - Task")
            const titleParsed = parseTitleDate(title, undefined, true);
            if (titleParsed.isValid) {
              const recorded = extractWorkItemRecordedDate(item, activeConfig.timezone);
              if (recorded && recorded.isoDate.slice(5) === titleParsed.isoDate.slice(5)) {
                itemDate = recorded.isoDate;
              } else {
                itemDate = titleParsed.isoDate;
              }
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
    let totalNeedsReview = 0;
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
        const plannedStart =
          item.fields['Custom.PlannedStartdate'] ||
          item.fields['Custom.PlannedStartDate'] ||
          item.fields['Microsoft.VSTS.Scheduling.StartDate'] || '';
        const actualStart = item.fields['Custom.ActualStartdate'] ||
          item.fields['Custom.ActualStartDate'] || '';
        const actualEnd = item.fields['Custom.ActualEnddate'] ||
          item.fields['Custom.ActualEndDate'] || '';

        const existingCompleted = readRecordedWorkHours(item.fields['Microsoft.VSTS.Scheduling.CompletedWork']);
        const closureCompletedWork = existingCompleted;
        const closureRemainingWork = 0;
        const ops: FieldPatchOperation[] = [
          { op: 'add', path: '/fields/Microsoft.VSTS.Scheduling.RemainingWork', value: closureRemainingWork },
          {
            op: 'add',
            path: '/fields/System.History',
            value: `EOD closure requested at ${nowUtc}. Remaining Work set to ${closureRemainingWork}h. Recorded completed work and actual dates preserved.`,
          },
          { op: 'add', path: '/fields/System.State', value: 'Closed' },
        ];

        // Ask Azure to apply process rules without persisting the transition.
        // This prevents a remote mutation attempt when required evidence is absent.
        if (this.workItemRepo.validateWorkItemPatch) {
          try {
            await this.workItemRepo.validateWorkItemPatch(taskId, ops, { bypassRules: false });
          } catch (preflightError) {
            const requiredEvidenceError = getAzureRequiredEvidenceError(preflightError);
            if (!requiredEvidenceError) throw preflightError;

            totalNeedsReview++;
            logger.warn(`Task #${taskId} for ${person.name} requires Azure closure evidence: ${requiredEvidenceError}`);
            results.push({
              personKey: person.key,
              personName: person.name,
              taskId,
              taskTitle,
              previousState: currentState,
              newState: currentState,
              plannedStartDate: String(plannedStart),
              actualStartDate: String(actualStart),
              actualEndDate: recordedActualEnd,
              remainingWork: readRecordedWorkHours(item.fields['Microsoft.VSTS.Scheduling.RemainingWork']),
              completedWork: closureCompletedWork,
              prCount: 0,
              prSourceDate: targetDate,
              isTodayPr: false,
              htmlDescription: String(item.fields['System.Description'] || ''),
              summaryText: requiredEvidenceError,
              patchOperations: [],
              status: 'needs_review',
              policyStatus: 'NEEDS_REVIEW',
              error: requiredEvidenceError,
              auditWarning: requiredEvidenceError,
            });
            if (!isDryRun && this.autoClosureAuditRepo) {
              try {
                let configurationVersion = 1;
                if (this.autoClosureConfigRepo?.getVersion) {
                  configurationVersion = await this.autoClosureConfigRepo.getVersion();
                }
                await this.autoClosureAuditRepo.record({
                  id: `${runId}:${taskId}:required-evidence`,
                  taskId,
                  assignedUser: person.assignedTo,
                  closedAt: nowUtc,
                  triggerSource: getClosureTriggerSource(input.operatorEmail),
                  closureReason: requiredEvidenceError,
                  automationDetails: { matchedFilters: [person.key, targetDate] },
                  configurationVersion,
                  validationResults: { passed: false, reason: requiredEvidenceError },
                  patchOperations: [],
                  status: 'rejected',
                  error: requiredEvidenceError,
                });
              } catch (auditError) {
                logger.warn(`Could not record required-evidence audit for #${taskId}: ${auditError instanceof Error ? auditError.message : String(auditError)}`);
              }
            }
            continue;
          }
        }

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

        let decision: ClosureDecision | undefined;
        // If policy gating is enforced, evaluate with Policy Engine
        if (input.enforcePolicyGating || input.manualOverride?.allowed) {
          decision = await this.policyEngine.evaluateClosure(
            item,
            {
              username: githubUser,
              sourceDate: targetDate,
              pullRequests: prDeliverables.pullRequests,
              isToday: prDeliverables.isToday,
            },
            {
              targetDate,
              timezone: activeConfig.timezone,
              autoCloseEnabled: person.autoCloseEnabled,
            }
          );

          if (!decision.taskClosed || input.manualOverride?.allowed) {
            let overrideDecision: ClosureDecision | null = null;
            if (input.manualOverride?.allowed) {
              const operatorUser: AuthenticatedUser | undefined =
                input.manualOverride.operatorUser ||
                (input.manualOverride.overrideRole
                  ? {
                      id: 'legacy-operator',
                      email: input.manualOverride.operatorEmail || input.operatorEmail || 'admin@workops.test',
                      name: 'Override Operator',
                      roles: [input.manualOverride.overrideRole as Role],
                      tenantId: 'tenant-enterprise-01',
                    }
                  : undefined);

              if (operatorUser) {
                try {
                  overrideDecision = this.policyEngine.evaluateManualOverride(
                    decision,
                    operatorUser,
                    input.manualOverride.reason || ''
                  );
                } catch (overrideErr: any) {
                  logger.warn(`Manual override rejected for task #${taskId}: ${overrideErr.message}`);
                }
              }
            }

            if (!overrideDecision || !overrideDecision.taskClosed) {
              totalNeedsReview++;
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
                githubUsername: githubUser,
                prCount: prDeliverables.pullRequests.length,
                prSourceDate: prDeliverables.sourceDate,
                isTodayPr: prDeliverables.isToday,
                htmlDescription: prDeliverables.htmlDescription,
                summaryText: `Task requires review: ${decision.reason}`,
                patchOperations: [],
                status: 'needs_review',
                policyStatus: decision.status,
                auditWarning: decision.reason,
              });
              if (this.autoClosureAuditRepo) {
                try {
                  let configurationVersion = 1;
                  if (this.autoClosureConfigRepo?.getVersion) {
                    configurationVersion = await this.autoClosureConfigRepo.getVersion();
                  }
                  await this.autoClosureAuditRepo.record({
                    id: `${runId}:${taskId}:review`,
                    taskId,
                    assignedUser: person.assignedTo,
                    closedAt: nowUtc,
                    triggerSource: getClosureTriggerSource(input.operatorEmail),
                    closureReason: decision.reason,
                    automationDetails: { matchedFilters: [person.key, targetDate] },
                    configurationVersion,
                    validationResults: { passed: false, reason: decision.reason },
                    patchOperations: [],
                    status: 'rejected',
                    error: decision.reason,
                  });
                } catch (auditError) {
                  logger.warn(`Could not record auto-closure review decision for #${taskId}: ${auditError instanceof Error ? auditError.message : String(auditError)}`);
                }
              }
              continue;
            } else {
              decision = overrideDecision;
            }
          }
        }

        let auditWarning: string | undefined;
        let verified = false;
        if (!isDryRun) {
          await this.workItemRepo.patchWorkItem(taskId, ops, { bypassRules: false });
          logger.info(`Closed task #${taskId} for ${person.name}; preserved Azure recorded work hours.`);
          totalClosed++;

          // Treat the PATCH as accepted but separately verify the resulting state.
          // A read-back failure must not turn an accepted write into a failed write.
          try {
            const current = await this.workItemRepo.getWorkItem(taskId, { fresh: true });
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
                operatorEmail: decision?.manualOverride?.operatorEmail || input.operatorEmail || person.assignedTo,
                operator_email: decision?.manualOverride?.operatorEmail || input.operatorEmail || person.assignedTo,
                targetIsoDate: targetDate,
                title: taskTitle,
                sourceTaskId: taskId,
                createdWorkItemId: taskId,
                fieldCopyStatus: 'SUCCESS',
                relationCopyStatus: 'SUCCESS',
                verified,
                action: 'CLOSED',
                taskId,
                manualOverride: Boolean(decision?.manualOverride?.allowed),
                overrideRole: decision?.manualOverride?.overrideRole,
                overrideReason: decision?.manualOverride?.reason,
                policyStatus: decision?.status,
                error: verified ? undefined : 'Closure accepted; independent final-state verification incomplete.',
              });
            } catch (jErr: any) {
              const journalWarning = `Azure task #${taskId} was closed, but recording the local audit journal failed: ${jErr instanceof Error ? jErr.message : String(jErr)}`;
              auditWarning = auditWarning ? `${auditWarning} ${journalWarning}` : journalWarning;
              logger.warn(auditWarning);
            }
          }

          if (this.autoClosureAuditRepo) {
            try {
              let configurationVersion = 1;
              if (this.autoClosureConfigRepo?.getVersion) {
                configurationVersion = await this.autoClosureConfigRepo.getVersion();
              }
              await this.autoClosureAuditRepo.record({
                id: `${runId}:${taskId}`,
                taskId,
                assignedUser: person.assignedTo,
                closedAt: nowUtc,
                triggerSource: input.operatorEmail?.startsWith('system-') ? 'scheduled' : 'manual',
                closureReason: decision?.manualOverride?.allowed
                  ? `Manual override: ${decision.manualOverride.reason}`
                  : (decision?.reason || prDeliverables.summaryText),
                automationDetails: {
                  matchedFilters: [person.key, targetDate],
                },
                configurationVersion,
                validationResults: {
                  passed: verified,
                  reason: auditWarning,
                  warnings: auditWarning ? [auditWarning] : undefined,
                },
                patchOperations: ops,
                status: verified ? 'success' : 'rejected',
                error: auditWarning,
              });
            } catch (auditError) {
              const auditWriteWarning = `Azure task #${taskId} was closed, but recording the auto-closure audit failed: ${auditError instanceof Error ? auditError.message : String(auditError)}`;
              auditWarning = auditWarning ? `${auditWarning} ${auditWriteWarning}` : auditWriteWarning;
              logger.warn(auditWriteWarning);
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
          remainingWork: closureRemainingWork,
          completedWork: closureCompletedWork,
          githubUsername: githubUser,
          prCount: prDeliverables.pullRequests.length,
          prSourceDate: prDeliverables.sourceDate,
          isTodayPr: prDeliverables.isToday,
          htmlDescription: prDeliverables.htmlDescription,
          summaryText: prDeliverables.summaryText,
          patchOperations: ops,
          status: isDryRun ? 'simulated' : 'closed',
          policyStatus: decision?.status,
          manualOverrideAttribution: decision?.manualOverride,
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
      totalClosed: isDryRun
        ? matchedTasks.length - totalAlreadyClosed - totalNeedsReview - totalFailed
        : totalClosed,
      totalAlreadyClosed,
      totalNeedsReview,
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
