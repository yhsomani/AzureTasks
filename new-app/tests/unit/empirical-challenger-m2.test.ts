import { describe, it, expect } from 'vitest';
import { Person, PersonConfig } from '../../src/domain/entities/person.js';
import {
  validateSourceTaskOwnership,
  extractWorkItemRecordedDate,
  WorkItem,
} from '../../src/domain/entities/task.js';
import { ExploreTasksUseCase } from '../../src/application/use-cases/explore-tasks.js';
import { WorkItemRepository, AppConfig } from '../../src/domain/ports/repositories.js';

describe('Empirical Challenger: validateSourceTaskOwnership Adversarial Testing', () => {
  const project = '3in1_Agile_Projects';
  const workItemType = '3in1 Task';
  const titlePrefix = '3in1_PWA_MyAccount |';

  const baseItem: WorkItem = {
    id: 1001,
    rev: 1,
    fields: {
      'System.TeamProject': project,
      'System.WorkItemType': workItemType,
      'System.Title': '3in1_PWA_MyAccount | 20 Oct 2026',
      'System.AssignedTo': { displayName: 'Yash Somani', uniqueName: 'yash.somani@company.test' },
    },
  };

  const person = new Person({
    key: 'yash-somani',
    name: 'Yash Somani',
    assignedTo: 'yash.somani@company.test',
  });

  const personConfig: PersonConfig = {
    key: 'yash-somani',
    name: 'Yash Somani',
    assignedTo: 'yash.somani@company.test',
  };

  describe('1. Valid Identity Variants Accepted', () => {
    it('accepts exact uniqueName and displayName match (Person entity)', () => {
      const res = validateSourceTaskOwnership(baseItem, project, workItemType, titlePrefix, person);
      expect(res.isValid).toBe(true);
      expect(res.isoDate).toBe('2026-10-20');
    });

    it('accepts exact uniqueName and displayName match (PersonConfig)', () => {
      const res = validateSourceTaskOwnership(baseItem, project, workItemType, titlePrefix, personConfig);
      expect(res.isValid).toBe(true);
    });

    it('accepts displayName-only object (no uniqueName) matching person.name', () => {
      const item: WorkItem = {
        ...baseItem,
        fields: { ...baseItem.fields, 'System.AssignedTo': { displayName: 'Yash Somani' } },
      };
      const res = validateSourceTaskOwnership(item, project, workItemType, titlePrefix, person);
      expect(res.isValid).toBe(true);
    });

    it('accepts displayName-only object matching with different case and whitespace', () => {
      const item: WorkItem = {
        ...baseItem,
        fields: { ...baseItem.fields, 'System.AssignedTo': { displayName: '   yash SOMANI   ' } },
      };
      const res = validateSourceTaskOwnership(item, project, workItemType, titlePrefix, person);
      expect(res.isValid).toBe(true);
    });

    it('accepts object with "name" field fallback if displayName is missing', () => {
      const item: WorkItem = {
        ...baseItem,
        fields: { ...baseItem.fields, 'System.AssignedTo': { name: 'Yash Somani' } as any },
      };
      const res = validateSourceTaskOwnership(item, project, workItemType, titlePrefix, person);
      expect(res.isValid).toBe(true);
    });

    it('accepts string raw email matching person.assignedTo', () => {
      const item: WorkItem = {
        ...baseItem,
        fields: { ...baseItem.fields, 'System.AssignedTo': 'yash.somani@company.test' },
      };
      const res = validateSourceTaskOwnership(item, project, workItemType, titlePrefix, person);
      expect(res.isValid).toBe(true);
    });

    it('accepts string raw displayName matching person.name', () => {
      const item: WorkItem = {
        ...baseItem,
        fields: { ...baseItem.fields, 'System.AssignedTo': 'Yash Somani' },
      };
      const res = validateSourceTaskOwnership(item, project, workItemType, titlePrefix, person);
      expect(res.isValid).toBe(true);
    });

    it('accepts string with angle bracket email "Name <email>" matching person', () => {
      const item: WorkItem = {
        ...baseItem,
        fields: { ...baseItem.fields, 'System.AssignedTo': 'Yash Somani <yash.somani@company.test>' },
      };
      const res = validateSourceTaskOwnership(item, project, workItemType, titlePrefix, person);
      expect(res.isValid).toBe(true);
    });

    it('accepts string with extra spaces in angle brackets "Name <   email   >"', () => {
      const item: WorkItem = {
        ...baseItem,
        fields: { ...baseItem.fields, 'System.AssignedTo': 'Yash Somani <   yash.somani@company.test   >' },
      };
      const res = validateSourceTaskOwnership(item, project, workItemType, titlePrefix, person);
      expect(res.isValid).toBe(true);
    });

    it('accepts uniqueName-only object (no displayName) matching person.assignedTo', () => {
      const item: WorkItem = {
        ...baseItem,
        fields: { ...baseItem.fields, 'System.AssignedTo': { uniqueName: 'yash.somani@company.test' } as any },
      };
      const res = validateSourceTaskOwnership(item, project, workItemType, titlePrefix, person);
      expect(res.isValid).toBe(true);
    });

    it('accepts uniqueName-only object with casing variations', () => {
      const item: WorkItem = {
        ...baseItem,
        fields: { ...baseItem.fields, 'System.AssignedTo': { uniqueName: 'YASH.SOMANI@COMPANY.TEST' } as any },
      };
      const res = validateSourceTaskOwnership(item, project, workItemType, titlePrefix, person);
      expect(res.isValid).toBe(true);
    });

    it('accepts uniqueName-only object with extra whitespace', () => {
      const item: WorkItem = {
        ...baseItem,
        fields: { ...baseItem.fields, 'System.AssignedTo': { uniqueName: '   yash.somani@company.test   ' } as any },
      };
      const res = validateSourceTaskOwnership(item, project, workItemType, titlePrefix, person);
      expect(res.isValid).toBe(true);
    });

    it('accepts string with angle-bracket email only "<email>" without displayName', () => {
      const item: WorkItem = {
        ...baseItem,
        fields: { ...baseItem.fields, 'System.AssignedTo': '<yash.somani@company.test>' },
      };
      const res = validateSourceTaskOwnership(item, project, workItemType, titlePrefix, person);
      expect(res.isValid).toBe(true);
    });
  });

  describe('2. String assignedTo Backward Compatibility', () => {
    it('accepts string email when Azure provides object with uniqueName', () => {
      const res = validateSourceTaskOwnership(baseItem, project, workItemType, titlePrefix, 'yash.somani@company.test');
      expect(res.isValid).toBe(true);
    });

    it('accepts string displayName when Azure provides object with uniqueName & displayName', () => {
      const res = validateSourceTaskOwnership(baseItem, project, workItemType, titlePrefix, 'Yash Somani');
      expect(res.isValid).toBe(true);
    });

    it('accepts string "Name <email>" when Azure provides object with uniqueName & displayName', () => {
      const res = validateSourceTaskOwnership(baseItem, project, workItemType, titlePrefix, 'Yash Somani <yash.somani@company.test>');
      expect(res.isValid).toBe(true);
    });

    it('accepts string displayName when Azure provides displayName-only object', () => {
      const item: WorkItem = {
        ...baseItem,
        fields: { ...baseItem.fields, 'System.AssignedTo': { displayName: 'Yash Somani' } },
      };
      const res = validateSourceTaskOwnership(item, project, workItemType, titlePrefix, 'Yash Somani');
      expect(res.isValid).toBe(true);
    });

    it('accepts string "Name <email>" when Azure provides displayName-only object', () => {
      const item: WorkItem = {
        ...baseItem,
        fields: { ...baseItem.fields, 'System.AssignedTo': { displayName: 'Yash Somani' } },
      };
      const res = validateSourceTaskOwnership(item, project, workItemType, titlePrefix, 'Yash Somani <yash.somani@company.test>');
      expect(res.isValid).toBe(true);
    });

    it('accepts string email when Azure provides string "Name <email>"', () => {
      const item: WorkItem = {
        ...baseItem,
        fields: { ...baseItem.fields, 'System.AssignedTo': 'Yash Somani <yash.somani@company.test>' },
      };
      const res = validateSourceTaskOwnership(item, project, workItemType, titlePrefix, 'yash.somani@company.test');
      expect(res.isValid).toBe(true);
    });

    it('accepts string email when Azure provides uniqueName-only object', () => {
      const item: WorkItem = {
        ...baseItem,
        fields: { ...baseItem.fields, 'System.AssignedTo': { uniqueName: 'yash.somani@company.test' } as any },
      };
      const res = validateSourceTaskOwnership(item, project, workItemType, titlePrefix, 'yash.somani@company.test');
      expect(res.isValid).toBe(true);
    });

    it('accepts string "Name <email>" when Azure provides uniqueName-only object', () => {
      const item: WorkItem = {
        ...baseItem,
        fields: { ...baseItem.fields, 'System.AssignedTo': { uniqueName: 'yash.somani@company.test' } as any },
      };
      const res = validateSourceTaskOwnership(item, project, workItemType, titlePrefix, 'Yash Somani <yash.somani@company.test>');
      expect(res.isValid).toBe(true);
    });

    it('accepts uppercase string email "YASH.SOMANI@COMPANY.TEST"', () => {
      const res = validateSourceTaskOwnership(baseItem, project, workItemType, titlePrefix, 'YASH.SOMANI@COMPANY.TEST');
      expect(res.isValid).toBe(true);
    });

    it('accepts string email with surrounding whitespace', () => {
      const res = validateSourceTaskOwnership(baseItem, project, workItemType, titlePrefix, '   yash.somani@company.test   ');
      expect(res.isValid).toBe(true);
    });

    it('accepts string angle bracket with surrounding whitespace', () => {
      const res = validateSourceTaskOwnership(baseItem, project, workItemType, titlePrefix, '  Yash Somani   <   yash.somani@company.test   >  ');
      expect(res.isValid).toBe(true);
    });
  });

  describe('3. Adversarial Rejections & Edge Case Safety', () => {
    it('rejects when uniqueName conflicts even if displayName matches (prevents impersonation)', () => {
      const item: WorkItem = {
        ...baseItem,
        fields: {
          ...baseItem.fields,
          'System.AssignedTo': { displayName: 'Yash Somani', uniqueName: 'imposter@other.test' },
        },
      };
      expect(() => validateSourceTaskOwnership(item, project, workItemType, titlePrefix, person))
        .toThrow(/not assigned to the selected team member/);
    });

    it('rejects when Azure assignedTo is null', () => {
      const item: WorkItem = {
        ...baseItem,
        fields: { ...baseItem.fields, 'System.AssignedTo': null as any },
      };
      expect(() => validateSourceTaskOwnership(item, project, workItemType, titlePrefix, person))
        .toThrow(/not assigned to the selected team member/);
    });

    it('rejects when Azure assignedTo is undefined', () => {
      const item: WorkItem = {
        ...baseItem,
        fields: { ...baseItem.fields, 'System.AssignedTo': undefined },
      };
      expect(() => validateSourceTaskOwnership(item, project, workItemType, titlePrefix, person))
        .toThrow(/not assigned to the selected team member/);
    });

    it('rejects when Azure assignedTo is a number', () => {
      const item: WorkItem = {
        ...baseItem,
        fields: { ...baseItem.fields, 'System.AssignedTo': 4294967295 as any },
      };
      expect(() => validateSourceTaskOwnership(item, project, workItemType, titlePrefix, person))
        .toThrow(/not assigned to the selected team member/);
    });

    it('rejects when Azure assignedTo is boolean true', () => {
      const item: WorkItem = {
        ...baseItem,
        fields: { ...baseItem.fields, 'System.AssignedTo': true as any },
      };
      expect(() => validateSourceTaskOwnership(item, project, workItemType, titlePrefix, person))
        .toThrow(/not assigned to the selected team member/);
    });

    it('rejects when Azure assignedTo is an empty object {}', () => {
      const item: WorkItem = {
        ...baseItem,
        fields: { ...baseItem.fields, 'System.AssignedTo': {} as any },
      };
      expect(() => validateSourceTaskOwnership(item, project, workItemType, titlePrefix, person))
        .toThrow(/not assigned to the selected team member/);
    });

    it('rejects when Azure assignedTo has empty string displayName', () => {
      const item: WorkItem = {
        ...baseItem,
        fields: { ...baseItem.fields, 'System.AssignedTo': { displayName: '   ' } },
      };
      expect(() => validateSourceTaskOwnership(item, project, workItemType, titlePrefix, person))
        .toThrow(/not assigned to the selected team member/);
    });

    it('rejects when Azure assignedTo is empty string or whitespace', () => {
      const item: WorkItem = {
        ...baseItem,
        fields: { ...baseItem.fields, 'System.AssignedTo': '   ' },
      };
      expect(() => validateSourceTaskOwnership(item, project, workItemType, titlePrefix, person))
        .toThrow(/not assigned to the selected team member/);
    });

    it('rejects completely different person', () => {
      const otherPerson = new Person({
        key: 'other-user',
        name: 'Other User',
        assignedTo: 'other@company.test',
      });
      expect(() => validateSourceTaskOwnership(baseItem, project, workItemType, titlePrefix, otherPerson))
        .toThrow(/not assigned to the selected team member/);
    });

    it('rejects project boundary violation', () => {
      expect(() => validateSourceTaskOwnership(baseItem, 'Rogue_Project', workItemType, titlePrefix, person))
        .toThrow(/does not belong to the configured project and task type/);
    });

    it('rejects work item type boundary violation', () => {
      expect(() => validateSourceTaskOwnership(baseItem, project, 'User Story', titlePrefix, person))
        .toThrow(/does not belong to the configured project and task type/);
    });

    it('rejects task series boundary violation', () => {
      expect(() => validateSourceTaskOwnership(baseItem, project, workItemType, '3in1_OtherSeries |', person))
        .toThrow(/belongs to a different task series/);
    });

    it('rejects undated task title', () => {
      const item: WorkItem = {
        ...baseItem,
        fields: { ...baseItem.fields, 'System.Title': '3in1_PWA_MyAccount | No Date Here' },
      };
      expect(() => validateSourceTaskOwnership(item, project, workItemType, titlePrefix, person))
        .toThrow(/has no unambiguous dated task title/);
    });

    it('rejects when caller provides display name string but Azure provides uniqueName-only object without mapping', () => {
      const item: WorkItem = {
        ...baseItem,
        fields: { ...baseItem.fields, 'System.AssignedTo': { uniqueName: 'yash.somani@company.test' } as any },
      };
      expect(() => validateSourceTaskOwnership(item, project, workItemType, titlePrefix, 'Yash Somani'))
        .toThrow(/not assigned to the selected team member/);
    });

    it('rejects email domain mismatch (e.g. yash.somani@other.test)', () => {
      const item: WorkItem = {
        ...baseItem,
        fields: { ...baseItem.fields, 'System.AssignedTo': { uniqueName: 'yash.somani@other.test' } as any },
      };
      expect(() => validateSourceTaskOwnership(item, project, workItemType, titlePrefix, person))
        .toThrow(/not assigned to the selected team member/);
    });

    it('rejects email local-part mismatch (e.g. imposter@company.test)', () => {
      const item: WorkItem = {
        ...baseItem,
        fields: { ...baseItem.fields, 'System.AssignedTo': { uniqueName: 'imposter@company.test' } as any },
      };
      expect(() => validateSourceTaskOwnership(item, project, workItemType, titlePrefix, person))
        .toThrow(/not assigned to the selected team member/);
    });

    it('rejects email subdomain / suffix attacks (e.g. yash.somani@company.test.evil.org)', () => {
      const item: WorkItem = {
        ...baseItem,
        fields: { ...baseItem.fields, 'System.AssignedTo': { uniqueName: 'yash.somani@company.test.evil.org' } as any },
      };
      expect(() => validateSourceTaskOwnership(item, project, workItemType, titlePrefix, person))
        .toThrow(/not assigned to the selected team member/);
    });

    it('rejects angle bracket string with mismatched email even if name matches', () => {
      const item: WorkItem = {
        ...baseItem,
        fields: { ...baseItem.fields, 'System.AssignedTo': 'Yash Somani <attacker@evil.test>' },
      };
      expect(() => validateSourceTaskOwnership(item, project, workItemType, titlePrefix, person))
        .toThrow(/not assigned to the selected team member/);
    });

    it('rejects uniqueName-only object when uniqueName is empty string or whitespace', () => {
      const item: WorkItem = {
        ...baseItem,
        fields: { ...baseItem.fields, 'System.AssignedTo': { uniqueName: '   ' } as any },
      };
      expect(() => validateSourceTaskOwnership(item, project, workItemType, titlePrefix, person))
        .toThrow(/not assigned to the selected team member/);
    });
  });
});

