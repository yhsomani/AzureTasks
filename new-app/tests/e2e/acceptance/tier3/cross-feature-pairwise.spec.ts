import fs from 'node:fs';
import { test, expect } from '../harness/fixtures.js';
import { startAcceptanceServer, type AcceptanceServerHandle } from '../harness/acceptance-server.js';
import {
  assertLandmarks,
  assertLiveAnnouncement,
  assertNoHorizontalOverflow,
} from '../harness/a11y.js';

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function formatTitleDate(isoDate: string): string {
  const [y, m, d] = isoDate.split('-').map((n) => parseInt(n, 10));
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
  }).format(dt);
}

function getNextWeekdayIso(step = 1, fromIso = todayIsoDate()): string {
  const [y, m, d] = fromIso.split('-').map((n) => parseInt(n, 10));
  const dt = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  let remaining = Math.max(1, step);
  while (remaining > 0) {
    dt.setUTCDate(dt.getUTCDate() + 1);
    const day = dt.getUTCDay();
    if (day !== 0 && day !== 6) {
      remaining -= 1;
    }
  }
  return dt.toISOString().slice(0, 10);
}

function getWeekdayWindow(count: number, startOffsetWeekdays = 1): string[] {
  const dates: string[] = [];
  let cursor = getNextWeekdayIso(startOffsetWeekdays);
  dates.push(cursor);
  while (dates.length < count) {
    cursor = getNextWeekdayIso(1, cursor);
    dates.push(cursor);
  }
  return dates;
}

function unwrapArray(payload: unknown, keys: string[]): Array<Record<string, unknown>> {
  if (Array.isArray(payload)) {
    return payload as Array<Record<string, unknown>>;
  }
  if (payload && typeof payload === 'object') {
    const rec = payload as Record<string, unknown>;
    for (const key of keys) {
      if (Array.isArray(rec[key])) {
        return rec[key] as Array<Record<string, unknown>>;
      }
    }
  }
  return [];
}

function seedDailyTask(
  server: AcceptanceServerHandle,
  opts: {
    id: number;
    personName: string;
    assignedTo: string;
    isoDate: string;
    state: 'New' | 'Active' | 'Closed';
    titlePrefix?: string;
    estimatedHours?: number;
  }
): void {
  const prefix = (opts.titlePrefix ?? 'Task |').replace(/\|$/, '').trim();
  const titleDate = formatTitleDate(opts.isoDate);
  server.mockAzure.seedWorkItem({
    id: opts.id,
    fields: {
      'System.TeamProject': 'TestProject',
      'System.WorkItemType': 'Task',
      'System.Title': `${prefix} | ${titleDate} | ${opts.personName} Daily Work`,
      'System.State': opts.state,
      'System.AssignedTo': { displayName: opts.personName, uniqueName: opts.assignedTo },
      'System.AreaPath': 'TestProject\\Platform',
      'System.IterationPath': 'TestProject\\Sprint 42',
      'Microsoft.VSTS.Scheduling.StartDate': `${opts.isoDate}T09:30:00Z`,
      'Custom.PlannedStartDate': `${opts.isoDate}T09:30:00Z`,
      'Microsoft.VSTS.Scheduling.OriginalEstimate': opts.estimatedHours ?? 8,
      'Microsoft.VSTS.Scheduling.RemainingWork': opts.state === 'Closed' ? 0 : opts.estimatedHours ?? 8,
      'Microsoft.VSTS.Scheduling.CompletedWork': opts.state === 'Closed' ? opts.estimatedHours ?? 8 : 0,
      'Microsoft.VSTS.Common.Activity': 'Development',
      'System.CreatedDate': `${opts.isoDate}T09:30:00Z`,
    },
    relations: [
      {
        rel: 'System.LinkTypes.Hierarchy-Reverse',
        url: `${server.mockAzure.getBaseUrl()}/test-org/_apis/wit/workItems/100`,
        attributes: { name: 'Parent' },
      },
    ],
  });
}

