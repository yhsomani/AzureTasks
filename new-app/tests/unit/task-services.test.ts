import { describe, it, expect } from 'vitest';
import { FieldCopyService, DuplicateDetector } from '../../src/domain/services/task-services';
import { Person } from '../../src/domain/entities/person';
import { WorkItem } from '../../src/domain/entities/task';

const sourceItem: WorkItem = {
  id: 42,
  rev: 1,
  fields: {
    'System.Id': 42,
    'System.Title': '3in1_PWA_MyAccount | Oct 7',
    'System.State': 'Done',
    'System.AssignedTo': { displayName: 'Old Owner', uniqueName: 'old@b.com' },
    'System.CreatedDate': '2026-10-01T00:00:00Z',
    'System.ChangedBy': 'someone',
    'System.AreaPath': 'Proj\\TeamA',
    'System.IterationPath': 'Proj\\Sprint1',
    'Microsoft.VSTS.Scheduling.OriginalEstimate': 4,
    'Microsoft.VSTS.Scheduling.CompletedWork': 3,
    'Custom.MyField': 'should-not-copy',
    'WEF_ABC': 'should-not-copy',
    'Company.CustomNote': 'keep-me',
  },
};

describe('FieldCopyService: buildFieldPatchOperations', () => {
  const svc = new FieldCopyService();
  const ops = svc.buildFieldPatchOperations({
    sourceWorkItem: sourceItem,
    newTitle: '3in1_PWA_MyAccount | Oct 8',
    targetIsoDate: '2026-10-08',
    assignedTo: 'new@b.com',
    startTime: '09:30',
    timezone: 'Asia/Kolkata',
    copyEstimates: true,
    resetActualWork: true,
    defaultState: 'New',
  });

  const byPath = (p: string) => ops.find(o => o.path === p);

  it('overrides the title', () => {
    expect(byPath('/fields/System.Title')?.value).toBe('3in1_PWA_MyAccount | Oct 8');
  });

  it('overrides the assignee', () => {
    expect(byPath('/fields/System.AssignedTo')?.value).toBe('new@b.com');
  });

  it('sets the state to New', () => {
    expect(byPath('/fields/System.State')?.value).toBe('New');
  });

  it('sets StartDate to 09:30 wall-clock in the configured timezone (09:30 IST = 04:00Z)', () => {
    const value = byPath('/fields/Microsoft.VSTS.Scheduling.StartDate')?.value as string;
    expect(value).toBe('2026-10-08T04:00:00.000Z');
  });

  it('copies the original estimate', () => {
    expect(byPath('/fields/Microsoft.VSTS.Scheduling.OriginalEstimate')?.value).toBe(4);
  });

  it('resets completed work to zero', () => {
    expect(byPath('/fields/Microsoft.VSTS.Scheduling.CompletedWork')?.value).toBe(0);
  });

  it('copies area and iteration paths', () => {
    expect(byPath('/fields/System.AreaPath')?.value).toBe('Proj\\TeamA');
    expect(byPath('/fields/System.IterationPath')?.value).toBe('Proj\\Sprint1');
  });

  it('does NOT copy system-managed fields', () => {
    const paths = ops.map(o => o.path);
    expect(paths).not.toContain('/fields/System.Id');
    expect(paths).not.toContain('/fields/System.CreatedDate');
    expect(paths).not.toContain('/fields/System.ChangedBy');
  });

  it('skips custom/WEF prefixed fields but copies other custom fields', () => {
    const paths = ops.map(o => o.path);
    expect(paths).not.toContain('/fields/Custom.MyField');
    expect(paths).not.toContain('/fields/WEF_ABC');
    expect(paths).toContain('/fields/Company.CustomNote');
  });

  it('honors copyEstimates=false and resetActualWork=false', () => {
    const ops2 = svc.buildFieldPatchOperations({
      sourceWorkItem: sourceItem,
      newTitle: 't',
      targetIsoDate: '2026-10-08',
      assignedTo: 'x@b.com',
      startTime: '09:30',
      timezone: 'Asia/Kolkata',
      copyEstimates: false,
      resetActualWork: false,
      defaultState: 'New',
    });
    const paths = ops2.map(o => o.path);
    expect(paths).not.toContain('/fields/Microsoft.VSTS.Scheduling.OriginalEstimate');
    expect(paths).not.toContain('/fields/Microsoft.VSTS.Scheduling.CompletedWork');
  });
});

describe('DuplicateDetector', () => {
  const person = new Person({ key: 'p1', name: 'A', assignedTo: 'a@b.com' });
  const detector = new DuplicateDetector();

  it('reports duplicates from the per-person date map only', () => {
    detector.setPersonDateMap('p1', new Map([
      ['2026-10-08', { id: 5, title: 't', isoDate: '2026-10-08' }],
    ]));
    expect(detector.isDuplicate(person, '2026-10-08')).toBe(true);
    expect(detector.isDuplicate(person, '2026-10-09')).toBe(false);
    expect(detector.getExistingTask(person, '2026-10-08')?.id).toBe(5);
  });

  it('isolates people from each other', () => {
    const other = new Person({ key: 'p2', name: 'B', assignedTo: 'b@b.com' });
    expect(detector.isDuplicate(other, '2026-10-08')).toBe(false);
  });
});
