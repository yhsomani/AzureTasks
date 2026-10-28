export interface CalendarException {
  id: string;
  label: string;
  kind: 'holiday' | 'leave';
  startDate: string;
  endDate: string;
  memberKeys: string[];
  availableHours: number;
}

export interface WorkCalendar {
  version: number;
  defaultHours: number;
  memberHours: Record<string, number>;
  exceptions: CalendarException[];
}

export interface WorkdayEligibility {
  eligible: boolean;
  plannedHours: number;
  reason?: string;
}

export function validCalendarDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validHours(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 24 &&
    Math.abs(value * 100 - Math.round(value * 100)) < 0.000001;
}

export function validateWorkCalendar(value: unknown, memberKeys: string[]): WorkCalendar {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Calendar must be an object.');
  const calendar = value as WorkCalendar;
  if (!Number.isSafeInteger(calendar.version) || calendar.version < 0) throw new Error('Calendar version must be a non-negative integer.');
  if (!validHours(calendar.defaultHours)) throw new Error('Planned hours must be 0-24 with up to two decimals.');
  if (!calendar.memberHours || typeof calendar.memberHours !== 'object' || Array.isArray(calendar.memberHours)) throw new Error('Member hours must be an object.');
  const known = new Set(memberKeys);
  const memberHours: Record<string, number> = {};
  for (const [key, hours] of Object.entries(calendar.memberHours)) {
    if (!known.has(key) || !validHours(hours)) throw new Error('Member hours require known member keys and valid planned hours.');
    memberHours[key] = hours;
  }
  if (!Array.isArray(calendar.exceptions) || calendar.exceptions.length > 1000) throw new Error('Calendar supports at most 1000 exceptions.');
  const ids = new Set<string>();
  const exceptions = calendar.exceptions.map(exception => {
    if (!exception || typeof exception.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(exception.id) || ids.has(exception.id)) throw new Error('Exception IDs must be unique letters, numbers, underscores or hyphens.');
    ids.add(exception.id);
    if (typeof exception.label !== 'string' || !exception.label.trim() || exception.label.length > 120) throw new Error('Exception label must contain 1-120 characters.');
    if (!['holiday', 'leave'].includes(exception.kind)) throw new Error('Exception kind must be holiday or leave.');
    if (!validCalendarDate(exception.startDate) || !validCalendarDate(exception.endDate) || exception.startDate > exception.endDate) throw new Error('Exception dates must be valid and ordered.');
    if (!Array.isArray(exception.memberKeys) || exception.memberKeys.some(key => typeof key !== 'string' || !known.has(key)) || new Set(exception.memberKeys).size !== exception.memberKeys.length) throw new Error('Exception members must be unique known member keys.');
    if (exception.kind === 'leave' && exception.memberKeys.length === 0) throw new Error('Leave requires an explicit member selection.');
    if (!validHours(exception.availableHours)) throw new Error('Available hours must be 0-24 with up to two decimals.');
    if (exception.kind === 'holiday' && exception.availableHours !== 0) throw new Error('Holiday availability must be zero.');
    for (const key of exception.memberKeys) {
      if (exception.availableHours > (memberHours[key] ?? calendar.defaultHours)) throw new Error('Available hours cannot exceed the member planned hours.');
    }
    return {
      id: exception.id, label: exception.label.trim(), kind: exception.kind,
      startDate: exception.startDate, endDate: exception.endDate,
      memberKeys: [...exception.memberKeys], availableHours: exception.availableHours,
    };
  });
  return { version: calendar.version, defaultHours: calendar.defaultHours, memberHours, exceptions };
}

export function workdayEligibility(
  memberKey: string,
  workDate: string,
  skipWeekends: boolean,
  calendar?: WorkCalendar
): WorkdayEligibility {
  if (!validCalendarDate(workDate)) throw new Error('Workdate must be a valid YYYY-MM-DD date.');
  const weekday = new Date(`${workDate}T00:00:00Z`).getUTCDay();
  if (skipWeekends && [0, 6].includes(weekday)) return { eligible: false, plannedHours: 0, reason: 'Weekend' };
  let plannedHours = calendar?.memberHours[memberKey] ?? calendar?.defaultHours ?? 8;
  let reason: string | undefined;
  for (const exception of calendar?.exceptions ?? []) {
    if (workDate < exception.startDate || workDate > exception.endDate) continue;
    if (exception.memberKeys.length && !exception.memberKeys.includes(memberKey)) continue;
    if (exception.availableHours <= plannedHours) {
      plannedHours = exception.availableHours;
      reason = exception.label;
    }
  }
  return { eligible: plannedHours > 0, plannedHours, reason: reason || (plannedHours === 0 ? 'No planned availability' : undefined) };
}