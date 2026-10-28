import { describe, it, expect, vi } from 'vitest';
import { CloseDailyTasksUseCase } from '../../src/application/use-cases/close-daily-tasks.js';
import { DatePlanningService } from '../../src/domain/index.js';
import { AppConfig, WorkItemRepository } from '../../src/domain/ports/repositories.js';
import { GitHubClient } from '../../src/infrastructure/github/github-client.js';

describe('CloseDailyTasksUseCase - Process Rule Recovery (TF401320)', () => {
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
      pullRequests: [{ number: 42, title: 'feat: add task close' }],
      htmlDescription: '<div><p>Task deliverables</p></div>',
      summaryText: '1 PR created: #42',
    }),
  } as unknown as GitHubClient;

  it('preserves PascalCase fields when tenant rules reject closure', async () => {
    const candidateTasks = [{
      id: 1001,
      fields: {
        'System.Id': 1001,
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
      getWorkItem: vi.fn().mockResolvedValue({
        id: 1001,
        fields: {
          'System.State': 'Closed',
          'System.AssignedTo': { displayName: 'Alice Smith', uniqueName: 'alice@example.com' },
        },
      }),
      createWorkItemWithReconciliation: vi.fn(),
      copyRelations: vi.fn(),
      patchWorkItem: vi.fn().mockImplementation(async (id, ops) => {
        patchCalls.push({ id, ops });
        if (patchCalls.length === 1) {
          // Initial patch fails due to TF401320 rule error
          throw new Error('TF401320: The work item cannot be closed because required process rules were not met.');
        }
        return { id, rev: 2, fields: {} };
      }),
    };

    const useCase = new CloseDailyTasksUseCase(baseConfig, mockRepo, mockDatePlanning, mockGitHubClient);
    const result = await useCase.execute({ asOf: '2026-10-15', dryRun: false });

    expect(result.totalClosed).toBe(0);
    expect(result.totalFailed).toBe(1);
    expect(patchCalls).toHaveLength(1);
    expect(patchCalls[0].ops.some((op: any) => op.path.includes('/Custom.'))).toBe(false);
  });

  it('preserves lowercase fields when tenant rules reject closure', async () => {
    const candidateTasks = [{
      id: 1002,
      fields: {
        'System.Id': 1002,
        'System.Title': '3in1_PWA_MyAccount | 15 Oct',
        'System.AssignedTo': { displayName: 'Alice Smith', uniqueName: 'alice@example.com' },
        'System.State': 'Active',
        'Custom.PlannedStartdate': '2026-10-15T04:00:00.000Z',
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
        id: 1002,
        fields: {
          'System.State': 'Closed',
          'System.AssignedTo': { displayName: 'Alice Smith', uniqueName: 'alice@example.com' },
        },
      }),
      createWorkItemWithReconciliation: vi.fn(),
      copyRelations: vi.fn(),
      patchWorkItem: vi.fn().mockImplementation(async (id, ops) => {
        patchCalls.push({ id, ops });
        if (patchCalls.length === 1) {
          throw new Error('TF401320: Rule error on closed transition');
        }
        return { id, rev: 2, fields: {} };
      }),
    };

    const useCase = new CloseDailyTasksUseCase(baseConfig, mockRepo, mockDatePlanning, mockGitHubClient);
    const result = await useCase.execute({ asOf: '2026-10-15', dryRun: false });

    expect(result.totalClosed).toBe(0);
    expect(result.totalFailed).toBe(1);
    expect(patchCalls).toHaveLength(1);
    expect(patchCalls[0].ops.some((op: any) => op.path.includes('/Custom.'))).toBe(false);
  });

  it('does not attempt alternate casing fallback after a rejected transition', async () => {
    const candidateTasks = [{
      id: 1003,
      fields: {
        'System.Id': 1003,
        'System.Title': '3in1_PWA_MyAccount | 15 Oct',
        'System.AssignedTo': { displayName: 'Alice Smith', uniqueName: 'alice@example.com' },
        'System.State': 'Active',
        'Custom.PlannedStartdate': '2026-10-15T04:00:00.000Z',
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
        id: 1003,
        fields: {
          'System.State': 'Closed',
          'System.AssignedTo': { displayName: 'Alice Smith', uniqueName: 'alice@example.com' },
        },
      }),
      createWorkItemWithReconciliation: vi.fn(),
      copyRelations: vi.fn(),
      patchWorkItem: vi.fn().mockImplementation(async (id, ops) => {
        patchCalls.push({ id, ops });
        if (patchCalls.length === 1) {
          // Standard close fails
          throw new Error('TF401320: Rule error');
        }
        if (patchCalls.length === 2) {
          // First recovery attempt with lowercase fails because server only knows PascalCase
          throw new Error('TF401320: Field Custom.ActualStartdate is not recognized');
        }
        // Fallback with swapped casing succeeds!
        return { id, rev: 3, fields: {} };
      }),
    };

    const useCase = new CloseDailyTasksUseCase(baseConfig, mockRepo, mockDatePlanning, mockGitHubClient);
    const result = await useCase.execute({ asOf: '2026-10-15', dryRun: false });

    expect(result.totalClosed).toBe(0);
    expect(result.totalFailed).toBe(1);
    expect(patchCalls).toHaveLength(1);
  });

  it('does not invent estimate, description or actual dates to satisfy missing tenant evidence', async () => {
    // This reproduces the exact failure: task #10707242 had no Original Estimate,
    // no Actual dates, no Planned dates, and no Description
    const candidateTasks = [{
      id: 10707242,
      fields: {
        'System.Id': 10707242,
        'System.Title': '3in1_PWA_MyAccount | 22 Oct',
        'System.AssignedTo': { displayName: 'Alice Smith', uniqueName: 'alice@example.com' },
        'System.State': 'New',
        'Custom.PlannedStartDate': '2026-10-22T04:00:00.000Z',
        // No OriginalEstimate, no CompletedWork, no RemainingWork
        // No ActualStartDate, no ActualEndDate
        // No Description
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
        id: 10707242,
        fields: {
          'System.State': 'Closed',
          'System.AssignedTo': { displayName: 'Alice Smith', uniqueName: 'alice@example.com' },
        },
      }),
      createWorkItemWithReconciliation: vi.fn(),
      copyRelations: vi.fn(),
      patchWorkItem: vi.fn().mockImplementation(async (id, ops) => {
        patchCalls.push({ id, ops });
        if (patchCalls.length === 1) {
          // Mirrors the real error: OriginalEstimate Required + 6 additional errors
          throw new Error(
            'TF401320: Rule Error for field Original Estimate. Error code: Required, InvalidEmpty. ' +
            '6 additional errors occurred during validation of the work item.'
          );
        }
        return { id, rev: 2, fields: {} };
      }),
    };

    const useCase = new CloseDailyTasksUseCase(baseConfig, mockRepo, mockDatePlanning, mockGitHubClient);
    const result = await useCase.execute({ asOf: '2026-10-22', dryRun: false });

    expect(result.totalClosed).toBe(0);
    expect(result.totalFailed).toBe(1);
    expect(patchCalls).toHaveLength(1);
    const paths = patchCalls[0].ops.map((op: any) => op.path);
    expect(paths).not.toContain('/fields/Microsoft.VSTS.Scheduling.OriginalEstimate');
    expect(paths).not.toContain('/fields/Microsoft.VSTS.Scheduling.CompletedWork');
    expect(paths).not.toContain('/fields/System.Description');
    expect(paths.some((value: string) => value.includes('/Custom.'))).toBe(false);
  });

  it('excludes people who have autoCloseEnabled set to false when running in all-members mode', async () => {
    const configWithExclusions: AppConfig = {
      ...baseConfig,
      people: [
        {
          key: 'user1',
          name: 'Alice Smith',
          assignedTo: 'alice@example.com',
          enabled: true,
          autoCloseEnabled: true,
        },
        {
          key: 'user2',
          name: 'Bob Jones',
          assignedTo: 'bob@example.com',
          enabled: true,
          autoCloseEnabled: false,
        },
      ],
    };

    const mockRepo: any = {
      findCandidateTasks: vi.fn().mockResolvedValue([
        {
          id: 2001,
          fields: {
            'System.Id': 2001,
            'System.Title': '3in1_PWA_MyAccount | 15 Oct',
            'System.AssignedTo': { displayName: 'Alice Smith', uniqueName: 'alice@example.com' },
            'System.State': 'Active',
            'Custom.PlannedStartDate': '2026-10-15T04:00:00.000Z',
            'Microsoft.VSTS.Scheduling.CompletedWork': 8,
            'Microsoft.VSTS.Scheduling.RemainingWork': 0,
          },
        },
        {
          id: 2002,
          fields: {
            'System.Id': 2002,
            'System.Title': '3in1_PWA_MyAccount | 15 Oct',
            'System.AssignedTo': { displayName: 'Bob Jones', uniqueName: 'bob@example.com' },
            'System.State': 'Active',
            'Custom.PlannedStartDate': '2026-10-15T04:00:00.000Z',
            'Microsoft.VSTS.Scheduling.CompletedWork': 8,
            'Microsoft.VSTS.Scheduling.RemainingWork': 0,
          },
        },
      ]),
      patchWorkItem: vi.fn().mockResolvedValue({ id: 2001, fields: { 'System.State': 'Closed' } }),
      getWorkItem: vi.fn().mockResolvedValue({ id: 2001, fields: { 'System.State': 'Closed' } }),
    };

    const useCase = new CloseDailyTasksUseCase(configWithExclusions, mockRepo, mockDatePlanning, mockGitHubClient);
    const result = await useCase.execute({ asOf: '2026-10-15', dryRun: false });

    // Only Alice Smith should be closed; Bob Jones is excluded because autoCloseEnabled is false
    expect(result.totalFound).toBe(1);
    expect(result.totalClosed).toBe(1);
    expect(result.results[0].personKey).toBe('user1');
    expect(mockRepo.patchWorkItem).toHaveBeenCalledTimes(1);
  });

  it('allows explicitly closing an excluded member when personKeys is provided', async () => {
    const configWithExclusions: AppConfig = {
      ...baseConfig,
      people: [
        {
          key: 'user2',
          name: 'Bob Jones',
          assignedTo: 'bob@example.com',
          enabled: true,
          autoCloseEnabled: false,
        },
      ],
    };

    const mockRepo: any = {
      findCandidateTasks: vi.fn().mockResolvedValue([
        {
          id: 2002,
          fields: {
            'System.Id': 2002,
            'System.Title': '3in1_PWA_MyAccount | 15 Oct',
            'System.AssignedTo': { displayName: 'Bob Jones', uniqueName: 'bob@example.com' },
            'System.State': 'Active',
            'Custom.PlannedStartDate': '2026-10-15T04:00:00.000Z',
            'Microsoft.VSTS.Scheduling.CompletedWork': 8,
            'Microsoft.VSTS.Scheduling.RemainingWork': 0,
          },
        },
      ]),
      patchWorkItem: vi.fn().mockResolvedValue({ id: 2002, fields: { 'System.State': 'Closed' } }),
      getWorkItem: vi.fn().mockResolvedValue({ id: 2002, fields: { 'System.State': 'Closed' } }),
    };

    const useCase = new CloseDailyTasksUseCase(configWithExclusions, mockRepo, mockDatePlanning, mockGitHubClient);
    const result = await useCase.execute({ asOf: '2026-10-15', personKeys: ['user2'], dryRun: false });

    // Explicit manual execution includes Bob Jones even if autoCloseEnabled is false
    expect(result.totalFound).toBe(1);
    expect(result.totalClosed).toBe(1);
    expect(result.results[0].personKey).toBe('user2');
  });

  it('matches and closes candidate task strictly as per its Planned Start Date', async () => {
    const candidateTasks = [{
      id: 7001,
      fields: {
        'System.Id': 7001,
        'System.Title': '3in1_PWA_MyAccount | Code Review and Testing',
        'System.AssignedTo': { displayName: 'Alice Smith', uniqueName: 'alice@example.com' },
        'System.State': 'Active',
        'Custom.PlannedStartDate': '2026-10-15T04:00:00.000Z',
        'Microsoft.VSTS.Scheduling.CompletedWork': 8,
        'Microsoft.VSTS.Scheduling.RemainingWork': 0,
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
        id: 7001,
        fields: {
          'System.State': 'Closed',
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

    const useCase = new CloseDailyTasksUseCase(baseConfig, mockRepo, mockDatePlanning, mockGitHubClient);
    const result = await useCase.execute({ asOf: '2026-10-15', dryRun: false });

    expect(result.totalClosed).toBe(1);
    expect(result.results[0].taskId).toBe(7001);
    expect(result.results[0].status).toBe('closed');
  });
});
