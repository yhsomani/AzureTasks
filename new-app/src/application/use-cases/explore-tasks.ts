/**
 * Explore Tasks Use Case
 * Multi-user intelligent date-range coverage matrix, task explorer, and burndown data provider.
 */

import { WorkItemRepository, AppConfig } from '../../domain/ports/repositories.js';
import { Person, PersonConfig, matchesPerson } from '../../domain/entities/person.js';
import { workdayEligibility } from '../../domain/services/work-calendar.js';
import {
  WorkItem,
  parseWorkItemTaskDate,
  parseTitleDate,
  matchesTaskSeries,
  extractWorkItemPlannedStartDate,
  extractWorkItemRecordedDate,
  isUserStoryOrParentContainer,
} from '../../domain/entities/task.js';
import {
  getTodayIso,
  getNextThursdayIso,
  getDayOfWeek,
  addDays,
  formatTitleDate,
} from '../../domain/value-objects/date-window.js';

export type CellStatus = 'CREATED' | 'MISSING' | 'DUPLICATE' | 'WEEKEND_SKIP' | 'NOT_APPLICABLE' | 'CALENDAR_SKIP';

export interface ExplorerTaskSummary {
  id: number;
  title: string;
  state: string;
  createdDate?: string;
  changedDate?: string;
  assignedTo?: string;
  url: string;
  completedWork?: number;
  remainingWork?: number;
  originalEstimate?: number;
}

export interface MatrixCell {
  dateIso: string;
  formattedDate: string;
  dayOfWeek: string;
  isWeekend: boolean;
  status: CellStatus;
  isEligibleForCreation: boolean;
  tasks: ExplorerTaskSummary[];
  primaryTask?: ExplorerTaskSummary;
  reason?: string;
}

export interface UserMatrixRow {
  person: PersonConfig;
  cells: Record<string, MatrixCell>;
  stats: {
    totalWorkingDays: number;
    createdCount: number;
    missingCount: number;
    duplicateCount: number;
    coveragePercent: number;
    stateCounts: Record<string, number>;
    totalCompletedWork: number | null;
    totalRemainingWork: number | null;
    recordedCompletedWorkTasks: number;
    unrecordedCompletedWorkTasks: number;
  };
}

export interface DetailedTaskItem {
  dateIso: string;
  formattedDate: string;
  dayOfWeek: string;
  isWeekend: boolean;
  person: PersonConfig;
  taskId?: number;
  title?: string;
  state?: string;
  createdDate?: string;
  changedDate?: string;
  status: CellStatus;
  isEligibleForCreation: boolean;
  url?: string;
  completedWork?: number;
  remainingWork?: number;
}

export interface ExploreTasksInput {
  preset?: string;
  startDate?: string;
  endDate?: string;
  personKeys?: string[];
  asOf?: string;
}

export interface ExploreTasksOutput {
  dateRange: {
    startDate: string;
    endDate: string;
    totalDays: number;
    workingDays: number;
    todayIso: string;
    nextThursdayIso: string;
  };
  summary: {
    totalSelectedUsers: number;
    totalWorkingDates: number;
    expectedCombinations: number;
    existingCombinations: number;
    missingCombinations: number;
    duplicateCombinations: number;
    overallCoveragePercent: number;
    stateCounts: {
      New: number;
      Active: number;
      Closed: number;
      Resolved: number;
      Other: number;
    };
    totalCompletedWork: number | null;
    totalRemainingWork: number | null;
    recordedCompletedWorkTasks: number;
    unrecordedCompletedWorkTasks: number;
  };
  users: PersonConfig[];
  dates: Array<{
    dateIso: string;
    formattedDate: string;
    dayOfWeek: string;
    isWeekend: boolean;
  }>;
  matrix: UserMatrixRow[];
  detailedTasks: DetailedTaskItem[];
  warnings?: string[];
}

