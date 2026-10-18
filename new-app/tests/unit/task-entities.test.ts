import { describe, it, expect } from 'vitest';
import { validateSourceTaskOwnership } from '../../src/domain/entities/task';
import {
  parseTitleDate,
  parseWorkItemTaskDate,
  matchesTaskSeries,
  filterCopyableRelations,
  isRelationCopyable,
  isRelationExcluded,
  COPYABLE_RELATION_TYPES,
} from '../../src/domain/entities/task';

describe('task: parseTitleDate', () => {
  it('parses a valid prefixed title', () => {
    const result = parseTitleDate('3in1_PWA_MyAccount | Oct 8', '3in1_PWA_MyAccount |');
    expect(result.isValid).toBe(true);
    expect(result.formattedTitleDate).toBe('Oct 8');
    expect(result.isoDate).toMatch(/^\d{4}-10-08$/);
  });

  it('rejects a title without the prefix', () => {
    const result = parseTitleDate('Something else Oct 8', '3in1_PWA_MyAccount |');
    expect(result.isValid).toBe(false);
  });

  it('rejects malformed dates', () => {
    const result = parseTitleDate('3in1_PWA_MyAccount | Oct 99', '3in1_PWA_MyAccount |');
    expect(result.isValid).toBe(false);
  });

  it('handles regex-special prefix characters safely', () => {
    const result = parseTitleDate('A.B(x) | Jan 5', 'A.B(x) |');
    expect(result.isValid).toBe(true);
    expect(result.formattedTitleDate).toBe('Jan 5');
  });

  it('rejects an unknown month abbreviation instead of assuming January', () => {
    const result = parseTitleDate('3in1_PWA_MyAccount | Foo 15', '3in1_PWA_MyAccount |');
    expect(result.isValid).toBe(false);
    expect(result.isoDate).toBe('');
  });
});

describe('task: series isolation', () => {
  it('matches canonical series across case and harmless spacing differences', () => {
    expect(matchesTaskSeries('3in1_PWA_MyAccount |  17 Oct', '3in1_PWA_MyAccount |')).toBe(true);
    expect(matchesTaskSeries('3IN1_pwa_myaccount|Oct 17', '3in1_PWA_MyAccount |')).toBe(true);
  });

  it('rejects another work series even if a date segment is valid', () => {
    expect(matchesTaskSeries('Other_Series | 17 Oct', '3in1_PWA_MyAccount |')).toBe(false);
    expect(matchesTaskSeries('3in1_PWA_MyAccount_Extra | 17 Oct', '3in1_PWA_MyAccount |')).toBe(false);
  });
});

describe('task: relation filtering', () => {
  it('copies known-safe relation types', () => {
    expect(isRelationCopyable('System.LinkTypes.Related')).toBe(true);
    expect(isRelationCopyable('System.LinkTypes.Hierarchy-Reverse')).toBe(true); // Parent link is safe
    expect(isRelationCopyable('Hyperlink')).toBe(true);
    expect(isRelationCopyable('ArtifactLink')).toBe(true);
  });

  it('excludes child hierarchy links and binary attachments', () => {
    expect(isRelationExcluded('System.LinkTypes.Hierarchy-Forward')).toBe(true); // Child
    expect(isRelationExcluded('AttachedFile')).toBe(true);
    expect(isRelationCopyable('System.LinkTypes.Hierarchy-Forward')).toBe(false);
    expect(isRelationCopyable('AttachedFile')).toBe(false);
    // Parent must NOT be excluded
    expect(isRelationExcluded('System.LinkTypes.Hierarchy-Reverse')).toBe(false);
  });

  it('filters a mixed relation list down to copyable only (deduped)', () => {
    const relations = [
      { rel: 'System.LinkTypes.Hierarchy-Reverse', url: 'a' },
      { rel: 'System.LinkTypes.Hierarchy-Forward', url: 'child' },
      { rel: 'System.LinkTypes.Related', url: 'b' },
      { rel: 'AttachedFile', url: 'c' },
      { rel: 'Custom.Unknown', url: 'd' },
      { rel: 'Hyperlink', url: 'e' },
      { rel: 'Hyperlink', url: 'e' }, // duplicate
    ];
    const filtered = filterCopyableRelations(relations as any);
    expect(filtered.map(r => r.url)).toEqual(['a', 'b', 'e']);
  });

  it('exposes a frozen-safe list of copyable types', () => {
    expect(COPYABLE_RELATION_TYPES.length).toBeGreaterThan(0);
    expect(COPYABLE_RELATION_TYPES).toContain('System.LinkTypes.Related');
  });
});