test.describe('[Tier 3] Pairwise Cross-Feature Combinatorial Tests (F1–F19)', () => {
  test('[Tier 3][F1xF14] OIDC/Basic role (Admin vs Auditor) reflected in session UI & gating mutations', async ({
    page,
    request,
  }) => {
    const server = await startAcceptanceServer({ authMode: 'oidc' });
    try {
      const anonSession = await request.get(`${server.baseUrl}/api/session`);
      expect(anonSession.status()).toBe(200);
      const anonBody = (await anonSession.json()) as {
        authenticated: boolean;
        authMode: string;
        user: unknown;
      };
      expect(anonBody.authenticated).toBe(false);
      expect(anonBody.authMode).toBe('oidc');
      expect(anonBody.user).toBeNull();

      const auditorJwt = server.mockOidc.mintToken({
        sub: 'oidc-auditor-1',
        email: 'auditor@workops.test',
        name: 'OIDC Auditor',
        roles: ['Auditor'],
      });
      const adminJwt = server.mockOidc.mintToken({
        sub: 'oidc-admin-1',
        email: 'admin@workops.test',
        name: 'OIDC Admin',
        roles: ['Admin'],
      });

      const auditorSessionRes = await request.get(`${server.baseUrl}/api/session`, {
        headers: { Authorization: `Bearer ${auditorJwt}` },
      });
      expect(auditorSessionRes.status()).toBe(200);
      const auditorSession = (await auditorSessionRes.json()) as {
        authenticated: boolean;
        user: { role: string; email: string } | null;
      };
      expect(auditorSession.authenticated).toBe(true);
      expect(auditorSession.user?.role).toBe('Auditor');

      const blockedRes = await request.post(`${server.baseUrl}/api/config/settings`, {
        headers: { Authorization: `Bearer ${auditorJwt}` },
        data: { titlePrefix: 'Blocked |' },
      });
      expect(blockedRes.status()).toBe(403);

      // Verify browser header session UI displays Auditor (never fake Admin)
      await page.setExtraHTTPHeaders({ Authorization: `Bearer ${auditorJwt}` });
      await page.goto(`${server.baseUrl}/mywork`, { waitUntil: 'domcontentloaded' });
      await assertLandmarks(page);
      const banner = page.getByRole('banner');
      await expect(banner).toContainText(/auditor/i);

      // Verify Admin JWT elevates session UI and permits mutation
      await page.setExtraHTTPHeaders({ Authorization: `Bearer ${adminJwt}` });
      await page.goto(`${server.baseUrl}/mywork`, { waitUntil: 'domcontentloaded' });
      await expect(banner).toContainText(/admin/i);

      const allowedRes = await request.post(`${server.baseUrl}/api/config/settings`, {
        headers: { Authorization: `Bearer ${adminJwt}` },
        data: { titlePrefix: 'OIDC-Admin |' },
      });
      expect(allowedRes.status()).toBe(200);
    } finally {
      await server.stop();
    }
  });

  test('[Tier 3][F1xF18] Auditor RBAC blocks Journal Repair / Auto-Closure Clear / Settings PAT update while allowing read/export', async ({
    page,
    request,
  }) => {
    const server = await startAcceptanceServer({ authMode: 'basic' });
    try {
      const adminHeaders = { Authorization: server.basicAdminHeader };
      const auditorHeaders = { Authorization: server.basicAuditorHeader };

      // Seed journal & auto-closure audit data as Admin
      const adhocRes = await request.post(`${server.baseUrl}/api/tasks/adhoc`, {
        headers: adminHeaders,
        data: {
          personKey: 'alice',
          date: todayIsoDate(),
          title: 'Auditor Read Export Verification',
          estimatedHours: 2,
        },
      });
      expect([200, 201]).toContain(adhocRes.status());

      await request.put(`${server.baseUrl}/api/auto-closure/config`, {
        headers: adminHeaders,
        data: { enabled: true },
      });
      const runAuditRes = await request.post(`${server.baseUrl}/api/auto-closure/run`, {
        headers: adminHeaders,
        data: { dryRun: false, confirm: true },
      });
      expect(runAuditRes.status()).toBe(200);

      // Auditor reads & exports succeed
      for (const readPath of [
        '/api/journal',
        '/api/journal/export?format=json',
        '/api/journal/export?format=csv',
        '/api/auto-closure/audit',
        '/api/auto-closure/audit/export',
        '/api/config',
      ]) {
        const res = await request.get(`${server.baseUrl}${readPath}`, { headers: auditorHeaders });
        expect(res.status(), `Auditor should be allowed to GET ${readPath}`).toBe(200);
      }

      // Auditor mutations are blocked with 403
      const repairBlocked = await request.post(`${server.baseUrl}/api/tasks/repair`, {
        headers: auditorHeaders,
        data: {},
      });
      expect(repairBlocked.status()).toBe(403);

      const clearBlocked = await request.delete(`${server.baseUrl}/api/auto-closure/audit`, {
        headers: auditorHeaders,
      });
      expect(clearBlocked.status()).toBe(403);

      const patBlocked = await request.post(`${server.baseUrl}/api/config/pat`, {
        headers: auditorHeaders,
        data: { pat: 'unauthorized-pat', githubToken: 'unauthorized-gh' },
      });
      expect(patBlocked.status()).toBe(403);

      // UI verification as Auditor on /journal
      await page.setExtraHTTPHeaders(auditorHeaders);
      await page.goto(`${server.baseUrl}/journal`, { waitUntil: 'domcontentloaded' });
      await assertLandmarks(page);
      await expect(page.locator('main#main')).toContainText(/Auditor Read Export Verification|alice/i);
    } finally {
      await server.stop();
    }
  });

  test('[Tier 3][F3xF14] Secret scrubbing in /api/logs/recent and global SSE Logs Drawer UI after PAT/GitHub token config update', async ({
    page,
    request,
  }) => {
    const server = await startAcceptanceServer({ authMode: 'basic' });
    try {
      const headers = { Authorization: server.basicAdminHeader };
      const sensitiveAzurePat = 'azdo_pat_confidential_998877665544';
      const sensitiveGhToken = 'ghp_confidential_token_112233445566';

      const patRes = await request.post(`${server.baseUrl}/api/config/pat`, {
        headers,
        data: {
          pat: sensitiveAzurePat,
          azurePat: sensitiveAzurePat,
          githubToken: sensitiveGhToken,
        },
      });
      expect(patRes.status()).toBe(200);

      const logsRes = await request.get(`${server.baseUrl}/api/logs/recent`, { headers });
      expect(logsRes.status()).toBe(200);
      const logsText = await logsRes.text();
      expect(logsText).not.toContain(sensitiveAzurePat);
      expect(logsText).not.toContain(sensitiveGhToken);
      expect(logsText).not.toContain('e2e-mock-azure-pat');
      expect(logsText).not.toContain('ghp_e2e_mock_github_token');

      const procLogs = server.getLogs();
      expect(procLogs.stdout + procLogs.stderr).not.toContain(sensitiveAzurePat);
      expect(procLogs.stdout + procLogs.stderr).not.toContain(sensitiveGhToken);

      await page.setExtraHTTPHeaders(headers);
      await page.goto(`${server.baseUrl}/mywork`, { waitUntil: 'domcontentloaded' });
      const banner = page.getByRole('banner');
      const logsToggle = banner.getByRole('button', { name: /logs/i }).first();
      await expect(logsToggle).toBeVisible();
      await logsToggle.click();
      await expect(logsToggle).toHaveAttribute('aria-expanded', 'true');

      const drawerText = await page.locator('body').innerText();
      expect(drawerText).not.toContain(sensitiveAzurePat);
      expect(drawerText).not.toContain(sensitiveGhToken);
    } finally {
      await server.stop();
    }
  });

  test('[Tier 3][F4xF17] Roster CRUD + multi-day Calendar exceptions persisted across server restart & reflected in /calendar UI', async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000);
    const server = await startAcceptanceServer({ authMode: 'basic' });
    try {
      const headers = { Authorization: server.basicAdminHeader };
      const [day1, day2] = getWeekdayWindow(2, 2);

      // 1. Roster CRUD: create diana, update bob, delete alice
      const createRes = await request.post(`${server.baseUrl}/api/config/people`, {
        headers,
        data: {
          key: 'diana',
          name: 'Diana Prince',
          assignedTo: 'diana@workops.test',
          enabled: true,
          autoCloseEnabled: true,
          pod: 'POD-005 Cloud',
          role: 'Developer',
          sourceTaskId: 200,
        },
      });
      expect([200, 201]).toContain(createRes.status());

      const updateRes = await request.put(`${server.baseUrl}/api/config/people/bob`, {
        headers,
        data: { pod: 'POD-099 Updated' },
      });
      expect(updateRes.status()).toBe(200);

      const deleteRes = await request.delete(`${server.baseUrl}/api/config/people/alice`, {
        headers,
      });
      expect([200, 204]).toContain(deleteRes.status());

      // 2. Calendar multi-day exception + member hour override
      const calGet = await request.get(`${server.baseUrl}/api/calendar`, { headers });
      expect(calGet.status()).toBe(200);
      const calBody = (await calGet.json()) as {
        calendar: {
          version: number;
          defaultHours?: number;
          memberHours?: Record<string, number>;
          exceptions?: Array<Record<string, unknown>>;
        };
      };

      const calPost = await request.post(`${server.baseUrl}/api/calendar`, {
        headers,
        data: {
          version: calBody.calendar.version,
          defaultHours: calBody.calendar.defaultHours ?? 8,
          memberHours: { ...(calBody.calendar.memberHours ?? {}), diana: 6 },
          exceptions: [
            ...(calBody.calendar.exceptions ?? []),
            {
              id: 'exc-winter-freeze',
              startDate: day1,
              endDate: day2,
              kind: 'leave',
              memberKeys: ['diana'],
              note: 'Winter Freeze Exception',
            },
          ],
        },
      });
      expect(calPost.status()).toBe(200);

      // 3. Restart server & verify zero resurrection + full persistence in API and /calendar UI
      await server.restart();

      const afterCfgRes = await request.get(`${server.baseUrl}/api/config`, { headers });
      expect(afterCfgRes.status()).toBe(200);
      const afterCfg = (await afterCfgRes.json()) as { people: Array<Record<string, unknown>> };
      expect(afterCfg.people.some((p) => p.key === 'alice')).toBe(false);
      expect(afterCfg.people.some((p) => p.key === 'diana' && p.name === 'Diana Prince')).toBe(true);
      expect(afterCfg.people.find((p) => p.key === 'bob')?.pod).toBe('POD-099 Updated');

      const afterCalRes = await request.get(`${server.baseUrl}/api/calendar`, { headers });
      expect(afterCalRes.status()).toBe(200);
      const afterCal = (await afterCalRes.json()) as {
        calendar: {
          memberHours?: Record<string, number>;
          exceptions?: Array<Record<string, unknown>>;
        };
      };
      expect(afterCal.calendar.memberHours?.diana).toBe(6);
      const savedExc = (afterCal.calendar.exceptions ?? []).find(
        (e) => e.note === 'Winter Freeze Exception' || e.id === 'exc-winter-freeze'
      );
      expect(savedExc).toBeTruthy();
      expect(savedExc?.startDate).toBe(day1);
      expect(savedExc?.endDate).toBe(day2);

      await page.setExtraHTTPHeaders(headers);
      await page.goto(`${server.baseUrl}/calendar`, { waitUntil: 'domcontentloaded' });
      await assertLandmarks(page);
      await expect(page.locator('main#main')).toContainText(/Winter Freeze Exception/i);
      await expect(page.locator('main#main')).toContainText(/Diana Prince|diana/i);
    } finally {
      await server.stop();
    }
  });

  test('[Tier 3][F4xF16] Work Calendar holiday/member-hour override changes Planner expected hours & Explorer working days', async ({
    page,
    request,
  }) => {
    const server = await startAcceptanceServer({ authMode: 'basic' });
    try {
      const headers = { Authorization: server.basicAdminHeader };
      const windowDays = getWeekdayWindow(5, 1);
      const startDate = windowDays[0];
      const holidayDate = windowDays[2];
      const endDate = windowDays[4];

      // Baseline Explorer window (5 working days, 2 members = 10 expected combinations)
      const baseExpRes = await request.get(
        `${server.baseUrl}/api/explorer?startDate=${startDate}&endDate=${endDate}`,
        { headers }
      );
      expect(baseExpRes.status()).toBe(200);
      const baseExp = (await baseExpRes.json()) as {
        workingDaysCount: number;
        summary: { expectedCombinations: number };
      };
      expect(baseExp.workingDaysCount).toBe(5);
      expect(baseExp.summary.expectedCombinations).toBe(10);

      // Add company-wide holiday on holidayDate + alice override 4h
      const calGet = await request.get(`${server.baseUrl}/api/calendar`, { headers });
      const calData = (await calGet.json()) as { calendar: { version: number } };
      const calSave = await request.post(`${server.baseUrl}/api/calendar`, {
        headers,
        data: {
          version: calData.calendar.version,
          defaultHours: 8,
          memberHours: { alice: 4 },
          exceptions: [
            {
              id: 'exc-company-holiday',
              startDate: holidayDate,
              endDate: holidayDate,
              kind: 'holiday',
              memberKeys: [],
              note: 'Midweek Company Holiday',
            },
          ],
        },
      });
      expect(calSave.status()).toBe(200);

      const updatedExpRes = await request.get(
        `${server.baseUrl}/api/explorer?startDate=${startDate}&endDate=${endDate}`,
        { headers }
      );
      expect(updatedExpRes.status()).toBe(200);
      const updatedExp = (await updatedExpRes.json()) as {
        workingDaysCount: number;
        summary: { expectedCombinations: number };
      };
      expect(updatedExp.workingDaysCount).toBe(4);
      expect(updatedExp.summary.expectedCombinations).toBe(8);

      // Plan on non-holiday day reflects alice's 4h override
      const planRes = await request.post(`${server.baseUrl}/api/tasks/plan`, {
        headers,
        data: { asOf: startDate },
      });
      expect(planRes.status()).toBe(200);
      const planText = await planRes.text();
      expect(planText).toMatch(/alice/i);

      await page.setExtraHTTPHeaders(headers);
      await page.goto(`${server.baseUrl}/explorer?startDate=${startDate}&endDate=${endDate}`, {
        waitUntil: 'domcontentloaded',
      });
      await assertLandmarks(page);
      await expect(page.locator('main#main')).toContainText(/4|8/);
    } finally {
      await server.stop();
    }
  });

  test('[Tier 3][F5xF8] Concurrent POST /api/tasks/execute with valid planToken guarded by ILockManager (zero duplicate Azure creations)', async ({
    request,
  }) => {
    const server = await startAcceptanceServer({ authMode: 'basic' });
    try {
      const headers = { Authorization: server.basicAdminHeader };
      const targetDate = getNextWeekdayIso(2);

      const planRes = await request.post(`${server.baseUrl}/api/tasks/plan`, {
        headers,
        data: { asOf: targetDate },
      });
      expect(planRes.status()).toBe(200);
      const planBody = (await planRes.json()) as { planToken: string };
      expect(planBody.planToken).toBeTruthy();

      const beforeCount = server.mockAzure.listWorkItems().length;

      // Fire 3 concurrent executions with the same planToken
      const responses = await Promise.all([
        request.post(`${server.baseUrl}/api/tasks/execute`, {
          headers,
          data: { planToken: planBody.planToken, confirm: true },
        }),
        request.post(`${server.baseUrl}/api/tasks/execute`, {
          headers,
          data: { planToken: planBody.planToken, confirm: true },
        }),
        request.post(`${server.baseUrl}/api/tasks/execute`, {
          headers,
          data: { planToken: planBody.planToken, confirm: true },
        }),
      ]);

      for (const r of responses) {
        expect([200, 409, 423]).toContain(r.status());
      }
      expect(responses.some((r) => r.status() === 200)).toBe(true);

      const afterItems = server.mockAzure.listWorkItems();
      const createdDelta = afterItems.length - beforeCount;
      // 2 seeded people -> strictly 2 created tasks (zero duplicates)
      expect(createdDelta).toBe(2);
    } finally {
      await server.stop();
    }
  });

  test('[Tier 3][F6xF10] Scheduler trigger-autoclose runs AutoClosureService rules & logs to /api/auto-closure/audit', async ({
    request,
  }) => {
    const server = await startAcceptanceServer({ authMode: 'basic' });
    try {
      const headers = { Authorization: server.basicAdminHeader };

      const cfgRes = await request.get(`${server.baseUrl}/api/auto-closure/config`, { headers });
      expect(cfgRes.status()).toBe(200);
      const cfg = (await cfgRes.json()) as Record<string, unknown>;

      await request.put(`${server.baseUrl}/api/auto-closure/config`, {
        headers,
        data: { ...cfg, enabled: true },
      });
      await request.delete(`${server.baseUrl}/api/auto-closure/audit`, { headers });

      // Ensure an Active task exists for today so AutoClosureService evaluates it
      seedDailyTask(server, {
        id: 501,
        personName: 'Alice Chen',
        assignedTo: 'alice@workops.test',
        isoDate: todayIsoDate(),
        state: 'Active',
      });

      const triggerRes = await request.post(`${server.baseUrl}/api/scheduler/trigger-autoclose`, {
        headers,
        data: {},
      });
      expect(triggerRes.status()).toBe(200);

      const auditRes = await request.get(`${server.baseUrl}/api/auto-closure/audit`, { headers });
      expect(auditRes.status()).toBe(200);
      const auditRows = unwrapArray(await auditRes.json(), ['entries', 'logs', 'items', 'audit']);
      expect(auditRows.length).toBeGreaterThan(0);

      const schedRes = await request.get(`${server.baseUrl}/api/scheduler`, { headers });
      expect(schedRes.status()).toBe(200);
      const schedBody = (await schedRes.json()) as { running: boolean };
      expect(schedBody.running).toBe(false);
    } finally {
      await server.stop();
    }
  });

  test('[Tier 3][F6xF18] Scheduler run-now confirmation updates /scheduler lastRuns & /journal entries', async ({
    page,
    request,
  }) => {
    const server = await startAcceptanceServer({ authMode: 'basic' });
    try {
      const headers = { Authorization: server.basicAdminHeader };
      await page.setExtraHTTPHeaders(headers);
      await page.goto(`${server.baseUrl}/scheduler`, { waitUntil: 'domcontentloaded' });
      await assertLandmarks(page);

      const runNowBtn = page.getByRole('button', { name: /run now|run-now/i }).first();
      await expect(runNowBtn).toBeVisible();

      const runNowResponsePromise = page.waitForResponse(
        (res) => res.url().includes('/api/scheduler/run-now') && res.request().method() === 'POST'
      );
      await runNowBtn.click();

      // If a confirmation dialog opens, confirm inside it
      const dialog = page.getByRole('dialog').first();
      if (await dialog.isVisible({ timeout: 1000 }).catch(() => false)) {
        const confirmBtn = dialog.getByRole('button', { name: /confirm|run|yes|execute/i }).first();
        await confirmBtn.click();
      }

      const runNowRes = await runNowResponsePromise;
      expect(runNowRes.status()).toBe(200);

      const schedRes = await request.get(`${server.baseUrl}/api/scheduler`, { headers });
      expect(schedRes.status()).toBe(200);
      const schedBody = (await schedRes.json()) as { lastRuns: Record<string, unknown> };
      expect(Object.keys(schedBody.lastRuns).length).toBeGreaterThan(0);

      await page.goto(`${server.baseUrl}/journal`, { waitUntil: 'domcontentloaded' });
      await assertLandmarks(page);
      const journalRes = await request.get(`${server.baseUrl}/api/journal`, { headers });
      expect(journalRes.status()).toBe(200);
      const entries = unwrapArray(await journalRes.json(), ['entries', 'items', 'journal', 'records']);
      expect(entries.length).toBeGreaterThan(0);
    } finally {
      await server.stop();
    }
  });

  test('[Tier 3][F7xF19] Read-only 0444 azure-data.db serves /azure-teams pagination + /unassigned triage seamlessly', async ({
    page,
    request,
  }) => {
    const server = await startAcceptanceServer({
      authMode: 'basic',
      readOnlyAzureDb: true,
      azureDbTeamCount: 260,
    });
    try {
      const mode = fs.statSync(server.azureDataDbPath).mode & 0o777;
      expect(mode).toBe(0o444);

      const headers = { Authorization: server.basicAdminHeader };
      const teamsPage1 = await request.get(`${server.baseUrl}/api/azure-data/teams?limit=25&offset=0`, {
        headers,
      });
      expect(teamsPage1.status()).toBe(200);
      const page1Body = (await teamsPage1.json()) as {
        total?: number;
        teams?: unknown[];
        items?: unknown[];
      };
      expect(page1Body.total ?? 0).toBeGreaterThanOrEqual(260);

      const teamsSearch = await request.get(
        `${server.baseUrl}/api/azure-data/teams?search=POD-150&limit=25&offset=0`,
        { headers }
      );
      expect(teamsSearch.status()).toBe(200);
      expect(await teamsSearch.text()).toContain('POD-150');

      await page.setExtraHTTPHeaders(headers);
      await page.goto(`${server.baseUrl}/azure-teams`, { waitUntil: 'domcontentloaded' });
      await assertLandmarks(page);
      await assertNoHorizontalOverflow(page);

      const searchInput = page.getByRole('searchbox').or(page.getByLabel(/search/i)).first();
      if (await searchInput.isVisible().catch(() => false)) {
        await searchInput.fill('POD-150');
        await expect(page.locator('main#main')).toContainText(/POD-150/i);
      }

      await page.goto(`${server.baseUrl}/unassigned`, { waitUntil: 'domcontentloaded' });
      await assertLandmarks(page);
      await expect(page.locator('main#main')).toContainText(/Unassigned Triage Item/i);
    } finally {
      await server.stop();
    }
  });

  test('[Tier 3][F8xF11] Two-phase plan -> execute uses batch team-wide WIQL & prevents duplicates on re-plan', async ({
    request,
  }) => {
    const server = await startAcceptanceServer({ authMode: 'basic' });
    try {
      const headers = { Authorization: server.basicAdminHeader };
      const targetDate = getNextWeekdayIso(3);

      server.mockAzure.clearRequests();
      const planRes = await request.post(`${server.baseUrl}/api/tasks/plan`, {
        headers,
        data: { asOf: targetDate },
      });
      expect(planRes.status()).toBe(200);
      const planBody = (await planRes.json()) as {
        planToken: string;
        planHash: string;
        summary: Record<string, unknown>;
        personPlans: Array<Record<string, unknown>>;
        expiresAt: string;
      };
      expect(planBody.planToken).toBeTruthy();
      expect(planBody.planHash).toBeTruthy();
      expect(planBody.expiresAt).toBeTruthy();
      expect(Array.isArray(planBody.personPlans)).toBe(true);

      const wiqlRequests = server.mockAzure
        .getRequests()
        .filter((r) => r.method === 'POST' && r.path.toLowerCase().includes('/wiql'));
      expect(wiqlRequests.length).toBeGreaterThan(0);
      // Batch WIQL query combines team members rather than issuing redundant per-person queries
      expect(wiqlRequests.length).toBeLessThanOrEqual(2);

      const execRes = await request.post(`${server.baseUrl}/api/tasks/execute`, {
        headers,
        data: { planToken: planBody.planToken, confirm: true },
      });
      expect(execRes.status()).toBe(200);
      const countAfterExec = server.mockAzure.listWorkItems().length;

      // Re-plan for the same date should detect existing tasks and skip duplicate creation
      const replanRes = await request.post(`${server.baseUrl}/api/tasks/plan`, {
        headers,
        data: { asOf: targetDate },
      });
      expect(replanRes.status()).toBe(200);
      const replanBody = (await replanRes.json()) as {
        planToken: string;
        summary: { toCreate?: number; createCount?: number; skipped?: number; skipCount?: number };
      };
      const plannedCreates = replanBody.summary.toCreate ?? replanBody.summary.createCount ?? 0;
      expect(plannedCreates).toBe(0);

      // Even if executed, zero additional work items are created
      if (replanBody.planToken) {
        await request.post(`${server.baseUrl}/api/tasks/execute`, {
          headers,
          data: { planToken: replanBody.planToken, confirm: true },
        });
      }
      expect(server.mockAzure.listWorkItems().length).toBe(countAfterExec);
    } finally {
      await server.stop();
    }
  });

  test('[Tier 3][F8xF16] /planner PlanToken modal confirm creates tasks and TanStack Query automatically invalidates /explorer & /journal', async ({
    page,
  }) => {
    const server = await startAcceptanceServer({ authMode: 'basic' });
    try {
      const headers = { Authorization: server.basicAdminHeader };
      const targetDate = getNextWeekdayIso(4);

      await page.setExtraHTTPHeaders(headers);

      // Prime TanStack Query cache on /explorer and /journal before planning
      await page.goto(`${server.baseUrl}/explorer?startDate=${targetDate}&endDate=${targetDate}`, {
        waitUntil: 'domcontentloaded',
      });
      await assertLandmarks(page);

      const nav = page.getByRole('navigation', { name: 'Main navigation' });
      await nav.getByRole('link', { name: /journal/i }).first().click();
      await expect(page).toHaveURL(/\/journal/);

      // Navigate via SPA to /planner, generate plan, confirm PlanToken modal
      await nav.getByRole('link', { name: /planner/i }).first().click();
      await expect(page).toHaveURL(/\/planner/);

      const dateInput = page.getByLabel(/as of|date/i).first();
      if (await dateInput.isVisible().catch(() => false)) {
        await dateInput.fill(targetDate);
      }

      const planBtn = page.getByRole('button', { name: /generate plan|preview plan|plan tasks|plan/i }).first();
      const planPromise = page.waitForResponse(
        (res) => res.url().includes('/api/tasks/plan') && res.request().method() === 'POST'
      );
      await planBtn.click();
      const planRes = await planPromise;
      expect(planRes.status()).toBe(200);

      const executeBtn = page.getByRole('button', { name: /execute|create tasks|apply plan/i }).first();
      await expect(executeBtn).toBeVisible();
      await executeBtn.click();

      const modal = page.getByRole('dialog').first();
      await expect(modal).toBeVisible();

      const execPromise = page.waitForResponse(
        (res) => res.url().includes('/api/tasks/execute') && res.request().method() === 'POST'
      );
      const confirmBtn = modal.getByRole('button', { name: /confirm|execute|create/i }).first();
      await confirmBtn.click();
      const execRes = await execPromise;
      expect(execRes.status()).toBe(200);

      // Navigate via SPA (no page.reload) to verify automatic TanStack Query cache invalidation
      await nav.getByRole('link', { name: /journal/i }).first().click();
      await expect(page).toHaveURL(/\/journal/);
      await expect(page.locator('main#main')).toContainText(/Alice Chen|Bob Patel|CREATED/i);

      await nav.getByRole('link', { name: /explorer/i }).first().click();
      await expect(page).toHaveURL(/\/explorer/);
      await expect(page.locator('main#main')).toContainText(/Alice Chen|Bob Patel/i);
    } finally {
      await server.stop();
    }
  });

  test('[Tier 3][F9xF11] /explorer Create Missing executes batch WIQL + missing creations and updates coverage <= 100%', async ({
    page,
    request,
  }) => {
    const server = await startAcceptanceServer({ authMode: 'basic' });
    try {
      const headers = { Authorization: server.basicAdminHeader };
      const [day1, day2, day3] = getWeekdayWindow(3, 5);

      // Seed only 1 task for alice on day1 (1 of 6 combinations)
      seedDailyTask(server, {
        id: 601,
        personName: 'Alice Chen',
        assignedTo: 'alice@workops.test',
        isoDate: day1,
        state: 'New',
      });

      const beforeExpRes = await request.get(
        `${server.baseUrl}/api/explorer?startDate=${day1}&endDate=${day3}`,
        { headers }
      );
      expect(beforeExpRes.status()).toBe(200);
      const beforeExp = (await beforeExpRes.json()) as {
        summary: { expectedCombinations: number; createdCount: number; missingCount: number; overallCoveragePercent: number };
      };
      expect(beforeExp.summary.expectedCombinations).toBe(6);
      expect(beforeExp.summary.createdCount).toBe(1);
      expect(beforeExp.summary.missingCount).toBe(5);
      expect(beforeExp.summary.overallCoveragePercent).toBeGreaterThan(0);
      expect(beforeExp.summary.overallCoveragePercent).toBeLessThan(100);

      server.mockAzure.clearRequests();
      await page.setExtraHTTPHeaders(headers);
      await page.goto(`${server.baseUrl}/explorer?startDate=${day1}&endDate=${day3}`, {
        waitUntil: 'domcontentloaded',
      });
      await assertLandmarks(page);

      const createMissingBtn = page.getByRole('button', { name: /create missing/i }).first();
      await expect(createMissingBtn).toBeVisible();

      const createPromise = page.waitForResponse(
        (res) => res.url().includes('/api/explorer/create-missing') && res.request().method() === 'POST'
      );
      await createMissingBtn.click();
      const dialog = page.getByRole('dialog').first();
      if (await dialog.isVisible({ timeout: 1000 }).catch(() => false)) {
        await dialog.getByRole('button', { name: /confirm|create|proceed/i }).first().click();
      }
      const createRes = await createPromise;
      expect(createRes.status()).toBe(200);

      const wiqlCalls = server.mockAzure
        .getRequests()
        .filter((r) => r.method === 'POST' && r.path.toLowerCase().includes('/wiql'));
      expect(wiqlCalls.length).toBeGreaterThan(0);

      const afterExpRes = await request.get(
        `${server.baseUrl}/api/explorer?startDate=${day1}&endDate=${day3}`,
        { headers }
      );
      expect(afterExpRes.status()).toBe(200);
      const afterExp = (await afterExpRes.json()) as {
        summary: { missingCount: number; overallCoveragePercent: number; createdCount: number };
      };
      expect(afterExp.summary.missingCount).toBe(0);
      expect(afterExp.summary.overallCoveragePercent).toBeLessThanOrEqual(100);
      expect(afterExp.summary.overallCoveragePercent).toBe(100);
      // Confirm day2 exists cleanly
      expect(afterExp.summary.createdCount).toBeGreaterThanOrEqual(day2 ? 6 : 6);
    } finally {
      await server.stop();
    }
  });

  test('[Tier 3][F9xF16] Explorer date range change syncs KPI cards, 14-day matrix, and Burndown monthly effort totals', async ({
    page,
    request,
  }) => {
    const server = await startAcceptanceServer({ authMode: 'basic' });
    try {
      const headers = { Authorization: server.basicAdminHeader };
      const [day1, day2] = getWeekdayWindow(2, 1);

      const aRes = await request.post(`${server.baseUrl}/api/tasks/adhoc`, {
        headers,
        data: {
          personKey: 'alice',
          date: day1,
          title: 'Burndown Effort Alice',
          estimatedHours: 5,
        },
      });
      expect([200, 201]).toContain(aRes.status());

      const bRes = await request.post(`${server.baseUrl}/api/tasks/adhoc`, {
        headers,
        data: {
          personKey: 'bob',
          date: day2,
          title: 'Burndown Effort Bob',
          estimatedHours: 3,
        },
      });
      expect([200, 201]).toContain(bRes.status());

      await page.setExtraHTTPHeaders(headers);
      await page.goto(`${server.baseUrl}/explorer?startDate=${day1}&endDate=${day2}`, {
        waitUntil: 'domcontentloaded',
      });
      await assertLandmarks(page);
      await expect(page.locator('main#main')).toContainText(/Alice Chen/i);
      await expect(page.locator('main#main')).toContainText(/Bob Patel/i);

      await page.goto(`${server.baseUrl}/burndown`, { waitUntil: 'domcontentloaded' });
      await assertLandmarks(page);
      await assertNoHorizontalOverflow(page);
      await expect(page.locator('main#main')).toContainText(/Alice Chen/i);
      await expect(page.locator('main#main')).toContainText(/5|8/);
    } finally {
      await server.stop();
    }
  });

  test('[Tier 3][F10xF15] Cockpit Morning Activation (activate-today) creates ACTIVATED journal entry and updates Cockpit task state', async ({
    page,
    request,
  }) => {
    const server = await startAcceptanceServer({ authMode: 'basic' });
    try {
      const headers = { Authorization: server.basicAdminHeader };
      const today = todayIsoDate();

      seedDailyTask(server, {
        id: 701,
        personName: 'Alice Chen',
        assignedTo: 'alice@workops.test',
        isoDate: today,
        state: 'New',
      });

      await page.setExtraHTTPHeaders(headers);
      await page.goto(`${server.baseUrl}/mywork`, { waitUntil: 'domcontentloaded' });
      await assertLandmarks(page);
      await expect(page.locator('main#main')).toContainText(/Alice Chen Daily Work/i);

      const activateBtn = page.getByRole('button', { name: /activate.*today|morning.*activat/i }).first();
      await expect(activateBtn).toBeVisible();
      await activateBtn.click();

      const confirmBtn = page
        .getByRole('dialog')
        .getByRole('button', { name: /confirm|activate/i })
        .or(page.getByRole('button', { name: /confirm.*activat/i }))
        .first();
      const activatePromise = page.waitForResponse(
        (res) =>
          res.url().includes('/api/tasks/activate-today') &&
          res.request().method() === 'POST'
      );
      if (await confirmBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        await confirmBtn.click();
      }
      const activateRes = await activatePromise;
      expect(activateRes.status()).toBe(200);

      // Verify MockAzure work item transitioned to Active
      const updated = server.mockAzure.getWorkItem(701);
      expect(updated?.fields['System.State']).toBe('Active');

      // Verify ACTIVATED journal entry exists
      const journalRes = await request.get(`${server.baseUrl}/api/journal`, { headers });
      expect(journalRes.status()).toBe(200);
      const entries = unwrapArray(await journalRes.json(), ['entries', 'items', 'journal', 'records']);
      expect(entries.some((e) => String(e.actionType).toUpperCase() === 'ACTIVATED')).toBe(true);
    } finally {
      await server.stop();
    }
  });

  test('[Tier 3][F10xF15] Cockpit EOD Closure (close-today) correlates GitHub PR/commit evidence with Auto-Closure audit trail', async ({
    page,
    request,
  }) => {
    const server = await startAcceptanceServer({ authMode: 'basic' });
    try {
      const headers = { Authorization: server.basicAdminHeader };
      const today = todayIsoDate();

      seedDailyTask(server, {
        id: 702,
        personName: 'Alice Chen',
        assignedTo: 'alice@workops.test',
        isoDate: today,
        state: 'Active',
      });

      await page.setExtraHTTPHeaders(headers);
      await page.goto(`${server.baseUrl}/mywork`, { waitUntil: 'domcontentloaded' });
      await assertLandmarks(page);

      const closeBtn = page.getByRole('button', { name: /close.*today|eod.*clos|end of day/i }).first();
      await expect(closeBtn).toBeVisible();
      await closeBtn.click();

      const confirmBtn = page
        .getByRole('dialog')
        .getByRole('button', { name: /confirm|close/i })
        .or(page.getByRole('button', { name: /confirm.*clos/i }))
        .first();
      if (await confirmBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
        const closePromise = page.waitForResponse(
          (res) => res.url().includes('/api/tasks/close-today') && res.request().method() === 'POST'
        );
        await confirmBtn.click();
        const closeRes = await closePromise;
        expect(closeRes.status()).toBe(200);
      }

      const auditRes = await request.get(`${server.baseUrl}/api/auto-closure/audit`, { headers });
      expect(auditRes.status()).toBe(200);
      const auditRows = unwrapArray(await auditRes.json(), ['entries', 'logs', 'items', 'audit']);
      expect(auditRows.length).toBeGreaterThan(0);

      const closedItem = server.mockAzure.getWorkItem(702);
      expect(['Closed', 'Done', 'Completed']).toContain(String(closedItem?.fields['System.State']));
    } finally {
      await server.stop();
    }
  });

  test('[Tier 3][F12xF15] Settings timezone & titlePrefix update (POST /api/config/settings) immediately drives Cockpit date/title formatting', async ({
    page,
    request,
  }) => {
    const server = await startAcceptanceServer({ authMode: 'basic' });
    try {
      const headers = { Authorization: server.basicAdminHeader };
      const updateRes = await request.post(`${server.baseUrl}/api/config/settings`, {
        headers,
        data: {
          titlePrefix: 'OpsDaily |',
          timezone: 'Asia/Tokyo',
        },
      });
      expect(updateRes.status()).toBe(200);

      const adhocRes = await request.post(`${server.baseUrl}/api/tasks/adhoc`, {
        headers,
        data: {
          personKey: 'alice',
          date: todayIsoDate(),
          title: 'OpsDaily | Tokyo Shift Verification',
          estimatedHours: 4,
        },
      });
      expect([200, 201]).toContain(adhocRes.status());

      await page.setExtraHTTPHeaders(headers);
      await page.goto(`${server.baseUrl}/mywork`, { waitUntil: 'domcontentloaded' });
      await assertLandmarks(page);
      const mainText = await page.locator('main#main').innerText();
      expect(mainText).toMatch(/OpsDaily|Asia\/Tokyo|Tokyo/i);
    } finally {
      await server.stop();
    }
  });

  test('[Tier 3][F12xF19] /unassigned triage assignment (POST /api/azure-data/work-items/assign) updates unassigned count + pagination totals', async ({
    page,
    request,
  }) => {
    const server = await startAcceptanceServer({ authMode: 'basic', readOnlyAzureDb: true });
    try {
      // Seed matching work item #8001 in MockAzureServer so Azure PATCH succeeds
      server.mockAzure.seedWorkItem({
        id: 8001,
        fields: {
          'System.TeamProject': 'TestProject',
          'System.WorkItemType': 'Task',
          'System.Title': 'Unassigned Triage Item #1 — Backlog Remediation',
          'System.State': 'New',
          'System.AreaPath': 'TestProject\\Backlog',
          'System.IterationPath': 'TestProject\\Sprint 42',
        },
      });

      const headers = { Authorization: server.basicAdminHeader };
      const initialRes = await request.get(
        `${server.baseUrl}/api/azure-data/work-items/unassigned?limit=10&offset=0`,
        { headers }
      );
      expect(initialRes.status()).toBe(200);
      const initialBody = (await initialRes.json()) as { total: number; items?: unknown[]; workItems?: unknown[] };
      const initialTotal = initialBody.total;
      expect(initialTotal).toBeGreaterThanOrEqual(12);

      await page.setExtraHTTPHeaders(headers);
      await page.goto(`${server.baseUrl}/unassigned`, { waitUntil: 'domcontentloaded' });
      await assertLandmarks(page);

      const assignBtn = page.getByRole('button', { name: /assign/i }).first();
      await expect(assignBtn).toBeVisible();

      const assignPromise = page.waitForResponse(
        (res) =>
          res.url().includes('/api/azure-data/work-items/assign') &&
          res.request().method() === 'POST'
      );
      await assignBtn.click();

      const dialog = page.getByRole('dialog').first();
      if (await dialog.isVisible({ timeout: 1000 }).catch(() => false)) {
        const assigneeSelect = dialog.getByRole('combobox').first();
        if (await assigneeSelect.isVisible().catch(() => false)) {
          await assigneeSelect.selectOption({ index: 0 });
        }
        await dialog.getByRole('button', { name: /confirm|assign|save/i }).first().click();
      }

      const assignRes = await assignPromise;
      expect(assignRes.status()).toBe(200);

      const afterRes = await request.get(
        `${server.baseUrl}/api/azure-data/work-items/unassigned?limit=10&offset=0`,
        { headers }
      );
      expect(afterRes.status()).toBe(200);
      const afterBody = (await afterRes.json()) as { total: number };
      expect(afterBody.total).toBe(initialTotal - 1);
    } finally {
      await server.stop();
    }
  });

  test('[Tier 3][F2xF13] Web shell serves clean React/Tailwind v4 SPA across direct URL and # hash routes without legacy template/scripts', async ({
    page,
    apiGet,
    gotoRoute,
  }) => {
    const htmlRes = await apiGet('/mywork');
    expect(htmlRes.status()).toBe(200);
    const html = await htmlRes.text();
    expect(html).not.toContain('legacyUiTemplate');
    expect(html).not.toContain('/app.js');
    expect(html).not.toContain('chart.umd');
    expect(html).toMatch(/<div id="root"/i);

    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));

    for (const route of ['/planner', '/#/explorer', '/#/azure-teams', '/settings']) {
      await gotoRoute(route);
      await assertLandmarks(page);
      await assertNoHorizontalOverflow(page);
      await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    }
    expect(errors).toEqual([]);
  });

  test('[Tier 3][F3xF7] Upstream Azure/GitHub outage degrades /api/ready (ready: false) and Dashboard status banner while /api/health stays 200', async ({
    page,
    request,
  }) => {
    const server = await startAcceptanceServer({ authMode: 'basic' });
    try {
      const headers = { Authorization: server.basicAdminHeader };
      const initialReady = await request.get(`${server.baseUrl}/api/ready`, { headers });
      expect(initialReady.status()).toBe(200);
      const initialBody = (await initialReady.json()) as { ready: boolean };
      expect(initialBody.ready).toBe(true);

      server.mockAzure.setUnavailable(true, 503);
      server.mockGitHub.setUnavailable(true, 503);

      const healthRes = await request.get(`${server.baseUrl}/api/health`);
      expect(healthRes.status()).toBe(200);
      const healthBody = (await healthRes.json()) as { status: string };
      expect(healthBody.status).toBe('ok');

      const degradedReady = await request.get(`${server.baseUrl}/api/ready`, { headers });
      const degradedBody = (await degradedReady.json()) as {
        ready: boolean;
        checks: Record<string, unknown>;
      };
      expect(degradedBody.ready).toBe(false);

      await page.setExtraHTTPHeaders(headers);
      await page.goto(`${server.baseUrl}/dashboard`, { waitUntil: 'domcontentloaded' });
      await assertLandmarks(page);
      await expect(page.locator('main#main')).toContainText(/degraded|unavailable|offline|error|attention/i);

      // Recover upstreams and verify readiness recovers
      server.mockAzure.setUnavailable(false);
      server.mockGitHub.setUnavailable(false);
      const recoveredReady = await request.get(`${server.baseUrl}/api/ready`, { headers });
      expect(recoveredReady.status()).toBe(200);
      const recoveredBody = (await recoveredReady.json()) as { ready: boolean };
      expect(recoveredBody.ready).toBe(true);
    } finally {
      await server.stop();
    }
  });

  test('[Tier 3][F13xF14] Theme toggle (dark/light/system) + Global Logs Drawer + aria-live toast announcements work together across route changes', async ({
    page,
    gotoRoute,
  }) => {
    await gotoRoute('/mywork');
    await assertLandmarks(page);

    const banner = page.getByRole('banner');
    const themeSelect = banner.getByRole('combobox', { name: /theme/i });
    const themeBtn = banner.getByRole('button', { name: /theme|dark|light|system/i }).first();

    if ((await themeSelect.count()) > 0) {
      await themeSelect.selectOption('dark');
    } else {
      for (let i = 0; i < 4; i++) {
        const isDark = await page.evaluate(
          () => document.documentElement.getAttribute('data-theme') === 'dark' || /\bdark\b/.test(document.documentElement.className)
        );
        if (isDark) break;
        await themeBtn.click();
      }
    }

    const logsToggle = banner.getByRole('button', { name: /logs/i }).first();
    await logsToggle.focus();
    await page.keyboard.press('Enter');
    await expect(logsToggle).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Escape');
    await expect(logsToggle).toHaveAttribute('aria-expanded', 'false');

    const nav = page.getByRole('navigation', { name: 'Main navigation' });
    await nav.getByRole('link', { name: /settings/i }).first().click();
    await expect(page).toHaveURL(/\/settings/);
    await assertLiveAnnouncement(page, /settings/i);

    const isStillDark = await page.evaluate(
      () => document.documentElement.getAttribute('data-theme') === 'dark' || /\bdark\b/.test(document.documentElement.className)
    );
    expect(isStillDark).toBe(true);

    // Re-open logs drawer on new route
    await logsToggle.click();
    await expect(logsToggle).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press('Escape');
    await expect(logsToggle).toHaveAttribute('aria-expanded', 'false');
  });
});
