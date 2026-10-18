import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CloseDailyTasksUseCase } from '../../src/application/use-cases/close-daily-tasks.js';
import { DatePlanningService } from '../../src/domain/index.js';
import { AppConfig, WorkItemRepository } from '../../src/domain/ports/repositories.js';
import { GitHubClient } from '../../src/infrastructure/github/github-client.js';

describe('CloseDailyTasksUseCase', () => {
  const baseConfig: AppConfig = {
    organization: 'BFLDevOpsOrg',
    project: '3in1_Agile_Projects',
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
        key: 'yash_somani',
        name: 'Yash Somani',
        assignedTo: 'yash.somani@bajajfinserv.in',
        role: 'Dev On-Role',
        enabled: true,
      },
      {
        key: 'mukul_ramteke',
        name: 'Mukul Ramteke',
        assignedTo: 'mukul.ramteke@bajajfinserv.in',
        role: 'SDM',
        enabled: true,
      },
    ],
  };

  let mockWorkItemRepo: WorkItemRepository;
  let mockGitHubClient: any;
  let datePlanning: DatePlanningService;

  beforeEach(() => {
    mockWorkItemRepo = {
      validateProject: vi.fn(),
      validateWorkItemType: vi.fn(),
      findLatestTaskForPerson: vi.fn(),
      discoverLatestTasksForPeople: vi.fn(),
      getExistingTasksForPerson: vi.fn(),
      findCandidateTasks: vi.fn(),
      getWorkItem: vi.fn(),
      createWorkItemWithReconciliation: vi.fn(),
      copyRelations: vi.fn(),
      patchWorkItem: vi.fn().mockResolvedValue({ id: 12345 }),
    };

    mockGitHubClient = {
      resolveUserByEmail: vi.fn().mockImplementation((email: string) => {
        if (email.includes('yash')) return 'yash-somani_bflghec';
        if (email.includes('mukul')) return 'mukul-ramteke_bflghec';
        return null;
      }),
      getPrDeliverablesForDate: vi.fn().mockImplementation((username: string, date: string) => {
        if (username === 'yash-somani_bflghec') {
          return {
            username,
            sourceDate: date,
            isToday: true,
            pullRequests: [{ number: 99, title: 'feat: add task close' }],
            htmlDescription: '<div><p>Daily Deliverables &amp; Pull Requests (2026-10-15)</p><ul><li>PR #99</li></ul></div>',
            summaryText: '1 PR(s) created today: #99',
          };
        }
        return {
          username,
          sourceDate: date,
          isToday: false,
          pullRequests: [],
          htmlDescription: '<div><p>Daily Deliverables &amp; Activities (2026-10-15)</p><p>No Pull Requests were created today. Scheduled development, code review, bug fixes, and verification tasks completed as planned.</p></div>',
          summaryText: 'No PRs created today. Daily engineering deliverables executed as planned.',
        };
      }),
    };

    datePlanning = new DatePlanningService();
  });

  it('does not close another work-item series just because the assigned person and date match', async () => {
    (mockWorkItemRepo.findCandidateTasks as any).mockResolvedValue([
      {
        id: 8001,
        fields: {
          'System.Title': 'Unrelated_Project | 15 Oct',
          'System.AssignedTo': 'yash.somani@bajajfinserv.in',
          'System.State': 'Active',
          'Custom.PlannedStartdate': '2026-10-15T04:00:00.000Z',
        },
      },
    ]);
    const useCase = new CloseDailyTasksUseCase(
      baseConfig, mockWorkItemRepo, datePlanning, mockGitHubClient as GitHubClient
    );
    const result = await useCase.execute({
      asOf: '2026-10-15',
      personKeys: ['yash_somani'],
      dryRun: false,
    });
    expect(result.totalFound).toBe(0);
    expect(result.totalClosed).toBe(0);
    expect(mockWorkItemRepo.patchWorkItem).not.toHaveBeenCalled();
  });

  it('closes without fabricating remaining or completed work hours', async () => {
    const targetDate = '2026-10-15';
    const candidateTasks = [
      {
        id: 5001,
        fields: {
          'System.Id': 5001,
          'System.Title': '3in1_PWA_MyAccount | 15-10-2026',
          'System.AssignedTo': 'yash.somani@bajajfinserv.in',
          'System.State': 'Active',
          'Custom.PlannedStartdate': '2026-10-15T04:00:00.000Z',
          'Microsoft.VSTS.Scheduling.RemainingWork': 4,
          'Microsoft.VSTS.Scheduling.CompletedWork': 4,
        },
      },
    ];

    (mockWorkItemRepo.findCandidateTasks as any).mockResolvedValue(candidateTasks);

    const useCase = new CloseDailyTasksUseCase(
      baseConfig,
      mockWorkItemRepo,
      datePlanning,
      mockGitHubClient as unknown as GitHubClient
    );

    const output = await useCase.execute({
      asOf: targetDate,
      personKeys: ['yash_somani'],
      bypassRules: true,
    });

    expect(output.totalFound).toBe(1);
    expect(output.totalClosed).toBe(1);
    expect(output.totalFailed).toBe(0);

    const result = output.results[0];
    expect(result.status).toBe('closed');
    expect(result.taskId).toBe(5001);
    expect(result.remainingWork).toBe(4);
    expect(result.completedWork).toBe(4);
    expect(result.actualStartDate).toBe('');
    expect(result.githubUsername).toBe('yash-somani_bflghec');
    expect(result.isTodayPr).toBe(true);

    // Workflow bypass stays disabled, even when a legacy caller requests it.
    expect(mockWorkItemRepo.patchWorkItem).toHaveBeenCalledTimes(1);
    const [callId, ops, options] = (mockWorkItemRepo.patchWorkItem as any).mock.calls[0];
    expect(callId).toBe(5001);
    expect(options).toEqual({ bypassRules: false });

    // Verify atomic patch operations
    const opMap = new Map(ops.map((o: any) => [o.path, o.value]));
    expect(opMap.has('/fields/Microsoft.VSTS.Scheduling.RemainingWork')).toBe(false);
    expect(opMap.has('/fields/Microsoft.VSTS.Scheduling.CompletedWork')).toBe(false);
    expect(opMap.has('/fields/Custom.ActualStartdate')).toBe(false);
    expect(opMap.has('/fields/Custom.ActualEnddate')).toBe(false);
    expect(opMap.has('/fields/Microsoft.VSTS.Common.ClosedDate')).toBe(false);
    expect(opMap.get('/fields/System.State')).toBe('Closed');
    expect(opMap.has('/fields/System.Reason')).toBe(false);
    expect(opMap.has('/fields/System.Description')).toBe(false);
    expect(opMap.get('/fields/System.History')).toContain('unchanged');
  });

  it('properly generates current-day deliverable description when individual user has no PRs today', async () => {
    const targetDate = '2026-10-15';
    const candidateTasks = [
      {
        id: 5002,
        fields: {
          'System.Id': 5002,
          'System.Title': '3in1_PWA_MyAccount | 15-10-2026',
          'System.AssignedTo': 'mukul.ramteke@bajajfinserv.in',
          'System.State': 'Active',
          'Custom.PlannedStartdate': '2026-10-15T04:00:00.000Z',
        },
      },
    ];

    (mockWorkItemRepo.findCandidateTasks as any).mockResolvedValue(candidateTasks);

    const useCase = new CloseDailyTasksUseCase(
      baseConfig,
      mockWorkItemRepo,
      datePlanning,
      mockGitHubClient as unknown as GitHubClient
    );

    const output = await useCase.execute({
      asOf: targetDate,
      personKeys: ['mukul_ramteke'],
    });

    expect(output.totalClosed).toBe(1);
    const result = output.results[0];
    expect(result.isTodayPr).toBe(false);
    expect(result.prCount).toBe(0);
    expect(result.prSourceDate).toBe('2026-10-15');
    expect(result.htmlDescription).toContain('No Pull Requests were created today');
    const [, ops] = (mockWorkItemRepo.patchWorkItem as any).mock.calls[0];
    expect(ops.some((op: any) => op.path === '/fields/System.Description')).toBe(false);
    expect(ops.some((op: any) => op.path === '/fields/Custom.ActualEnddate')).toBe(false);
  });

  it('reports unrecorded hours as unknown rather than invented zero or eight', async () => {
    (mockWorkItemRepo.findCandidateTasks as any).mockResolvedValue([{
      id: 5022,
      fields: {
        'System.Title': '3in1_PWA_MyAccount | 15 Oct 2026',
        'System.AssignedTo': 'yash.somani@bajajfinserv.in',
        'System.State': 'Active',
        'Custom.PlannedStartdate': '2026-10-15T04:00:00.000Z',
      },
    }]);
    const output = await new CloseDailyTasksUseCase(
      baseConfig, mockWorkItemRepo, datePlanning, mockGitHubClient as GitHubClient
    ).execute({ asOf: '2026-10-15', personKeys: ['yash_somani'] });
    expect(output.totalClosed).toBe(1);
    expect(output.results[0].completedWork).toBeNull();
    expect(output.results[0].remainingWork).toBeNull();
    const [, ops] = (mockWorkItemRepo.patchWorkItem as any).mock.calls[0];
    expect(ops.find((op: any) => op.path === '/fields/System.History').value).toContain('not recorded');
  });

  it('skips tasks that are already Closed without calling patch', async () => {
    const targetDate = '2026-10-15';
    const candidateTasks = [
      {
        id: 5003,
        fields: {
          'System.Id': 5003,
          'System.Title': '3in1_PWA_MyAccount | Oct 15',
          'System.AssignedTo': 'yash.somani@bajajfinserv.in',
          'System.State': 'Closed',
          'Custom.PlannedStartdate': '2026-10-15T04:00:00.000Z',
        },
      },
    ];

    (mockWorkItemRepo.findCandidateTasks as any).mockResolvedValue(candidateTasks);

    const useCase = new CloseDailyTasksUseCase(
      baseConfig,
      mockWorkItemRepo,
      datePlanning,
      mockGitHubClient as unknown as GitHubClient
    );

    const output = await useCase.execute({ asOf: targetDate });

    expect(output.totalAlreadyClosed).toBe(1);
    expect(output.totalClosed).toBe(0);
    expect(mockWorkItemRepo.patchWorkItem).not.toHaveBeenCalled();
    expect(output.results[0].status).toBe('already_closed');
  });

  it('skips tasks that are in Done/Resolved/Completed states or have ClosedDate without calling patch', async () => {
    const targetDate = '2026-10-15';
    const candidateTasks = [
      {
        id: 5010,
        fields: {
          'System.Id': 5010,
          'System.Title': '3in1_PWA_MyAccount | Oct 15',
          'System.AssignedTo': 'yash.somani@bajajfinserv.in',
          'System.State': 'Done',
          'Custom.PlannedStartdate': '2026-10-15T04:00:00.000Z',
        },
      },
      {
        id: 5011,
        fields: {
          'System.Id': 5011,
          'System.Title': '3in1_PWA_MyAccount | Oct 15',
          'System.AssignedTo': 'mukul.ramteke@bajajfinserv.in',
          'System.State': 'Active',
          'Custom.ActualEnddate': '2026-10-15T13:00:00Z',
          'Microsoft.VSTS.Common.ClosedDate': '2026-10-15T13:00:00Z',
          'Custom.PlannedStartdate': '2026-10-15T04:00:00.000Z',
        },
      },
    ];

    (mockWorkItemRepo.findCandidateTasks as any).mockResolvedValue(candidateTasks);

    const useCase = new CloseDailyTasksUseCase(
      baseConfig,
      mockWorkItemRepo,
      datePlanning,
      mockGitHubClient as unknown as GitHubClient
    );

    const output = await useCase.execute({ asOf: targetDate });

    expect(output.totalAlreadyClosed).toBe(2);
    expect(output.totalClosed).toBe(0);
    expect(mockWorkItemRepo.patchWorkItem).not.toHaveBeenCalled();
    expect(output.results[0].status).toBe('already_closed');
    expect(output.results[1].status).toBe('already_closed');
  });

  it('runs simulation in dry-run mode without modifying Azure DevOps', async () => {
    const targetDate = '2026-10-15';
    const candidateTasks = [
      {
        id: 5004,
        fields: {
          'System.Id': 5004,
          'System.Title': '3in1_PWA_MyAccount | 15-10-2026',
          'System.AssignedTo': 'yash.somani@bajajfinserv.in',
          'System.State': 'New',
          'Custom.PlannedStartdate': '2026-10-15T04:00:00.000Z',
        },
      },
    ];

    (mockWorkItemRepo.findCandidateTasks as any).mockResolvedValue(candidateTasks);

    const useCase = new CloseDailyTasksUseCase(
      baseConfig,
      mockWorkItemRepo,
      datePlanning,
      mockGitHubClient as unknown as GitHubClient
    );

    const output = await useCase.execute({
      asOf: targetDate,
      dryRun: true,
    });

    expect(output.dryRun).toBe(true);
    expect(output.results[0].status).toBe('simulated');
    expect(mockWorkItemRepo.patchWorkItem).not.toHaveBeenCalled();
  });

  it('acquires and releases concurrency lock during non-dry-run execution', async () => {
    const targetDate = '2026-10-15';
    (mockWorkItemRepo.findCandidateTasks as any).mockResolvedValue([]);

    const mockLockRepo = {
      acquire: vi.fn().mockReturnValue(true),
      release: vi.fn(),
      isLocked: vi.fn().mockReturnValue(false),
      getLockInfo: vi.fn().mockReturnValue(null),
    };

    const useCase = new CloseDailyTasksUseCase(
      baseConfig,
      mockWorkItemRepo,
      datePlanning,
      mockGitHubClient as unknown as GitHubClient,
      undefined,
      undefined,
      mockLockRepo
    );

    await useCase.execute({ asOf: targetDate, dryRun: false });
    expect(mockLockRepo.acquire).toHaveBeenCalled();
    expect(mockLockRepo.release).toHaveBeenCalled();
  });

  it('rejects execution if another process currently holds the lock', async () => {
    const mockLockRepo = {
      acquire: vi.fn().mockReturnValue(false),
      release: vi.fn(),
      isLocked: vi.fn().mockReturnValue(true),
      getLockInfo: vi.fn().mockReturnValue({ pid: 1234, acquiredAt: new Date().toISOString(), stale: false }),
    };

    const useCase = new CloseDailyTasksUseCase(
      baseConfig,
      mockWorkItemRepo,
      datePlanning,
      mockGitHubClient as unknown as GitHubClient,
      undefined,
      undefined,
      mockLockRepo
    );

    await expect(useCase.execute({ dryRun: false })).rejects.toThrow('Another execution is already running');
    expect(mockLockRepo.release).not.toHaveBeenCalled();
  });

  it('records an entry in JournalRepository when a task is closed', async () => {
    const targetDate = '2026-10-15';
    const candidateTasks = [
      {
        id: 5005,
        fields: {
          'System.Id': 5005,
          'System.Title': '3in1_PWA_MyAccount | Oct 15',
          'System.AssignedTo': 'yash.somani@bajajfinserv.in',
          'System.State': 'Active',
          'Custom.PlannedStartdate': '2026-10-15T04:00:00.000Z',
        },
      },
    ];

    (mockWorkItemRepo.findCandidateTasks as any).mockResolvedValue(candidateTasks);

    const mockJournalRepo = {
      record: vi.fn().mockResolvedValue(undefined),
      getEntries: vi.fn().mockResolvedValue([]),
      getUnfinishedRelations: vi.fn().mockResolvedValue([]),
      markRepaired: vi.fn().mockResolvedValue(true),
      exportCsv: vi.fn().mockResolvedValue(''),
      exportJson: vi.fn().mockResolvedValue('[]'),
    };

    const useCase = new CloseDailyTasksUseCase(
      baseConfig,
      mockWorkItemRepo,
      datePlanning,
      mockGitHubClient as unknown as GitHubClient,
      undefined,
      mockJournalRepo
    );

    const output = await useCase.execute({ asOf: targetDate, dryRun: false });
    expect(output.totalClosed).toBe(1);
    expect(mockJournalRepo.record).toHaveBeenCalledWith(expect.objectContaining({
      sourceTaskId: 5005,
      createdWorkItemId: 5005,
      fieldCopyStatus: 'SUCCESS',
      relationCopyStatus: 'SUCCESS',
    }));
  });

  it('gracefully handles patch failure and marks task as failed', async () => {
    const targetDate = '2026-10-15';
    const candidateTasks = [
      {
        id: 5006,
        fields: {
          'System.Id': 5006,
          'System.Title': '3in1_PWA_MyAccount | Oct 15',
          'System.AssignedTo': 'yash.somani@bajajfinserv.in',
          'System.State': 'Active',
          'Custom.PlannedStartdate': '2026-10-15T04:00:00.000Z',
        },
      },
    ];

    (mockWorkItemRepo.findCandidateTasks as any).mockResolvedValue(candidateTasks);
    (mockWorkItemRepo.patchWorkItem as any).mockRejectedValue(new Error('Rule validation failed: TF400898'));

    const useCase = new CloseDailyTasksUseCase(
      baseConfig,
      mockWorkItemRepo,
      datePlanning,
      mockGitHubClient as unknown as GitHubClient
    );

    const output = await useCase.execute({ asOf: targetDate, dryRun: false });
    expect(output.totalFailed).toBe(1);
    expect(output.totalClosed).toBe(0);
    expect(output.results[0].status).toBe('failed');
    expect(output.results[0].error).toContain('Rule validation failed');
    // Rejected Azure transitions cannot invent an end-of-work timestamp.
    expect(output.results[0].actualEndDate).toBe('');
  });

  it('never invents a closure time or work end time', async () => {
    (mockWorkItemRepo.findCandidateTasks as any).mockResolvedValue([{
      id: 7001,
      fields: {
        'System.Id': 7001,
        'System.Title': '3in1_PWA_MyAccount | 15-10-2026',
        'System.AssignedTo': 'yash.somani@bajajfinserv.in',
        'System.State': 'Active',
        'Custom.PlannedStartdate': '2026-10-15T04:00:00.000Z',
        'Custom.ActualEndDate': null,
        'Custom.ActualClosedDate': null,
      },
    }]);
    const useCase = new CloseDailyTasksUseCase(
      baseConfig, mockWorkItemRepo, datePlanning, mockGitHubClient as unknown as GitHubClient
    );
    const result = await useCase.execute({ asOf: '2026-10-15', dryRun: false });
    expect(result.totalClosed).toBe(1);
    const [, ops] = (mockWorkItemRepo.patchWorkItem as any).mock.calls[0];
    const paths = ops.map((op: any) => op.path);
    expect(paths).toEqual(['/fields/System.History', '/fields/System.State']);
    expect(result.results[0].actualEndDate).toBe('');
  });

  it('reports audit persistence failure separately from a successful Azure closure', async () => {
    const candidateTasks = [{
      id: 5010,
      fields: {
        'System.Id': 5010,
        'System.Title': '3in1_PWA_MyAccount | Oct 15',
        'System.AssignedTo': 'yash.somani@bajajfinserv.in',
        'System.State': 'Active',
        'Custom.PlannedStartdate': '2026-10-15T04:00:00.000Z',
      },
    }];
    (mockWorkItemRepo.findCandidateTasks as any).mockResolvedValue(candidateTasks);
    const journal = {
      record: vi.fn().mockRejectedValue(new Error('disk full')),
    } as any;
    const useCase = new CloseDailyTasksUseCase(
      baseConfig,
      mockWorkItemRepo,
      datePlanning,
      mockGitHubClient as unknown as GitHubClient,
      undefined,
      journal
    );

    const output = await useCase.execute({ asOf: '2026-10-15', dryRun: false });
    expect(output.totalClosed).toBe(1);
    expect(output.totalFailed).toBe(0);
    expect(output.results[0].status).toBe('closed');
    expect(output.results[0].auditWarning).toContain('disk full');
    expect(mockWorkItemRepo.patchWorkItem).toHaveBeenCalledOnce();
  });

});