describe('source task ownership validation', () => {
  const prefix = '3in1_PWA_MyAccount |';
  const source = {
    id: 77,
    rev: 1,
    fields: {
      'System.Title': '3in1_PWA_MyAccount | 15 Oct 2026',
      'System.TeamProject': 'Project-A',
      'System.WorkItemType': '3in1 Task',
      'System.AssignedTo': { displayName: 'Member A', uniqueName: 'member-a@company.test' },
    },
  };

  it('accepts a matching project, type, series and exact Azure assignee', () => {
    expect(validateSourceTaskOwnership(source, 'Project-A', '3in1 Task', prefix, 'member-a@company.test').isValid).toBe(true);
  });

  it('blocks cross-person, cross-project and cross-series overrides', () => {
    expect(() => validateSourceTaskOwnership(source, 'Project-A', '3in1 Task', prefix, 'member-b@company.test')).toThrow(/not assigned/);
    expect(() => validateSourceTaskOwnership(source, 'Project-B', '3in1 Task', prefix, 'member-a@company.test')).toThrow(/project and task type/);
    expect(() => validateSourceTaskOwnership(source, 'Project-A', 'Bug', prefix, 'member-a@company.test')).toThrow(/project and task type/);
    expect(() => validateSourceTaskOwnership(source, 'Project-A', '3in1 Task', 'OtherSeries |', 'member-a@company.test')).toThrow(/different task series/);
  });
});

describe('year-aware Azure workday interpretation', () => {
  const prefix = '3in1_PWA_MyAccount |';

  it('uses Azure planned date rather than guessing the current year', () => {
    const item = {
      id: 5, rev: 1,
      fields: {
        'System.Title': '3in1_PWA_MyAccount | Dec 30',
        'Custom.PlannedStartdate': '2025-12-30T04:00:00Z',
      },
    } as any;
    const parsed = parseWorkItemTaskDate(item, prefix, 'Asia/Kolkata');
    expect(parsed.isoDate).toBe('2025-12-30');
    expect(parsed.year).toBe(2025);
  });

  it('uses local timezone across UTC midnight boundaries', () => {
    const item = {
      id: 6, rev: 1,
      fields: {
        'System.Title': '3in1_PWA_MyAccount | Jan 1',
        'Microsoft.VSTS.Scheduling.StartDate': '2025-12-31T22:00:00Z',
      },
    } as any;
    expect(parseWorkItemTaskDate(item, prefix, 'Asia/Kolkata').isoDate).toBe('2026-01-01');
  });

  it('does not silently accept a conflicting recorded work date', () => {
    const item = {
      id: 7, rev: 1,
      fields: {
        'System.Title': '3in1_PWA_MyAccount | Jan 1',
        'Custom.PlannedStartdate': '2025-12-26T04:00:00Z',
      },
    } as any;
    expect(parseWorkItemTaskDate(item, prefix, 'Asia/Kolkata').isValid).toBe(false);
  });
});

describe('strict mutation-date evidence', () => {
  it('blocks yearless title and creation-date inference for a remote EOD mutation', () => {
    const task = { id: 600, rev: 1, fields: {
      'System.Title': '3in1_PWA_MyAccount | Oct 15',
      'System.CreatedDate': '2025-10-15T04:00:00Z',
    } } as any;
    expect(parseWorkItemTaskDate(task, '3in1_PWA_MyAccount |', 'Asia/Kolkata', true).isValid).toBe(false);
  });
});

describe('explicit-year title validation', () => {
  const prefix = '3in1_PWA_MyAccount |';
  it('accepts legacy DD-MM-YYYY when workday metadata agrees', () => {
    const task = { id: 501, rev: 1, fields: {
      'System.Title': '3in1_PWA_MyAccount | 15-10-2025',
      'Custom.PlannedStartdate': '2025-10-15T04:00:00.000Z',
    } } as any;
    expect(parseWorkItemTaskDate(task, prefix, 'Asia/Kolkata').isoDate).toBe('2025-10-15');
  });
  it('does not reinterpret an explicit historical year from a later planned date', () => {
    const task = { id: 502, rev: 1, fields: {
      'System.Title': '3in1_PWA_MyAccount | 15 Oct 2025',
      'Custom.PlannedStartdate': '2026-10-15T04:00:00.000Z',
    } } as any;
    expect(parseWorkItemTaskDate(task, prefix, 'Asia/Kolkata').isValid).toBe(false);
  });
  it('refuses impossible day-month-year titles', () => {
    const task = { id: 503, rev: 1, fields: {
      'System.Title': '3in1_PWA_MyAccount | 31-02-2026',
    } } as any;
    expect(parseWorkItemTaskDate(task, prefix, 'Asia/Kolkata').isValid).toBe(false);
  });
});