describe('Empirical Challenger: extractWorkItemRecordedDate Timezone Edge Cases', () => {
  it('challenges user-specified timestamp 2026-10-18T19:00:00Z across Asia/Kolkata (+05:30) and America/New_York (-04:00)', () => {
    // 2026-10-18T19:00:00Z is:
    // - In Asia/Kolkata (+05:30): 2026-10-19 00:30:00 -> 2026-10-19
    // - In America/New_York (-04:00): 2026-10-18 15:00:00 -> 2026-10-18
    const item: WorkItem = {
      id: 99, rev: 1,
      fields: { 'Custom.PlannedStartDate': '2026-10-18T19:00:00Z' },
    };
    const kolkata = extractWorkItemRecordedDate(item, 'Asia/Kolkata');
    expect(kolkata?.isoDate).toBe('2026-10-19');
    expect(kolkata?.year).toBe(2026);

    const newYork = extractWorkItemRecordedDate(item, 'America/New_York');
    expect(newYork?.isoDate).toBe('2026-10-18');
    expect(newYork?.year).toBe(2026);
  });

  it('extracts date in Asia/Kolkata across UTC midnight boundary (18:30 UTC -> next day)', () => {
    // 2026-10-18T18:30:00Z is 2026-10-19 00:00:00 in Asia/Kolkata (+05:30)
    const item: WorkItem = {
      id: 1, rev: 1,
      fields: { 'Custom.PlannedStartdate': '2026-10-18T18:30:00Z' },
    };
    const res = extractWorkItemRecordedDate(item, 'Asia/Kolkata');
    expect(res).not.toBeNull();
    expect(res?.isoDate).toBe('2026-10-19');
    expect(res?.year).toBe(2026);
  });

  it('extracts date in Asia/Kolkata before UTC midnight boundary (18:29:59 UTC -> same day)', () => {
    const item: WorkItem = {
      id: 1, rev: 1,
      fields: { 'Custom.PlannedStartdate': '2026-10-18T18:29:59Z' },
    };
    const res = extractWorkItemRecordedDate(item, 'Asia/Kolkata');
    expect(res?.isoDate).toBe('2026-10-18');
  });

  it('extracts date in America/New_York across UTC midnight boundary (02:00 UTC -> previous day)', () => {
    // 2026-10-19T02:00:00Z in America/New_York (EDT, UTC-4) is 2026-10-18 22:00:00
    const item: WorkItem = {
      id: 2, rev: 1,
      fields: { 'Microsoft.VSTS.Scheduling.StartDate': '2026-10-19T02:00:00Z' },
    };
    const res = extractWorkItemRecordedDate(item, 'America/New_York');
    expect(res?.isoDate).toBe('2026-10-18');
    expect(res?.year).toBe(2026);
  });

  it('extracts date in America/New_York after UTC midnight transition (04:00 UTC -> current day)', () => {
    // 2026-10-19T04:00:00Z in America/New_York is 2026-10-19 00:00:00
    const item: WorkItem = {
      id: 2, rev: 1,
      fields: { 'Microsoft.VSTS.Scheduling.StartDate': '2026-10-19T04:00:00Z' },
    };
    const res = extractWorkItemRecordedDate(item, 'America/New_York');
    expect(res?.isoDate).toBe('2026-10-19');
  });

  it('handles extreme timezone Pacific/Kiritimati (Line Islands, UTC+14)', () => {
    // 2026-10-18T10:30:00Z + 14:00 = 2026-10-19 00:30:00
    const item: WorkItem = {
      id: 3, rev: 1,
      fields: { 'Custom.PlannedStartDate': '2026-10-18T10:30:00Z' },
    };
    const res = extractWorkItemRecordedDate(item, 'Pacific/Kiritimati');
    expect(res?.isoDate).toBe('2026-10-19');
  });

  it('handles extreme timezone Pacific/Auckland (NZDT, UTC+13 in October)', () => {
    // 2026-10-18T11:30:00Z + 13:00 = 2026-10-19 00:30:00
    const item: WorkItem = {
      id: 4, rev: 1,
      fields: { 'Custom.ActualStartDate': '2026-10-18T11:30:00Z' },
    };
    const res = extractWorkItemRecordedDate(item, 'Pacific/Auckland');
    expect(res?.isoDate).toBe('2026-10-19');
  });

  it('handles extreme negative timezone Pacific/Honolulu (HST, UTC-10)', () => {
    // 2026-10-19T09:30:00Z - 10:00 = 2026-10-18 23:30:00
    const item: WorkItem = {
      id: 5, rev: 1,
      fields: { 'Custom.ActualStartdate': '2026-10-19T09:30:00Z' },
    };
    const res = extractWorkItemRecordedDate(item, 'Pacific/Honolulu');
    expect(res?.isoDate).toBe('2026-10-18');
  });

  it('handles Year-End Boundary in Asia/Kolkata (+05:30 -> changes year to 2027)', () => {
    // 2026-12-31T23:30:00Z is 2027-01-01 05:00:00 in Asia/Kolkata
    const item: WorkItem = {
      id: 6, rev: 1,
      fields: { 'Custom.PlannedStartdate': '2026-12-31T23:30:00Z' },
    };
    const res = extractWorkItemRecordedDate(item, 'Asia/Kolkata');
    expect(res?.isoDate).toBe('2027-01-01');
    expect(res?.year).toBe(2027);

    // In UTC, the same timestamp is 2026-12-31
    const resUtc = extractWorkItemRecordedDate(item, 'UTC');
    expect(resUtc?.isoDate).toBe('2026-12-31');
    expect(resUtc?.year).toBe(2026);
  });

  it('handles Year-End Boundary in America/New_York (EST, UTC-5 -> stays in 2026)', () => {
    // 2027-01-01T02:00:00Z is 2026-12-31 21:00:00 in America/New_York
    const item: WorkItem = {
      id: 7, rev: 1,
      fields: { 'Custom.PlannedStartdate': '2027-01-01T02:00:00Z' },
    };
    const res = extractWorkItemRecordedDate(item, 'America/New_York');
    expect(res?.isoDate).toBe('2026-12-31');
    expect(res?.year).toBe(2026);
  });

  it('handles Leap Year Boundary in Asia/Kolkata', () => {
    // 2028-02-28T20:00:00Z in Asia/Kolkata is 2028-02-29 01:30:00
    const item: WorkItem = {
      id: 8, rev: 1,
      fields: { 'Custom.PlannedStartdate': '2028-02-28T20:00:00Z' },
    };
    const res = extractWorkItemRecordedDate(item, 'Asia/Kolkata');
    expect(res?.isoDate).toBe('2028-02-29');
  });

  describe('Field Precedence Order', () => {
    it('prefers Custom.PlannedStartdate over subsequent fields', () => {
      const item: WorkItem = {
        id: 9, rev: 1,
        fields: {
          'Custom.PlannedStartdate': '2026-10-15T09:00:00Z',
          'Microsoft.VSTS.Scheduling.StartDate': '2026-10-16T09:00:00Z',
          'Custom.ActualStartDate': '2026-10-17T09:00:00Z',
        },
      };
      const res = extractWorkItemRecordedDate(item, 'UTC');
      expect(res?.isoDate).toBe('2026-10-15');
    });

    it('falls back to Microsoft.VSTS.Scheduling.StartDate if PlannedStartdate is missing', () => {
      const item: WorkItem = {
        id: 10, rev: 1,
        fields: {
          'Microsoft.VSTS.Scheduling.StartDate': '2026-10-16T09:00:00Z',
          'Custom.ActualStartDate': '2026-10-17T09:00:00Z',
        },
      };
      const res = extractWorkItemRecordedDate(item, 'UTC');
      expect(res?.isoDate).toBe('2026-10-16');
    });
  });

  describe('Malformed & Missing Data Handling', () => {
    it('returns null when no candidate date fields exist', () => {
      const item: WorkItem = { id: 11, rev: 1, fields: { 'System.Title': 'Task' } };
      expect(extractWorkItemRecordedDate(item, 'Asia/Kolkata')).toBeNull();
    });

    it('returns null on invalid date strings without crashing', () => {
      const item: WorkItem = {
        id: 12, rev: 1,
        fields: { 'Custom.PlannedStartdate': 'not-a-valid-date' },
      };
      expect(extractWorkItemRecordedDate(item, 'Asia/Kolkata')).toBeNull();
    });

    it('returns null on null or empty field values', () => {
      const item: WorkItem = {
        id: 13, rev: 1,
        fields: { 'Custom.PlannedStartdate': null, 'Microsoft.VSTS.Scheduling.StartDate': '' },
      };
      expect(extractWorkItemRecordedDate(item, 'Asia/Kolkata')).toBeNull();
    });
  });
});

