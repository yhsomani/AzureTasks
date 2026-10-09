/**
 * Date Window Value Object
 * Encapsulates the logic for planning task creation dates
 * Pure functions - no external dependencies
 */

export interface PlannedDate {
  isoDate: string;
  formattedTitleDate: string;
  fullTitle: string;
  status: 'PLANNED' | 'WEEKEND_SKIP' | 'DUPLICATE' | 'DUPLICATE_ALREADY_EXISTS' | 'MULTIPLE_EXISTING_TASKS' | 'FUTURE_TASK_WARN' | 'NO_TASKS_NEEDED' | 'CREATED' | 'FAILED';
  skipReason?: string;
  createdWorkItemId?: number;
  relationCopyStatus?: 'SUCCESS' | 'PARTIAL' | 'FAILED';
  errorMessage?: string;
}

export interface DatePlan {
  plannedDates: PlannedDate[];
  effectiveStartDate: string;
  nextThursday: string;
  warningMessage?: string;
}

export interface DatePlanInput {
  todayIso: string;
  latestExistingTaskIso: string;
  latestExistingTaskId: number;
  existingTasksMap: Map<string, { id: number; title: string; isoDate: string; count?: number }>;
  titlePrefix: string;
  thursdayMode: 'CURRENT' | 'FOLLOWING';
  skipWeekends: boolean;
  stopDayOfWeek: number;
}

/**
 * Get today's date in ISO format for a given timezone
 */
export function getTodayIso(timezone: string): string {
  const now = new Date();
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = formatter.formatToParts(now);
  const year = parts.find(p => p.type === 'year')?.value;
  const month = parts.find(p => p.type === 'month')?.value;
  const day = parts.find(p => p.type === 'day')?.value;
  return `${year}-${month}-${day}`;
}

/**
 * Get day of week (0 = Sunday, 6 = Saturday), UTC-safe
 */
export function getDayOfWeek(isoDate: string): number {
  return new Date(isoDate + 'T00:00:00Z').getUTCDay();
}

/**
 * Add days to an ISO date, UTC-safe
 */
export function addDays(isoDate: string, days: number): string {
  const date = new Date(isoDate + 'T00:00:00Z');
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().split('T')[0];
}

/**
 * Get the next stop day (default: Thursday) from a given date, UTC-safe.
 * `stopDayOfWeek` is 0=Sun … 6=Sat and lets callers honour a configured
 * window end other than Thursday.
 */
export function getNextThursdayIso(
  fromIso: string,
  mode: 'CURRENT' | 'FOLLOWING',
  stopDayOfWeek: number = 4
): string {
  const target = ((Math.trunc(stopDayOfWeek) % 7) + 7) % 7;
  const day = getDayOfWeek(fromIso);
  let daysUntilStopDay = (target - day + 7) % 7;
  if (mode === 'FOLLOWING' && day === target) daysUntilStopDay = 7; // already the stop day -> next week
  return addDays(fromIso, daysUntilStopDay);
}

/**
 * Format date for display in task title (e.g., "Jan 15"), UTC-safe
 */
export function formatTitleDate(isoDate: string): string {
  const date = new Date(isoDate + 'T00:00:00Z');
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

/**
 * Convert a wall-clock date+time in an IANA timezone to a UTC ISO timestamp.
 * Azure DevOps stores StartDate as an instant; we want 09:30 local wall time.
 */
export function zonedTimeToUtcIso(isoDate: string, hhmm: string, timeZone: string): string {
  const [hh, mm] = hhmm.split(':').map(Number);
  const [y, mo, d] = isoDate.split('-').map(Number);
  const utcGuess = Date.UTC(y, mo - 1, d, hh, mm, 0, 0);

  // What wall-clock time does that UTC instant show in the target zone?
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const parts = dtf.formatToParts(new Date(utcGuess));
  const get = (t: string) => Number(parts.find(p => p.type === t)?.value ?? 0);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));

  // offset = how far the zone is ahead of UTC at this instant
  const offset = asUtc - utcGuess;
  return new Date(utcGuess - offset).toISOString();
}

/**
 * Plan creation dates for a person
 * Core business logic - pure function, no side effects
 */
export function planCreationDates(input: DatePlanInput): DatePlan {
  const { todayIso, latestExistingTaskIso, latestExistingTaskId, existingTasksMap, titlePrefix, thursdayMode, skipWeekends, stopDayOfWeek } = input;

  const nextThursdayIso = getNextThursdayIso(todayIso, thursdayMode, stopDayOfWeek);
  const plannedDates: PlannedDate[] = [];

  // If latest existing task is beyond the window, warn
  if (latestExistingTaskIso > nextThursdayIso) {
    return {
      plannedDates: [],
      effectiveStartDate: todayIso,
      nextThursday: nextThursdayIso,
      warningMessage: `Latest task date (${latestExistingTaskIso}) is ahead of creation window ending on Thursday (${nextThursdayIso}).`,
    };
  }

  // Start from the day after the latest existing task, or today if no tasks exist
  let currentIso = latestExistingTaskIso ? addDays(latestExistingTaskIso, 1) : todayIso;
  
  // Don't go before today
  if (currentIso < todayIso) {
    currentIso = todayIso;
  }

  // Plan dates up to and including nextThursday
  while (currentIso <= nextThursdayIso) {
    const dayOfWeek = getDayOfWeek(currentIso);
    const isWeekend = (dayOfWeek === 0 || dayOfWeek === 6) && skipWeekends;

    if (isWeekend) {
      plannedDates.push({
        isoDate: currentIso,
        formattedTitleDate: formatTitleDate(currentIso),
        fullTitle: '',
        status: 'WEEKEND_SKIP',
        skipReason: 'Weekend',
      });
    } else {
      const existing = existingTasksMap.get(currentIso);
      if (existing) {
        const multiple = (existing.count ?? 1) > 1;
        plannedDates.push({
          isoDate: currentIso,
          formattedTitleDate: formatTitleDate(currentIso),
          fullTitle: `${titlePrefix} ${formatTitleDate(currentIso)}`,
          status: multiple ? 'MULTIPLE_EXISTING_TASKS' : 'DUPLICATE_ALREADY_EXISTS',
          skipReason: multiple
            ? `${existing.count} tasks already exist for this date`
            : `Task already exists (#${existing.id})`,
        });
      } else {
        plannedDates.push({
          isoDate: currentIso,
          formattedTitleDate: formatTitleDate(currentIso),
          fullTitle: `${titlePrefix} ${formatTitleDate(currentIso)}`,
          status: 'PLANNED',
        });
      }
    }

    currentIso = addDays(currentIso, 1);
  }

  const toCreate = plannedDates.filter(p => p.status === 'PLANNED');
  
  if (toCreate.length === 0) {
    return {
      plannedDates,
      effectiveStartDate: todayIso,
      nextThursday: nextThursdayIso,
      warningMessage: `All working dates up to date (latest task: ${latestExistingTaskIso}).`,
    };
  }

  return {
    plannedDates,
    effectiveStartDate: toCreate[0].isoDate,
    nextThursday: nextThursdayIso,
  };
}

/**
 * Validate that a date is not in the past
 */
export function validateNotPastDate(requestedIso: string, actualTodayIso: string): void {
  if (requestedIso < actualTodayIso) {
    throw new Error(
      `Validation Error: The requested task creation date (${requestedIso}) is in the past. ` +
      `Tasks must only be created for the current date (${actualTodayIso}) or future dates.`
    );
  }
}