/**
 * Intelligent Date-Range Task Explorer & Multi-User Task Tracking Service.
 *
 * Strictly queries and displays tasks of people configured in Team Management (people.json).
 * Computes coverage matrix, date-wise/user-wise stats, and enforces creation window boundaries.
 */

import { AzureDevOpsClient } from '../azure/client.js';
import { WorkItem } from '../azure/types.js';
import { WiqlService } from '../azure/wiql-service.js';
import { WorkItemService } from '../azure/work-item-service.js';
import { AppConfig, PersonConfig } from '../config/config.js';
import { addDays, getDayOfWeek, getNextThursdayIso, getTodayIso } from '../date/date-engine.js';
import { formatTitleDate, parseDateFromTitle } from '../date/parser.js';
import { matchesPerson } from '../people/person-service.js';
import { logger } from '../utils/logger.js';

export type CellStatus = 'CREATED' | 'MISSING' | 'DUPLICATE' | 'NOT_APPLICABLE' | 'UNAVAILABLE';

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
    totalCompletedWork: number;
    totalRemainingWork: number;
  };
}

export interface DateSummary {
  dateIso: string;
  formattedDate: string;
  dayOfWeek: string;
  isWeekend: boolean;
  expectedUsers: number;
  createdUsers: number;
  missingUsers: number;
  duplicateUsers: number;
  coveragePercent: number;
  createdList: { person: PersonConfig; task: ExplorerTaskSummary }[];
  missingList: { person: PersonConfig; isEligible: boolean }[];
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
}

export interface ExplorerOptions {
  startDate: string;
  endDate: string;
  selectedUsers?: string[];
  stateFilter?: string;
  statusFilter?: string;
  asOf?: string;
}