function readRecordedHours(raw: unknown): number | undefined {
  if (raw === undefined || raw === null || raw === '') return undefined;
  const number = Number(raw);
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export class ExploreTasksUseCase {
  constructor(
    private readonly workItemRepo: WorkItemRepository,
    private readonly config: AppConfig,
    private readonly baseUrl = 'https://dev.azure.com'
  ) {}

  public static getPresetDateRange(
    preset: string,
    timezone = 'Asia/Kolkata',
    referenceDate?: string,
    thursdayMode: 'CURRENT' | 'FOLLOWING' = 'CURRENT',
    stopDayOfWeek = 4
  ): { startDate: string; endDate: string } {
    const today = referenceDate || getTodayIso(timezone);
    const [y, m, d] = today.split('-').map(Number);
    const dateObj = new Date(Date.UTC(y, m - 1, d));
    const dayOfWeek = dateObj.getUTCDay();

    switch (preset) {
      case 'today':
        return { startDate: today, endDate: today };
      case 'yesterday': {
        const yest = addDays(today, -1);
        return { startDate: yest, endDate: yest };
      }
      case 'this_week': {
        const diffToMon = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
        const monday = addDays(today, diffToMon);
        const friday = addDays(monday, 4);
        return { startDate: monday, endDate: friday };
      }
      case 'last_week': {
        const diffToMon = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
        const lastMonday = addDays(today, diffToMon - 7);
        const lastFriday = addDays(lastMonday, 4);
        return { startDate: lastMonday, endDate: lastFriday };
      }
      case 'current_month': {
        const firstDay = `${y}-${String(m).padStart(2, '0')}-01`;
        const lastDayObj = new Date(Date.UTC(y, m, 0));
        const lastDay = `${y}-${String(m).padStart(2, '0')}-${String(lastDayObj.getUTCDate()).padStart(2, '0')}`;
        return { startDate: firstDay, endDate: lastDay };
      }
      case 'previous_month': {
        const prevMonthDate = new Date(Date.UTC(y, m - 2, 1));
        const py = prevMonthDate.getUTCFullYear();
        const pm = prevMonthDate.getUTCMonth() + 1;
        const pFirst = `${py}-${String(pm).padStart(2, '0')}-01`;
        const pLastDayObj = new Date(Date.UTC(py, pm, 0));
        const pLast = `${py}-${String(pm).padStart(2, '0')}-${String(pLastDayObj.getUTCDate()).padStart(2, '0')}`;
        return { startDate: pFirst, endDate: pLast };
      }
      case 'last_7_days':
        return { startDate: addDays(today, -6), endDate: today };
      case 'last_30_days':
        return { startDate: addDays(today, -29), endDate: today };
      case 'today_to_next_thursday':
      default: {
        const nextThursday = getNextThursdayIso(today, thursdayMode, stopDayOfWeek);
        return { startDate: today, endDate: nextThursday };
      }
    }
  }

  async execute(input: ExploreTasksInput): Promise<ExploreTasksOutput> {
    const timezone = this.config.timezone || 'Asia/Kolkata';
    const todayIso = input.asOf || getTodayIso(timezone);
    const thursdayMode = this.config.thursdayMode || 'CURRENT';
    const stopDayOfWeek = this.config.stopDayOfWeek ?? 4;
    const nextThursdayIso = getNextThursdayIso(todayIso, thursdayMode, stopDayOfWeek);

    let { startDate, endDate } = input;
    if (input.preset) {
      const presetRange = ExploreTasksUseCase.getPresetDateRange(
        input.preset,
        timezone,
        todayIso,
        thursdayMode,
        stopDayOfWeek
      );
      startDate = presetRange.startDate;
      endDate = presetRange.endDate;
    } else if (!startDate || !endDate) {
      const defaultRange = ExploreTasksUseCase.getPresetDateRange(
        'today_to_next_thursday',
        timezone,
        todayIso,
        thursdayMode,
        stopDayOfWeek
      );
      startDate = startDate || defaultRange.startDate;
      endDate = endDate || defaultRange.endDate;
    }

    if (startDate > endDate) {
      throw new Error(`Start date (${startDate}) cannot be after end date (${endDate}).`);
    }

    // Generate calendar dates
    const calendarDates: Array<{
      dateIso: string;
      formattedDate: string;
      dayOfWeek: string;
      isWeekend: boolean;
    }> = [];
    let cur = startDate;
    let count = 0;
    const MAX_DAYS = 120;

    while (cur <= endDate) {
      count++;
      if (count > MAX_DAYS) {
        throw new Error(`Requested date range exceeds maximum allowed limit of ${MAX_DAYS} days.`);
      }
      const dow = getDayOfWeek(cur);
      const isWeekend = (dow === 0 || dow === 6) && (this.config.skipWeekends !== false);
      calendarDates.push({
        dateIso: cur,
        formattedDate: formatTitleDate(cur),
        dayOfWeek: DAY_NAMES[dow],
        isWeekend,
      });
      cur = addDays(cur, 1);
    }

    const workingDaysCount = calendarDates.filter(d => !d.isWeekend).length;

    // Filter enabled configured people
    const allConfiguredPeople = (this.config.people || [])
      .filter(p => p.enabled !== false)
      .map(p => new Person(p));

    if (allConfiguredPeople.length === 0) {
      throw new Error('No enabled team members found in configuration.');
    }

    let selectedPeople = allConfiguredPeople;
    if (input.personKeys !== undefined) {
      if (!Array.isArray(input.personKeys) || input.personKeys.length === 0) {
        throw new Error('Select at least one enabled team member for Explorer.');
      }
      const keySet = new Set(input.personKeys.map(k => String(k).trim().toLowerCase()));
      selectedPeople = allConfiguredPeople.filter(p =>
        keySet.has(p.key.toLowerCase()) || keySet.has(p.assignedTo.toLowerCase()) || keySet.has(p.name.toLowerCase())
      );
      if (selectedPeople.length === 0 || selectedPeople.length !== keySet.size) {
        throw new Error('Explorer member selection contains unknown or disabled members. Refresh the team list.');
      }
    }

    // Query candidate work items from Azure DevOps
    const candidateWorkItems = await this.workItemRepo.findCandidateTasks(
      this.config.project,
      this.config.workItemType,
      this.config.titlePrefix,
      startDate,
      endDate,
      Array.from(new Set(selectedPeople.flatMap(p => [p.assignedTo, p.name].filter(Boolean) as string[])))
    );

    // Index work items by Person Key -> Date ISO -> WorkItem[]
    const personTaskIndex = new Map<string, Map<string, WorkItem[]>>();
    for (const p of selectedPeople) {
      personTaskIndex.set(p.key.toLowerCase(), new Map());
    }

    for (const item of candidateWorkItems) {
      // Exclude User Stories and parent containers (which have child links or User Story type)
      if (isUserStoryOrParentContainer(item)) {
        continue;
      }
      const assignedToVal = item.fields['System.AssignedTo'];
      const title = String(item.fields['System.Title'] || '');

      for (const p of selectedPeople) {
        if (matchesPerson(assignedToVal, p)) {
          let itemDate = '';
          const memberPrefix = p.titlePrefix || this.config.titlePrefix;

          // 1. Prioritize Planned Start Date as primary source of truth
          const planned = extractWorkItemPlannedStartDate(item, timezone);
          if (planned && (!title.includes('|') || (memberPrefix && matchesTaskSeries(title, memberPrefix)))) {
            itemDate = planned.isoDate;
          }

          // 2. If no Planned Start Date, check task title series parsing
          if (!itemDate) {
            if (p.titlePrefix) {
              if (matchesTaskSeries(title, p.titlePrefix)) {
                const parsed = parseWorkItemTaskDate(item, p.titlePrefix, timezone);
                if (parsed.isValid) itemDate = parsed.isoDate;
              }
            } else {
              // Check default series prefix
              if (matchesTaskSeries(title, this.config.titlePrefix)) {
                const parsed = parseWorkItemTaskDate(item, this.config.titlePrefix, timezone);
                if (parsed.isValid) itemDate = parsed.isoDate;
              } else if (!title.includes('|')) {
                // Non-pipe task formats (e.g. Mukul's "23 Oct 26 - Task", "My Account Task - 21 Oct")
                const titleParsed = parseTitleDate(title, undefined, true);
                if (titleParsed.isValid) itemDate = titleParsed.isoDate;
              }
            }
          }

          // 3. Fallback to any remaining Azure recorded dates (ActualStartDate, etc.)
          if (!itemDate && (!title.includes('|') || (memberPrefix && matchesTaskSeries(title, memberPrefix)))) {
            const recorded = extractWorkItemRecordedDate(item, timezone);
            if (recorded) {
              itemDate = recorded.isoDate;
            }
          }

          if (!itemDate) continue;

          const pKey = p.key.toLowerCase();
          let dateMap = personTaskIndex.get(pKey);
          if (!dateMap) {
            dateMap = new Map();
            personTaskIndex.set(pKey, dateMap);
          }
          const list = dateMap.get(itemDate) || [];
          list.push(item);
          dateMap.set(itemDate, list);
        }
      }
    }

    // Build Matrix, user stats, and detailed tasks list
    const matrix: UserMatrixRow[] = [];
    const detailedTasks: DetailedTaskItem[] = [];

    const overallStateCounts = { New: 0, Active: 0, Closed: 0, Resolved: 0, Other: 0 };
    let overallCreated = 0;
    let overallMissing = 0;
    let overallDuplicates = 0;
    let overallCompletedWork = 0;
    let overallRemainingWork = 0;
    let overallRecordedCompleted = 0;
    let overallUnrecordedCompleted = 0;
    let overallRecordedRemaining = 0;

    const baseOrgUrl = `${this.baseUrl.replace(/\/$/, '')}/${this.config.organization}/${this.config.project}/_workitems/edit`;

    for (const person of selectedPeople) {
      const pKey = person.key.toLowerCase();
      const dateMap = personTaskIndex.get(pKey) || new Map();
      const cells: Record<string, MatrixCell> = {};

      const userStateCounts: Record<string, number> = { New: 0, Active: 0, Closed: 0, Resolved: 0, Other: 0 };
      let userCreated = 0;
      let userMissing = 0;
      let userDuplicates = 0;
      let userCompletedWork = 0;
      let userRemainingWork = 0;
      let userRecordedCompleted = 0;
      let userUnrecordedCompleted = 0;
      let userRecordedRemaining = 0;
      let eligibleDays = 0;

      for (const cal of calendarDates) {
        const eligibility = workdayEligibility(person.key, cal.dateIso, this.config.skipWeekends !== false, this.config.calendar);
        if (eligibility.eligible) eligibleDays++;
        const rawTasks = dateMap.get(cal.dateIso) || [];
        const taskSummaries: ExplorerTaskSummary[] = rawTasks.map((t: WorkItem) => {
          const st = String(t.fields['System.State'] || 'New');
          if (st === 'New') userStateCounts.New++;
          else if (st === 'Active') userStateCounts.Active++;
          else if (st === 'Closed') userStateCounts.Closed++;
          else if (st === 'Resolved') userStateCounts.Resolved++;
          else userStateCounts.Other = (userStateCounts.Other || 0) + 1;

          const completed = readRecordedHours(t.fields['Microsoft.VSTS.Scheduling.CompletedWork']);
          const remaining = readRecordedHours(t.fields['Microsoft.VSTS.Scheduling.RemainingWork']);
          const orig = readRecordedHours(t.fields['Microsoft.VSTS.Scheduling.OriginalEstimate']);

          if (completed !== undefined) {
            userCompletedWork += completed;
            userRecordedCompleted++;
          } else {
            userUnrecordedCompleted++;
          }
          if (remaining !== undefined) {
            userRemainingWork += remaining;
            userRecordedRemaining++;
          }

          return {
            id: t.id,
            title: String(t.fields['System.Title'] || ''),
            state: st,
            createdDate: t.fields['System.CreatedDate'],
            changedDate: t.fields['System.ChangedDate'],
            assignedTo: typeof t.fields['System.AssignedTo'] === 'object'
              ? (t.fields['System.AssignedTo'] as any)?.displayName
              : String(t.fields['System.AssignedTo'] || ''),
            url: `${baseOrgUrl}/${t.id}`,
            completedWork: completed,
            remainingWork: remaining,
            originalEstimate: orig,
          };
        });

        let status: CellStatus;
        let isEligible = false;

        if (cal.isWeekend) {
          status = 'WEEKEND_SKIP';
        } else if (!eligibility.eligible) {
          status = 'CALENDAR_SKIP';
        } else if (taskSummaries.length > 0) {
          if (taskSummaries.length > 1) {
            status = 'DUPLICATE';
            userDuplicates++;
          } else {
            status = 'CREATED';
            userCreated++;
          }
        } else {
          // No task
          if (cal.dateIso >= todayIso && cal.dateIso <= nextThursdayIso) {
            status = 'MISSING';
            isEligible = true;
            userMissing++;
          } else if (cal.dateIso < todayIso) {
            status = 'MISSING';
            isEligible = false;
            userMissing++;
          } else {
            status = 'NOT_APPLICABLE';
            isEligible = false;
          }
        }

        const primaryTask = taskSummaries[0];
        cells[cal.dateIso] = {
          dateIso: cal.dateIso,
          formattedDate: cal.formattedDate,
          dayOfWeek: cal.dayOfWeek,
          isWeekend: cal.isWeekend,
          status,
          isEligibleForCreation: isEligible,
          tasks: taskSummaries,
          primaryTask,
          reason: eligibility.reason,
        };

        // Add to detailed task items
        if (taskSummaries.length > 0) {
          for (const ts of taskSummaries) {
            detailedTasks.push({
              dateIso: cal.dateIso,
              formattedDate: cal.formattedDate,
              dayOfWeek: cal.dayOfWeek,
              isWeekend: cal.isWeekend,
              person: person.toConfig(),
              taskId: ts.id,
              title: ts.title,
              state: ts.state,
              createdDate: ts.createdDate,
              changedDate: ts.changedDate,
              status,
              isEligibleForCreation: isEligible,
              url: ts.url,
              completedWork: ts.completedWork,
              remainingWork: ts.remainingWork,
            });
          }
        } else if (!cal.isWeekend) {
          detailedTasks.push({
            dateIso: cal.dateIso,
            formattedDate: cal.formattedDate,
            dayOfWeek: cal.dayOfWeek,
            isWeekend: cal.isWeekend,
            person: person.toConfig(),
            status,
            isEligibleForCreation: isEligible,
          });
        }
      }

      const coveragePercent = eligibleDays > 0
        ? Math.min(100, Math.round((userCreated / eligibleDays) * 100))
        : 0;

      matrix.push({
        person: person.toConfig(),
        cells,
        stats: {
          totalWorkingDays: eligibleDays,
          createdCount: userCreated,
          missingCount: userMissing,
          duplicateCount: userDuplicates,
          coveragePercent,
          stateCounts: userStateCounts,
          totalCompletedWork: userRecordedCompleted ? userCompletedWork : null,
          totalRemainingWork: userRecordedRemaining ? userRemainingWork : null,
          recordedCompletedWorkTasks: userRecordedCompleted,
          unrecordedCompletedWorkTasks: userUnrecordedCompleted,
        },
      });

      overallCreated += userCreated;
      overallMissing += userMissing;
      overallDuplicates += userDuplicates;
      overallCompletedWork += userCompletedWork;
      overallRemainingWork += userRemainingWork;
      overallRecordedCompleted += userRecordedCompleted;
      overallUnrecordedCompleted += userUnrecordedCompleted;
      overallRecordedRemaining += userRecordedRemaining;
      overallStateCounts.New += userStateCounts.New;
      overallStateCounts.Active += userStateCounts.Active;
      overallStateCounts.Closed += userStateCounts.Closed;
      overallStateCounts.Resolved += userStateCounts.Resolved;
      overallStateCounts.Other += userStateCounts.Other || 0;
    }

    const expectedCombinations = matrix.reduce((total, row) => total + row.stats.totalWorkingDays, 0);
    const overallCoveragePercent = expectedCombinations > 0
      ? Math.min(100, Math.round((overallCreated / expectedCombinations) * 100))
      : 0;

    return {
      dateRange: {
        startDate,
        endDate,
        totalDays: calendarDates.length,
        workingDays: workingDaysCount,
        todayIso,
        nextThursdayIso,
      },
      summary: {
        totalSelectedUsers: selectedPeople.length,
        totalWorkingDates: workingDaysCount,
        expectedCombinations,
        existingCombinations: overallCreated,
        missingCombinations: overallMissing,
        duplicateCombinations: overallDuplicates,
        overallCoveragePercent,
        stateCounts: overallStateCounts,
        totalCompletedWork: overallRecordedCompleted ? overallCompletedWork : null,
        totalRemainingWork: overallRecordedRemaining ? overallRemainingWork : null,
        recordedCompletedWorkTasks: overallRecordedCompleted,
        unrecordedCompletedWorkTasks: overallUnrecordedCompleted,
      },
      users: selectedPeople.map(p => p.toConfig()),
      dates: calendarDates,
      matrix,
      detailedTasks,
    };
  }
}
