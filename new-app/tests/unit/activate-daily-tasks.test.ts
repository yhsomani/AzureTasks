import { describe, it, expect, vi } from 'vitest';
import { ActivateDailyTasksUseCase } from '../../src/application/use-cases/activate-daily-tasks.js';
import { DatePlanningService } from '../../src/domain/index.js';
import { AppConfig, WorkItemRepository } from '../../src/domain/ports/repositories.js';
import { GitHubClient } from '../../src/infrastructure/github/github-client.js';

describe('ActivateDailyTasksUseCase', () => {
  const baseConfig: AppConfig = {
    organization: 'TestOrg',
    project: 'TestProj',
    baseUrl: 'https://dev.azure.com',
    workItemType: '3in1 Task',
    taskSeries: '3in1_PWA_MyAccount',
    titlePrefix: '3in1_PWA_MyAccount |',
    startTime: '09:30',
    timezone: 'Asia/Kolkata',
    skipWeekends: true,
    stopDay: 'Thursday',
    stopDayOfWeek: 4,
    thursdayMode: 'CURRENT',
    defaultState: 'New',
    autoClose: true,
    autoCloseStartTime: '18:15',
    autoCloseEndTime: '18:45',
    autoActive: true,
    autoActiveTime: '17:30',
    copyEstimates: true,
    resetActualWork: true,
    maxRetries: 3,
    initialRetryDelayMs: 100,
    githubUserSuffix: '_bflghec',
    people: [
      {
        key: 'user1',
        name: 'Alice Smith',
        assignedTo: 'alice@example.com',
        role: 'Dev On-Role',
        enabled: true,
        autoCloseEnabled: true,
      },
      {
        key: 'user2',
        name: 'Bob Jones',
        assignedTo: 'bob@example.com',
        role: 'Dev On-Role',
        enabled: true,
        autoCloseEnabled: false,
      },
    ],
  };

  const mockDatePlanning = new DatePlanningService();
  const mockGitHubClient = {
    resolveUserByEmail: vi.fn().mockResolvedValue('alice_bflghec'),
    getPrDeliverablesForDate: vi.fn().mockResolvedValue({
      username: 'alice_bflghec',
      sourceDate: '2026-10-15',
      isToday: true,
      pullRequests: [{ number: 42, title: 'feat: add task activation' }],
      htmlDescription: '<div><p>Task deliverables</p></div>',
      summaryText: '1 PR created: #42',
    }),
  } as unknown as GitHubClient;

  it('activates New tasks while preserving descriptions and recorded work fields', async () => {
    const candidateTasks = [{
      id: 2001,
      fields: {
        'System.Id': 2001,
        'System.Title': '3in1_PWA_MyAccount | 15 Oct',
        'System.AssignedTo': { displayName: 'Alice Smith', uniqueName: 'alice@example.com' },
        'System.State': 'New',
        'Custom.PlannedStartDate': '2026-10-15T04:00:00.000Z',
        'System.Description': 'Old description',
      },
    }];

    const patchCalls: any[] = [];
    const mockRepo: WorkItemRepository = {
      validateProject: vi.fn(),
      validateWorkItemType: vi.fn(),
      findLatestTaskForPerson: vi.fn(),
      discoverLatestTasksForPeople: vi.fn(),
      getExistingTasksForPerson: vi.fn(),
      findCandidateTasks: vi.fn().mockResolvedValue(candidateTasks),
      getWorkItem: vi.fn().mockResolvedValue({
        id: 2001,
        fields: {
          'System.State': 'Active',
          'System.AssignedTo': { displayName: 'Alice Smith', uniqueName: 'alice@example.com' },
        },
      }),
      createWorkItemWithReconciliation: vi.fn(),
      copyRelations: vi.fn(),
      patchWorkItem: vi.fn().mockImplementation(async (id, ops) => {
        patchCalls.push({ id, ops });
        return { id, rev: 2, fields: {} };
      }),
    };

    const useCase = new ActivateDailyTasksUseCase(baseConfig, mockRepo, mockDatePlanning, mockGitHubClient);
    const result = await useCase.execute({ asOf: '2026-10-15', dryRun: false });

    expect(result.totalFound).toBe(1);
    expect(result.totalActivated).toBe(1);
    expect(result.totalAlreadyActive).toBe(0);
    expect(result.totalAlreadyClosed).toBe(0);
    expect(result.totalFailed).toBe(0);
    expect(patchCalls).toHaveLength(1);

    const ops = patchCalls[0].ops;
    const stateOp = ops.find((op: any) => op.path === '/fields/System.State');
    expect(stateOp).toBeDefined();
    expect(stateOp.value).toBe('Active');

    const descOp = ops.find((op: any) => op.path === '/fields/System.Description');
    expect(descOp).toBeUndefined();
    expect(ops.some((operation: { path: string }) => operation.path.includes('ActualStart'))).toBe(false);
  });

  it('does NOT re-change tasks that are already in Active state', async () => {
    const candidateTasks = [{
      id: 2002,
      fields: {
        'System.Id': 2002,
        'System.Title': '3in1_PWA_MyAccount | 15 Oct',
        'System.AssignedTo': { displayName: 'Alice Smith', uniqueName: 'alice@example.com' },
        'System.State': 'Active',
        'Custom.PlannedStartDate': '2026-10-15T04:00:00.000Z',
      },
    }];

    const patchCalls: any[] = [];
    const mockRepo: WorkItemRepository = {
      validateProject: vi.fn(),
      validateWorkItemType: vi.fn(),
      findLatestTaskForPerson: vi.fn(),
      discoverLatestTasksForPeople: vi.fn(),
      getExistingTasksForPerson: vi.fn(),
      findCandidateTasks: vi.fn().mockResolvedValue(candidateTasks),
      getWorkItem: vi.fn(),
      createWorkItemWithReconciliation: vi.fn(),
      copyRelations: vi.fn(),
      patchWorkItem: vi.fn().mockImplementation(async (id, ops) => {
        patchCalls.push({ id, ops });
        return { id, rev: 2, fields: {} };
      }),
    };

    const useCase = new ActivateDailyTasksUseCase(baseConfig, mockRepo, mockDatePlanning, mockGitHubClient);
    const result = await useCase.execute({ asOf: '2026-10-15', dryRun: false });

    expect(result.totalFound).toBe(1);
    expect(result.totalActivated).toBe(0);
    expect(result.totalAlreadyActive).toBe(1);
    expect(result.totalFailed).toBe(0);
    expect(patchCalls).toHaveLength(0); // Zero patch calls because it was already active!
    expect(result.results[0].status).toBe('already_active');
  });

  it('skips Closed tasks without patching', async () => {
    const candidateTasks = [{
      id: 2003,
      fields: {
        'System.Id': 2003,
        'System.Title': '3in1_PWA_MyAccount | 15 Oct',
        'System.AssignedTo': { displayName: 'Alice Smith', uniqueName: 'alice@example.com' },
        'System.State': 'Closed',
        'Custom.PlannedStartDate': '2026-10-15T04:00:00.000Z',
      },
    }];

    const mockRepo: WorkItemRepository = {
      validateProject: vi.fn(),
      validateWorkItemType: vi.fn(),
      findLatestTaskForPerson: vi.fn(),
      discoverLatestTasksForPeople: vi.fn(),
      getExistingTasksForPerson: vi.fn(),
      findCandidateTasks: vi.fn().mockResolvedValue(candidateTasks),
      getWorkItem: vi.fn(),
      createWorkItemWithReconciliation: vi.fn(),
      copyRelations: vi.fn(),
      patchWorkItem: vi.fn(),
    };

    const useCase = new ActivateDailyTasksUseCase(baseConfig, mockRepo, mockDatePlanning, mockGitHubClient);
    const result = await useCase.execute({ asOf: '2026-10-15', dryRun: false });

    expect(result.totalFound).toBe(1);
    expect(result.totalActivated).toBe(0);
    expect(result.totalAlreadyActive).toBe(0);
    expect(result.totalAlreadyClosed).toBe(1);
    expect(result.results[0].status).toBe('already_closed');
  });

  it('reports tenant rule failure without fabricating actual dates or replaying writes', async () => {
    const candidateTasks = [{
      id: 2004,
      fields: {
        'System.Id': 2004,
        'System.Title': '3in1_PWA_MyAccount | 15 Oct',
        'System.AssignedTo': { displayName: 'Alice Smith', uniqueName: 'alice@example.com' },
        'System.State': 'New',
        'Custom.PlannedStartDate': '2026-10-15T04:00:00.000Z',
      },
    }];

    const patchCalls: any[] = [];
    const mockRepo: WorkItemRepository = {
      validateProject: vi.fn(),
      validateWorkItemType: vi.fn(),
      findLatestTaskForPerson: vi.fn(),
      discoverLatestTasksForPeople: vi.fn(),
      getExistingTasksForPerson: vi.fn(),
      findCandidateTasks: vi.fn().mockResolvedValue(candidateTasks),
      getWorkItem: vi.fn().mockResolvedValue({
        id: 2004,
        fields: {
          'System.State': 'Active',
          'System.AssignedTo': { displayName: 'Alice Smith', uniqueName: 'alice@example.com' },
        },
      }),
      createWorkItemWithReconciliation: vi.fn(),
      copyRelations: vi.fn(),
      patchWorkItem: vi.fn().mockImplementation(async (id, ops) => {
        patchCalls.push({ id, ops });
        if (patchCalls.length === 1) {
          throw new Error('TF401320: The work item cannot be updated because required process rules were not met.');
        }
        return { id, rev: 2, fields: {} };
      }),
    };

    const useCase = new ActivateDailyTasksUseCase(baseConfig, mockRepo, mockDatePlanning, mockGitHubClient);
    const result = await useCase.execute({ asOf: '2026-10-15', dryRun: false });

    expect(result.totalActivated).toBe(0);
    expect(result.totalFailed).toBe(1);
    expect(patchCalls).toHaveLength(1);
    expect(patchCalls[0].ops.some((op: any) => op.path.includes('ActualStart'))).toBe(false);
    expect(result.results[0].error).toContain('TF401320');
  });

  it('rejects matching display names when the authoritative account belongs to another person', async () => {
    const repository = {
      findCandidateTasks: vi.fn().mockResolvedValue([{
        id: 7001,
        fields: {
          'System.Title': '3in1_PWA_MyAccount | 15 Oct',
          'System.AssignedTo': { displayName: 'Alice Smith', uniqueName: 'different@example.com' },
          'System.State': 'New', 'Custom.PlannedStartDate': '2026-10-15T04:00:00Z',
        },
      }]),
      patchWorkItem: vi.fn(),
    } as unknown as WorkItemRepository;
    const useCase = new ActivateDailyTasksUseCase(baseConfig, repository, mockDatePlanning, mockGitHubClient);
    const result = await useCase.execute({ asOf: '2026-10-15', dryRun: true });
    expect(result.totalFound).toBe(0);
    expect(repository.patchWorkItem).not.toHaveBeenCalled();
  });

  it('matches and activates candidate task strictly as per its Planned Start Date', async () => {
    const candidateTasks = [{
      id: 3001,
      fields: {
        'System.Id': 3001,
        'System.Title': '3in1_PWA_MyAccount | Standup & Planning',
        'System.AssignedTo': { displayName: 'Alice Smith', uniqueName: 'alice@example.com' },
        'System.State': 'New',
        'Custom.PlannedStartDate': '2026-10-15T04:00:00.000Z',
      },
    }];

    const patchCalls: any[] = [];
    const mockRepo: WorkItemRepository = {
      validateProject: vi.fn(),
      validateWorkItemType: vi.fn(),
      findLatestTaskForPerson: vi.fn(),
      discoverLatestTasksForPeople: vi.fn(),
      getExistingTasksForPerson: vi.fn(),
      findCandidateTasks: vi.fn().mockResolvedValue(candidateTasks),
      getWorkItem: vi.fn().mockResolvedValue({
        id: 3001,
        fields: {
          'System.State': 'Active',
          'System.AssignedTo': { displayName: 'Alice Smith', uniqueName: 'alice@example.com' },
        },
      }),
      createWorkItemWithReconciliation: vi.fn(),
      copyRelations: vi.fn(),
      patchWorkItem: vi.fn().mockImplementation(async (id, ops) => {
        patchCalls.push({ id, ops });
        return { id, rev: 2, fields: {} };
      }),
    };

    const useCase = new ActivateDailyTasksUseCase(baseConfig, mockRepo, mockDatePlanning, mockGitHubClient);
    const result = await useCase.execute({ asOf: '2026-10-15', dryRun: false });

    expect(result.totalActivated).toBe(1);
    expect(result.results[0].taskId).toBe(3001);
    expect(result.results[0].status).toBe('activated');
  });
});
