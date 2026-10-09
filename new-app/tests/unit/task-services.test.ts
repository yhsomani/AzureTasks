import { describe, it, expect } from 'vitest';
import { FieldCopyService, DuplicateDetector, RelationCopyService, TaskDiscoveryService } from '../../src/domain/services/task-services';
import { Person } from '../../src/domain/entities/person';
import { WorkItem } from '../../src/domain/entities/task';
import { WorkItemRepository } from '../../src/domain/ports/repositories';

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
    'Microsoft.VSTS.Scheduling.TargetDate': '2026-10-20T00:00:00Z',
    'System.Watermark': 999,
    'System.TeamProject': 'Proj',
    'System.AreaId': 12,
    'System.IterationId': 34,
    'System.RevisedDate': '2026-10-01T00:00:00Z',
    'System.BoardColumn': 'Doing',
    'System.Reason': 'New',
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

  it('does NOT copy read-only system fields (would be rejected by Azure)', () => {
    const paths = ops.map(o => o.path);
    for (const f of [
      'System.Watermark', 'System.TeamProject', 'System.AreaId', 'System.IterationId',
      'System.RevisedDate', 'System.PersonId', 'System.NodeName', 'System.Reason',
      'System.BoardColumn', 'System.BoardColumnDone', 'System.BoardLane',
      'Microsoft.VSTS.Scheduling.TargetDate',
    ]) {
      expect(paths).not.toContain(`/fields/${f}`);
    }
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

describe('RelationCopyService.repairRelations', () => {
  const source: WorkItem = {
    id: 10,
    rev: 1,
    fields: {},
    relations: [
      { rel: 'System.LinkTypes.Related', url: 'vstfs:///x/1' },
      { rel: 'System.LinkTypes.Hierarchy-Reverse', url: 'vstfs:///x/parent' },
      { rel: 'System.LinkTypes.Hierarchy-Forward', url: 'vstfs:///x/child' }, // excluded
      { rel: 'AttachedFile', url: 'att' }, // excluded
    ],
  };

  it('copies only the missing copyable relations (idempotent)', async () => {
    const target: WorkItem = {
      id: 20,
      rev: 1,
      fields: {},
      relations: [{ rel: 'System.LinkTypes.Related', url: 'vstfs:///x/1' }], // already there
    };
    const calls: Array<{ targetId: number; urls: string[] }> = [];
    const repo = {
      async copyRelations(src: WorkItem, targetId: number) {
        calls.push({ targetId, urls: (src.relations ?? []).map(r => r.url) });
        return { copiedCount: (src.relations ?? []).length, failedCount: 0, totalRelations: 1 };
      },
    } as any;

    const svc = new RelationCopyService(repo);
    const result = await svc.repairRelations(source, target);

    expect(result.copiedCount).toBe(1);
    expect(calls).toHaveLength(1);
    expect(calls[0].targetId).toBe(20);
    // only the missing Parent link: Related is present, Child/AttachedFile excluded
    expect(calls[0].urls).toEqual(['vstfs:///x/parent']);
  });

  it('does nothing when everything copyable is already present', async () => {
    const target: WorkItem = {
      id: 20,
      rev: 1,
      fields: {},
      relations: [
        { rel: 'System.LinkTypes.Related', url: 'vstfs:///x/1' },
        { rel: 'System.LinkTypes.Hierarchy-Reverse', url: 'vstfs:///x/parent' },
      ],
    };
    const repo = {
      async copyRelations() {
        throw new Error('should not be called');
      },
    } as any;

    const svc = new RelationCopyService(repo);
    const result = await svc.repairRelations(source, target);
    expect(result).toEqual({ copiedCount: 0, failedCount: 0, totalRelations: 0 });
  });
});

describe('TaskDiscoveryService.discoverForPeople', () => {
  it('forwards the global override and default source as distinct arguments', async () => {
    const calls: any[][] = [];
    const repo = {
      async discoverLatestTasksForPeople(...args: any[]) {
        calls.push(args);
        return new Map();
      },
    } as unknown as WorkItemRepository;

    const svc = new TaskDiscoveryService(repo);
    const people = [new Person({ key: 'p1', name: 'A', assignedTo: 'a@b.com' })];
    await svc.discoverForPeople('Proj', 'Task', 'PFX', people, undefined, 99);

    expect(calls[0][4]).toBeUndefined(); // sourceTaskIdOverride
    expect(calls[0][5]).toBe(99);        // defaultSourceTaskId
  });
});
