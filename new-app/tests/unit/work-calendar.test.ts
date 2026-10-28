import { describe, expect, it } from 'vitest';
import { validateWorkCalendar, workdayEligibility, type WorkCalendar } from '../../src/domain/services/work-calendar.js';
import { DatePlanningService, DuplicateDetector } from '../../src/domain/services/task-services.js';
import { Person } from '../../src/domain/entities/person.js';

const calendar: WorkCalendar = {
  version: 1, defaultHours: 8, memberHours: { alice: 6 },
  exceptions: [
    { id: 'holiday', kind: 'holiday', label: 'Holiday', startDate: '2026-10-28', endDate: '2026-10-28', memberKeys: [], availableHours: 0 },
    { id: 'leave', kind: 'leave', label: 'Leave', startDate: '2026-10-29', endDate: '2026-10-29', memberKeys: ['alice'], availableHours: 0 },
    { id: 'partial', kind: 'leave', label: 'Partial day', startDate: '2026-10-30', endDate: '2026-10-30', memberKeys: ['alice'], availableHours: 3 },
  ],
};

describe('shared work calendar', () => {
  it('excludes the same holiday and leave dates from task planning', () => {
    const person = new Person({ key: 'alice', name: 'Alice', assignedTo: 'alice@example.invalid' });
    const plan = new DatePlanningService().planForPerson(person, {
      key: 'alice', workItem: { id: 1, fields: {} },
      parsedDate: { isoDate: '2026-10-27', formattedTitleDate: 'Oct 27', year: 2026, isValid: true },
    }, '2026-10-28', 'Task |', 'CURRENT', true, 4, new DuplicateDetector(), calendar);
    expect(plan.plannedDates.filter(date => date.status === 'PLANNED')).toHaveLength(0);
    expect(plan.plannedDates.map(date => date.skipReason)).toEqual(['Holiday', 'Leave']);
  });
  it('applies holidays globally and leave only to explicit members', () => {
    expect(workdayEligibility('bob', '2026-10-28', true, calendar).eligible).toBe(false);
    expect(workdayEligibility('alice', '2026-10-29', true, calendar).eligible).toBe(false);
    expect(workdayEligibility('bob', '2026-10-29', true, calendar).plannedHours).toBe(8);
  });
  it('reduces planned capacity without inventing actual work', () => {
    expect(workdayEligibility('alice', '2026-10-30', true, calendar)).toEqual({ eligible: true, plannedHours: 3, reason: 'Partial day' });
    expect(workdayEligibility('alice', '2026-10-31', true, calendar).plannedHours).toBe(0);
  });
  it('validates exact dates, known references and capacity bounds', () => {
    expect(validateWorkCalendar(calendar, ['alice', 'bob'])).toEqual(calendar);
    expect(() => validateWorkCalendar({ ...calendar, defaultHours: 25 }, ['alice'])).toThrow('hours');
    expect(() => validateWorkCalendar({ ...calendar, exceptions: [{ ...calendar.exceptions[0], startDate: '2026-02-30' }] }, ['alice'])).toThrow('dates');
    expect(() => validateWorkCalendar(calendar, ['bob'])).toThrow('known member');
  });
});