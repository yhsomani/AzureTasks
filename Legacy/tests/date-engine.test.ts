import { describe, it, expect } from 'vitest';
import {
  addDays,
  getDayOfWeek,
  getNextThursdayIso,
  getTodayIso,
  planCreationDates,
} from '../src/date/date-engine.js';

describe('Date Engine', () => {
  describe('Helper utilities', () => {
    it('calculates getDayOfWeek correctly', () => {
      expect(getDayOfWeek('2026-10-04')).toBe(0); // Sunday
      expect(getDayOfWeek('2026-10-05')).toBe(1); // Monday
      expect(getDayOfWeek('2026-10-06')).toBe(2); // Tuesday
      expect(getDayOfWeek('2026-10-07')).toBe(3); // Wednesday
      expect(getDayOfWeek('2026-10-08')).toBe(4); // Thursday
      expect(getDayOfWeek('2026-10-09')).toBe(5); // Friday
      expect(getDayOfWeek('2026-10-10')).toBe(6); // Saturday
    });

    it('adds days across month and year boundaries', () => {
      expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
      expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
      expect(addDays('2024-02-28', 1)).toBe('2024-02-29'); // Leap year
      expect(addDays('2025-02-28', 1)).toBe('2025-03-01'); // Non-leap year
    });

    it('calculates getTodayIso in target timezone', () => {
      // 2026-10-08T15:52:10+05:30 in Asia/Kolkata
      const sampleDate = new Date('2026-10-08T10:22:10Z');
      const todayIso = getTodayIso('Asia/Kolkata', sampleDate);
      expect(todayIso).toBe('2026-10-08');
    });

    it('calculates next Thursday correctly for each day of the week', () => {
      // Thursday Oct 8 -> Next Thursday is today (Oct 8)
      expect(getNextThursdayIso('2026-10-08')).toBe('2026-10-08');

      // Friday Oct 9 -> Next Thursday is Oct 15
      expect(getNextThursdayIso('2026-10-09')).toBe('2026-10-15');

      // Saturday Oct 10 -> Next Thursday is Oct 15
      expect(getNextThursdayIso('2026-10-10')).toBe('2026-10-15');

      // Sunday Oct 11 -> Next Thursday is Oct 15
      expect(getNextThursdayIso('2026-10-11')).toBe('2026-10-15');

      // Monday Oct 12 -> Next Thursday is Oct 15
      expect(getNextThursdayIso('2026-10-12')).toBe('2026-10-15');

      // Tuesday Oct 13 -> Next Thursday is Oct 15
      expect(getNextThursdayIso('2026-10-13')).toBe('2026-10-15');

      // Wednesday Oct 14 -> Next Thursday is Oct 15
      expect(getNextThursdayIso('2026-10-14')).toBe('2026-10-15');

      // Thursday CURRENT mode: ends today
      expect(getNextThursdayIso('2026-10-08', 'CURRENT')).toBe('2026-10-08');

      // Thursday FOLLOWING mode: ends Thursday of following week (Oct 15)
      expect(getNextThursdayIso('2026-10-08', 'FOLLOWING')).toBe('2026-10-15');
    });
  });

  describe('planCreationDates - Business Rules', () => {
    // Example A: Today is Thursday Oct 8. Latest task is Oct 7. Create: 8 Oct. Stop: 8 Oct.
    it('Example A: Today = Thursday Oct 8, Latest = Oct 7 -> creates Oct 8 only', () => {
      const plan = planCreationDates({
        todayIso: '2026-10-08', // Thursday
        latestExistingTaskIso: '2026-10-07', // Wednesday
      });

      expect(plan.effectiveStartDate).toBe('2026-10-08');
      expect(plan.nextThursday).toBe('2026-10-08');

      const toCreate = plan.plannedDates.filter((p) => p.status === 'PLANNED');
      expect(toCreate).toHaveLength(1);
      expect(toCreate[0].isoDate).toBe('2026-10-08');
      expect(toCreate[0].formattedTitleDate).toBe('8 Oct');
    });

    // Example B: Today is Monday Oct 12. Latest task is Friday Oct 9.
    // Create: 12 Oct, 13 Oct, 14 Oct, 15 Oct.
    it('Example B: Today = Monday Oct 12, Latest = Friday Oct 9 -> creates 12, 13, 14, 15 Oct', () => {
      const plan = planCreationDates({
        todayIso: '2026-10-12', // Monday
        latestExistingTaskIso: '2026-10-09', // Friday
      });

      expect(plan.effectiveStartDate).toBe('2026-10-12');
      expect(plan.nextThursday).toBe('2026-10-15');

      const toCreate = plan.plannedDates.filter((p) => p.status === 'PLANNED');
      expect(toCreate.map((p) => p.formattedTitleDate)).toEqual([
        '12 Oct',
        '13 Oct',
        '14 Oct',
        '15 Oct',
      ]);
    });

    // Example C: Today is Thursday. Today task already exists.
    // Result: No new task required. Do NOT create for following week.
    it('Example C: Today = Thursday Oct 8, Today task already exists -> creates 0 tasks', () => {
      const existingMap = new Map<string, number[]>([
        ['2026-10-08', [101]],
      ]);

      const plan = planCreationDates({
        todayIso: '2026-10-08', // Thursday
        latestExistingTaskIso: '2026-10-08', // Thursday
        existingTasksMap: existingMap,
      });

      const toCreate = plan.plannedDates.filter((p) => p.status === 'PLANNED');
      expect(toCreate).toHaveLength(0);
    });

    // Example D: Latest task is older than today.
    // Create all missing working days: today -> Thursday.
    it('Example D: Latest task older than today -> starts at today through Thursday', () => {
      const plan = planCreationDates({
        todayIso: '2026-10-13', // Tuesday
        latestExistingTaskIso: '2026-10-01', // Older in the past
      });

      expect(plan.effectiveStartDate).toBe('2026-10-13');
      expect(plan.nextThursday).toBe('2026-10-15');

      const toCreate = plan.plannedDates.filter((p) => p.status === 'PLANNED');
      expect(toCreate.map((p) => p.formattedTitleDate)).toEqual([
        '13 Oct',
        '14 Oct',
        '15 Oct',
      ]);
    });

    // Section 6 & 11: Gap Filling across Window
    // Today: Monday 12 Oct. Existing tasks: 12 Oct, 14 Oct, 15 Oct.
    // 13 Oct MUST be planned, not skipped!
    it('Section 6 & 11: Fills gaps within window even when future-dated tasks exist', () => {
      const existingMap = new Map<string, number[]>([
        ['2026-10-12', [101]],
        ['2026-10-14', [102]],
        ['2026-10-15', [103]],
      ]);

      const plan = planCreationDates({
        todayIso: '2026-10-12', // Monday
        latestExistingTaskIso: '2026-10-15',
        existingTasksMap: existingMap,
      });

      const toCreate = plan.plannedDates.filter((p) => p.status === 'PLANNED');
      expect(toCreate).toHaveLength(1);
      expect(toCreate[0].formattedTitleDate).toBe('13 Oct');

      const dupes = plan.plannedDates.filter((p) => p.status === 'DUPLICATE_ALREADY_EXISTS');
      expect(dupes.map((d) => d.formattedTitleDate)).toEqual(['12 Oct', '14 Oct', '15 Oct']);
    });

    // When all tasks in the window already exist and latest task is ahead of window:
    it('Latest task is ahead of window: inspects window, skips if already filled', () => {
      const existingMap = new Map<string, number[]>([
        ['2026-10-08', [100]],
        ['2026-10-16', [105]],
      ]);

      const plan = planCreationDates({
        todayIso: '2026-10-08', // Thursday
        latestExistingTaskIso: '2026-10-16',
        existingTasksMap: existingMap,
      });

      expect(plan.warningMessage).toBeDefined();
      const toCreate = plan.plannedDates.filter((p) => p.status === 'PLANNED');
      expect(toCreate).toHaveLength(0);
      const dupes = plan.plannedDates.filter((p) => p.status === 'DUPLICATE_ALREADY_EXISTS');
      expect(dupes.map((d) => d.formattedTitleDate)).toEqual(['8 Oct']);
    });

    // Section 48 Example with Weekend:
    // Today = Friday Oct 9, Latest = Thursday Oct 8.
    // Friday -> Create, Saturday -> Skip, Sunday -> Skip, Monday -> Create, Tue -> Create, Wed -> Create, Thu -> Create.
    it('Section 48: Friday -> next Thursday skips Saturday and Sunday', () => {
      const plan = planCreationDates({
        todayIso: '2026-10-09', // Friday
        latestExistingTaskIso: '2026-10-08', // Thursday
      });

      expect(plan.nextThursday).toBe('2026-10-15');

      const toCreate = plan.plannedDates.filter((p) => p.status === 'PLANNED');
      const weekends = plan.plannedDates.filter((p) => p.status === 'WEEKEND_SKIP');

      expect(toCreate.map((p) => p.formattedTitleDate)).toEqual([
        '9 Oct',
        '12 Oct',
        '13 Oct',
        '14 Oct',
        '15 Oct',
      ]);

      expect(weekends.map((p) => p.formattedTitleDate)).toEqual(['10 Oct', '11 Oct']);
    });

    // Section 49 Example with Duplicates:
    // Friday exists, Monday exists, Tuesday missing, Wednesday exists, Thursday missing
    // Must create ONLY: Tuesday, Thursday
    it('Section 49: Skips duplicates accurately, creates only missing working days', () => {
      const existingMap = new Map<string, number[]>([
        ['2026-10-09', [201]], // Friday exists
        ['2026-10-12', [202]], // Monday exists
        ['2026-10-14', [203]], // Wednesday exists
      ]);

      const plan = planCreationDates({
        todayIso: '2026-10-09', // Friday
        latestExistingTaskIso: '2026-10-08',
        existingTasksMap: existingMap,
      });

      const toCreate = plan.plannedDates.filter((p) => p.status === 'PLANNED');
      const duplicates = plan.plannedDates.filter((p) => p.status === 'DUPLICATE_ALREADY_EXISTS');

      expect(toCreate.map((p) => p.formattedTitleDate)).toEqual(['13 Oct', '15 Oct']);
      expect(duplicates.map((p) => p.formattedTitleDate)).toEqual([
        '9 Oct',
        '12 Oct',
        '14 Oct',
      ]);
    });

    it('handles Month Boundary transition correctly (Oct 30 -> Nov 5)', () => {
      // Friday Oct 30, 2026 -> Next Thursday is Nov 5, 2026
      const plan = planCreationDates({
        todayIso: '2026-10-30', // Friday
        latestExistingTaskIso: '2026-10-29',
      });

      expect(plan.nextThursday).toBe('2026-11-05');
      const toCreate = plan.plannedDates.filter((p) => p.status === 'PLANNED');

      expect(toCreate.map((p) => p.formattedTitleDate)).toEqual([
        '30 Oct',
        '2 Nov',
        '3 Nov',
        '4 Nov',
        '5 Nov',
      ]);
    });

    it('handles Year Boundary transition correctly (Dec 31 -> Jan 7)', () => {
      // Thursday Dec 31, 2026 -> stop day is Dec 31
      const planThu = planCreationDates({
        todayIso: '2026-12-31', // Thursday
        latestExistingTaskIso: '2026-12-30',
      });
      expect(planThu.nextThursday).toBe('2026-12-31');

      // Friday Jan 1, 2027 -> Next Thursday is Jan 7, 2027
      const planFri = planCreationDates({
        todayIso: '2027-01-01', // Friday
        latestExistingTaskIso: '2026-12-31',
      });
      expect(planFri.nextThursday).toBe('2027-01-07');
      const toCreate = planFri.plannedDates.filter((p) => p.status === 'PLANNED');
      expect(toCreate.map((p) => p.formattedTitleDate)).toEqual([
        '1 Jan',
        '4 Jan',
        '5 Jan',
        '6 Jan',
        '7 Jan',
      ]);
    });
  });
});
