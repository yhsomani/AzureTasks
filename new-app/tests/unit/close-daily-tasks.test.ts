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

  it('recovers from TF401320 using PascalCase fields when tenant uses Custom.PlannedStartDate', async () => {
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

    expect(result.totalClosed).toBe(1);
    expect(result.totalFailed).toBe(0);
    expect(patchCalls).toHaveLength(2);

    // Second patch call should have used PascalCase fields
    const recoveryOps = patchCalls[1].ops;
    const paths = recoveryOps.map((op: any) => op.path);
    expect(paths).toContain('/fields/Custom.ActualStartDate');
    expect(paths).toContain('/fields/Custom.ActualEndDate');
    expect(paths).not.toContain('/fields/Custom.ActualStartdate');
    expect(paths).not.toContain('/fields/Custom.ActualEnddate');
  });

  it('recovers from TF401320 using lowercase fields when tenant uses Custom.PlannedStartdate', async () => {
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

    expect(result.totalClosed).toBe(1);
    expect(result.totalFailed).toBe(0);
    expect(patchCalls).toHaveLength(2);

    // Second patch call should have used lowercase fields
    const recoveryOps = patchCalls[1].ops;
    const paths = recoveryOps.map((op: any) => op.path);
    expect(paths).toContain('/fields/Custom.ActualStartdate');
    expect(paths).toContain('/fields/Custom.ActualEnddate');
    expect(paths).not.toContain('/fields/Custom.ActualStartDate');
    expect(paths).not.toContain('/fields/Custom.ActualEndDate');
  });

  it('attempts alternate casing fallback if initial recovery patch fails', async () => {
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

    expect(result.totalClosed).toBe(1);
    expect(result.totalFailed).toBe(0);
    expect(patchCalls).toHaveLength(3);

    // Third patch call should have swapped to PascalCase
    const finalOps = patchCalls[2].ops;
    const paths = finalOps.map((op: any) => op.path);
    expect(paths).toContain('/fields/Custom.ActualStartDate');
    expect(paths).toContain('/fields/Custom.ActualEndDate');
  });
});
