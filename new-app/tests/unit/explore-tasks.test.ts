import { describe, it, expect, vi } from 'vitest';
import { ExploreTasksUseCase } from '../../src/application/use-cases/explore-tasks.js';
import { WorkItemRepository, AppConfig } from '../../src/domain/ports/repositories.js';

describe('ExploreTasksUseCase', () => {
  const mockConfig: AppConfig = {
    organization: 'TestOrg',
    project: 'TestProj',
    baseUrl: 'https://dev.azure.com',
    workItemType: 'Task',
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
      { key: 'user1', name: 'Alice Smith', assignedTo: 'alice@example.com', enabled: true },
      { key: 'user2', name: 'Bob Jones', assignedTo: 'bob@example.com', enabled: true },
      { key: 'user3', name: 'Charlie Disabled', assignedTo: 'charlie@example.com', enabled: false },
    ],
    schedulerEnabled: false,
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
          rev: 1,
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
          rev: 1,
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
      patchWorkItem: vi.fn(async () => ({ id: 0, rev: 1, fields: {} })),
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

  it('correctly maps scheduling dates across UTC midnight boundaries to local timezone', async () => {
    // 2026-10-19T20:00:00Z is 2026-10-20 01:30:00 in Asia/Kolkata (+05:30)
    const mockRepo: WorkItemRepository = {
      validateProject: vi.fn(),
      validateWorkItemType: vi.fn(),
      findLatestTaskForPerson: vi.fn(),
      discoverLatestTasksForPeople: vi.fn(),
      getExistingTasksForPerson: vi.fn(),
      findCandidateTasks: vi.fn(async () => [
        {
          id: 201,
          rev: 1,
          fields: {
            'System.Title': '3in1_PWA_MyAccount | Standup and Review',
            'System.AssignedTo': { displayName: 'Alice Smith', uniqueName: 'alice@example.com' },
            'System.State': 'Active',
            'Custom.PlannedStartdate': '2026-10-19T20:00:00Z',
          },
        },
        {
          id: 202,
          rev: 1,
          fields: {
            'System.Title': '3in1_PWA_MyAccount | Code Review',
            'System.AssignedTo': { displayName: 'Bob Jones', uniqueName: 'bob@example.com' },
            'System.State': 'Active',
            'Custom.ActualStartDate': '2026-10-20T19:30:00Z', // 2026-10-21 01:00:00 in Asia/Kolkata
          },
        },
      ]),
      getWorkItem: vi.fn(),
      createWorkItemWithReconciliation: vi.fn(),
      copyRelations: vi.fn(),
      patchWorkItem: vi.fn(async () => ({ id: 0, rev: 1, fields: {} })),
    };

    const useCase = new ExploreTasksUseCase(mockRepo, mockConfig);
    const result = await useCase.execute({
      startDate: '2026-10-19',
      endDate: '2026-10-21',
      asOf: '2026-10-19',
    });

    const aliceRow = result.matrix.find(r => r.person.key === 'user1');
    expect(aliceRow).toBeDefined();
    // 2026-10-19T20:00:00Z in Asia/Kolkata must map to 2026-10-20, NOT 2026-10-19
    expect(aliceRow?.cells['2026-10-19'].status).toBe('MISSING');
    expect(aliceRow?.cells['2026-10-20'].status).toBe('CREATED');
    expect(aliceRow?.cells['2026-10-20'].tasks[0].id).toBe(201);

    const bobRow = result.matrix.find(r => r.person.key === 'user2');
    expect(bobRow).toBeDefined();
    // 2026-10-20T19:30:00Z in Asia/Kolkata must map to 2026-10-21, NOT 2026-10-20
    expect(bobRow?.cells['2026-10-20'].status).toBe('MISSING');
    expect(bobRow?.cells['2026-10-21'].status).toBe('CREATED');
    expect(bobRow?.cells['2026-10-21'].tasks[0].id).toBe(202);
  });
});
