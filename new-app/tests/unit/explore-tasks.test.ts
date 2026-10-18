import { describe, it, expect, vi } from 'vitest';
import { ExploreTasksUseCase } from '../../src/application/use-cases/explore-tasks.js';
import { WorkItemRepository, AppConfig } from '../../src/domain/ports/repositories.js';

describe('ExploreTasksUseCase', () => {
  const mockConfig: AppConfig = {
    organization: 'TestOrg',
    project: 'TestProj',
    workItemType: 'Task',
    titlePrefix: '3in1_PWA_MyAccount |',
    timezone: 'Asia/Kolkata',
    startTime: '09:30',
    thursdayMode: 'CURRENT',
    skipWeekends: true,
    stopDayOfWeek: 4,
    people: [
      { key: 'user1', name: 'Alice Smith', assignedTo: 'alice@example.com', enabled: true },
      { key: 'user2', name: 'Bob Jones', assignedTo: 'bob@example.com', enabled: true },
      { key: 'user3', name: 'Charlie Disabled', assignedTo: 'charlie@example.com', enabled: false },
    ],
  };

  it('computes preset date ranges correctly', () => {
    const today = '2026-10-12'; // Monday
    const thisWeek = ExploreTasksUseCase.getPresetDateRange('this_week', 'Asia/Kolkata', today);
    expect(thisWeek.startDate).toBe('2026-10-12');
    expect(thisWeek.endDate).toBe('2026-10-16');

    const lastWeek = ExploreTasksUseCase.getPresetDateRange('last_week', 'Asia/Kolkata', today);
    expect(lastWeek.startDate).toBe('2026-10-05');
    expect(lastWeek.endDate).toBe('2026-10-09');

    const month = ExploreTasksUseCase.getPresetDateRange('current_month', 'Asia/Kolkata', today);
    expect(month.startDate).toBe('2026-10-01');
    expect(month.endDate).toBe('2026-10-31');
  });

  it('never widens an unknown member selection to every employee', async () => {
    const repo = { findCandidateTasks: vi.fn() } as unknown as WorkItemRepository;
    const explorer = new ExploreTasksUseCase(repo, mockConfig);
    await expect(explorer.execute({
      asOf: '2026-10-12',
      personKeys: ['removed-member'],
    })).rejects.toThrow(/unknown or disabled members/);
    expect(repo.findCandidateTasks).not.toHaveBeenCalled();
  });

  it('rejects explicit empty member selections', async () => {
    const repo = { findCandidateTasks: vi.fn() } as unknown as WorkItemRepository;
    const explorer = new ExploreTasksUseCase(repo, mockConfig);
    await expect(explorer.execute({
      asOf: '2026-10-12',
      personKeys: [],
    })).rejects.toThrow(/Select at least one/);
    expect(repo.findCandidateTasks).not.toHaveBeenCalled();
  });

  it('keeps unrecorded work values unknown and excludes them from totals', async () => {
    const repo = {
      findCandidateTasks: vi.fn(async () => [{
        id: 501,
        fields: {
          'System.Title': '3in1_PWA_MyAccount | 12 Oct',
          'System.AssignedTo': { displayName: 'Alice Smith', uniqueName: 'alice@example.com' },
          'System.State': 'Active',
        },
      }]),
    } as unknown as WorkItemRepository;
    const explorer = new ExploreTasksUseCase(repo, mockConfig);
    const data = await explorer.execute({
      startDate: '2026-10-12', endDate: '2026-10-12',
      asOf: '2026-10-12', personKeys: ['user1'],
    });
    expect(data.summary.totalCompletedWork).toBeNull();
    expect(data.summary.totalRemainingWork).toBeNull();
    expect(data.summary.unrecordedCompletedWorkTasks).toBe(1);
    const task = data.detailedTasks.find(t => t.taskId === 501)!;
    expect(task.completedWork).toBeUndefined();
    expect(task.remainingWork).toBeUndefined();
  });

  it('executes task exploration, builds matrix and computes stats', async () => {
    const mockRepo: WorkItemRepository = {
      validateProject: vi.fn(),
      validateWorkItemType: vi.fn(),
      findLatestTaskForPerson: vi.fn(),
      discoverLatestTasksForPeople: vi.fn(),
      getExistingTasksForPerson: vi.fn(),
      findCandidateTasks: vi.fn(async () => [
        {
          id: 101,
          fields: {
            'System.Title': '3in1_PWA_MyAccount | 12 Oct',
            'System.AssignedTo': { displayName: 'Alice Smith', uniqueName: 'alice@example.com' },
            'System.State': 'Active',
            'System.CreatedDate': '2026-10-12T04:00:00Z',
            'Microsoft.VSTS.Scheduling.CompletedWork': 4,
            'Microsoft.VSTS.Scheduling.RemainingWork': 2,
          },
        },
        {
          id: 102,
          fields: {
            'System.Title': 'Unrelated_Project | 12 Oct',
            'System.AssignedTo': { displayName: 'Alice Smith', uniqueName: 'alice@example.com' },
            'System.State': 'Active',
            'Microsoft.VSTS.Scheduling.StartDate': '2026-10-12T04:00:00Z',
          },
        },
      ]),
      getWorkItem: vi.fn(),
      createWorkItemWithReconciliation: vi.fn(),
      copyRelations: vi.fn(),
      patchFields: vi.fn(),
    };

    const useCase = new ExploreTasksUseCase(mockRepo, mockConfig);
    const result = await useCase.execute({
      startDate: '2026-10-12',
      endDate: '2026-10-14',
      asOf: '2026-10-12',
    });

    expect(result.summary.totalSelectedUsers).toBe(2); // Only enabled users
    expect(result.matrix.length).toBe(2);

    const aliceRow = result.matrix.find(r => r.person.key === 'user1');
    expect(aliceRow).toBeDefined();
    expect(aliceRow?.stats.createdCount).toBe(1);
    expect(aliceRow?.stats.totalCompletedWork).toBe(4);
    expect(aliceRow?.stats.recordedCompletedWorkTasks).toBe(1);
    expect(aliceRow?.stats.unrecordedCompletedWorkTasks).toBe(0);

    expect(aliceRow?.cells['2026-10-12'].status).toBe('CREATED');
    expect(aliceRow?.cells['2026-10-13'].status).toBe('MISSING');
    expect(aliceRow?.cells['2026-10-13'].isEligibleForCreation).toBe(true);

    const bobRow = result.matrix.find(r => r.person.key === 'user2');
    expect(bobRow?.stats.createdCount).toBe(0);
    expect(bobRow?.stats.totalCompletedWork).toBeNull();
    expect(bobRow?.cells['2026-10-12'].status).toBe('MISSING');

    expect(result.summary.stateCounts.Active).toBe(1);
    expect(result.detailedTasks.length).toBeGreaterThan(0);
  });
});
