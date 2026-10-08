/**
 * Date calculation engine for rolling creation window:
 * Window: today -> next Thursday (inclusive).
 * Respects weekend rule (skip Saturday/Sunday) and duplicate prevention.
 */

import { formatFullTitle, formatTitleDate } from './parser.js';
import { DateWindowPlan, PlannedTaskDate } from './types.js';

const DAY_NAMES = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
] as const;

/**
 * Returns today's ISO date string (YYYY-MM-DD) in the specified timezone
 */
export function getTodayIso(timezone = 'Asia/Kolkata', now = new Date()): string {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    return formatter.format(now);
  } catch {
    // Fallback if timezone string is invalid
    return now.toISOString().slice(0, 10);
  }
}

/**
 * Adds N days to a YYYY-MM-DD date string
 */
export function addDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  const d = new Date(Date.UTC(year, month - 1, day));
  d.setUTCDate(d.getUTCDate() + days);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/**
 * Gets day of week for YYYY-MM-DD (0=Sunday, 1=Monday, ..., 6=Saturday)
 */
export function getDayOfWeek(isoDate: string): number {
  const [year, month, day] = isoDate.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

/**
 * Calculates "next Thursday" inclusive.
 * - If today is Thursday: stop day is today (0 days ahead).
 * - If today is Friday: 6 days ahead (Thu of next week).
 * - If today is Saturday: 5 days ahead.
 * - If today is Sunday: 4 days ahead.
 * - If today is Monday: 3 days ahead (Thu of same week).
 * - If today is Tuesday: 2 days ahead.
 * - If today is Wednesday: 1 day ahead.
 */
export function getNextThursdayIso(
  todayIso: string,
  thursdayMode: 'CURRENT' | 'FOLLOWING' = 'CURRENT'
): string {
  const dow = getDayOfWeek(todayIso);
  if (dow === 4) {
    return thursdayMode === 'FOLLOWING' ? addDays(todayIso, 7) : todayIso;
  }
  const daysAhead = (4 - dow + 7) % 7;
  return addDays(todayIso, daysAhead);
}

export interface PlanCreationDatesOptions {
  todayIso: string;
  latestExistingTaskIso?: string;
  latestExistingTaskId?: number;
  existingTasksMap?: Map<string, number[]>; // YYYY-MM-DD -> list of Work Item IDs
  titlePrefix?: string;
  thursdayMode?: 'CURRENT' | 'FOLLOWING';
}

/**
 * Plans the tasks to create between today and next Thursday.
 * Evaluates every working date in the window independently and identifies gaps,
 * even if a future-dated task exists beyond the window.
 */
export function planCreationDates(options: PlanCreationDatesOptions): DateWindowPlan {
  const {
    todayIso,
    latestExistingTaskIso,
    latestExistingTaskId,
    existingTasksMap = new Map<string, number[]>(),
    titlePrefix = '3in1_PWA_MyAccount |',
    thursdayMode = 'CURRENT',
  } = options;

  const nextThursdayIso = getNextThursdayIso(todayIso, thursdayMode);

  let warningMessage: string | undefined;
  if (latestExistingTaskIso && latestExistingTaskIso > nextThursdayIso) {
    warningMessage = `Latest existing task date (${latestExistingTaskIso}) is beyond creation window ending on Thursday (${nextThursdayIso}). Inspecting window for any missing dates.`;
  }

  // Effective start date is today: we examine every date from today through next Thursday.
  // Historical dates before today are never backfilled.
  const candidateStartIso = todayIso;
  const plannedDates: PlannedTaskDate[] = [];

  let currentIso = candidateStartIso;
  while (currentIso <= nextThursdayIso) {
    const dow = getDayOfWeek(currentIso);
    const dayName = DAY_NAMES[dow];
    const formattedTitleDate = formatTitleDate(currentIso);
    const fullTitle = formatFullTitle(titlePrefix, currentIso);

    // Rule: Skip Saturday (6) and Sunday (0)
    if (dow === 0 || dow === 6) {
      plannedDates.push({
        isoDate: currentIso,
        formattedTitleDate,
        fullTitle,
        dayOfWeek: dow,
        dayName,
        status: 'WEEKEND_SKIP',
        skipReason: 'Weekend (Saturday/Sunday)',
      });
      currentIso = addDays(currentIso, 1);
      continue;
    }

    // Duplicate check: check if task already exists in Azure DevOps for this person
    const existingIds = existingTasksMap.get(currentIso);
    if (existingIds && existingIds.length > 0) {
      const isMultiple = existingIds.length > 1;
      plannedDates.push({
        isoDate: currentIso,
        formattedTitleDate,
        fullTitle,
        dayOfWeek: dow,
        dayName,
        status: isMultiple ? 'MULTIPLE_EXISTING_TASKS' : 'DUPLICATE_ALREADY_EXISTS',
        existingWorkItemIds: existingIds,
        skipReason: isMultiple
          ? `Multiple existing tasks found (${existingIds.map((id) => `#${id}`).join(', ')})`
          : `Task already exists (#${existingIds[0]})`,
      });
      currentIso = addDays(currentIso, 1);
      continue;
    }

    // Ready to be planned for creation
    plannedDates.push({
      isoDate: currentIso,
      formattedTitleDate,
      fullTitle,
      dayOfWeek: dow,
      dayName,
      status: 'PLANNED',
    });

    currentIso = addDays(currentIso, 1);
  }

  return {
    today: todayIso,
    nextThursday: nextThursdayIso,
    effectiveStartDate: candidateStartIso,
    latestExistingTaskDate: latestExistingTaskIso,
    latestExistingTaskId,
    plannedDates,
    warningMessage,
  };
}
