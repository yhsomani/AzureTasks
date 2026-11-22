import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import crypto from 'node:crypto';
import express from 'express';
import { createDatabase, WorkOpsDb } from '../../src/infrastructure/persistence/database.js';
import { RelationalPlanTokenRepository } from '../../src/infrastructure/persistence/relational-plan-token-repo.js';
import { RelationalJournalRepository } from '../../src/infrastructure/persistence/relational-journal-repo.js';
import { SqliteLockManager } from '../../src/infrastructure/lock/distributed-lock-manager.js';
import { PlanTasksUseCase } from '../../src/application/use-cases/plan-tasks.js';
import { ExecuteTasksUseCase } from '../../src/application/use-cases/execute-tasks.js';
import { CloseDailyTasksUseCase } from '../../src/application/use-cases/close-daily-tasks.js';
import { EntraIdAuthProvider } from '../../src/infrastructure/auth/entra-id-auth-provider.js';
import { createAuthRouter } from '../../src/infrastructure/auth/session-routes.js';
import { createApiRouter } from '../../src/presentation/api/routes.js';
import { VerifiedAutoClosurePolicyEngine } from '../../src/domain/services/policy-engine.js';

describe('Milestone 4 Integration: Enterprise Identity, RBAC, Attribution & Policy Gating', () => {
  let tempDir: string;
  let sqlitePath: string;
  let db: WorkOpsDb;
  let journalRepo: RelationalJournalRepository;
  let planTokenRepo: RelationalPlanTokenRepository;
  let lockManager: SqliteLockManager;

  let server: http.Server;
  let baseUrl: string;

  let keyPair: { privateKey: crypto.KeyObject; publicKey: crypto.KeyObject };
  let authProvider: EntraIdAuthProvider;
  const kid = 'integration-test-key';
  const issuer = 'https://login.microsoftonline.com/tenant-ent/v2.0';
  const clientId = 'workops-integration-client';
  const audience = 'workops-api';

  beforeEach(() => {
    process.env.OIDC_ISSUER = issuer;
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workops-auth-test-'));
    sqlitePath = path.join(tempDir, 'auth-test.db');
    db = createDatabase({ sqlitePath, engine: 'sqlite' });
    journalRepo = new RelationalJournalRepository(db);
    planTokenRepo = new RelationalPlanTokenRepository(db);
    lockManager = new SqliteLockManager((db as any).sqlite);

    keyPair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });

    authProvider = new EntraIdAuthProvider({
      issuer,
      clientId,
      audience,
      redirectUri: 'http://127.0.0.1/auth/callback',
    });
    authProvider.jwksCache.setKey(kid, keyPair.publicKey);

    const todayIso = new Date().toISOString().slice(0, 10);
    const [, month, day] = todayIso.split('-');
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const formattedDayMonth = `${parseInt(day, 10)} ${monthNames[parseInt(month, 10) - 1]}`;

    const datePlanning: any = {
      getTodayIso: () => todayIso,
    };

    const mockWorkItemRepo = {
      discoverLatestTasksForPeople: vi.fn().mockResolvedValue(new Map()),
      getExistingTasksForPerson: vi.fn().mockResolvedValue(new Map()),
      findCandidateTasks: vi.fn().mockResolvedValue([
        {
          id: 6001,
          fields: {
            'System.Title': `3in1_PWA_MyAccount | ${formattedDayMonth}`,
            'System.State': 'In Progress',
            'System.AssignedTo': 'dev1@workops.test',
            'Custom.PlannedStartdate': `${todayIso}T04:00:00.000Z`,
            'Custom.PlannedStartDate': `${todayIso}T04:00:00.000Z`,
          },
        },
      ]),
      getWorkItem: vi.fn().mockImplementation((id: number) =>
        Promise.resolve({
          id,
          fields: {
            'System.Title': `3in1_PWA_MyAccount | ${formattedDayMonth}`,
            'System.State': 'Closed',
            'System.AssignedTo': 'dev1@workops.test',
          },
        })
      ),
      patchWorkItem: vi.fn().mockResolvedValue({ id: 6001, fields: { 'System.State': 'Closed' } }),
      createWorkItemWithReconciliation: vi.fn().mockResolvedValue({ id: 7001, fields: {} }),
    };

    const mockGithubClient = {
      resolveUserByEmail: vi.fn().mockResolvedValue('dev1-github'),
      getPrDeliverablesForDate: vi.fn().mockResolvedValue({
        username: 'dev1-github',
        sourceDate: todayIso,
        isToday: true,
        pullRequests: [
          {
            id: 888,
            title: 'feat: add enterprise identity',
            created_at: `${todayIso}T10:00:00Z`,
            isDraft: false,
            commitsCount: 2,
          },
        ],
        htmlDescription: '<p>1 verified PR</p>',
        summaryText: '1 verified PR',
      }),
    };

    const appConfig: any = {
      organization: 'test-org',
      project: 'TestProject',
      titlePrefix: '3in1_PWA_MyAccount |',
      taskSeries: '3in1_PWA_MyAccount',
      timezone: 'UTC',
      cycleAnchorDay: 4,
      people: [
        {
          key: 'dev1',
          name: 'Dev One',
          assignedTo: 'dev1@workops.test',
          enabled: true,
          autoCloseEnabled: true,
        },
      ],
    };

    const policyEngine = new VerifiedAutoClosurePolicyEngine();

    const planUseCase = new PlanTasksUseCase(mockWorkItemRepo as any, appConfig, planTokenRepo);
    const executeUseCase = new ExecuteTasksUseCase(
      mockWorkItemRepo as any,
      journalRepo,
      planTokenRepo,
      lockManager,
      appConfig
    );
    const closeDailyTasksUseCase = new CloseDailyTasksUseCase(
      appConfig,
      mockWorkItemRepo as any,
      datePlanning,
      mockGithubClient as any,
      { load: vi.fn().mockResolvedValue(appConfig), getConfig: vi.fn().mockResolvedValue(appConfig) } as any,
      journalRepo,
      undefined,
      { load: vi.fn().mockResolvedValue({ enabled: true, rules: [] }) },
      undefined,
      policyEngine
    );

    const app = express();
    app.use(express.json());

    // Attach OIDC JWT verification middleware
    app.use(authProvider.createMiddleware());

    // Mount Auth session routes (/auth/login, /auth/callback, /auth/logout)
    app.use('/auth', createAuthRouter({ authProvider }));

    // Mount API router
    const router = createApiRouter({
      createTasks: {} as any,
      planTasks: planUseCase,
      executeTasks: executeUseCase,
      closeDailyTasks: closeDailyTasksUseCase,
      exploreTasks: {} as any,
      getStatus: {} as any,
      config: { getConfig: vi.fn().mockResolvedValue(appConfig) } as any,
      journal: journalRepo,
      scheduler: {} as any,
      autoClosureConfigRepo: {
        load: vi.fn().mockResolvedValue({ enabled: true, rules: [] }),
        save: vi.fn().mockResolvedValue(undefined),
        validate: vi.fn().mockResolvedValue({ isValid: true, errors: [], warnings: [] }),
        getVersion: vi.fn().mockResolvedValue(1),
      } as any,
    });
    app.use('/api', router);

    server = app.listen(0);
    const port = (server.address() as any).port;
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterEach(() => {
    delete process.env.OIDC_ISSUER;
    if (server) {
      server.close();
    }
    if (db && db.engine === 'sqlite') {
      db.close();
    }
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  function createSignedToken(claims: Record<string, any>): string {
    const header = { alg: 'RS256', typ: 'JWT', kid };
    const hB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
    const pB64 = Buffer.from(JSON.stringify({
      iss: issuer,
      aud: audience,
      iat: Math.floor(Date.now() / 1000) - 60,
      exp: Math.floor(Date.now() / 1000) + 3600,
      tenantId: 'tenant-enterprise-01',
      ...claims,
    })).toString('base64url');
    const input = `${hB64}.${pB64}`;

    const signer = crypto.createSign('RSA-SHA256');
    signer.update(input);
    const sig = signer.sign(keyPair.privateKey).toString('base64url');
    return `${input}.${sig}`;
  }

  describe('Session Endpoints & OIDC Flow', () => {
    it('GET /api/session returns session data for authenticated Lead user', async () => {
      const leadToken = createSignedToken({
        sub: 'user-lead-01',
        email: 'alex.lead@workops.test',
        name: 'Alex Lead',
        roles: ['Lead'],
      });

      const res = await fetch(`${baseUrl}/api/session`, {
        headers: { Authorization: `Bearer ${leadToken}` },
      });

      expect(res.status).toBe(200);
      const data: any = await res.json();
      expect(data.success).toBe(true);
      expect(data.authenticated).toBe(true);
      expect(data.user).toBe('alex.lead@workops.test');
      expect(data.role).toBe('lead');
      expect(data.roles).toContain('Lead');
      expect(data.viewerMode).toBe(false);
    });

    it('GET /auth/login returns authorization URL with PKCE parameters', async () => {
      const res = await fetch(`${baseUrl}/auth/login`, {
        headers: { Accept: 'application/json' },
      });

      expect(res.status).toBe(200);
      const data: any = await res.json();
      expect(data.success).toBe(true);
      expect(data.authorizationUrl).toContain('/oauth/authorize');
      expect(data.authorizationUrl).toContain('client_id=workops-integration-client');
      expect(data.authorizationUrl).toContain('code_challenge=');
    });

    it('POST /auth/logout clears session cookies', async () => {
      const res = await fetch(`${baseUrl}/auth/logout`, { method: 'POST' });
      expect(res.status).toBe(200);
      const data: any = await res.json();
      expect(data.success).toBe(true);
    });
  });

  describe('Four-Tier Granular RBAC Route Protection', () => {
    it('Lead token is permitted to execute team planning and batch execution', async () => {
      const leadToken = createSignedToken({
        email: 'lead@workops.test',
        name: 'Tech Lead',
        roles: ['Lead'],
      });

      // 1. Plan
      const today = new Date().toISOString().slice(0, 10);
      const planRes = await fetch(`${baseUrl}/api/tasks/plan`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${leadToken}`,
        },
        body: JSON.stringify({ all: true, asOf: today }),
      });

      expect(planRes.status).toBe(200);
      const planData: any = await planRes.json();
      expect(planData.planToken).toBeDefined();

      // 2. Execute
      const execRes = await fetch(`${baseUrl}/api/tasks/execute`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${leadToken}`,
        },
        body: JSON.stringify({ planToken: planData.planToken, confirm: true, dryRun: true }),
      });

      expect(execRes.status).toBe(200);
    });

    it('Developer token is denied team plan execution with HTTP 403', async () => {
      const devToken = createSignedToken({
        email: 'dev@workops.test',
        name: 'Developer One',
        roles: ['Developer'],
      });

      const res = await fetch(`${baseUrl}/api/tasks/execute`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${devToken}`,
        },
        body: JSON.stringify({ planToken: 'pln_dummy.1799999999.sig' }),
      });

      expect(res.status).toBe(403);
      const data: any = await res.json();
      expect(data.error).toBe("Role 'Developer' cannot execute team plans.");
    });

    it('Auditor token has strictly read-only access and receives HTTP 403 on mutations', async () => {
      const auditorToken = createSignedToken({
        email: 'auditor@workops.test',
        name: 'Compliance Auditor',
        roles: ['Auditor'],
      });

      // 1. GET /api/session succeeds
      const sessionRes = await fetch(`${baseUrl}/api/session`, {
        headers: { Authorization: `Bearer ${auditorToken}` },
      });
      expect(sessionRes.status).toBe(200);
      const sessionData: any = await sessionRes.json();
      expect(sessionData.viewerMode).toBe(true);

      // 2. POST /api/tasks/plan blocked with 403
      const planRes = await fetch(`${baseUrl}/api/tasks/plan`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${auditorToken}`,
        },
        body: JSON.stringify({ all: true }),
      });
      expect(planRes.status).toBe(403);
      const planData: any = await planRes.json();
      expect(planData.error).toBe("Role 'Auditor' is read-only.");

      // 3. POST /api/tasks/close-today blocked with 403
      const closeRes = await fetch(`${baseUrl}/api/tasks/close-today`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${auditorToken}`,
        },
        body: JSON.stringify({ all: true, confirm: true }),
      });
      expect(closeRes.status).toBe(403);
      const closeData: any = await closeRes.json();
      expect(closeData.error).toBe("Role 'Auditor' is read-only.");

      // 4. PUT /api/auto-closure/config blocked with 403
      const configRes = await fetch(`${baseUrl}/api/auto-closure/config`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${auditorToken}`,
        },
        body: JSON.stringify({ enabled: true, rules: [] }),
      });
      expect(configRes.status).toBe(403);
      const configData: any = await configRes.json();
      expect(configData.error).toBe("Role 'Auditor' is read-only.");
    });
  });

  describe('Personal Identity Attribution & Policy Gating', () => {
    it('attributes task mutations in relational journal to authenticated operator email', async () => {
      const leadToken = createSignedToken({
        email: 'lead.attribution@workops.test',
        name: 'Attributed Lead',
        roles: ['Lead'],
      });

      // Close task
      const res = await fetch(`${baseUrl}/api/tasks/close-today`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${leadToken}`,
        },
        body: JSON.stringify({
          personKeys: ['dev1'],
          confirm: true,
          dryRun: false,
          asOf: new Date().toISOString().slice(0, 10),
        }),
      });

      expect(res.status).toBe(200);

      // Verify attribution in journal_entries table
      const entries = await journalRepo.getEntries();
      expect(entries.length).toBeGreaterThanOrEqual(1);
      const closedEntry = entries.find((e: any) => e.action === 'CLOSED' || e.actionType === 'CLOSED');
      expect(closedEntry).toBeDefined();
      expect(closedEntry?.operatorEmail).toBe('lead.attribution@workops.test');
    });

    it('POST /api/auto-closure/run executes verified closure with Policy Engine', async () => {
      const adminToken = createSignedToken({
        email: 'admin@workops.test',
        name: 'System Admin',
        roles: ['Admin'],
      });

      const res = await fetch(`${baseUrl}/api/auto-closure/run`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${adminToken}`,
        },
        body: JSON.stringify({
          asOf: new Date().toISOString().slice(0, 10),
          dryRun: true,
        }),
      });

      expect(res.status).toBe(200);
      const data: any = await res.json();
      expect(data.success).toBe(true);
      expect(data.data.results).toBeDefined();
    });
  });

  describe('Adversarial Security & Governance Verification', () => {
    describe('Adversarial Suite A — Unauthenticated Mutation Lockout', () => {
      const mutationEndpoints = [
        { method: 'POST', path: '/api/tasks/plan', body: { all: true } },
        { method: 'POST', path: '/api/tasks/execute', body: { planToken: 'token' } },
        { method: 'POST', path: '/api/tasks/close-today', body: { confirm: true } },
        { method: 'POST', path: '/api/tasks/adhoc', body: { personKey: 'dev1' } },
        { method: 'POST', path: '/api/tasks/repair', body: { confirm: true } },
        { method: 'POST', path: '/api/calendar', body: { calendar: {} } },
        { method: 'POST', path: '/api/config/people', body: {} },
        { method: 'POST', path: '/api/config/settings', body: {} },
        { method: 'POST', path: '/api/config/pat', body: {} },
        { method: 'POST', path: '/api/scheduler/toggle', body: { enabled: true } },
        { method: 'POST', path: '/api/scheduler/run-now', body: { confirm: true, all: true } },
        { method: 'POST', path: '/api/auto-closure/run', body: {} },
        { method: 'PUT', path: '/api/auto-closure/config', body: { enabled: true, rules: [] } },
      ];

      for (const endpoint of mutationEndpoints) {
        it(`unauthenticated ${endpoint.method} ${endpoint.path} is rejected with HTTP 401`, async () => {
          const res = await fetch(`${baseUrl}${endpoint.path}`, {
            method: endpoint.method,
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(endpoint.body),
          });

          expect(res.status).toBe(401);
          const data: any = await res.json();
          expect(data.success).toBe(false);
          expect(data.error).toContain('Authentication required');
        });
      }
    });

    describe('Adversarial Suite B — Universal Auditor Mutation Shield', () => {
      let auditorToken: string;

      beforeEach(() => {
        auditorToken = createSignedToken({
          email: 'auditor.shield@workops.test',
          name: 'Compliance Auditor',
          roles: ['Auditor'],
        });
      });

      const mutationEndpoints = [
        { method: 'POST', path: '/api/tasks/plan', body: { all: true } },
        { method: 'POST', path: '/api/tasks/execute', body: { planToken: 'token' } },
        { method: 'POST', path: '/api/tasks/close-today', body: { confirm: true } },
        { method: 'POST', path: '/api/tasks/adhoc', body: { personKey: 'dev1' } },
        { method: 'POST', path: '/api/tasks/repair', body: { confirm: true } },
        { method: 'POST', path: '/api/calendar', body: { calendar: {} } },
        { method: 'POST', path: '/api/config/people', body: {} },
        { method: 'POST', path: '/api/config/settings', body: {} },
        { method: 'POST', path: '/api/config/pat', body: {} },
        { method: 'POST', path: '/api/scheduler/toggle', body: { enabled: true } },
        { method: 'POST', path: '/api/scheduler/run-now', body: { confirm: true, all: true } },
        { method: 'POST', path: '/api/auto-closure/run', body: {} },
        { method: 'PUT', path: '/api/auto-closure/config', body: { enabled: true, rules: [] } },
      ];

      for (const endpoint of mutationEndpoints) {
        it(`Auditor ${endpoint.method} ${endpoint.path} is rejected with HTTP 403`, async () => {
          const res = await fetch(`${baseUrl}${endpoint.path}`, {
            method: endpoint.method,
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${auditorToken}`,
            },
            body: JSON.stringify(endpoint.body),
          });

          expect(res.status).toBe(403);
          const data: any = await res.json();
          expect(data.success).toBe(false);
          expect(data.error).toBe("Role 'Auditor' is read-only.");
        });
      }

      it('Auditor retains read-only access to query endpoints', async () => {
        const sessionRes = await fetch(`${baseUrl}/api/session`, {
          headers: { Authorization: `Bearer ${auditorToken}` },
        });
        expect(sessionRes.status).toBe(200);

        const journalRes = await fetch(`${baseUrl}/api/journal`, {
          headers: { Authorization: `Bearer ${auditorToken}` },
        });
        expect(journalRes.status).toBe(200);

        const configRes = await fetch(`${baseUrl}/api/auto-closure/config`, {
          headers: { Authorization: `Bearer ${auditorToken}` },
        });
        expect(configRes.status).toBe(200);
      });
    });

    describe('Adversarial Suite C — Developer IDOR Isolation', () => {
      let devToken: string;

      beforeEach(() => {
        devToken = createSignedToken({
          email: 'dev1@workops.test',
          name: 'Developer One',
          roles: ['Developer'],
        });
      });

      it('Developer cannot close tasks for another personKey (IDOR attack)', async () => {
        const res = await fetch(`${baseUrl}/api/tasks/close-today`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${devToken}`,
          },
          body: JSON.stringify({
            personKeys: ['dev2'],
            confirm: true,
            dryRun: false,
          }),
        });

        expect(res.status).toBe(403);
        const data: any = await res.json();
        expect(data.success).toBe(false);
        expect(data.error).toBe('Developer role may only close their own tasks.');
      });

      it('Developer cannot close tasks across multiple personKeys', async () => {
        const res = await fetch(`${baseUrl}/api/tasks/close-today`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${devToken}`,
          },
          body: JSON.stringify({
            personKeys: ['dev1', 'dev2'],
            confirm: true,
            dryRun: false,
          }),
        });

        expect(res.status).toBe(403);
        const data: any = await res.json();
        expect(data.success).toBe(false);
        expect(data.error).toBe('Developer role may only close their own tasks.');
      });

      it('Developer cannot close tasks with scope.all wildcard', async () => {
        const res = await fetch(`${baseUrl}/api/tasks/close-today`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${devToken}`,
          },
          body: JSON.stringify({
            all: true,
            confirm: true,
            dryRun: false,
          }),
        });

        expect(res.status).toBe(403);
        const data: any = await res.json();
        expect(data.success).toBe(false);
        expect(data.error).toBe('Developer role may only close their own tasks.');
      });

      it('Developer can close tasks for their own member key', async () => {
        const res = await fetch(`${baseUrl}/api/tasks/close-today`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${devToken}`,
          },
          body: JSON.stringify({
            personKeys: ['dev1'],
            confirm: true,
            dryRun: true,
          }),
        });

        expect(res.status).toBe(200);
        const data: any = await res.json();
        expect(data.success).toBe(true);
      });
    });

    describe('Adversarial Suite D — Manual Override Role Spoofing & Justification Validation', () => {
      it('rejects manual override attempt by Developer role claiming Admin overrideRole', async () => {
        const devToken = createSignedToken({
          email: 'dev1@workops.test',
          name: 'Developer One',
          roles: ['Developer'],
        });

        const res = await fetch(`${baseUrl}/api/tasks/close-today`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${devToken}`,
          },
          body: JSON.stringify({
            personKeys: ['dev1'],
            confirm: true,
            dryRun: false,
            manualOverride: {
              allowed: true,
              overrideRole: 'Admin',
              reason: 'Self override',
            },
          }),
        });

        expect(res.status).toBe(403);
        const data: any = await res.json();
        expect(data.error).toBe("Manual override policy requires role 'Admin' or 'Lead'.");
      });

      it('rejects manual override with empty or whitespace justification reason', async () => {
        const adminToken = createSignedToken({
          email: 'admin@workops.test',
          name: 'System Admin',
          roles: ['Admin'],
        });

        const res = await fetch(`${baseUrl}/api/tasks/close-today`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${adminToken}`,
          },
          body: JSON.stringify({
            personKeys: ['dev1'],
            confirm: true,
            dryRun: false,
            manualOverride: {
              allowed: true,
              reason: '   ',
            },
          }),
        });

        expect(res.status).toBe(400);
        const data: any = await res.json();
        expect(data.error).toBe('Manual override requires an attributed justification reason.');
      });

      it('accepts legitimate manual override by Admin and records audit attribution', async () => {
        const adminToken = createSignedToken({
          email: 'admin.governance@workops.test',
          name: 'Governance Admin',
          roles: ['Admin'],
        });

        const reason = 'Emergency hotfix deployment verified in Slack';
        const res = await fetch(`${baseUrl}/api/tasks/close-today`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${adminToken}`,
          },
          body: JSON.stringify({
            personKeys: ['dev1'],
            confirm: true,
            dryRun: false,
            manualOverride: {
              allowed: true,
              reason,
            },
          }),
        });

        expect(res.status).toBe(200);
        const data: any = await res.json();
        expect(data.success).toBe(true);

        const entries = await journalRepo.getEntries();
        const overriddenEntry: any = entries.find(
          (e: any) => e.manualOverride === true || e.overrideRole === 'Admin'
        );
        expect(overriddenEntry).toBeDefined();
        expect(overriddenEntry.operatorEmail).toBe('admin.governance@workops.test');
        expect(overriddenEntry.overrideRole).toBe('Admin');
        expect(overriddenEntry.overrideReason).toBe(reason);
      });
    });

    describe('Adversarial Suite E — OAuth2 State CSRF Neutralization', () => {
      it('rejects callback when state parameter is missing', async () => {
        const res = await fetch(`${baseUrl}/auth/callback?code=mock_auth_code`);
        expect(res.status).toBe(400);
        const data: any = await res.json();
        expect(data.error).toContain('Invalid or missing OAuth2 state parameter (CSRF detected)');
      });

      it('rejects callback when state parameter does not match stored oauth_state cookie', async () => {
        const res = await fetch(`${baseUrl}/auth/callback?code=mock_auth_code&state=forged_state`, {
          headers: {
            Cookie: 'oauth_state=genuine_state; pkce_verifier=genuine_verifier',
          },
        });
        expect(res.status).toBe(400);
        const data: any = await res.json();
        expect(data.error).toBe('Invalid or missing OAuth2 state parameter (CSRF detected)');
      });
    });
  });
});
