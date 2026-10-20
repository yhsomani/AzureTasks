import { describe, it, expect, vi } from 'vitest';
import { GitHubClient } from '../../src/infrastructure/github/github-client.js';
import { CloseDailyTasksUseCase } from '../../src/application/use-cases/close-daily-tasks.js';
import {
  RepairRelationsUseCase,
  OrphanTaskItem,
} from '../../src/application/use-cases/repair-relations.js';
import { DatePlanningService } from '../../src/domain/index.js';
import {
  AppConfig,
  WorkItemRepository,
  JournalRepository,
  LockRepository,
} from '../../src/domain/ports/repositories.js';
import { WorkItem } from '../../src/domain/entities/task.js';

describe('Empirical Challenger 2: GitHubClient Timeout & Retry Resilience', () => {
  describe('1. Timeout & AbortController Handling', () => {
    it('aborts hanging request when timeout threshold is exceeded', async () => {
      let abortedSignal: boolean = false;
      const mockFetch = vi.fn().mockImplementation((_url: string, init: any) => {
        return new Promise((_, reject) => {
          if (init?.signal) {
            init.signal.addEventListener('abort', () => {
              abortedSignal = true;
              const err = new Error('The operation was aborted');
              err.name = 'AbortError';
              reject(err);
            });
          }
        });
      });

      const client = new GitHubClient({
        fetchFn: mockFetch,
        timeout: 25,
        maxRetries: 0,
        initialRetryDelayMs: 5,
      });

      await expect(client.getUserPullRequests('dev-user'))
        .rejects.toThrow(/GitHub API request timed out after 25ms/);
      expect(abortedSignal).toBe(true);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('retries after transient timeout and succeeds on subsequent attempt', async () => {
      let callCount = 0;
      const mockFetch = vi.fn().mockImplementation((_url: string, init: any) => {
        callCount++;
        if (callCount === 1) {
          return new Promise((_, reject) => {
            init?.signal?.addEventListener('abort', () => {
              const err = new Error('The operation was aborted');
              err.name = 'AbortError';
              reject(err);
            });
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: { get: () => null },
          json: async () => ({
            items: [
              {
                id: 101,
                number: 1,
                title: 'Recovered PR',
                html_url: 'https://github.com/pr/1',
                state: 'open',
                created_at: '2026-10-15T12:00:00Z',
              },
            ],
          }),
        });
      });

      const client = new GitHubClient({
        fetchFn: mockFetch,
        timeout: 30,
        maxRetries: 2,
        initialRetryDelayMs: 5,
      });

      const prs = await client.getUserPullRequests('transient-timeout-user');
      expect(prs).toHaveLength(1);
      expect(prs[0].number).toBe(1);
      expect(callCount).toBe(2);
    });

    it('exhausts retries on persistent timeout and throws descriptive error', async () => {
      const mockFetch = vi.fn().mockImplementation((_url: string, init: any) => {
        return new Promise((_, reject) => {
          init?.signal?.addEventListener('abort', () => {
            const err = new Error('The operation was aborted');
            err.name = 'AbortError';
            reject(err);
          });
        });
      });

      const client = new GitHubClient({
        fetchFn: mockFetch,
        timeout: 20,
        maxRetries: 2,
        initialRetryDelayMs: 5,
      });

      await expect(client.getUserPullRequests('dead-network-user'))
        .rejects.toThrow(/GitHub API request timed out after 20ms/);
      expect(mockFetch).toHaveBeenCalledTimes(3); // Attempt 0, 1, 2
    });
  });

  describe('2. HTTP 429 & Rate Limit Backoff Resilience', () => {
    it('retries on HTTP 429 and honors retry-after header', async () => {
      const mockFetch = vi.fn()
        .mockResolvedValueOnce({
          status: 429,
          ok: false,
          headers: {
            get: (h: string) => (h.toLowerCase() === 'retry-after' ? '1' : null),
          },
          text: async () => 'Rate limit exceeded',
        })
        .mockResolvedValueOnce({
          status: 200,
          ok: true,
          headers: { get: () => null },
          json: async () => ({
            items: [{ id: 1, number: 42, title: 'Throttled PR', state: 'open', html_url: 'https://github.com/pr/42', created_at: '2026-10-15T10:00:00Z' }],
          }),
        });

      const client = new GitHubClient({
        fetchFn: mockFetch,
        maxRetries: 1,
        initialRetryDelayMs: 5,
      });

      const prs = await client.getUserPullRequests('throttled-user');
      expect(prs).toHaveLength(1);
      expect(prs[0].number).toBe(42);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('clamps excessive retry-after header to 60000ms max delay', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        status: 429,
        ok: false,
        headers: {
          get: (h: string) => (h.toLowerCase() === 'retry-after' ? '999999' : null),
        },
        text: async () => 'Rate limit exceeded for long time',
      });

      const client = new GitHubClient({
        fetchFn: mockFetch,
        maxRetries: 0, // Immediately exhaust so test does not wait 60s
        initialRetryDelayMs: 5,
      });

      await expect(client.getUserPullRequests('clamped-user'))
        .rejects.toThrow(/GitHub API rate limit exceeded \(HTTP 429\)/);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('falls back to exponential backoff when retry-after is non-numeric or zero', async () => {
      const mockFetch = vi.fn()
        .mockResolvedValueOnce({
          status: 429,
          ok: false,
          headers: {
            get: (h: string) => (h.toLowerCase() === 'retry-after' ? 'invalid-string' : null),
          },
          text: async () => 'Invalid retry after',
        })
        .mockResolvedValueOnce({
          status: 200,
          ok: true,
          headers: { get: () => null },
          json: async () => ({
            items: [{ id: 2, number: 99, title: 'Non-numeric retry PR', state: 'open', html_url: 'https://github.com/pr/99', created_at: '2026-10-15T10:00:00Z' }],
          }),
        });

      const client = new GitHubClient({
        fetchFn: mockFetch,
        maxRetries: 1,
        initialRetryDelayMs: 5,
      });

      const prs = await client.getUserPullRequests('invalid-retry-after-user');
      expect(prs).toHaveLength(1);
      expect(prs[0].number).toBe(99);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });
  });

  describe('3. HTTP 403 Rate Limit Reset & Non-Rate-Limit Discrimination', () => {
    it('retries on HTTP 403 when x-ratelimit-remaining is "0" and parses x-ratelimit-reset', async () => {
      const futureResetEpochSec = Math.floor(Date.now() / 1000) + 1; // 1 second in the future
      const mockFetch = vi.fn()
        .mockResolvedValueOnce({
          status: 403,
          ok: false,
          headers: {
            get: (h: string) => {
              const lower = h.toLowerCase();
              if (lower === 'x-ratelimit-remaining') return '0';
              if (lower === 'x-ratelimit-reset') return String(futureResetEpochSec);
              return null;
            },
          },
          text: async () => 'Rate limit exceeded',
        })
        .mockResolvedValueOnce({
          status: 200,
          ok: true,
          headers: { get: () => null },
          json: async () => ({
            items: [{ id: 3, number: 105, title: 'Rate reset PR', state: 'closed', html_url: 'https://github.com/pr/105', created_at: '2026-10-15T10:00:00Z' }],
          }),
        });

      const client = new GitHubClient({
        fetchFn: mockFetch,
        maxRetries: 1,
        initialRetryDelayMs: 5,
      });

      const prs = await client.getUserPullRequests('reset-user');
      expect(prs).toHaveLength(1);
      expect(prs[0].number).toBe(105);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('does NOT retry HTTP 403 when x-ratelimit-remaining is non-zero (e.g. permission/SSO denied)', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        status: 403,
        statusText: 'Forbidden',
        ok: false,
        headers: {
          get: (h: string) => (h.toLowerCase() === 'x-ratelimit-remaining' ? '4999' : null),
        },
        text: async () => 'Resource protected by organization SAML enforcement',
      });

      const client = new GitHubClient({
        fetchFn: mockFetch,
        maxRetries: 3,
        initialRetryDelayMs: 5,
      });

      await expect(client.getUserPullRequests('saml-blocked-user'))
        .rejects.toThrow(/GitHub API error 403 \(Forbidden\): Resource protected/);
      expect(mockFetch).toHaveBeenCalledTimes(1); // Fails immediately, no retry loop
    });
  });

  describe('4. HTTP 5xx Server Errors and Jitter Resilience', () => {
    it('retries on HTTP 502 Bad Gateway and 503 Service Unavailable, then succeeds', async () => {
      const mockFetch = vi.fn()
        .mockResolvedValueOnce({
          status: 502,
          ok: false,
          headers: { get: () => null },
          text: async () => 'Bad Gateway',
        })
        .mockResolvedValueOnce({
          status: 503,
          ok: false,
          headers: { get: () => null },
          text: async () => 'Service Unavailable',
        })
        .mockResolvedValueOnce({
          status: 200,
          ok: true,
          headers: { get: () => null },
          json: async () => ({
            items: [{ id: 4, number: 200, title: 'Success after 5xx', state: 'open', html_url: 'https://github.com/pr/200', created_at: '2026-10-15T10:00:00Z' }],
          }),
        });

      const client = new GitHubClient({
        fetchFn: mockFetch,
        maxRetries: 3,
        initialRetryDelayMs: 5,
      });

      const prs = await client.getUserPullRequests('flaky-server-user');
      expect(prs).toHaveLength(1);
      expect(prs[0].number).toBe(200);
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('throws server error message when 5xx retries are completely exhausted', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        status: 504,
        ok: false,
        headers: { get: () => null },
        text: async () => 'Gateway Timeout from Cloudflare',
      });

      const client = new GitHubClient({
        fetchFn: mockFetch,
        maxRetries: 2,
        initialRetryDelayMs: 5,
      });

      await expect(client.getUserPullRequests('exhausted-504-user'))
        .rejects.toThrow(/GitHub API server error 504: Gateway Timeout/);
      expect(mockFetch).toHaveBeenCalledTimes(3); // Attempt 0, 1, 2
    });
  });

  describe('5. Non-Retryable HTTP 4xx Client Errors', () => {
    it('does not retry HTTP 400 Bad Request', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        status: 400,
        statusText: 'Bad Request',
        ok: false,
        headers: { get: () => null },
        text: async () => 'Invalid query parameter',
      });

      const client = new GitHubClient({ fetchFn: mockFetch, maxRetries: 3 });
      await expect(client.getUserPullRequests('bad-query-user'))
        .rejects.toThrow(/GitHub API error 400 \(Bad Request\)/);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('does not retry HTTP 401 Unauthorized', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        status: 401,
        statusText: 'Unauthorized',
        ok: false,
        headers: { get: () => null },
        text: async () => 'Bad credentials',
      });

      const client = new GitHubClient({ fetchFn: mockFetch, maxRetries: 3 });
      await expect(client.getUserPullRequests('bad-creds-user'))
        .rejects.toThrow(/GitHub API error 401 \(Unauthorized\)/);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it('does not retry HTTP 422 Unprocessable Entity', async () => {
      const mockFetch = vi.fn().mockResolvedValue({
        status: 422,
        statusText: 'Unprocessable Entity',
        ok: false,
        headers: { get: () => null },
        text: async () => 'Validation failed',
      });

      const client = new GitHubClient({ fetchFn: mockFetch, maxRetries: 3 });
      await expect(client.getUserPullRequests('unprocessable-user'))
        .rejects.toThrow(/GitHub API error 422 \(Unprocessable Entity\)/);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('6. Network Error Retries (TypeError / fetch failed)', () => {
    it('retries when fetch throws TypeError (network disconnection) and succeeds', async () => {
      const mockFetch = vi.fn()
        .mockRejectedValueOnce(new TypeError('Failed to fetch'))
        .mockResolvedValueOnce({
          status: 200,
          ok: true,
          headers: { get: () => null },
          json: async () => ({
            items: [{ id: 5, number: 300, title: 'Network recovered PR', state: 'open', html_url: 'https://github.com/pr/300', created_at: '2026-10-15T10:00:00Z' }],
          }),
        });

      const client = new GitHubClient({
        fetchFn: mockFetch,
        maxRetries: 2,
        initialRetryDelayMs: 5,
      });

      const prs = await client.getUserPullRequests('network-recover-user');
      expect(prs).toHaveLength(1);
      expect(prs[0].number).toBe(300);
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('re-throws non-network errors immediately without retrying', async () => {
      const mockFetch = vi.fn().mockRejectedValue(new RangeError('Out of range memory'));

      const client = new GitHubClient({
        fetchFn: mockFetch,
        maxRetries: 2,
        initialRetryDelayMs: 5,
      });

      await expect(client.getUserPullRequests('fatal-error-user'))
        .rejects.toThrow(/Out of range memory/);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });
});

describe('Empirical Challenger 2: EOD Custom Field Casing Resilience (close-daily-tasks.ts)', () => {
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
      pullRequests: [{ number: 55, title: 'feat: add task close' }],
      htmlDescription: '<div><p>Task deliverables for test</p></div>',
      summaryText: '1 PR created: #55',
    }),
  } as unknown as GitHubClient;

  it('detects PascalCase tenant from Custom.ActualEndDate and applies PascalCase ops', async () => {
    const candidateTasks = [{
      id: 2001,
      fields: {
        'System.Id': 2001,
        'System.Title': '3in1_PWA_MyAccount | 15 Oct',
        'System.AssignedTo': { displayName: 'Alice Smith', uniqueName: 'alice@example.com' },
        'System.State': 'Active',
        'Custom.PlannedStartDate': '2026-10-15T04:00:00Z',
        'Custom.ActualEndDate': '2026-10-15T13:00:00Z', // Pre-existing PascalCase end date
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
          'System.State': 'Closed',
          'System.AssignedTo': { displayName: 'Alice Smith', uniqueName: 'alice@example.com' },
        },
      }),
      createWorkItemWithReconciliation: vi.fn(),
      copyRelations: vi.fn(),
      patchWorkItem: vi.fn().mockImplementation(async (id, ops) => {
        patchCalls.push({ id, ops });
        if (patchCalls.length === 1) {
          throw new Error('TF401320: Required rule error');
        }
        return { id, rev: 2, fields: {} };
      }),
    };

    const useCase = new CloseDailyTasksUseCase(baseConfig, mockRepo, mockDatePlanning, mockGitHubClient);
    const result = await useCase.execute({ asOf: '2026-10-15', dryRun: false });

    expect(result.totalClosed).toBe(1);
    expect(patchCalls).toHaveLength(2);

    const recoveryOps = patchCalls[1].ops;
    const paths = recoveryOps.map((op: any) => op.path);
    // Custom.ActualStartDate should be added with PascalCase
    expect(paths).toContain('/fields/Custom.ActualStartDate');
    // Custom.ActualEndDate was already present, so should NOT be duplicated
    expect(paths).not.toContain('/fields/Custom.ActualEndDate');
    expect(paths).not.toContain('/fields/Custom.ActualStartdate');
    expect(paths).not.toContain('/fields/Custom.ActualEnddate');
  });

  it('detects PascalCase tenant from generic custom date field (Custom.TargetDate)', async () => {
    const candidateTasks = [{
      id: 2002,
      fields: {
        'System.Id': 2002,
        'System.Title': '3in1_PWA_MyAccount | 15 Oct',
        'System.AssignedTo': { displayName: 'Alice Smith', uniqueName: 'alice@example.com' },
        'System.State': 'Active',
        'Microsoft.VSTS.Scheduling.StartDate': '2026-10-15T04:00:00Z', // Neutral start date
        'Custom.TargetDate': '2026-10-15', // Matches k.startsWith('Custom.') && k.endsWith('Date')
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
        id: 2002,
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
          throw new Error('TF401320: Rule check');
        }
        return { id, rev: 2, fields: {} };
      }),
    };

    const useCase = new CloseDailyTasksUseCase(baseConfig, mockRepo, mockDatePlanning, mockGitHubClient);
    const result = await useCase.execute({ asOf: '2026-10-15', dryRun: false });

    expect(result.totalClosed).toBe(1);
    expect(patchCalls).toHaveLength(2);

    const recoveryOps = patchCalls[1].ops;
    const paths = recoveryOps.map((op: any) => op.path);
    expect(paths).toContain('/fields/Custom.ActualStartDate');
    expect(paths).toContain('/fields/Custom.ActualEndDate');
  });

  it('swaps PascalCase to lowercase during fallback when server only accepts lowercase', async () => {
    const candidateTasks = [{
      id: 2003,
      fields: {
        'System.Id': 2003,
        'System.Title': '3in1_PWA_MyAccount | 15 Oct',
        'System.AssignedTo': { displayName: 'Alice Smith', uniqueName: 'alice@example.com' },
        'System.State': 'Active',
        'Custom.PlannedStartDate': '2026-10-15T04:00:00Z', // Heuristic selects PascalCase first
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
        id: 2003,
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
          // PascalCase recovery fails because tenant schema is strictly lowercase
          throw new Error('TF401320: Field Custom.ActualStartDate is not recognized');
        }
        // Swapped lowercase succeeds
        return { id, rev: 3, fields: {} };
      }),
    };

    const useCase = new CloseDailyTasksUseCase(baseConfig, mockRepo, mockDatePlanning, mockGitHubClient);
    const result = await useCase.execute({ asOf: '2026-10-15', dryRun: false });

    expect(result.totalClosed).toBe(1);
    expect(patchCalls).toHaveLength(3);

    // Call 2 used PascalCase
    const call2Paths = patchCalls[1].ops.map((op: any) => op.path);
    expect(call2Paths).toContain('/fields/Custom.ActualStartDate');
    expect(call2Paths).toContain('/fields/Custom.ActualEndDate');

    // Call 3 swapped to lowercase
    const call3Paths = patchCalls[2].ops.map((op: any) => op.path);
    expect(call3Paths).toContain('/fields/Custom.ActualStartdate');
    expect(call3Paths).toContain('/fields/Custom.ActualEnddate');
  });

  it('marks task as failed when BOTH recovery attempts fail with rule errors', async () => {
    const candidateTasks = [{
      id: 2004,
      fields: {
        'System.Id': 2004,
        'System.Title': '3in1_PWA_MyAccount | 15 Oct',
        'System.AssignedTo': { displayName: 'Alice Smith', uniqueName: 'alice@example.com' },
        'System.State': 'Active',
        'Custom.PlannedStartDate': '2026-10-15T04:00:00Z',
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
        throw new Error('TF401320: Permanent schema constraint violation');
      }),
    };

    const useCase = new CloseDailyTasksUseCase(baseConfig, mockRepo, mockDatePlanning, mockGitHubClient);
    const result = await useCase.execute({ asOf: '2026-10-15', dryRun: false });

    expect(result.totalClosed).toBe(0);
    expect(result.totalFailed).toBe(1);
    expect(result.results[0].status).toBe('failed');
    expect(result.results[0].error).toContain('TF401320');
    expect(patchCalls).toHaveLength(3); // 1 initial, 1 recovery, 1 swapped fallback
  });

  it('does NOT trigger rule recovery on unrelated non-rule errors (e.g. TF26071 concurrent modification)', async () => {
    const candidateTasks = [{
      id: 2005,
      fields: {
        'System.Id': 2005,
        'System.Title': '3in1_PWA_MyAccount | 15 Oct',
        'System.AssignedTo': { displayName: 'Alice Smith', uniqueName: 'alice@example.com' },
        'System.State': 'Active',
        'Custom.PlannedStartDate': '2026-10-15T04:00:00Z',
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
        throw new Error('TF26071: This work item has been modified by someone else.');
      }),
    };

    const useCase = new CloseDailyTasksUseCase(baseConfig, mockRepo, mockDatePlanning, mockGitHubClient);
    const result = await useCase.execute({ asOf: '2026-10-15', dryRun: false });

    expect(result.totalClosed).toBe(0);
    expect(result.totalFailed).toBe(1);
    expect(patchCalls).toHaveLength(1); // Exactly 1 call, no recovery attempted
  });

  it('preserves existing System.Description and does not overwrite with PR deliverables', async () => {
    const candidateTasks = [{
      id: 2006,
      fields: {
        'System.Id': 2006,
        'System.Title': '3in1_PWA_MyAccount | 15 Oct',
        'System.AssignedTo': { displayName: 'Alice Smith', uniqueName: 'alice@example.com' },
        'System.State': 'Active',
        'Custom.PlannedStartDate': '2026-10-15T04:00:00Z',
        'System.Description': '<div><p>Important preexisting human notes.</p></div>',
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
        id: 2006,
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
          throw new Error('TF401320: Rule violation');
        }
        return { id, rev: 2, fields: {} };
      }),
    };

    const useCase = new CloseDailyTasksUseCase(baseConfig, mockRepo, mockDatePlanning, mockGitHubClient);
    const result = await useCase.execute({ asOf: '2026-10-15', dryRun: false });

    expect(result.totalClosed).toBe(1);
    expect(patchCalls).toHaveLength(2);

    const recoveryOps = patchCalls[1].ops;
    const paths = recoveryOps.map((op: any) => op.path);
    // Description should NOT be added because it already exists!
    expect(paths).not.toContain('/fields/System.Description');
  });
});

describe('Empirical Challenger 2: Orphan Task Discovery, Repair & Concurrency Locking', () => {
  const dummyJournal: JournalRepository = {
    record: vi.fn(),
    getEntries: vi.fn().mockResolvedValue([]),
    getUnfinishedRelations: vi.fn().mockResolvedValue([]),
    markRepaired: vi.fn().mockResolvedValue(true),
    exportCsv: vi.fn().mockResolvedValue(''),
    exportJson: vi.fn().mockResolvedValue('[]'),
  };

  describe('1. detectOrphanTasks Stress Cases', () => {
    it('accurately identifies orphan tasks having related and child links but missing parent hierarchy link', async () => {
      const candidates: WorkItem[] = [
        {
          id: 301,
          rev: 1,
          fields: {
            'System.Title': '3in1_PWA_MyAccount | 15 Oct',
            'System.AssignedTo': 'alice@example.com',
            'System.State': 'Active',
          },
          relations: [
            { rel: 'System.LinkTypes.Hierarchy-Forward', url: 'https://dev.azure.com/child/1' },
            { rel: 'System.LinkTypes.Related', url: 'https://dev.azure.com/related/2' },
          ], // Has child and related, but NO Hierarchy-Reverse parent!
        },
        {
          id: 302,
          rev: 1,
          fields: {
            'System.Title': '3in1_PWA_MyAccount | 16 Oct',
            'System.AssignedTo': { displayName: 'Bob Jones' },
            'System.State': 'Active',
          },
          relations: [
            { rel: 'System.LinkTypes.Hierarchy-Reverse', url: 'https://dev.azure.com/parent/99' },
          ], // Has parent
        },
      ];

      const mockRepo = {} as WorkItemRepository;
      const useCase = new RepairRelationsUseCase(mockRepo, dummyJournal);
      const orphans = await useCase.detectOrphanTasks(candidates, '3in1_PWA_MyAccount |');

      expect(orphans).toHaveLength(1);
      expect(orphans[0].id).toBe(301);
      expect(orphans[0].hasParent).toBe(false);
      expect(orphans[0].status).toBe('DETECTED');
    });

    it('gracefully survives when candidate has no relations and getWorkItem throws', async () => {
      const candidates: WorkItem[] = [
        {
          id: 303,
          rev: 1,
          fields: {
            'System.Title': '3in1_PWA_MyAccount | 15 Oct',
            'System.State': 'Active',
          },
          // relations undefined
        },
      ];

      const mockRepo: WorkItemRepository = {
        validateProject: vi.fn(),
        validateWorkItemType: vi.fn(),
        findLatestTaskForPerson: vi.fn(),
        discoverLatestTasksForPeople: vi.fn(),
        getExistingTasksForPerson: vi.fn(),
        findCandidateTasks: vi.fn(),
        getWorkItem: vi.fn().mockRejectedValue(new Error('Item was deleted from Azure in background')),
        createWorkItemWithReconciliation: vi.fn(),
        copyRelations: vi.fn(),
        patchWorkItem: vi.fn(),
      };

      const useCase = new RepairRelationsUseCase(mockRepo, dummyJournal);
      const orphans = await useCase.detectOrphanTasks(candidates, '3in1_PWA_MyAccount |');

      expect(orphans).toHaveLength(0); // Safely caught, skipped, does not crash
      expect(mockRepo.getWorkItem).toHaveBeenCalledWith(303);
    });
  });

  describe('2. repairOrphanTasks Verification Failures and Fallbacks', () => {
    it('marks orphan UNRESOLVED when copyRelations throws an exception', async () => {
      const parentUrl = 'https://dev.azure.com/org/p/_apis/wit/workItems/500';
      const referenceTask: WorkItem = {
        id: 50,
        rev: 1,
        fields: {},
        relations: [{ rel: 'System.LinkTypes.Hierarchy-Reverse', url: parentUrl }],
      };

      const orphans: OrphanTaskItem[] = [
        {
          id: 305,
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
        getWorkItem: vi.fn(),
        createWorkItemWithReconciliation: vi.fn(),
        copyRelations: vi.fn().mockRejectedValue(new Error('Azure DevOps 400: Circular hierarchy detected')),
        patchWorkItem: vi.fn(),
      };

      const useCase = new RepairRelationsUseCase(mockRepo, dummyJournal);
      const repaired = await useCase.repairOrphanTasks(orphans, referenceTask);

      expect(repaired).toHaveLength(1);
      expect(repaired[0].status).toBe('UNRESOLVED');
      expect(repaired[0].hasParent).toBe(false);
      expect(repaired[0].message).toContain('Circular hierarchy detected');
    });

    it('dynamically fetches reference source task from repository if its relations are unpopulated', async () => {
      const parentUrl = 'https://dev.azure.com/org/p/_apis/wit/workItems/777';
      const referenceTaskWithoutRelations: WorkItem = {
        id: 70,
        rev: 1,
        fields: {},
        // relations undefined
      };

      const orphans: OrphanTaskItem[] = [
        {
          id: 306,
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
        getWorkItem: vi.fn().mockImplementation(async (id: number) => {
          if (id === 70) {
            return {
              ...referenceTaskWithoutRelations,
              relations: [{ rel: 'System.LinkTypes.Hierarchy-Reverse', url: parentUrl }],
            };
          }
          if (id === 306) {
            return {
              id: 306,
              rev: 2,
              fields: {},
              relations: [{ rel: 'System.LinkTypes.Hierarchy-Reverse', url: parentUrl }],
            };
          }
          throw new Error('Unknown id');
        }),
        createWorkItemWithReconciliation: vi.fn(),
        copyRelations: vi.fn().mockResolvedValue({ copiedCount: 1, failedCount: 0, totalRelations: 1 }),
        patchWorkItem: vi.fn(),
      };

      const useCase = new RepairRelationsUseCase(mockRepo, dummyJournal);
      const repaired = await useCase.repairOrphanTasks(orphans, referenceTaskWithoutRelations);

      expect(mockRepo.getWorkItem).toHaveBeenCalledWith(70);
      expect(repaired).toHaveLength(1);
      expect(repaired[0].status).toBe('REPAIRED');
      expect(repaired[0].parentRelationUrl).toBe(parentUrl);
    });
  });

  describe('3. Concurrency Locking Invariants', () => {
    it('unconditionally releases concurrency lock in finally block even if journal throws an error', async () => {
      const mockLock: LockRepository = {
        acquire: vi.fn().mockReturnValue(true),
        release: vi.fn(),
        isLocked: vi.fn().mockReturnValue(true),
        getLockInfo: vi.fn().mockReturnValue({ pid: process.pid, timestamp: Date.now() }),
      };

      const failingJournal: JournalRepository = {
        ...dummyJournal,
        getUnfinishedRelations: vi.fn().mockRejectedValue(new Error('Corrupted journal database')),
      };

      const mockRepo = {} as WorkItemRepository;
      const useCase = new RepairRelationsUseCase(mockRepo, failingJournal, mockLock);

      await expect(useCase.execute()).rejects.toThrow(/Corrupted journal database/);
      expect(mockLock.acquire).toHaveBeenCalledTimes(1);
      expect(mockLock.release).toHaveBeenCalledTimes(1); // Lock is always released!
    });
  });
});
