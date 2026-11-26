import { describe, it, expect, vi, afterEach } from 'vitest';
import { MetricsRegistry, metricsRegistry } from '../../src/infrastructure/telemetry/metrics.js';
import { parseTraceparent, formatTraceparent, recordSpanException } from '../../src/infrastructure/telemetry/tracer.js';
import { WorkerDaemon } from '../../src/infrastructure/scheduler/worker-daemon.js';
import { AzureDevOpsClient } from '../../src/infrastructure/azure/client.js';
import { PlanTasksUseCase } from '../../src/application/use-cases/plan-tasks.js';
import { ExecuteTasksUseCase } from '../../src/application/use-cases/execute-tasks.js';
import { generatePlanToken } from '../../src/domain/entities/plan-token.js';
import type { AppConfig, ILockManager, IPlanTokenRepository, JournalRepository, WorkItemRepository } from '../../src/domain/ports/repositories.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Feature #36: Production Observability & Prometheus Telemetry', () => {
  it('renders standard Prometheus metrics in plain text format', () => {
    const registry = new MetricsRegistry();
    registry.recordHttpRequest('GET', '/api/health', 200, 0.012);
    registry.incrementTasksCreated(5);
    registry.setActiveJobs(2);
    registry.setAzureRateLimitRemaining(85);
    registry.recordPlanDuration(0.35);

    const output = registry.renderPrometheusMetrics();

    expect(output).toContain('# HELP');
    expect(output).toContain('# TYPE');
    expect(output).toContain('http_requests_total');
    expect(output).toContain('workops_tasks_created_total 5');
    expect(output).toContain('workops_active_jobs 2');
    expect(output).toContain('workops_azure_rate_limit_remaining 85');
    expect(output).toContain('workops_plan_duration_seconds_bucket');
  });

  it('handles 64-bit BigInt counts accurately without loss of precision', () => {
    const registry = new MetricsRegistry();
    const largeCount = 9007199254740993; // > Number.MAX_SAFE_INTEGER
    registry.incrementTasksCreated(largeCount);

    const output = registry.renderPrometheusMetrics();
    expect(output).toContain(`workops_tasks_created_total ${largeCount}`);
  });

  it('validates W3C traceparent header format and propagates trace ID', () => {
    const validHeader = '00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01';
    const ctx = parseTraceparent(validHeader);

    expect(ctx.valid).toBe(true);
    expect(ctx.version).toBe('00');
    expect(ctx.traceId).toBe('4bf92f3577b34da6a3ce929d0e0e4736');
    expect(ctx.parentId).toBe('00f067aa0ba902b7');
    expect(ctx.traceFlags).toBe('01');

    const formatted = formatTraceparent(ctx);
    expect(formatted).toBe(validHeader);
  });

  it('generates a fresh compliant trace context when given an invalid traceparent', () => {
    const invalidHeader = 'invalid-not-a-traceparent';
    const ctx = parseTraceparent(invalidHeader);

    expect(ctx.valid).toBe(false);
    expect(ctx.traceId.length).toBe(32);
    expect(ctx.parentId.length).toBe(16);
    expect(ctx.version).toBe('00');
  });

  it('formats span exception event on error', () => {
    const err = new Error('Database connection pool exhausted');
    const span = recordSpanException(err);

    expect(span.spanStatus).toBe('ERROR');
    expect(span.event).toBe('exception');
    expect(span.errorMessage).toBe('Database connection pool exhausted');
    expect(span.stack).toBeDefined();
  });

  it('does not emit fabricated http_requests_total baseline when no HTTP requests were recorded', () => {
    const registry = new MetricsRegistry();
    const output = registry.renderPrometheusMetrics();
    expect(output).toContain('# TYPE http_requests_total counter');
    expect(output).not.toContain('http_requests_total{method="GET",route="/api/health",status="200"} 1');
  });

  it('wires WorkerDaemon job lifecycle to metricsRegistry.setActiveJobs', async () => {
    const setActiveSpy = vi.spyOn(metricsRegistry, 'setActiveJobs');
    const daemon = new WorkerDaemon({ timezone: 'UTC' });
    let observedActiveDuringJob = 0;

    const job = {
      id: 'metrics-job',
      name: 'Metrics Job',
      handler: async () => {
        observedActiveDuringJob = daemon.getActiveJobsCount();
      },
    };
    daemon.registerJob(job);
    daemon.start();
    try {
      await daemon.runJobWithRetry(job);
      expect(observedActiveDuringJob).toBe(1);
      expect(setActiveSpy).toHaveBeenCalledWith(1);
      expect(setActiveSpy).toHaveBeenCalledWith(0);
    } finally {
      await daemon.stop();
    }
  });

  it('wires AzureDevOpsClient X-RateLimit-Remaining and 429 responses to metricsRegistry.setAzureRateLimitRemaining', async () => {
    const setRateSpy = vi.spyOn(metricsRegistry, 'setAzureRateLimitRemaining');
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'X-RateLimit-Remaining': '42' },
        })
      )
      .mockResolvedValueOnce(
        new Response('', {
          status: 429,
          headers: { 'Retry-After': '0' },
        })
      );

    const client = new AzureDevOpsClient({
      organization: 'org',
      pat: 'test-pat',
      maxRetries: 0,
      initialRetryDelayMs: 0,
    });

    await client.get('/_apis/projects');
    expect(setRateSpy).toHaveBeenCalledWith(42);

    await expect(client.get('/_apis/projects')).rejects.toThrow(/429/);
    expect(setRateSpy).toHaveBeenCalledWith(0);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('wires PlanTasksUseCase and ExecuteTasksUseCase to recordPlanDuration and incrementTasksCreated', async () => {
    const durationSpy = vi.spyOn(metricsRegistry, 'recordPlanDuration');
    const createdSpy = vi.spyOn(metricsRegistry, 'incrementTasksCreated');

    const config: AppConfig = {
      organization: 'org',
      project: 'proj',
      baseUrl: 'https://dev.azure.com',
      workItemType: 'Task',
      taskSeries: 'Daily Task',
      titlePrefix: 'Daily Task',
      timezone: 'UTC',
      startTime: '09:30',
      scheduleTime: '09:30',
      schedulerEnabled: false,
      schedulerAutoStart: false,
      thursdayMode: 'CURRENT',
      skipWeekends: true,
      stopDay: 'Thursday',
      stopDayOfWeek: 4,
      copyEstimates: true,
      resetActualWork: true,
      defaultState: 'New',
      autoClose: false,
      maxRetries: 3,
      initialRetryDelayMs: 1000,
      people: [
        {
          key: 'alex',
          name: 'Alex Dev',
          assignedTo: 'alex@workops.test',
          enabled: true,
        },
      ],
    };

    const workItemRepo = {
      discoverLatestTasksForPeople: vi.fn().mockResolvedValue(new Map()),
      getExistingTasksForPerson: vi.fn().mockResolvedValue(new Map()),
      createWorkItemWithReconciliation: vi.fn().mockResolvedValue({ id: 9001 }),
      addRelations: vi.fn().mockResolvedValue({ copiedCount: 0, failedCount: 0, totalRelations: 0 }),
      getWorkItem: vi.fn().mockResolvedValue({ id: 9001, rev: 1, fields: {}, relations: [] }),
    } as unknown as WorkItemRepository;

    const planUseCase = new PlanTasksUseCase(workItemRepo, config);
    await planUseCase.execute({ all: true });
    expect(durationSpy).toHaveBeenCalledTimes(1);
    expect(durationSpy.mock.calls[0][0]).toBeGreaterThanOrEqual(0);

    const snapshot = {
      todayIso: '2026-11-25',
      nextThursdayIso: '2026-11-26',
      createdAt: new Date().toISOString(),
      totalPlanned: 1,
      personCount: 1,
      items: [
        {
          personKey: 'alex',
          personName: 'Alex Dev',
          assignedTo: 'alex@workops.test',
          targetIsoDate: '2026-11-25',
          title: 'Daily Task 25/11/2026',
          sourceTaskId: 100,
          sourceTask: { id: 100, rev: 1, fields: {}, relations: [] },
        },
      ],
    };
    const tokenInfo = generatePlanToken(snapshot);
    const planTokenRepo = {
      getTokenByHash: vi.fn().mockResolvedValue({
        tokenHash: tokenInfo.tokenHash,
        planToken: tokenInfo.planToken,
        expiresAt: tokenInfo.expiresAt,
        isExecuted: false,
        snapshotJson: JSON.stringify(snapshot),
        operatorEmail: 'lead@workops.test',
      }),
      markExecuted: vi.fn().mockResolvedValue(undefined),
    } as unknown as IPlanTokenRepository;

    const journalRepo = {
      record: vi.fn().mockResolvedValue(undefined),
    } as unknown as JournalRepository;

    const lockManager = {
      acquire: vi.fn().mockResolvedValue({ key: 'lock', token: 'tok', expiresAt: Date.now() + 10000 }),
      release: vi.fn().mockResolvedValue(undefined),
    } as unknown as ILockManager;

    const execUseCase = new ExecuteTasksUseCase(workItemRepo, journalRepo, planTokenRepo, lockManager, config);
    const result = await execUseCase.execute({ planToken: tokenInfo.planToken, confirm: true });

    expect(result.createdTasksCount).toBe(1);
    expect(createdSpy).toHaveBeenCalledWith(1);
  });
});
