import { describe, it, expect } from 'vitest';
import {
  getTodayIso,
  getDayOfWeek,
  addDays,
  getNextThursdayIso,
  formatTitleDate,
  planCreationDates,
  validateNotPastDate,
  computeTaskCloseTimestamp,
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

  it('FOLLOWING mode advances 7 days on Friday', () => {
    // 2026-10-09 is Friday. In FOLLOWING mode, it advances 7 days -> 2026-10-16
    expect(getNextThursdayIso('2026-10-09', 'FOLLOWING')).toBe('2026-10-16');
  });

  it('from Friday returns the following Thursday in CURRENT mode', () => {
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

  it('rejects impossible and noncanonical ISO dates', () => {
    expect(() => validateNotPastDate('2026-02-30', '2026-01-01')).toThrow(/YYYY-MM-DD/);
    expect(() => validateNotPastDate('2026-99-01', '2026-01-01')).toThrow(/YYYY-MM-DD/);
    expect(() => validateNotPastDate('tomorrow', '2026-01-01')).toThrow(/YYYY-MM-DD/);
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

  it('fills gaps while skipping all existing dates including the latest source', () => {
    // Latest task exists today (Oct 5); another task already exists on Oct 7.
    const existing = new Map([
      ['2026-10-05', { id: 2, title: 'latest source', isoDate: '2026-10-05' }],
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
    expect(dupes).toEqual(['2026-10-05', '2026-10-07']);
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

  it('does not lose missing dates when source task is beyond the window', () => {
    const plan = planCreationDates({
      ...base,
      todayIso: '2026-10-05',
      latestExistingTaskIso: '2026-11-01',
      latestExistingTaskId: 99,
      existingTasksMap: new Map(),
    });
    expect(plan.plannedDates.filter(d => d.status === 'PLANNED').map(d => d.isoDate))
      .toEqual(['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08']);
  });

  it('reports no work when all dates exist', () => {
    const existing = new Map([
      ['2026-10-05', { id: 3, title: 'a', isoDate: '2026-10-05' }],
      ['2026-10-06', { id: 4, title: 'b', isoDate: '2026-10-06' }],
      ['2026-10-07', { id: 1, title: 'c', isoDate: '2026-10-07' }],
      ['2026-10-08', { id: 2, title: 'd', isoDate: '2026-10-08' }],
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

describe('date-window: computeTaskCloseTimestamp', () => {
  it('generates a timestamp between 18:15 and 18:45 for a past date', () => {
    // Current time is 2026-10-16 21:00:00 IST
    const now = new Date('2026-10-16T15:30:00.000Z'); // 21:00 IST
    const targetDate = '2026-10-15';
    const tz = 'Asia/Kolkata';

    for (let i = 0; i < 20; i++) {
      const ts = computeTaskCloseTimestamp(targetDate, tz, '18:15', '18:45', now);
      const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: tz,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }).format(new Date(ts)).split(':').map(Number);

      const sec = parts[0] * 3600 + parts[1] * 60 + parts[2];
      expect(sec).toBeGreaterThanOrEqual(18 * 3600 + 15 * 60);
      expect(sec).toBeLessThanOrEqual(18 * 3600 + 45 * 60);
      expect(new Date(ts).getTime()).toBeLessThanOrEqual(now.getTime());
    }
  });

  it('generates a timestamp between 18:15 and 18:45 when closing today after 18:45', () => {
    // Current time is 2026-10-16 20:30:00 IST (15:00 UTC)
    const now = new Date('2026-10-16T15:00:00.000Z');
    const targetDate = '2026-10-16';
    const tz = 'Asia/Kolkata';

    for (let i = 0; i < 20; i++) {
      const ts = computeTaskCloseTimestamp(targetDate, tz, '18:15', '18:45', now);
      const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: tz,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }).format(new Date(ts)).split(':').map(Number);

      const sec = parts[0] * 3600 + parts[1] * 60 + parts[2];
      expect(sec).toBeGreaterThanOrEqual(18 * 3600 + 15 * 60);
      expect(sec).toBeLessThanOrEqual(18 * 3600 + 45 * 60);
      expect(new Date(ts).getTime()).toBeLessThanOrEqual(now.getTime());
    }
  });

  it('restricts timestamp to <= current time when closing inside the 18:15 - 18:45 window', () => {
    // Current time is 2026-10-16 18:25:30 IST (12:55:30 UTC)
    const now = new Date('2026-10-16T12:55:30.000Z');
    const targetDate = '2026-10-16';
    const tz = 'Asia/Kolkata';

    for (let i = 0; i < 20; i++) {
      const ts = computeTaskCloseTimestamp(targetDate, tz, '18:15', '18:45', now);
      const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: tz,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false,
      }).format(new Date(ts)).split(':').map(Number);

      const sec = parts[0] * 3600 + parts[1] * 60 + parts[2];
      expect(sec).toBeGreaterThanOrEqual(18 * 3600 + 15 * 60);
      expect(sec).toBeLessThanOrEqual(18 * 3600 + 25 * 60 + 30);
      expect(new Date(ts).getTime()).toBeLessThanOrEqual(now.getTime());
    }
  });

  it('caps timestamp at now when closing today before 18:15 to avoid future date errors', () => {
    // Current time is 2026-10-16 15:30:00 IST (10:00:00 UTC)
    const now = new Date('2026-10-16T10:00:00.000Z');
    const targetDate = '2026-10-16';
    const tz = 'Asia/Kolkata';

    const ts = computeTaskCloseTimestamp(targetDate, tz, '18:15', '18:45', now);
    expect(new Date(ts).getTime()).toBeLessThanOrEqual(now.getTime());
  });
});