export interface ExplorerResult {
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
  };
  users: PersonConfig[];
  dates: {
    dateIso: string;
    formattedDate: string;
    dayOfWeek: string;
    isWeekend: boolean;
  }[];
  matrix: UserMatrixRow[];
  dateSummaries: Record<string, DateSummary>;
  detailedTasks: DetailedTaskItem[];
  warnings?: string[];
}

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export class TaskExplorerService {
  constructor(
    private readonly client: AzureDevOpsClient,
    private readonly config: AppConfig
  ) {}

  /**
   * Generates date presets based on reference date in configured timezone
   */
  public static getPresetDateRange(
    preset: string,
    timezone = 'Asia/Kolkata',
    referenceDate?: string
  ): { startDate: string; endDate: string } {
    const today = referenceDate || getTodayIso(timezone);
    const [y, m, d] = today.split('-').map(Number);
    const dateObj = new Date(Date.UTC(y, m - 1, d));
    const dayOfWeek = dateObj.getUTCDay(); // 0=Sun, 1=Mon, ..., 6=Sat

    switch (preset) {
      case 'today':
        return { startDate: today, endDate: today };

      case 'yesterday': {
        const yest = addDays(today, -1);
        return { startDate: yest, endDate: yest };
      }

      case 'this_week': {
        // Monday to Friday of current week
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
        const nextThursday = getNextThursdayIso(today, 'CURRENT');
        return { startDate: today, endDate: nextThursday };
      }
    }
  }

  /**
   * Explores task coverage across an arbitrary date range for configured team members
   */
  public async exploreDateRange(options: ExplorerOptions): Promise<ExplorerResult> {
    const timezone = this.config.timezone || 'Asia/Kolkata';
    const todayIso = options.asOf || getTodayIso(timezone);
    const nextThursdayIso = getNextThursdayIso(todayIso, this.config.thursdayMode || 'CURRENT');

    // 1. Validate date range
    if (!/^\d{4}-\d{2}-\d{2}$/.test(options.startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(options.endDate)) {
      throw new Error(`Invalid date format. Expected YYYY-MM-DD for startDate and endDate.`);
    }

    if (options.startDate > options.endDate) {
      throw new Error(`Start date (${options.startDate}) cannot be after end date (${options.endDate}).`);
    }

    // 2. Generate calendar date list
    const calendarDates: { dateIso: string; formattedDate: string; dayOfWeek: string; isWeekend: boolean }[] = [];
    let cur = options.startDate;
    let daysCount = 0;
    const MAX_DAYS = 120;

    while (cur <= options.endDate) {
      daysCount++;
      if (daysCount > MAX_DAYS) {
        throw new Error(`Requested date range exceeds maximum allowed limit of ${MAX_DAYS} days.`);
      }
      const dow = getDayOfWeek(cur);
      const isWeekend = dow === 0 || dow === 6;
      calendarDates.push({
        dateIso: cur,
        formattedDate: formatTitleDate(cur),
        dayOfWeek: DAY_NAMES[dow],
        isWeekend,
      });
      cur = addDays(cur, 1);
    }

    const workingDaysCount = calendarDates.filter((d) => !d.isWeekend).length;

    // 3. Filter configured people (STRICT TEAM MANAGEMENT RULE)
    const allConfiguredPeople = (this.config.people || []).filter((p) => p.enabled !== false);
    if (allConfiguredPeople.length === 0) {
      throw new Error(`No enabled team members found in Team Management (people.json).`);
    }

    let selectedPeople = allConfiguredPeople;
    if (options.selectedUsers && options.selectedUsers.length > 0) {
      const lowerKeys = new Set(options.selectedUsers.map((u) => u.trim().toLowerCase()));
      selectedPeople = allConfiguredPeople.filter(
        (p) =>
          (p.key && lowerKeys.has(p.key.toLowerCase())) ||
          lowerKeys.has(p.assignedTo.toLowerCase()) ||
          lowerKeys.has(p.name.toLowerCase())
      );
      if (selectedPeople.length === 0) {
        selectedPeople = allConfiguredPeople; // Fallback if filter didn't match
      }
    }

    // 4. Query candidate work items from Azure DevOps
    const wiqlService = new WiqlService(this.client);
    const workItemService = new WorkItemService(this.client);

    const candidateIds = await wiqlService.findCandidateSourceTasks(
      this.config.project,
      this.config.workItemType,
      this.config.titlePrefix
    );

    let allProjectWorkItems: WorkItem[] = [];
    if (candidateIds.length > 0) {
      allProjectWorkItems = await workItemService.getWorkItemsBatch(candidateIds, 'all');
    }

    // STRICT FILTER: Only keep work items assigned to one of the configured team members in people.json
    const teamWorkItems = allProjectWorkItems.filter((item) => {
      const assignedToVal = item.fields['System.AssignedTo'];
      return allConfiguredPeople.some((p) => matchesPerson(assignedToVal, p));
    });

    // 5. Index work items by Person Key -> Date ISO -> Array of work items
    const personTaskIndex = new Map<string, Map<string, WorkItem[]>>();
    for (const p of allConfiguredPeople) {
      personTaskIndex.set(p.assignedTo.toLowerCase().trim(), new Map());
    }

    for (const item of teamWorkItems) {
      const assignedToVal = item.fields['System.AssignedTo'];
      const title = String(item.fields['System.Title'] || '');
      const createdDate = item.fields['System.CreatedDate'] as string | undefined;
      const parsed = parseDateFromTitle(title, createdDate);

      if (!parsed) continue;

      for (const p of allConfiguredPeople) {
        if (matchesPerson(assignedToVal, p)) {
          const pKey = p.assignedTo.toLowerCase().trim();
          let dateMap = personTaskIndex.get(pKey);
          if (!dateMap) {
            dateMap = new Map();
            personTaskIndex.set(pKey, dateMap);
          }
          const list = dateMap.get(parsed.isoDate) || [];
          list.push(item);
          dateMap.set(parsed.isoDate, list);
        }
      }
    }

    // 6. Build Matrix Rows, Date Summaries, and Detailed Task Items
    const matrixRows: UserMatrixRow[] = [];
    const dateSummaries: Record<string, DateSummary> = {};
    const detailedTasks: DetailedTaskItem[] = [];

    // Initialize date summaries
    for (const d of calendarDates) {
      dateSummaries[d.dateIso] = {
        dateIso: d.dateIso,
        formattedDate: d.formattedDate,
        dayOfWeek: d.dayOfWeek,
        isWeekend: d.isWeekend,
        expectedUsers: d.isWeekend ? 0 : selectedPeople.length,
        createdUsers: 0,
        missingUsers: 0,
        duplicateUsers: 0,
        coveragePercent: 0,
        createdList: [],
        missingList: [],
      };
    }

    const stateCounts: Record<string, number> = {
      New: 0,
      Active: 0,
      Closed: 0,
      Resolved: 0,
      Other: 0,
    };

    let totalExpectedCombinations = 0;
    let totalExistingCombinations = 0;
    let totalMissingCombinations = 0;
    let totalDuplicateCombinations = 0;

    for (const person of selectedPeople) {
      const pKey = person.assignedTo.toLowerCase().trim();
      const userDateMap = personTaskIndex.get(pKey) || new Map();
      const cells: Record<string, MatrixCell> = {};

      let userCreatedCount = 0;
      let userMissingCount = 0;
      let userDuplicateCount = 0;
      let userWorkingDays = 0;
      let userTotalCompletedWork = 0;
      let userTotalRemainingWork = 0;
      const userStateCounts: Record<string, number> = {};

      for (const d of calendarDates) {
        const matchingItems: WorkItem[] = userDateMap.get(d.dateIso) || [];
        const isEligible = !d.isWeekend && d.dateIso >= todayIso && d.dateIso <= nextThursdayIso;

        let status: CellStatus = 'MISSING';
        if (d.isWeekend) {
          status = 'NOT_APPLICABLE';
        } else if (matchingItems.length === 1) {
          status = 'CREATED';
        } else if (matchingItems.length > 1) {
          status = 'DUPLICATE';
        }

        const taskSummaries: ExplorerTaskSummary[] = matchingItems.map((item: WorkItem) => {
          const state = String(item.fields['System.State'] || 'New');
          if (['New', 'Active', 'Closed', 'Resolved'].includes(state)) {
            stateCounts[state] = (stateCounts[state] || 0) + 1;
            userStateCounts[state] = (userStateCounts[state] || 0) + 1;
          } else {
            stateCounts.Other = (stateCounts.Other || 0) + 1;
            userStateCounts[state] = (userStateCounts[state] || 0) + 1;
          }

          const baseDevUrl = this.config.baseUrl.replace(/\/+$/, '');
          const workItemUrl = `${baseDevUrl}/${encodeURIComponent(this.config.organization)}/${encodeURIComponent(
            this.config.project
          )}/_workitems/edit/${item.id}`;

          const completed = Number(item.fields['Microsoft.VSTS.Scheduling.CompletedWork'] || 0);
          const remaining = Number(item.fields['Microsoft.VSTS.Scheduling.RemainingWork'] || 0);
          userTotalCompletedWork += completed;
          userTotalRemainingWork += remaining;

          return {
            id: item.id,
            title: String(item.fields['System.Title'] || ''),
            state,
            createdDate: item.fields['System.CreatedDate'] as string | undefined,
            changedDate: item.fields['System.ChangedDate'] as string | undefined,
            assignedTo: person.name,
            url: workItemUrl,
            completedWork: completed,
            remainingWork: remaining,
            originalEstimate: Number(item.fields['Microsoft.VSTS.Scheduling.OriginalEstimate'] || 0),
          };
        });

        const primaryTask = taskSummaries[0];

        const cell: MatrixCell = {
          dateIso: d.dateIso,
          formattedDate: d.formattedDate,
          dayOfWeek: d.dayOfWeek,
          isWeekend: d.isWeekend,
          status,
          isEligibleForCreation: isEligible,
          tasks: taskSummaries,
          primaryTask,
        };

        cells[d.dateIso] = cell;

        // Update aggregations
        if (!d.isWeekend) {
          userWorkingDays++;
          totalExpectedCombinations++;

          if (status === 'CREATED') {
            userCreatedCount++;
            totalExistingCombinations++;
            dateSummaries[d.dateIso].createdUsers++;
            if (primaryTask) {
              dateSummaries[d.dateIso].createdList.push({ person, task: primaryTask });
            }
          } else if (status === 'DUPLICATE') {
            userDuplicateCount++;
            userCreatedCount++;
            totalExistingCombinations++;
            totalDuplicateCombinations++;
            dateSummaries[d.dateIso].duplicateUsers++;
            dateSummaries[d.dateIso].createdUsers++;
            if (primaryTask) {
              dateSummaries[d.dateIso].createdList.push({ person, task: primaryTask });
            }
          } else {
            userMissingCount++;
            totalMissingCombinations++;
            dateSummaries[d.dateIso].missingUsers++;
            dateSummaries[d.dateIso].missingList.push({ person, isEligible });
          }
        }

        // Add to DetailedTaskItem list (for View B)
        if (status === 'CREATED' || status === 'DUPLICATE') {
          for (const task of taskSummaries) {
            detailedTasks.push({
              dateIso: d.dateIso,
              formattedDate: d.formattedDate,
              dayOfWeek: d.dayOfWeek,
              isWeekend: d.isWeekend,
              person,
              taskId: task.id,
              title: task.title,
              state: task.state,
              createdDate: task.createdDate,
              changedDate: task.changedDate,
              status,
              isEligibleForCreation: isEligible,
              url: task.url,
            });
          }
        } else if (!d.isWeekend) {
          detailedTasks.push({
            dateIso: d.dateIso,
            formattedDate: d.formattedDate,
            dayOfWeek: d.dayOfWeek,
            isWeekend: d.isWeekend,
            person,
            status: 'MISSING',
            isEligibleForCreation: isEligible,
          });
        }
      }

      const userCoveragePercent =
        userWorkingDays > 0 ? Math.round((userCreatedCount / userWorkingDays) * 100) : 100;

      matrixRows.push({
        person,
        cells,
        stats: {
          totalWorkingDays: userWorkingDays,
          createdCount: userCreatedCount,
          missingCount: userMissingCount,
          duplicateCount: userDuplicateCount,
          coveragePercent: userCoveragePercent,
          stateCounts: userStateCounts,
          totalCompletedWork: userTotalCompletedWork,
          totalRemainingWork: userTotalRemainingWork,
        },
      });
    }

    // Compute date summaries coverage percent
    for (const d of calendarDates) {
      const ds = dateSummaries[d.dateIso];
      if (ds.expectedUsers > 0) {
        ds.coveragePercent = Math.round((ds.createdUsers / ds.expectedUsers) * 100);
      } else {
        ds.coveragePercent = 100;
      }
    }

    const overallCoveragePercent =
      totalExpectedCombinations > 0
        ? Math.round((totalExistingCombinations / totalExpectedCombinations) * 100)
        : 100;

    return {
      dateRange: {
        startDate: options.startDate,
        endDate: options.endDate,
        totalDays: calendarDates.length,
        workingDays: workingDaysCount,
        todayIso,
        nextThursdayIso,
      },
      summary: {
        totalSelectedUsers: selectedPeople.length,
        totalWorkingDates: workingDaysCount,
        expectedCombinations: totalExpectedCombinations,
        existingCombinations: totalExistingCombinations,
        missingCombinations: totalMissingCombinations,
        duplicateCombinations: totalDuplicateCombinations,
        overallCoveragePercent,
        stateCounts: {
          New: stateCounts.New || 0,
          Active: stateCounts.Active || 0,
          Closed: stateCounts.Closed || 0,
          Resolved: stateCounts.Resolved || 0,
          Other: stateCounts.Other || 0,
        },
      },
      users: selectedPeople,
      dates: calendarDates,
      matrix: matrixRows,
      dateSummaries,
      detailedTasks,
    };
  }
}
