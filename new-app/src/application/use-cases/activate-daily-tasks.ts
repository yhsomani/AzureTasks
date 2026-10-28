/**
 * Activate Daily Tasks Use Case
 * Transitions today's eligible tasks from New to Active at 5:30 PM,
 * updates task description with GitHub PR evidence, and leaves already active/closed tasks intact.
 */

import {
  AppConfig,
  WorkItemRepository,
  JournalRepository,
  LockRepository,
  ConfigRepository,
} from '../../domain/ports/repositories.js';
import {
  Person,
  parseWorkItemTaskDate,
  parseTitleDate,
  matchesTaskSeries,
  isUserStoryOrParentContainer,
  DatePlanningService,
} from '../../domain/index.js';
import type { FieldPatchOperation } from '../../domain/services/task-services.js';
import { GitHubClient } from '../../infrastructure/github/github-client.js';
import { logger } from '../../infrastructure/logging/logger.js';

export interface ActivateDailyTasksInput {
  personKeys?: string[];
  asOf?: string; // Optional target date override, format YYYY-MM-DD
  dryRun?: boolean;
}

export interface ActivatedTaskResult {
  personKey: string;
  personName: string;
  taskId: number;
  taskTitle: string;
  previousState: string;
  newState: string;
  plannedStartDate?: string;
  actualStartDate?: string;
  githubUsername?: string;
  prCount: number;
  prSourceDate: string;
  isTodayPr: boolean;
  htmlDescription: string;
  summaryText: string;
  patchOperations: FieldPatchOperation[];
  status: 'activated' | 'simulated' | 'already_active' | 'already_closed' | 'failed';
  error?: string;
  auditWarning?: string;
  verified?: boolean;
}

export interface ActivateDailyTasksOutput {
  targetDate: string;
  timezone: string;
  dryRun: boolean;
  totalFound: number;
  totalActivated: number;
  totalAlreadyActive: number;
  totalAlreadyClosed: number;
  totalFailed: number;
  results: ActivatedTaskResult[];
}

function matchesPerson(assignedTo: any, person: Person): boolean {
  if (!assignedTo) return false;
  const pName = (person.name || '').trim().toLowerCase();
  const pEmail = (person.assignedTo || '').trim().toLowerCase();
  if (typeof assignedTo === 'string') {
    const s = assignedTo.trim().toLowerCase();
    return Boolean((pEmail && s.includes(pEmail)) || (pName && s.includes(pName)));
  }
  const dName = String(assignedTo.displayName || '').trim().toLowerCase();
  const uName = String(assignedTo.uniqueName || '').trim().toLowerCase();
  return Boolean((pEmail && uName === pEmail) || (pName && dName === pName));
}

export class ActivateDailyTasksUseCase {
  constructor(
    private readonly config: AppConfig,
    private readonly workItemRepo: WorkItemRepository,
    private readonly datePlanning: DatePlanningService,
    private readonly githubClient: GitHubClient,
    private readonly configRepo?: ConfigRepository,
    private readonly journalRepo?: JournalRepository,
    private readonly lockRepo?: LockRepository
  ) {}

