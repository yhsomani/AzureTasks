import { describe, it, expect } from 'vitest';
import {
  getTodayIso,
  getDayOfWeek,
  addDays,
  getNextThursdayIso,
  formatTitleDate,
  planCreationDates,
  validateNotPastDate,
} from '../../src/domain/value-objects/date-window';

describe('date-window: basic date helpers', () => {
  it('adds days across month and year boundaries', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('returns day of week (0=Sun, 4=Thu, 6=Sat)', () => {
    expect(getDayOfWeek('2026-10-11')).toBe(0); // Sunday
    expect(getDayOfWeek('2026-10-08')).toBe(4); // Thursday
    expect(getDayOfWeek('2026-10-10')).toBe(6); // Saturday
  });

  it('formats a title date as MMM D', () => {
    expect(formatTitleDate('2026-01-15')).toBe('Jan 15');
    expect(formatTitleDate('2026-12-01')).toBe('Dec 1');
  });

  it('produces an ISO date for a given timezone', () => {
    const iso = getTodayIso('Asia/Kolkata');
    expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('date-window: getNextThursdayIso', () => {
  it('from Monday returns that week Thursday', () => {
    // 2026-10-05 is Monday, Thursday is 2026-10-08
    expect(getNextThursdayIso('2026-10-05', 'CURRENT')).toBe('2026-10-08');
  });

  it('CURRENT mode ends today when today is Thursday', () => {
    // 2026-10-08 is Thursday
    expect(getNextThursdayIso('2026-10-08', 'CURRENT')).toBe('2026-10-08');
  });

  it('FOLLOWING mode advances a full week on Thursday', () => {
    expect(getNextThursdayIso('2026-10-08', 'FOLLOWING')).toBe('2026-10-15');
  });

  it('from Friday returns the following Thursday', () => {
    // 2026-10-09 is Friday -> 2026-10-15
    expect(getNextThursdayIso('2026-10-09', 'CURRENT')).toBe('2026-10-15');
  });

  it('honors a configured stop day other than Thursday', () => {
    // 2026-10-05 is Monday; stop on Monday
    expect(getNextThursdayIso('2026-10-05', 'CURRENT', 1)).toBe('2026-10-05');
    // Tuesday 2026-10-06 -> next Monday 2026-10-12
    expect(getNextThursdayIso('2026-10-06', 'CURRENT', 1)).toBe('2026-10-12');
    // On the stop day, FOLLOWING advances a full week
    expect(getNextThursdayIso('2026-10-05', 'FOLLOWING', 1)).toBe('2026-10-12');
  });
});

describe('date-window: validateNotPastDate', () => {
  it('allows today and future', () => {
    expect(() => validateNotPastDate('2026-10-09', '2026-10-09')).not.toThrow();
    expect(() => validateNotPastDate('2026-10-10', '2026-10-09')).not.toThrow();
  });

  it('rejects past dates', () => {
    expect(() => validateNotPastDate('2026-10-08', '2026-10-09')).toThrow(/past/i);
  });
});

describe('date-window: planCreationDates', () => {
  const base = {
    titlePrefix: '3in1_PWA_MyAccount |',
    thursdayMode: 'CURRENT' as const,
    skipWeekends: true,
    stopDayOfWeek: 4,
  };

  it('plans working days from today through Thursday, skipping weekends', () => {
    // Monday 2026-10-05 -> Thu 2026-10-08
    const plan = planCreationDates({
      ...base,
      todayIso: '2026-10-05',
      latestExistingTaskIso: '',
      latestExistingTaskId: 0,
      existingTasksMap: new Map(),
    });

    const planned = plan.plannedDates.filter(d => d.status === 'PLANNED');
    expect(planned.map(d => d.isoDate)).toEqual(['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08']);
    expect(plan.nextThursday).toBe('2026-10-08');
  });

  it('marks weekends as WEEKEND_SKIP', () => {
    // Friday 2026-10-09 -> Thu 2026-10-15, weekend 10-10/10-11
    const plan = planCreationDates({
      ...base,
      todayIso: '2026-10-09',
      latestExistingTaskIso: '',
      latestExistingTaskId: 0,
      existingTasksMap: new Map(),
    });

    const weekends = plan.plannedDates.filter(d => d.status === 'WEEKEND_SKIP').map(d => d.isoDate);
    expect(weekends).toEqual(['2026-10-10', '2026-10-11']);
    const planned = plan.plannedDates.filter(d => d.status === 'PLANNED').map(d => d.isoDate);
    expect(planned).toEqual(['2026-10-09', '2026-10-12', '2026-10-13', '2026-10-14', '2026-10-15']);
  });

  it('resumes after the latest task and skips any other existing dates', () => {
    // Latest task exists today (Oct 5); another task already exists on Oct 7.
    const existing = new Map([
      ['2026-10-07', { id: 1, title: 'x', isoDate: '2026-10-07' }],
    ]);
    const plan = planCreationDates({
      ...base,
      todayIso: '2026-10-05',
      latestExistingTaskIso: '2026-10-05',
      latestExistingTaskId: 1,
      existingTasksMap: existing,
    });

    const dupes = plan.plannedDates.filter(d => d.status === 'DUPLICATE_ALREADY_EXISTS').map(d => d.isoDate);
    expect(dupes).toEqual(['2026-10-07']);
    const planned = plan.plannedDates.filter(d => d.status === 'PLANNED').map(d => d.isoDate);
    expect(planned).toEqual(['2026-10-06', '2026-10-08']);
  });

  it('marks dates with more than one existing task as MULTIPLE_EXISTING_TASKS', () => {
    const existing = new Map([
      ['2026-10-07', { id: 1, title: 'a', isoDate: '2026-10-07', count: 2 }],
    ]);
    const plan = planCreationDates({
      ...base,
      todayIso: '2026-10-05',
      latestExistingTaskIso: '2026-10-05',
      latestExistingTaskId: 1,
      existingTasksMap: existing,
    });

    const entry = plan.plannedDates.find(d => d.isoDate === '2026-10-07');
    expect(entry?.status).toBe('MULTIPLE_EXISTING_TASKS');
    expect(entry?.skipReason).toMatch(/2 tasks/);
  });

  it('warns when latest task is beyond the window', () => {
    const plan = planCreationDates({
      ...base,
      todayIso: '2026-10-05',
      latestExistingTaskIso: '2026-11-01',
      latestExistingTaskId: 99,
      existingTasksMap: new Map(),
    });
    expect(plan.plannedDates).toHaveLength(0);
    expect(plan.warningMessage).toMatch(/ahead of creation window/);
  });

  it('reports no work when all dates exist', () => {
    const existing = new Map([
      ['2026-10-07', { id: 1, title: 'a', isoDate: '2026-10-07' }],
      ['2026-10-08', { id: 2, title: 'b', isoDate: '2026-10-08' }],
    ]);
    const plan = planCreationDates({
      ...base,
      todayIso: '2026-10-05',
      latestExistingTaskIso: '2026-10-08',
      latestExistingTaskId: 2,
      existingTasksMap: existing,
    });
    const planned = plan.plannedDates.filter(d => d.status === 'PLANNED');
    expect(planned).toHaveLength(0);
  });

  it('ends the window on the configured stop day, not always Thursday', () => {
    // Monday 2026-10-05, stop on Wednesday (3) -> window ends 2026-10-07
    const plan = planCreationDates({
      ...base,
      stopDayOfWeek: 3,
      todayIso: '2026-10-05',
      latestExistingTaskIso: '',
      latestExistingTaskId: 0,
      existingTasksMap: new Map(),
    });
    expect(plan.nextThursday).toBe('2026-10-07');
    expect(plan.plannedDates.filter(d => d.status === 'PLANNED').map(d => d.isoDate))
      .toEqual(['2026-10-05', '2026-10-06', '2026-10-07']);
  });
});