describe('Empirical Challenger: ExploreTasksUseCase Timezone Integration', () => {
  const mockConfig: AppConfig = {
    organization: 'TestOrg',
    project: 'TestProj',
    baseUrl: 'https://dev.azure.com',
    workItemType: '3in1 Task',
    taskSeries: '3in1',
    titlePrefix: '3in1_PWA_MyAccount |',
    timezone: 'Asia/Kolkata',
    startTime: '09:30',
    thursdayMode: 'CURRENT',
    skipWeekends: true,
    stopDay: 'Thursday',
    stopDayOfWeek: 4,
    defaultState: 'To Do',
    autoClose: false,
    copyEstimates: true,
    resetActualWork: true,
    maxRetries: 3,
    initialRetryDelayMs: 1000,
    people: [
      { key: 'alice', name: 'Alice Smith', assignedTo: 'alice@example.com', enabled: true },
      { key: 'bob', name: 'Bob Jones', assignedTo: 'bob@example.com', enabled: true },
    ],
    schedulerEnabled: false,
  };

  it('correctly maps overnight tasks to local calendar day in Explorer matrix (Asia/Kolkata)', async () => {
    // Alice has a task with PlannedStartDate at 2026-10-19T19:00:00Z (Monday 19:00 UTC).
    // In Asia/Kolkata (+05:30), this is 2026-10-20 00:30:00 (Tuesday).
    // With raw .split('T')[0], this would erroneously show on 2026-10-19.
    const mockRepo: WorkItemRepository = {
      validateProject: vi.fn(),
      validateWorkItemType: vi.fn(),
      findLatestTaskForPerson: vi.fn(),
      discoverLatestTasksForPeople: vi.fn(),
      getExistingTasksForPerson: vi.fn(),
      findCandidateTasks: vi.fn(async () => [
        {
          id: 5001,
          rev: 1,
          fields: {
            'System.Title': '3in1_PWA_MyAccount | Work Item Without Pipe Date',
            'System.AssignedTo': { displayName: 'Alice Smith', uniqueName: 'alice@example.com' },
            'System.State': 'Active',
            'Custom.PlannedStartdate': '2026-10-19T19:00:00Z',
          },
        },
      ]),
      getWorkItem: vi.fn(),
      createWorkItemWithReconciliation: vi.fn(),
      copyRelations: vi.fn(),
      patchWorkItem: vi.fn(async () => ({ id: 0, rev: 1, fields: {} })),
    };

    const explorer = new ExploreTasksUseCase(mockRepo, mockConfig);
    const result = await explorer.execute({
      startDate: '2026-10-19',
      endDate: '2026-10-20',
      asOf: '2026-10-19',
    });

    const aliceRow = result.matrix.find(r => r.person.key === 'alice');
    expect(aliceRow).toBeDefined();
    // 2026-10-19 (Monday) should be MISSING
    expect(aliceRow?.cells['2026-10-19'].status).toBe('MISSING');
    // 2026-10-20 (Tuesday) should be CREATED because 19:00 UTC = 00:30 IST on Oct 20!
    expect(aliceRow?.cells['2026-10-20'].status).toBe('CREATED');
    expect(aliceRow?.cells['2026-10-20'].tasks[0].id).toBe(5001);
  });

  it('correctly maps American evening tasks across midnight in America/New_York', async () => {
    // Bob has a task with PlannedStartDate at 2026-10-20T02:00:00Z (Tuesday 02:00 UTC).
    // In America/New_York (EDT, UTC-4), this is 2026-10-19 22:00:00 (Monday).
    // With raw .split('T')[0], this would erroneously show on 2026-10-20.
    const nyConfig: AppConfig = {
      ...mockConfig,
      timezone: 'America/New_York',
    };

    const mockRepo: WorkItemRepository = {
      validateProject: vi.fn(),
      validateWorkItemType: vi.fn(),
      findLatestTaskForPerson: vi.fn(),
      discoverLatestTasksForPeople: vi.fn(),
      getExistingTasksForPerson: vi.fn(),
      findCandidateTasks: vi.fn(async () => [
        {
          id: 5002,
          rev: 1,
          fields: {
            'System.Title': '3in1_PWA_MyAccount | Standup NY',
            'System.AssignedTo': { displayName: 'Bob Jones', uniqueName: 'bob@example.com' },
            'System.State': 'Active',
            'Custom.PlannedStartdate': '2026-10-20T02:00:00Z',
          },
        },
      ]),
      getWorkItem: vi.fn(),
      createWorkItemWithReconciliation: vi.fn(),
      copyRelations: vi.fn(),
      patchWorkItem: vi.fn(async () => ({ id: 0, rev: 1, fields: {} })),
    };

    const explorer = new ExploreTasksUseCase(mockRepo, nyConfig);
    const result = await explorer.execute({
      startDate: '2026-10-19',
      endDate: '2026-10-20',
      asOf: '2026-10-19',
    });

    const bobRow = result.matrix.find(r => r.person.key === 'bob');
    expect(bobRow).toBeDefined();
    // In America/New_York, 2026-10-20T02:00:00Z maps to 2026-10-19 (Monday)!
    expect(bobRow?.cells['2026-10-19'].status).toBe('CREATED');
    expect(bobRow?.cells['2026-10-19'].tasks[0].id).toBe(5002);
    expect(bobRow?.cells['2026-10-20'].status).toBe('MISSING');
  });

  it('supports weekend task exploration when skipWeekends is false', async () => {
    // 2026-10-18 was Sunday. With skipWeekends: false, Sunday should be eligible.
    // Task with 2026-10-17T20:00:00Z in Asia/Kolkata maps to 2026-10-18 01:30:00 (Sunday).
    const weekendConfig: AppConfig = {
      ...mockConfig,
      skipWeekends: false,
    };

    const mockRepo: WorkItemRepository = {
      validateProject: vi.fn(),
      validateWorkItemType: vi.fn(),
      findLatestTaskForPerson: vi.fn(),
      discoverLatestTasksForPeople: vi.fn(),
      getExistingTasksForPerson: vi.fn(),
      findCandidateTasks: vi.fn(async () => [
        {
          id: 5003,
          rev: 1,
          fields: {
            'System.Title': '3in1_PWA_MyAccount | Weekend Emergency Task',
            'System.AssignedTo': { displayName: 'Alice Smith', uniqueName: 'alice@example.com' },
            'System.State': 'Active',
            'Custom.PlannedStartdate': '2026-10-17T20:00:00Z',
          },
        },
      ]),
      getWorkItem: vi.fn(),
      createWorkItemWithReconciliation: vi.fn(),
      copyRelations: vi.fn(),
      patchWorkItem: vi.fn(async () => ({ id: 0, rev: 1, fields: {} })),
    };

    const explorer = new ExploreTasksUseCase(mockRepo, weekendConfig);
    const result = await explorer.execute({
      startDate: '2026-10-17',
      endDate: '2026-10-18',
      asOf: '2026-10-17',
    });

    const aliceRow = result.matrix.find(r => r.person.key === 'alice');
    expect(aliceRow).toBeDefined();
    expect(aliceRow?.cells['2026-10-17'].status).toBe('MISSING');
    expect(aliceRow?.cells['2026-10-18'].status).toBe('CREATED');
    expect(aliceRow?.cells['2026-10-18'].tasks[0].id).toBe(5003);
  });

  it('challenges user-specified scenario 2026-10-18T19:00:00Z in ExploreTasksUseCase across Asia/Kolkata and America/New_York', async () => {
    // 2026-10-18T19:00:00Z in Asia/Kolkata +05:30 -> 2026-10-19
    // 2026-10-18T19:00:00Z in America/New_York -04:00 -> 2026-10-18
    const item: WorkItem = {
      id: 5010,
      rev: 1,
      fields: {
        'System.Title': '3in1_PWA_MyAccount | Midnight Boundary Verification',
        'System.AssignedTo': { displayName: 'Alice Smith', uniqueName: 'alice@example.com' },
        'System.State': 'Active',
        'Custom.PlannedStartDate': '2026-10-18T19:00:00Z',
      },
    };

    const repo: WorkItemRepository = {
      validateProject: vi.fn(),
      validateWorkItemType: vi.fn(),
      findLatestTaskForPerson: vi.fn(),
      discoverLatestTasksForPeople: vi.fn(),
      getExistingTasksForPerson: vi.fn(),
      findCandidateTasks: vi.fn(async () => [item]),
      getWorkItem: vi.fn(),
      createWorkItemWithReconciliation: vi.fn(),
      copyRelations: vi.fn(),
      patchWorkItem: vi.fn(async () => ({ id: 0, rev: 1, fields: {} })),
    };

    // 1. In Asia/Kolkata (+05:30)
    const kolkataConfig: AppConfig = { ...mockConfig, timezone: 'Asia/Kolkata', skipWeekends: false };
    const kolkataExplorer = new ExploreTasksUseCase(repo, kolkataConfig);
    const kolkataRes = await kolkataExplorer.execute({
      startDate: '2026-10-18',
      endDate: '2026-10-19',
      asOf: '2026-10-18',
    });
    const kolkataAlice = kolkataRes.matrix.find(r => r.person.key === 'alice')!;
    expect(kolkataAlice.cells['2026-10-18'].status).toBe('MISSING');
    expect(kolkataAlice.cells['2026-10-19'].status).toBe('CREATED');
    expect(kolkataAlice.cells['2026-10-19'].tasks[0].id).toBe(5010);

    // 2. In America/New_York (-04:00)
    const nyConfig: AppConfig = { ...mockConfig, timezone: 'America/New_York', skipWeekends: false };
    const nyExplorer = new ExploreTasksUseCase(repo, nyConfig);
    const nyRes = await nyExplorer.execute({
      startDate: '2026-10-18',
      endDate: '2026-10-19',
      asOf: '2026-10-18',
    });
    const nyAlice = nyRes.matrix.find(r => r.person.key === 'alice')!;
    expect(nyAlice.cells['2026-10-18'].status).toBe('CREATED');
    expect(nyAlice.cells['2026-10-18'].tasks[0].id).toBe(5010);
    expect(nyAlice.cells['2026-10-19'].status).toBe('MISSING');
  });
});