  async execute(input: ActivateDailyTasksInput = {}): Promise<ActivateDailyTasksOutput> {
    const isDryRun = Boolean(input.dryRun);
    const targetDate = input.asOf || this.datePlanning.getTodayIso(this.config.timezone);
    const nowUtc = new Date().toISOString();
    const runId = `activate-${Date.now()}`;

    // Concurrency lock for non-dry-run operations
    if (!isDryRun && this.lockRepo) {
      if (!this.lockRepo.acquire()) {
        throw new Error('Another execution is already running. Please wait for it to complete.');
      }
    }

    try {
      logger.info(`Starting daily task activation for date: ${targetDate} (dryRun=${isDryRun})...`);

      // 1. Resolve eligible team members
      const activeConfig = this.configRepo ? await this.configRepo.load() : this.config;
      let selectedPeople = activeConfig.people
        .filter(p => p.enabled !== false)
        .map(p => new Person(p));

      if (input.personKeys !== undefined) {
        if (!Array.isArray(input.personKeys) || input.personKeys.length === 0) {
          throw new Error('Task activation requires at least one member when personKeys is provided.');
        }
        const keys = new Set(input.personKeys.map(k => k.trim().toLowerCase()));
        selectedPeople = selectedPeople.filter(p => keys.has(p.key.toLowerCase()));
        if (selectedPeople.length !== keys.size) {
          throw new Error('Task activation selected unknown or disabled members. Refresh the team list.');
        }
      } else {
        const excluded = selectedPeople.filter(p => !p.autoCloseEnabled).map(p => p.name);
        if (excluded.length > 0) {
          logger.info(`Auto-activation: excluding ${excluded.length} member(s) with autoCloseEnabled=false: ${excluded.join(', ')}`);
        }
        selectedPeople = selectedPeople.filter(p => p.autoCloseEnabled);
      }

      if (selectedPeople.length === 0) {
        logger.warn('No enabled people found for daily task activation.');
        return {
          targetDate,
          timezone: activeConfig.timezone,
          dryRun: isDryRun,
          totalFound: 0,
          totalActivated: 0,
          totalAlreadyActive: 0,
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

      const results: ActivatedTaskResult[] = [];
      let totalActivated = 0;
      let totalAlreadyActive = 0;
      let totalAlreadyClosed = 0;
      let totalFailed = 0;

      for (const { person, item } of matchedTasks) {
        const currentState = String(item.fields['System.State'] || 'New');
        const taskId = item.id;
        const taskTitle = String(item.fields['System.Title'] || `Task #${taskId}`);
        const stateLower = currentState.trim().toLowerCase();

        // 1. Check if already closed
        const isClosedState = ['closed', 'done', 'resolved', 'completed'].includes(stateLower) ||
          Boolean(item.fields['Microsoft.VSTS.Common.ClosedDate']);
        if (isClosedState) {
          totalAlreadyClosed++;
          results.push({
            personKey: person.key,
            personName: person.name,
            taskId,
            taskTitle,
            previousState: currentState,
            newState: currentState,
            prCount: 0,
            prSourceDate: targetDate,
            isTodayPr: false,
            htmlDescription: String(item.fields['System.Description'] || ''),
            summaryText: 'Task is already closed; state left unchanged.',
            patchOperations: [],
            status: 'already_closed',
          });
          continue;
        }

        // 2. Check if already Active
        if (stateLower === 'active') {
          totalAlreadyActive++;
          results.push({
            personKey: person.key,
            personName: person.name,
            taskId,
            taskTitle,
            previousState: currentState,
            newState: currentState,
            plannedStartDate: String(item.fields['Custom.PlannedStartDate'] || item.fields['Custom.PlannedStartdate'] || ''),
            actualStartDate: String(item.fields['Custom.ActualStartDate'] || item.fields['Custom.ActualStartdate'] || ''),
            prCount: 0,
            prSourceDate: targetDate,
            isTodayPr: false,
            htmlDescription: String(item.fields['System.Description'] || ''),
            summaryText: 'Task is already in Active state; state left unchanged.',
            patchOperations: [],
            status: 'already_active',
          });
          continue;
        }

        // 3. Task is in New (or non-active) state and needs to transition to Active
        try {
          // Resolve GitHub username
          let githubUser = person.githubUsername;
          if (!githubUser) {
            githubUser = (await this.githubClient.resolveUserByEmail(person.assignedTo, activeConfig.githubUserSuffix)) || undefined;
          }

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
            prDeliverables = {
              username: person.name,
              sourceDate: targetDate,
              isToday: false,
              pullRequests: [],
              htmlDescription: `<div><p>Task activated on ${targetDate}. Work in progress.</p></div>`,
              summaryText: 'Activated at 5:30 PM; work in progress.',
            };
          }

          const plannedStart =
            item.fields['Custom.PlannedStartdate'] ||
            item.fields['Custom.PlannedStartDate'] ||
            item.fields['Microsoft.VSTS.Scheduling.StartDate'] || '';
          const actualStart =
            item.fields['Custom.ActualStartdate'] ||
            item.fields['Custom.ActualStartDate'] || '';

          const ops: FieldPatchOperation[] = [
            { op: 'add', path: '/fields/System.State', value: 'Active' },
            {
              op: 'add',
              path: '/fields/System.Description',
              value: prDeliverables.htmlDescription || `<div><p>Task activated on ${targetDate}. ${prDeliverables.summaryText}</p></div>`,
            },
            {
              op: 'add',
              path: '/fields/System.History',
              value: `Task moved to Active state at 17:30 (${nowUtc}). ${prDeliverables.summaryText}`,
            },
          ];

          let auditWarning: string | undefined;
          let verified = false;

          if (!isDryRun) {
            try {
              await this.workItemRepo.patchWorkItem(taskId, ops, { bypassRules: false });
            } catch (patchErr: any) {
              const errStr = String(patchErr?.message || '');
              // If tenant requires ActualStartDate or Planned dates when moving to Active
              if (errStr.includes('TF401320') || errStr.toLowerCase().includes('rule error')) {
                logger.info(`Applying compliant activation fields for task #${taskId} to satisfy tenant process rules...`);
                const ruleOps = [...ops];

                const hasActualStart = Boolean(item.fields['Custom.ActualStartdate'] || item.fields['Custom.ActualStartDate']);
                const fieldKeys = Object.keys(item.fields || {});
                const hasPascalField = fieldKeys.some(
                  k => k === 'Custom.ActualStartDate' || k === 'Custom.PlannedStartDate'
                );
                const hasLowerField = fieldKeys.some(
                  k => k === 'Custom.ActualStartdate' || k === 'Custom.PlannedStartdate'
                );
                const prefersPascalCase = hasPascalField || (!hasLowerField && fieldKeys.some(k => k.startsWith('Custom.') && k.endsWith('Date')));

                const startField = prefersPascalCase ? 'Custom.ActualStartDate' : 'Custom.ActualStartdate';
                const plannedStartField = prefersPascalCase ? 'Custom.PlannedStartDate' : 'Custom.PlannedStartdate';

                if (!hasActualStart) {
                  ruleOps.push({ op: 'add', path: `/fields/${startField}`, value: String(plannedStart || `${targetDate}T04:00:00Z`) });
                }

                const hasPlannedStart = Boolean(
                  item.fields['Custom.PlannedStartdate'] || item.fields['Custom.PlannedStartDate'] ||
                  item.fields['Microsoft.VSTS.Scheduling.StartDate']
                );
                if (!hasPlannedStart) {
                  ruleOps.push({ op: 'add', path: `/fields/${plannedStartField}`, value: `${targetDate}T04:00:00Z` });
                  ruleOps.push({ op: 'add', path: '/fields/Microsoft.VSTS.Scheduling.StartDate', value: `${targetDate}T04:00:00Z` });
                }

                try {
                  await this.workItemRepo.patchWorkItem(taskId, ruleOps, { bypassRules: false });
                } catch (retryErr: any) {
                  // Invert casing if needed
                  const alternateOps = ruleOps.map(op => {
                    if (op.path === '/fields/Custom.ActualStartdate') return { ...op, path: '/fields/Custom.ActualStartDate' };
                    if (op.path === '/fields/Custom.ActualStartDate') return { ...op, path: '/fields/Custom.ActualStartdate' };
                    if (op.path === '/fields/Custom.PlannedStartdate') return { ...op, path: '/fields/Custom.PlannedStartDate' };
                    if (op.path === '/fields/Custom.PlannedStartDate') return { ...op, path: '/fields/Custom.PlannedStartdate' };
                    return op;
                  });
                  await this.workItemRepo.patchWorkItem(taskId, alternateOps, { bypassRules: false });
                }
              } else {
                throw patchErr;
              }
            }

            logger.info(`Activated task #${taskId} for ${person.name} with updated description.`);
            totalActivated++;

            try {
              const current = await this.workItemRepo.getWorkItem(taskId);
              verified = current.id === taskId &&
                String(current.fields['System.State'] || '').trim().toLowerCase() === 'active' &&
                matchesPerson(current.fields['System.AssignedTo'], person);
              if (!verified) auditWarning = `Azure accepted activation of #${taskId}, but final state was not confirmed Active.`;
            } catch (readbackError) {
              auditWarning = `Azure accepted activation of #${taskId}, but read-back check failed: ${readbackError instanceof Error ? readbackError.message : String(readbackError)}`;
            }

            if (auditWarning) logger.warn(auditWarning);

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
                  error: verified ? undefined : 'Activation accepted; independent read-back incomplete.',
                });
              } catch (jErr: any) {
                const journalWarning = `Azure task #${taskId} was activated, but recording the local audit journal failed: ${jErr instanceof Error ? jErr.message : String(jErr)}`;
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
            newState: 'Active',
            plannedStartDate: String(plannedStart),
            actualStartDate: String(actualStart),
            githubUsername: githubUser,
            prCount: prDeliverables.pullRequests.length,
            prSourceDate: prDeliverables.sourceDate,
            isTodayPr: prDeliverables.isToday,
            htmlDescription: prDeliverables.htmlDescription,
            summaryText: prDeliverables.summaryText,
            patchOperations: ops,
            status: isDryRun ? 'simulated' : 'activated',
            auditWarning,
            verified: isDryRun ? false : verified,
          });
        } catch (err: any) {
          totalFailed++;
          logger.error(`Failed to activate task #${taskId} for ${person.name}: ${err.message}`);
          results.push({
            personKey: person.key,
            personName: person.name,
            taskId,
            taskTitle,
            previousState: currentState,
            newState: currentState,
            prCount: 0,
            prSourceDate: targetDate,
            isTodayPr: false,
            htmlDescription: '',
            summaryText: 'Failed to activate task',
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
        totalActivated: isDryRun ? matchedTasks.length - totalAlreadyActive - totalAlreadyClosed - totalFailed : totalActivated,
        totalAlreadyActive,
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
