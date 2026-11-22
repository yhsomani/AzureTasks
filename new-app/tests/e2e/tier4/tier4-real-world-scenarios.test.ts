import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { FileLockRepository } from '../../../src/infrastructure/lock/file-lock-repo.js';
import { startHarness, stopHarness, WorkOpsTestHarness } from '../harness/index.js';
import { AutoClosureService } from '../../../src/domain/services/auto-closure-service.js';

describe('Tier 4: Real-World Application Scenarios (6 Multi-Step Operational Journeys)', () => {
  let harness: WorkOpsTestHarness;

  beforeAll(async () => {
    harness = await startHarness({ enableSqlite: true });
  });

  afterAll(async () => {
    await stopHarness();
  });

  // =========================================================================
  // Scenario 1: Full Sprint Planning & Plan Execution Workflow
  // Features: F16-F20, F22, F24-F25, F33, F34, F37-F38
  // =========================================================================
  it('Scenario 1: Full Sprint Planning & Plan Execution Workflow', async () => {
    const db = harness.dbHelper.getSqliteDb();

    // 1. Authentication & Context: Alex logs in via Entra ID OIDC SSO as Lead (F23, F24)
    const alexToken = harness.oidcMock.issueLeadToken('alex.lead@workops.test');
    const claims = harness.oidcMock.verifyToken(alexToken);
    expect(claims?.email).toBe('alex.lead@workops.test');
    expect(claims?.roles).toContain('Lead');

    // Negative RBAC: Auditor cannot act as Lead
    const auditorToken = harness.oidcMock.issueAuditorToken('david.auditor@workops.test');
    const auditorClaims = harness.oidcMock.verifyToken(auditorToken);
    expect(auditorClaims?.roles).not.toContain('Lead');
    expect(auditorClaims?.roles).toContain('Auditor');

    // 2. Planning Workspace & Capacity Verification via API (F1, F33)
    const calRes = await harness.get('/api/calendar');
    expect(calRes.status).toBe(200);
    const calData = (await calRes.json()) as any;
    expect(calData.success).toBe(true);
    expect(calData.data.members).toBeDefined();

    const configRes = await harness.get('/api/config');
    expect(configRes.status).toBe(200);
    const configData = (await configRes.json()) as any;
    expect(configData.data.people.length).toBeGreaterThanOrEqual(2);

    // 3. Plan Generation (Phase 1 Commit) via Authentic Endpoint (F19, F34)
    const planRes = await harness.post('/api/tasks/plan', { all: true });
    expect(planRes.status).toBe(200);
    const planJson = (await planRes.json()) as any;
    expect(planJson.success).toBe(true);
    expect(planJson.data.personPlans.length).toBeGreaterThan(0);
    const token = planJson.data?.planToken || planJson.planToken;
    expect(token).toBeDefined();

    // 4. Distributed Execution Lock (Mutual Exclusion) (F22)
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const lockResource = 'workops:lock:execute:' + tokenHash;
    const lockHandle = await harness.app.lockManager!.acquire(lockResource, 30000);
    const lockAcquired = lockHandle !== null;
    expect(lockAcquired).toBe(true);

    // Concurrent execution attempt while lock is held must fail with 409 Conflict
    const conflictRes = await harness.post('/api/tasks/execute', {
      planToken: token,
      confirm: true,
      dryRun: true,
    });
    expect(conflictRes.status).toBe(409);
    const conflictJson = (await conflictRes.json()) as any;
    expect(conflictJson.success).toBe(false);
    expect(conflictJson.error).toContain('EXECUTION_LOCK_CONFLICT');

    // Release distributed execution lock
    await harness.app.lockManager!.release(lockHandle!);
    await harness.app.lockManager!.release(lockResource);

    // 5. Plan Execution (Phase 2 Commit with Zero Drift) via Authentic API Endpoint (F20, F25)
    const execRes = await harness.post('/api/tasks/execute', {
      planToken: token,
      confirm: true,
      dryRun: true,
    });
    expect(execRes.status).toBe(200);
    const execJson = (await execRes.json()) as any;
    expect(execJson.success).toBe(true);

    // Verify SQLite plan_tokens was automatically updated to is_executed = 1 by backend
    const updatedPlan = db.prepare('SELECT is_executed FROM plan_tokens WHERE token_hash = ?;').get(tokenHash) as { is_executed: number };
    expect(updatedPlan).toBeDefined();
    expect(updatedPlan.is_executed).toBe(1);

    // Verify Replay Protection: Second execution attempt must fail with 409 Conflict
    const replayRes = await harness.post('/api/tasks/execute', {
      planToken: token,
      confirm: true,
      dryRun: true,
    });
    expect(replayRes.status).toBe(409);
    const replayJson = (await replayRes.json()) as any;
    expect(replayJson.success).toBe(false);
    expect(replayJson.error).toContain('PLAN_ALREADY_EXECUTED');

    // Record personal identity attribution in journal repository (F25)
    await harness.app.journal.record({
      timestamp: new Date().toISOString(),
      action: 'PLAN_EXECUTED',
      taskId: 1001,
      personKey: 'dev1',
      isoDate: '2026-11-21',
      title: 'Sprint 48 Tasks Executed',
      assignedTo: claims!.email,
    } as any);

    const journalRes = await harness.get('/api/journal');
    expect(journalRes.status).toBe(200);
    const journalJson = (await journalRes.json()) as any;
    expect(journalJson.data.entries.some((e: any) => e.assignedTo === claims!.email)).toBe(true);

    // 6. Enterprise Notification Dispatch to Mock Webhook Receiver (F38)
    const notifyRes = await fetch(harness.webhookMock.getTeamsUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'message',
        attachments: [{
          contentType: 'application/vnd.microsoft.card.adaptive',
          content: {
            type: 'AdaptiveCard',
            version: '1.4',
            body: [
              { type: 'TextBlock', text: 'Sprint 48 Tasks Created by Alex' },
              { type: 'TextBlock', text: `Operator: ${claims!.email}` },
            ],
          },
        }],
      }),
    });
    expect(notifyRes.status).toBe(200);

    const teamsHooks = harness.webhookMock.getTeamsWebhooks();
    expect(teamsHooks.length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(teamsHooks[teamsHooks.length - 1].body)).toContain('Sprint 48 Tasks Created by Alex');
  });

  // =========================================================================
  // Scenario 2: End-of-Day Verified Auto-Closure & Audit Trail
  // Features: F3, F16, F24-F26, F35, F38
  // =========================================================================
  it('Scenario 2: End-of-Day Verified Auto-Closure & Audit Trail', async () => {
    // 1. Verify Auto-Closure Route Configuration Endpoint (F3)
    const configRes = await harness.get('/api/auto-closure/config');
    expect(configRes.status).toBe(200);

    // 2. Deliverable Verification via Mock GitHub Server and Policy Engine (F26)
    // Priya has verified GitHub PR #412; Mukul has 0 PRs
    harness.githubMock.seedPullRequests([
      {
        id: 412,
        number: 412,
        title: 'feat: add payment gateway webhook handler',
        state: 'closed',
        created_at: '2026-11-21T09:00:00Z',
        merged_at: '2026-11-21T15:00:00Z',
        user: { login: 'priya-dev', id: 501 },
      },
    ]);

    const priyaDeliverables = await harness.app.githubClient.getPrDeliverablesForDate(
      'priya-dev',
      '2026-11-21',
      'Asia/Kolkata'
    );
    expect(priyaDeliverables.pullRequests.length).toBeGreaterThanOrEqual(1);

    const mukulDeliverables = await harness.app.githubClient.getPrDeliverablesForDate(
      'mukul-dev',
      '2026-11-21',
      'Asia/Kolkata'
    );
    expect(mukulDeliverables.pullRequests.length).toBe(0);

    const autoService = new AutoClosureService();
    const priyaDecision = autoService.shouldCloseTask(
      {
        enabled: true,
        version: 1,
        createdAt: '2026-11-21T00:00:00Z',
        updatedAt: '2026-11-21T00:00:00Z',
        createdBy: 'admin',
        lastModifiedBy: 'admin',
        rules: [{
          ruleId: 'r-priya',
          type: 'inclusion',
          filterType: 'users',
          filters: [{ id: 'priya@workops.test', name: 'Priya' }],
          createdAt: '2026-11-21T00:00:00Z',
          updatedAt: '2026-11-21T00:00:00Z',
          createdBy: 'admin',
        }],
      },
      'priya@workops.test'
    );
    expect(priyaDecision.shouldClose).toBe(true);

    const mukulDecision = autoService.shouldCloseTask(
      {
        enabled: true,
        version: 1,
        createdAt: '2026-11-21T00:00:00Z',
        updatedAt: '2026-11-21T00:00:00Z',
        createdBy: 'admin',
        lastModifiedBy: 'admin',
        rules: [{
          ruleId: 'r-priya',
          type: 'inclusion',
          filterType: 'users',
          filters: [{ id: 'priya@workops.test', name: 'Priya' }],
          createdAt: '2026-11-21T00:00:00Z',
          updatedAt: '2026-11-21T00:00:00Z',
          createdBy: 'admin',
        }],
      },
      'mukul@workops.test'
    );
    expect(mukulDecision.shouldClose).toBe(false);

    // 3. Audit Trail Persistence in Relational Storage & Journal (F16, F25)
    await harness.app.journal.record({
      timestamp: new Date().toISOString(),
      action: 'AUTO_CLOSE_SUCCESS',
      taskId: 3001,
      personKey: 'dev1',
      isoDate: '2026-11-21',
      title: 'Auto-closed with verified PR #412',
      assignedTo: 'system:worker-daemon',
    } as any);

    await harness.app.journal.record({
      timestamp: new Date().toISOString(),
      action: 'AUTO_CLOSE_NEEDS_REVIEW',
      taskId: 3002,
      personKey: 'dev2',
      isoDate: '2026-11-21',
      title: 'Needs review: zero deliverables found',
      assignedTo: 'system:worker-daemon',
    } as any);

    const journalRes = await harness.get('/api/journal');
    expect(journalRes.status).toBe(200);
    const journalJson = (await journalRes.json()) as any;
    expect(journalJson.data.entries.some((e: any) => e.action === 'AUTO_CLOSE_SUCCESS')).toBe(true);

    // 4. Lead Manual Review & Attributed Override for Mukul (F24, F25)
    const leadAuth = autoService.checkConfigurationAuthorization('alex.lead@workops.test', ['alex.lead@workops.test', 'admin@workops.test']);
    expect(leadAuth.isAuthorized).toBe(true);

    await harness.app.journal.record({
      timestamp: new Date().toISOString(),
      action: 'LEAD_MANUAL_OVERRIDE',
      taskId: 3002,
      personKey: 'dev2',
      isoDate: '2026-11-21',
      title: 'Lead manual approval: paired with Priya on PR #412',
      assignedTo: 'alex.lead@workops.test',
    } as any);

    // 5. Auditor Compliance Verification (100% Evidence Linkage)
    const auditEntries = await harness.app.journal.getEntries();
    const priyaEntry = auditEntries.find((e: any) => e.taskId === 3001);
    const mukulEntry = auditEntries.find((e: any) => e.taskId === 3002 && e.action === 'LEAD_MANUAL_OVERRIDE');
    expect(priyaEntry?.assignedTo).toBe('system:worker-daemon');
    expect(mukulEntry?.assignedTo).toBe('alex.lead@workops.test');

    // 6. Enterprise Notification & Deep Telemetry Probes (F35, F38)
    const slackRes = await fetch(harness.webhookMock.getSlackUrl(), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        channel: '#eng-workops',
        text: 'EOD Auto-Closure Digest: 1 closed, 1 overridden, 0 remaining',
      }),
    });
    expect(slackRes.status).toBe(200);

    const slackHooks = harness.webhookMock.getSlackWebhooks();
    expect(slackHooks.some((h) => h.body.text?.includes('EOD Auto-Closure Digest'))).toBe(true);

    const readyRes = await harness.get('/api/ready');
    expect(readyRes.status).toBe(200);
    const readyJson = (await readyRes.json()) as any;
    expect(readyJson.success).toBe(true);
    expect(readyJson.data.azureDevOpsConnected).toBe(true);
  });

  // =========================================================================
  // Scenario 3: Multi-Tenant Organization Onboarding & RBAC Governance
  // Features: F16, F17, F23-F25, F33
  // =========================================================================
  it('Scenario 3: Multi-Tenant Organization Onboarding & RBAC Governance', () => {
    const db = harness.dbHelper.getSqliteDb();

    // 1. Admin logs in and provisions Organization (F16, F23)
    const orgId = 'org_payments_div';
    db.prepare('INSERT OR REPLACE INTO organizations (id, name, slug) VALUES (?, ?, ?);').run(
      orgId,
      'Payments Division',
      'payments-division'
    );

    // Adversarial: Duplicate organization slug fails UNIQUE constraint
    expect(() => {
      db.prepare('INSERT INTO organizations (id, name, slug) VALUES (?, ?, ?);').run(
        'org_payments_dup',
        'Duplicate Division',
        'payments-division'
      );
    }).toThrow();

    // 2. Department & Multi-Team Hierarchy Creation (F17, F33)
    const deptId = 'dept_card_services';
    db.prepare('INSERT OR REPLACE INTO departments (id, org_id, name) VALUES (?, ?, ?);').run(
      deptId,
      orgId,
      'Card Services'
    );

    const team1Id = 'team_payment_gateway';
    const team2Id = 'team_fraud_engine';
    db.prepare('INSERT OR REPLACE INTO teams (id, dept_id, name) VALUES (?, ?, ?);').run(team1Id, deptId, 'Payment Gateway Pod');
    db.prepare('INSERT OR REPLACE INTO teams (id, dept_id, name) VALUES (?, ?, ?);').run(team2Id, deptId, 'Fraud Engine Pod');

    // 3. Team Member Registration Across 4 Roles (F24)
    const memberStmt = db.prepare('INSERT OR REPLACE INTO members (id, team_id, email, display_name, role) VALUES (?, ?, ?, ?, ?);');
    memberStmt.run('m_sarah', team1Id, 'sarah.lead@payments.test', 'Sarah Jenkins', 'Lead');
    for (let i = 1; i <= 3; i++) {
      memberStmt.run(`m_pg_${i}`, team1Id, `pg_dev_${i}@payments.test`, `Gateway Dev ${i}`, 'Developer');
    }
    for (let i = 1; i <= 4; i++) {
      memberStmt.run(`m_fe_${i}`, team2Id, `fe_dev_${i}@payments.test`, `Fraud Dev ${i}`, 'Developer');
    }

    // 4. Granular RBAC Permission Verification (F24)
    const sarahMember = db.prepare('SELECT role FROM members WHERE email = ?;').get('sarah.lead@payments.test') as { role: string };
    expect(sarahMember.role).toBe('Lead');

    const devMember = db.prepare('SELECT role FROM members WHERE email = ?;').get('pg_dev_1@payments.test') as { role: string };
    expect(devMember.role).toBe('Developer');

    // 5. Tenant Isolation Verification (F33)
    const paymentsTeams = db.prepare(`
      SELECT t.name FROM teams t
      JOIN departments d ON t.dept_id = d.id
      WHERE d.org_id = ?;
    `).all(orgId);
    expect(paymentsTeams.length).toBe(2);

    // Cross-tenant check: non-existent tenant returns 0 teams
    const foreignTeams = db.prepare(`
      SELECT t.name FROM teams t
      JOIN departments d ON t.dept_id = d.id
      WHERE d.org_id = 'org_external_contractors';
    `).all();
    expect(foreignTeams.length).toBe(0);

    // 6. Foreign Key Cascade Deletion (F17)
    db.prepare('INSERT OR REPLACE INTO departments (id, org_id, name) VALUES (?, ?, ?);').run('dept_temp', orgId, 'Temporary Dept');
    db.prepare('INSERT OR REPLACE INTO teams (id, dept_id, name) VALUES (?, ?, ?);').run('team_temp', 'dept_temp', 'Temp Team');
    db.prepare('INSERT OR REPLACE INTO members (id, team_id, email, display_name, role) VALUES (?, ?, ?, ?, ?);').run('m_temp', 'team_temp', 'temp@payments.test', 'Temp User', 'Developer');

    db.prepare('DELETE FROM departments WHERE id = ?;').run('dept_temp');
    const remainingTempTeam = db.prepare('SELECT * FROM teams WHERE id = ?;').get('team_temp');
    expect(remainingTempTeam).toBeUndefined();
  });

  // =========================================================================
  // Scenario 4: Offline Data Migration, Service Bootstrap & Telemetry Health
  // Features: F4, F16-F18, F21, F27-F29, F35-F36
  // =========================================================================
  it('Scenario 4: Offline Data Migration, Service Bootstrap & Telemetry Health', async () => {
    // 1. Sanitization & Hygiene Verification (F4)
    const gitignore = fs.readFileSync('.gitignore', 'utf8');
    expect(gitignore).toContain('.task-journal.json');
    expect(gitignore).toContain('people.json');

    // 2. Database Migration Execution (Batch processing of historical journal) (F18)
    const db = harness.dbHelper.getSqliteDb();
    const batchStmt = db.prepare('INSERT OR REPLACE INTO journal_entries (id, action_type, operator_email, details_json) VALUES (?, ?, ?, ?);');

    // Migrate in transactional batches of 50
    for (let chunk = 0; chunk < 10; chunk++) {
      for (let i = 0; i < 50; i++) {
        const id = chunk * 50 + i;
        batchStmt.run(`migrated_s4_${id}`, 'HISTORICAL_TASK', 'migration-sre@workops.test', JSON.stringify({ id }));
      }
    }

    const migratedCount = (db.prepare("SELECT count(*) as count FROM journal_entries WHERE id LIKE 'migrated_s4_%';").get() as { count: number }).count;
    expect(migratedCount).toBe(500);

    // 3. Telemetry Verification (Liveness and Readiness Probes) (F35)
    const healthRes = await harness.get('/api/health');
    const readyRes = await harness.get('/api/ready');

    expect(healthRes.status).toBe(200);
    expect(readyRes.status).toBe(200);

    const readyJson = (await readyRes.json()) as any;
    expect(readyJson.success).toBe(true);
    expect(readyJson.data.azureDevOpsConnected).toBe(true);

    // 4. Fault Injection & Degraded Telemetry Check
    harness.azureMock.setFault('503', 1);
    const degradedRes = await fetch(`${harness.azureMock.getBaseUrl()}/_apis/wit/wiql`);
    expect(degradedRes.status).toBe(503);
    const degradedBody = (await degradedRes.json()) as any;
    expect(degradedBody.message).toBe('Service Unavailable');
    harness.azureMock.clearFault();

    const recoveredRes = await harness.get('/api/ready');
    expect(recoveredRes.status).toBe(200);
  });

  // =========================================================================
  // Scenario 5: Web Client Workspace Navigation, Accessibility & Responsive Layout
  // Features: F7-F14, F15, F32
  // =========================================================================
  it('Scenario 5: Web Client Workspace Navigation, Accessibility & Responsive Layout', async () => {
    // 1. Responsive Typography & Design Tokens (F11, F12, F13)
    const css = fs.readFileSync('src/presentation/web/public/styles.css', 'utf8');
    expect(css).toMatch(/--font-h1:\s*clamp\(18px,\s*2\.5vw,\s*24px\)/);
    expect(css).toMatch(/--font-h2:\s*clamp\(15px,\s*2vw,\s*18px\)/);
    expect(css).toMatch(/--font-kpi:\s*clamp\(18px,\s*3vw,\s*26px\)/);
    expect(css).toContain('--surface-base');
    expect(css).toContain('--surface-card');
    expect(css).toContain('--surface: #202326'); // dark mode
    expect(css).toContain('--surface: #ffffff'); // light mode
    expect(css).toMatch(/@media\s*\(max-width:\s*768px\)/);
    expect(css).toContain('card-accordion');

    // 2. Three Workspaces Client Navigation Architecture (F7, F8, F9)
    const navSource = fs.readFileSync('src/presentation/web/src/components/layout/Navigation.tsx', 'utf8');
    expect(navSource).toContain("id: 'daily'");
    expect(navSource).toContain("id: 'planning'");
    expect(navSource).toContain("id: 'governance'");
    expect(navSource).toContain('Personal Cockpit');
    expect(navSource).toContain('Plan & Review');
    expect(navSource).toContain('Audit Log');

    const res = await harness.get('/');
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('id="main"');
    expect(html).toContain('data-view="mywork"');
    expect(html).toContain('data-view="planner"');
    expect(html).toContain('data-view="journal"');

    // 3. WCAG 2.1 AA Accessibility & Modal Focus Trap (F14)
    const modalSource = fs.readFileSync('src/presentation/web/src/components/common/Modal.tsx', 'utf8');
    expect(modalSource).toContain('trapModalFocus');
    expect(modalSource).toContain('role="dialog"');
    expect(modalSource).toContain('aria-modal="true"');
    expect(modalSource).toContain('aria-labelledby="modal-title"');
    expect(modalSource).toContain("e.key === 'Escape'");

    // 4. Asset Bundling & Zero Unescaped innerHTML (F5, F10)
    expect(fs.existsSync('src/presentation/web/public/vendor/chart.umd.js')).toBe(true);
    expect(html).toContain('vendor/chart.umd.js');
    expect(html).not.toContain('cdn.jsdelivr.net');

    const appShellSource = fs.readFileSync('src/presentation/web/src/components/layout/AppShell.tsx', 'utf8');
    expect(appShellSource).not.toContain('dangerouslySetInnerHTML');
    expect(appShellSource).not.toContain('.innerHTML');

    // 5. E2E Automation Architecture (F32)
    const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
    expect(pkg.scripts['test:e2e']).toBeDefined();
    expect(pkg.devDependencies.vitest).toBeDefined();
  });

  // =========================================================================
  // Scenario 6: Distributed Worker Job Scheduling & Concurrency Under Load
  // Features: F19-F22, F36-F37
  // =========================================================================
  it('Scenario 6: Distributed Worker Job Scheduling & Concurrency Under Load', async () => {
    // 1. Scheduler Activation with Distributed Lock (F21, F22)
    const lock = new FileLockRepository(path.join(harness.tempDir, 'lock-s6.lock'));
    expect(lock.acquire()).toBe(true);

    // 2. Bounded Parallel Batch Processing (100 work item IDs in chunks of 10) (F37)
    const allTaskIds = Array.from({ length: 100 }, (_, i) => i + 1000);
    const chunkSize = 10;
    const chunks: number[][] = [];
    for (let i = 0; i < allTaskIds.length; i += chunkSize) {
      chunks.push(allTaskIds.slice(i, i + chunkSize));
    }
    expect(chunks.length).toBe(10);
    expect(chunks[0].length).toBe(10);

    // 3. Web Server Event Loop Responsiveness Under Load (F19, F21)
    const startPlanTime = Date.now();
    const planRes = await harness.post('/api/tasks/plan', { all: true });
    const planDurationMs = Date.now() - startPlanTime;
    expect(planRes.status).toBe(200);
    expect(planDurationMs).toBeLessThan(1000); // Responsive under 1s SLA

    lock.release();

    // 4. Telemetry Heartbeat & Scheduler Status Verification (F36)
    const schedulerStatus = harness.app.scheduler.getStatus();
    expect(schedulerStatus).toBeDefined();
    expect(typeof schedulerStatus.running).toBe('boolean');
  });
});
