import { describe, it, expect, vi } from 'vitest';
import {
  RepairRelationsUseCase,
  OrphanTaskItem,
} from '../../src/application/use-cases/repair-relations.js';
import {
  WorkItemRepository,
  JournalRepository,
  LockRepository,
} from '../../src/domain/ports/repositories.js';
import { WorkItem } from '../../src/domain/entities/task.js';

describe('RepairRelationsUseCase - Orphan Tasks and Locking', () => {
  const dummyJournal: JournalRepository = {
    record: vi.fn(),
    getEntries: vi.fn().mockResolvedValue([]),
    getUnfinishedRelations: vi.fn().mockResolvedValue([]),
    markRepaired: vi.fn().mockResolvedValue(true),
    exportCsv: vi.fn().mockResolvedValue(''),
    exportJson: vi.fn().mockResolvedValue('[]'),
  };

  describe('detectOrphanTasks', () => {
    it('detects tasks matching the series pattern that have no parent relation', async () => {
      const candidates: WorkItem[] = [
        {
          id: 101,
          rev: 1,
          fields: {
            'System.Title': '3in1_PWA_MyAccount | 15 Oct',
            'System.AssignedTo': 'alice@example.com',
            'System.State': 'Active',
          },
          relations: [], // No parent
        },
        {
          id: 102,
          rev: 1,
          fields: {
            'System.Title': '3in1_PWA_MyAccount | 16 Oct',
            'System.AssignedTo': { displayName: 'Bob Jones' },
            'System.State': 'Active',
          },
          relations: [
            { rel: 'System.LinkTypes.Hierarchy-Reverse', url: 'https://dev.azure.com/org/p/_apis/wit/workItems/999' },
          ], // Has parent
        },
        {
          id: 103,
          rev: 1,
          fields: {
            'System.Title': 'Other_Series | 17 Oct',
            'System.AssignedTo': 'alice@example.com',
            'System.State': 'Active',
          },
          relations: [], // Belongs to different series
        },
      ];

      const mockRepo: WorkItemRepository = {
        validateProject: vi.fn(),
        validateWorkItemType: vi.fn(),
        findLatestTaskForPerson: vi.fn(),
        discoverLatestTasksForPeople: vi.fn(),
        getExistingTasksForPerson: vi.fn(),
        findCandidateTasks: vi.fn(),
        getWorkItem: vi.fn(),
        createWorkItemWithReconciliation: vi.fn(),
        copyRelations: vi.fn(),
        patchWorkItem: vi.fn(),
      };

      const useCase = new RepairRelationsUseCase(mockRepo, dummyJournal);
      const orphans = await useCase.detectOrphanTasks(candidates, '3in1_PWA_MyAccount |');

      expect(orphans).toHaveLength(1);
      expect(orphans[0].id).toBe(101);
      expect(orphans[0].hasParent).toBe(false);
      expect(orphans[0].status).toBe('DETECTED');
      expect(orphans[0].assignedTo).toBe('alice@example.com');
    });

    it('fetches full work item from repository if relations are not populated on candidate', async () => {
      const candidateWithoutRelations: WorkItem = {
        id: 104,
        rev: 1,
        fields: {
          'System.Title': '3in1_PWA_MyAccount | 18 Oct',
          'System.AssignedTo': 'alice@example.com',
          'System.State': 'Active',
        },
        // relations is undefined
      };

      const mockRepo: WorkItemRepository = {
        validateProject: vi.fn(),
        validateWorkItemType: vi.fn(),
        findLatestTaskForPerson: vi.fn(),
        discoverLatestTasksForPeople: vi.fn(),
        getExistingTasksForPerson: vi.fn(),
        findCandidateTasks: vi.fn(),
        getWorkItem: vi.fn().mockResolvedValue({
          ...candidateWithoutRelations,
          relations: [], // Fetched item has no parent
        }),
        createWorkItemWithReconciliation: vi.fn(),
        copyRelations: vi.fn(),
        patchWorkItem: vi.fn(),
      };

      const useCase = new RepairRelationsUseCase(mockRepo, dummyJournal);
      const orphans = await useCase.detectOrphanTasks([candidateWithoutRelations], '3in1_PWA_MyAccount |');

      expect(mockRepo.getWorkItem).toHaveBeenCalledWith(104);
      expect(orphans).toHaveLength(1);
      expect(orphans[0].id).toBe(104);
      expect(orphans[0].status).toBe('DETECTED');
    });
  });

  describe('repairOrphanTasks', () => {
    it('applies parent link from reference source task and verifies read-back', async () => {
      const parentUrl = 'https://dev.azure.com/org/p/_apis/wit/workItems/900';
      const referenceSourceTask: WorkItem = {
        id: 50,
        rev: 1,
        fields: {},
        relations: [
          { rel: 'System.LinkTypes.Hierarchy-Reverse', url: parentUrl },
          { rel: 'System.LinkTypes.Related', url: 'https://dev.azure.com/org/p/_apis/wit/workItems/901' },
        ],
      };

      const orphans: OrphanTaskItem[] = [
        {
          id: 101,
          title: '3in1_PWA_MyAccount | 15 Oct',
          assignedTo: 'alice@example.com',
          state: 'Active',
          hasParent: false,
          status: 'DETECTED',
          message: 'Missing parent relation',
        },
      ];

      const mockRepo: WorkItemRepository = {
        validateProject: vi.fn(),
        validateWorkItemType: vi.fn(),
        findLatestTaskForPerson: vi.fn(),
        discoverLatestTasksForPeople: vi.fn(),
        getExistingTasksForPerson: vi.fn(),
        findCandidateTasks: vi.fn(),
        getWorkItem: vi.fn().mockResolvedValue({
          id: 101,
          rev: 2,
          fields: {},
          relations: [{ rel: 'System.LinkTypes.Hierarchy-Reverse', url: parentUrl }],
        }),
        createWorkItemWithReconciliation: vi.fn(),
        copyRelations: vi.fn().mockResolvedValue({ copiedCount: 1, failedCount: 0, totalRelations: 1 }),
        patchWorkItem: vi.fn(),
      };

      const useCase = new RepairRelationsUseCase(mockRepo, dummyJournal);
      const repaired = await useCase.repairOrphanTasks(orphans, referenceSourceTask);

      expect(mockRepo.copyRelations).toHaveBeenCalledWith(
        expect.objectContaining({
          relations: [{ rel: 'System.LinkTypes.Hierarchy-Reverse', url: parentUrl }],
        }),
        101,
        ['System.LinkTypes.Hierarchy-Reverse']
      );

      expect(repaired).toHaveLength(1);
      expect(repaired[0].status).toBe('REPAIRED');
      expect(repaired[0].hasParent).toBe(true);
      expect(repaired[0].parentRelationUrl).toBe(parentUrl);
      expect(repaired[0].message).toContain('Successfully linked to parent');
    });

    it('returns UNRESOLVED status when reference source task has no parent relation', async () => {
      const referenceSourceTaskWithoutParent: WorkItem = {
        id: 51,
        rev: 1,
        fields: {},
        relations: [
          { rel: 'System.LinkTypes.Related', url: 'https://dev.azure.com/org/p/_apis/wit/workItems/901' },
        ],
      };

      const orphans: OrphanTaskItem[] = [
        {
          id: 101,
          title: '3in1_PWA_MyAccount | 15 Oct',
          state: 'Active',
          hasParent: false,
          status: 'DETECTED',
          message: 'Missing parent',
        },
      ];

      const mockRepo = {} as WorkItemRepository;
      const useCase = new RepairRelationsUseCase(mockRepo, dummyJournal);
      const repaired = await useCase.repairOrphanTasks(orphans, referenceSourceTaskWithoutParent);

      expect(repaired).toHaveLength(1);
      expect(repaired[0].status).toBe('UNRESOLVED');
      expect(repaired[0].message).toContain('does not have a parent relation');
    });

    it('marks orphan UNRESOLVED if read-back verification does not show the copied parent relation', async () => {
      const parentUrl = 'https://dev.azure.com/org/p/_apis/wit/workItems/900';
      const referenceSourceTask: WorkItem = {
        id: 50,
        rev: 1,
        fields: {},
        relations: [{ rel: 'System.LinkTypes.Hierarchy-Reverse', url: parentUrl }],
      };

      const orphans: OrphanTaskItem[] = [
        {
          id: 101,
          title: '3in1_PWA_MyAccount | 15 Oct',
          state: 'Active',
          hasParent: false,
          status: 'DETECTED',
          message: 'Missing parent',
        },
      ];

      const mockRepo: WorkItemRepository = {
        validateProject: vi.fn(),
        validateWorkItemType: vi.fn(),
        findLatestTaskForPerson: vi.fn(),
        discoverLatestTasksForPeople: vi.fn(),
        getExistingTasksForPerson: vi.fn(),
        findCandidateTasks: vi.fn(),
        getWorkItem: vi.fn().mockResolvedValue({
          id: 101,
          rev: 2,
          fields: {},
          relations: [], // Read-back did not reflect the parent relation
        }),
        createWorkItemWithReconciliation: vi.fn(),
        copyRelations: vi.fn().mockResolvedValue({ copiedCount: 1, failedCount: 0, totalRelations: 1 }),
        patchWorkItem: vi.fn(),
      };

      const useCase = new RepairRelationsUseCase(mockRepo, dummyJournal);
      const repaired = await useCase.repairOrphanTasks(orphans, referenceSourceTask);

      expect(repaired).toHaveLength(1);
      expect(repaired[0].status).toBe('UNRESOLVED');
      expect(repaired[0].message).toContain('failed read-back verification');
    });
  });

  describe('concurrency locking and full execution flow', () => {
    it('blocks execution when another process holds the concurrency lock', async () => {
      const mockLock: LockRepository = {
        acquire: vi.fn().mockReturnValue(false),
        release: vi.fn(),
        isLocked: vi.fn().mockReturnValue(true),
        getLockInfo: vi.fn().mockReturnValue({ pid: 9999, timestamp: Date.now() }),
      };

      const mockRepo = {} as WorkItemRepository;
      const useCase = new RepairRelationsUseCase(mockRepo, dummyJournal, mockLock);

      await expect(useCase.execute()).rejects.toThrow(/Cannot run relation repair: another process \(PID 9999\)/);
      expect(mockLock.acquire).toHaveBeenCalled();
      expect(mockLock.release).not.toHaveBeenCalled();
    });

    it('acquires and releases concurrency lock upon completion', async () => {
      const mockLock: LockRepository = {
        acquire: vi.fn().mockReturnValue(true),
        release: vi.fn(),
        isLocked: vi.fn().mockReturnValue(false),
        getLockInfo: vi.fn().mockReturnValue(null),
      };

      const mockRepo = {} as WorkItemRepository;
      const useCase = new RepairRelationsUseCase(mockRepo, dummyJournal, mockLock);

      const report = await useCase.execute();
      expect(mockLock.acquire).toHaveBeenCalled();
      expect(mockLock.release).toHaveBeenCalled();
      expect(report.total).toBe(0);
    });

    it('performs orphan task discovery and repair during execute when candidateTasks and referenceSourceTask are passed', async () => {
      const parentUrl = 'https://dev.azure.com/org/p/_apis/wit/workItems/888';
      const referenceTask: WorkItem = {
        id: 40,
        rev: 1,
        fields: {},
        relations: [{ rel: 'System.LinkTypes.Hierarchy-Reverse', url: parentUrl }],
      };

      const candidate: WorkItem = {
        id: 201,
        rev: 1,
        fields: {
          'System.Title': '3in1_PWA_MyAccount | 15 Oct',
          'System.AssignedTo': 'alice@example.com',
          'System.State': 'Active',
        },
        relations: [],
      };

      const mockRepo: WorkItemRepository = {
        validateProject: vi.fn(),
        validateWorkItemType: vi.fn(),
        findLatestTaskForPerson: vi.fn(),
        discoverLatestTasksForPeople: vi.fn(),
        getExistingTasksForPerson: vi.fn(),
        findCandidateTasks: vi.fn(),
        getWorkItem: vi.fn().mockResolvedValue({
          ...candidate,
          relations: [{ rel: 'System.LinkTypes.Hierarchy-Reverse', url: parentUrl }],
        }),
        createWorkItemWithReconciliation: vi.fn(),
        copyRelations: vi.fn().mockResolvedValue({ copiedCount: 1, failedCount: 0, totalRelations: 1 }),
        patchWorkItem: vi.fn(),
      };

      const useCase = new RepairRelationsUseCase(mockRepo, dummyJournal);
      const report = await useCase.execute({
        candidateTasks: [candidate],
        referenceSourceTask: referenceTask,
        titlePrefix: '3in1_PWA_MyAccount |',
      });

      expect(report.orphans).toBeDefined();
      expect(report.orphans).toHaveLength(1);
      expect(report.orphans![0].id).toBe(201);
      expect(report.orphans![0].status).toBe('REPAIRED');
      expect(report.orphans![0].parentRelationUrl).toBe(parentUrl);
    });
  });
});
