import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import express from 'express';
import { PlanTasksUseCase } from '../../src/application/use-cases/plan-tasks.js';
import { ExecuteTasksUseCase } from '../../src/application/use-cases/execute-tasks.js';
import { createDatabase, WorkOpsDb } from '../../src/infrastructure/persistence/database.js';
import { RelationalPlanTokenRepository } from '../../src/infrastructure/persistence/relational-plan-token-repo.js';
import { RelationalJournalRepository } from '../../src/infrastructure/persistence/relational-journal-repo.js';
import { SqliteLockManager } from '../../src/infrastructure/lock/distributed-lock-manager.js';
import { generatePlanToken } from '../../src/domain/entities/plan-token.js';
import { createApiRouter } from '../../src/presentation/api/routes.js';

describe('Milestone 3 — Features 19 & 20: Immutable Plan Generation and Execution Protocol', () => {
  let tempDir: string;
  let sqlitePath: string;
  let db: WorkOpsDb;
  let planTokenRepo: RelationalPlanTokenRepository;
  let journalRepo: RelationalJournalRepository;
  let lockManager: SqliteLockManager;

  let mockWorkItemRepo: any;
  let appConfig: any;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workops-plan-test-'));
    sqlitePath = path.join(tempDir, 'plan-test.db');
    db = createDatabase({ sqlitePath, engine: 'sqlite' });
    planTokenRepo = new RelationalPlanTokenRepository(db);
    journalRepo = new RelationalJournalRepository(db);
    lockManager = new SqliteLockManager((db as any).sqlite);

    mockWorkItemRepo = {
      discoverLatestTasksForPeople: vi.fn().mockResolvedValue(new Map()),
      getExistingTasksForPerson: vi.fn().mockResolvedValue(new Map()),
      createWorkItemWithReconciliation: vi.fn().mockImplementation((_p, _t, ops) => {
        const title = ops.find((o: any) => o.path === '/fields/System.Title')?.value;
        return Promise.resolve({
          id: Math.floor(1000 + Math.random() * 9000),
          title,
          fields: {},
        });
      }),
    };

    appConfig = {
      organization: 'test-org',
      project: 'TestProject',
      baseUrl: 'https://dev.azure.com/test-org',
      workItemType: 'Task',
      taskSeries: '3in1',
      titlePrefix: '3in1_PWA_FD_Services |',
      startTime: '09:00',
      timezone: 'America/New_York',
      skipWeekends: true,
      stopDay: 'Thursday',
      stopDayOfWeek: 4,
      thursdayMode: 'CURRENT' as const,
      defaultState: 'New',
      autoClose: false,
      copyEstimates: true,
      resetActualWork: true,
      maxRetries: 3,
      initialRetryDelayMs: 100,
      people: [
        {
          key: 'dev1',
          name: 'Dev One',
          assignedTo: 'dev1@workops.test',
          enabled: true,
        },
      ],
    };
  });

  afterEach(() => {
    if (db && db.engine === 'sqlite') {
      db.close();
    }
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('PlanTasksUseCase generates signed planToken, persists snapshot to plan_tokens table', async () => {
    const planUseCase = new PlanTasksUseCase(mockWorkItemRepo, appConfig, planTokenRepo);

    // Mock today as Wednesday 2026-11-25 (next Thursday is 2026-11-26)
    const result = await planUseCase.execute({
      all: true,
      asOf: '2026-11-25',
      thursdayMode: 'CURRENT',
      operatorEmail: 'lead@workops.test',
    });

    expect(result.planToken).toBeDefined();
    expect(result.planToken.startsWith('pln_')).toBe(true);
    expect(result.expiresAt).toBeGreaterThan(Date.now());
    expect(result.planHash).toHaveLength(64);
    expect(result.summary.personCount).toBe(1);

    // Verify persisted record in plan_tokens table
    const tokenHash = crypto.createHash('sha256').update(result.planToken).digest('hex');
    const record = await planTokenRepo.getTokenByHash(tokenHash);

    expect(record).not.toBeNull();
    expect(record?.planToken).toBe(result.planToken);
    expect(record?.isExecuted).toBe(false);
    expect(record?.operatorEmail).toBe('lead@workops.test');

    const snapshot = JSON.parse(record!.snapshotJson);
    expect(snapshot.totalPlanned).toBe(result.summary.totalPlanned);
  });

  it('ExecuteTasksUseCase executes exact snapshot without re-querying Azure and marks executed', async () => {
    const snapshot = {
      todayIso: '2026-11-25',
      nextThursdayIso: '2026-11-26',
      createdAt: new Date().toISOString(),
      totalPlanned: 2,
      personCount: 1,
      items: [
        {
          personKey: 'dev1',
          personName: 'Dev One',
          assignedTo: 'dev1@workops.test',
          targetIsoDate: '2026-11-25',
          title: 'Task: Dev One | Sprint 1 | 2026-11-25',
          originalEstimate: 8,
          activity: 'Development',
        },
        {
          personKey: 'dev1',
          personName: 'Dev One',
          assignedTo: 'dev1@workops.test',
          targetIsoDate: '2026-11-26',
          title: 'Task: Dev One | Sprint 1 | 2026-11-26',
          originalEstimate: 8,
          activity: 'Development',
        },
      ],
    };

    const tokenInfo = generatePlanToken(snapshot);
    await planTokenRepo.saveToken({
      tokenHash: tokenInfo.tokenHash,
      planToken: tokenInfo.planToken,
      expiresAt: tokenInfo.expiresAt,
      isExecuted: false,
      snapshotJson: JSON.stringify(snapshot),
      operatorEmail: 'lead@workops.test',
    });

    const executeUseCase = new ExecuteTasksUseCase(
      mockWorkItemRepo,
      journalRepo,
      planTokenRepo,
      lockManager,
      appConfig
    );

    const result = await executeUseCase.execute({
      planToken: tokenInfo.planToken,
      confirm: true,
      dryRun: false,
      operatorEmail: 'lead@workops.test',
    });

    expect(result.success).toBe(true);
    expect(result.createdTasksCount).toBe(2);
    expect(result.journalEntryIds.length).toBe(2);

    // Verify token marked executed
    const updatedRecord = await planTokenRepo.getTokenByHash(tokenInfo.tokenHash);
    expect(updatedRecord?.isExecuted).toBe(true);

    // Verify journal entries recorded
    const entries = await journalRepo.getEntries();
    expect(entries.length).toBe(2);
    expect(entries[0].operatorEmail).toBe('lead@workops.test');
  });

  it('ExecuteTasksUseCase rejects expired token with HTTP 410 (PLAN_EXPIRED)', async () => {
    const snapshot = { items: [] };
    // Create token expired in the past
    const tokenInfo = generatePlanToken(snapshot, -5000);
    await planTokenRepo.saveToken({
      tokenHash: tokenInfo.tokenHash,
      planToken: tokenInfo.planToken,
      expiresAt: tokenInfo.expiresAt,
      isExecuted: false,
      snapshotJson: JSON.stringify(snapshot),
      operatorEmail: 'lead@workops.test',
    });

    const executeUseCase = new ExecuteTasksUseCase(
      mockWorkItemRepo,
      journalRepo,
      planTokenRepo,
      lockManager,
      appConfig
    );

    await expect(
      executeUseCase.execute({ planToken: tokenInfo.planToken })
    ).rejects.toMatchObject({
      message: expect.stringContaining('PLAN_EXPIRED'),
      statusCode: 410,
    });
  });

  it('ExecuteTasksUseCase rejects already-executed token with HTTP 409 (PLAN_ALREADY_EXECUTED)', async () => {
    const snapshot = { items: [] };
    const tokenInfo = generatePlanToken(snapshot);
    await planTokenRepo.saveToken({
      tokenHash: tokenInfo.tokenHash,
      planToken: tokenInfo.planToken,
      expiresAt: tokenInfo.expiresAt,
      isExecuted: true, // Already executed!
      snapshotJson: JSON.stringify(snapshot),
      operatorEmail: 'lead@workops.test',
    });

    const executeUseCase = new ExecuteTasksUseCase(
      mockWorkItemRepo,
      journalRepo,
      planTokenRepo,
      lockManager,
      appConfig
    );

    await expect(
      executeUseCase.execute({ planToken: tokenInfo.planToken })
    ).rejects.toMatchObject({
      message: expect.stringContaining('PLAN_ALREADY_EXECUTED'),
      statusCode: 409,
    });
  });

  it('ExecuteTasksUseCase rejects tampered token with HTTP 400 (PLAN_TAMPERED)', async () => {
    const executeUseCase = new ExecuteTasksUseCase(
      mockWorkItemRepo,
      journalRepo,
      planTokenRepo,
      lockManager,
      appConfig
    );

    await expect(
      executeUseCase.execute({ planToken: 'pln_badhash.1799999999.invalidsig' })
    ).rejects.toMatchObject({
      message: expect.stringContaining('PLAN_TAMPERED'),
      statusCode: 400,
    });
  });

  it('HTTP endpoints POST /api/tasks/plan and POST /api/tasks/execute handle protocol via Express', async () => {
    const planUseCase = new PlanTasksUseCase(mockWorkItemRepo, appConfig, planTokenRepo);
    const executeUseCase = new ExecuteTasksUseCase(
      mockWorkItemRepo,
      journalRepo,
      planTokenRepo,
      lockManager,
      appConfig
    );

    const app = express();
    app.use(express.json());
    const router = createApiRouter({
      createTasks: {} as any,
      planTasks: planUseCase,
      executeTasks: executeUseCase,
      exploreTasks: {} as any,
      getStatus: {} as any,
      config: {} as any,
      journal: journalRepo,
      scheduler: {} as any,
    });
    app.use('/api', router);

    const server = app.listen(0);
    const port = (server.address() as any).port;
    const baseUrl = `http://127.0.0.1:${port}`;

    try {
      // 1. Plan
      const planRes = await fetch(`${baseUrl}/api/tasks/plan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ all: true, asOf: '2026-11-25', thursdayMode: 'CURRENT' }),
      });

      expect(planRes.status).toBe(200);
      const planData: any = await planRes.json();
      expect(planData.success).toBe(true);
      expect(planData.planToken).toBeDefined();

      // 2. Execute with valid planToken
      const execRes = await fetch(`${baseUrl}/api/tasks/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planToken: planData.planToken, confirm: true, dryRun: true }),
      });

      expect(execRes.status).toBe(200);
      const execData: any = await execRes.json();
      expect(execData.success).toBe(true);

      // 3. Re-execution (Replay attack prevention) -> HTTP 409 Conflict
      const replayRes = await fetch(`${baseUrl}/api/tasks/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planToken: planData.planToken, confirm: true }),
      });

      expect(replayRes.status).toBe(409);
      const replayData: any = await replayRes.json();
      expect(replayData.error).toContain('PLAN_ALREADY_EXECUTED');
    } finally {
      server.close();
    }
  });
});
