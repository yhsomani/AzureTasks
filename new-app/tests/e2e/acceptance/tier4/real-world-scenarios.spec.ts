import { test, expect } from '../harness/fixtures.js';
import { startAcceptanceServer, type AcceptanceServerHandle } from '../harness/acceptance-server.js';
import {
  assertKeyboardDialogBehavior,
  assertLandmarks,
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

test.describe('[Tier 4] Real-World End-to-End Application Scenarios', () => {
  test('[Tier 4][Scenario 1] Full Developer Day Lifecycle (Cockpit -> Morning Activate -> Ad-Hoc Task -> Live Logs -> EOD Close -> Journal Export)', async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000);
    const server = await startAcceptanceServer({ authMode: 'basic' });
    try {
      const headers = { Authorization: server.basicAdminHeader };
      const today = todayIsoDate();

      seedDailyTask(server, {
        id: 1101,
        personName: 'Alice Chen',
        assignedTo: 'alice@workops.test',
        isoDate: today,
        state: 'New',
      });

      await page.setExtraHTTPHeaders(headers);
      await page.goto(`${server.baseUrl}/mywork`, { waitUntil: 'domcontentloaded' });
      await assertLandmarks(page);
      await assertNoHorizontalOverflow(page);

      // 1. Morning Activation
      const activateBtn = page.getByRole('button', { name: /activate.*today|morning.*activat/i }).first();
      await expect(activateBtn).toBeVisible();
      await activateBtn.click();

      const activateConfirm = page
        .getByRole('dialog')
        .getByRole('button', { name: /confirm|activate/i })
        .or(page.getByRole('button', { name: /confirm.*activat/i }))
        .first();
      const activatePromise = page.waitForResponse(
        (res) => res.url().includes('/api/tasks/activate-today') && res.request().method() === 'POST'
      );
      if (await activateConfirm.isVisible({ timeout: 2000 }).catch(() => false)) {
        await activateConfirm.click();
      }
      expect((await activatePromise).status()).toBe(200);
      expect(server.mockAzure.getWorkItem(1101)?.fields['System.State']).toBe('Active');

      // 2. Ad-Hoc Task creation from Cockpit modal
      const adhocTrigger = page.getByRole('button', { name: /ad-?hoc|new task|create.*task/i }).first();
      await expect(adhocTrigger).toBeVisible();
      await adhocTrigger.click();

      const adhocDialog = page.getByRole('dialog').first();
      await expect(adhocDialog).toBeVisible();
      const titleInput = adhocDialog.getByLabel(/title/i).first();
      await titleInput.fill('Hotfix Auth Token Validation');
      const hoursInput = adhocDialog.getByLabel(/hour|estimate/i).first();
      if (await hoursInput.isVisible().catch(() => false)) {
        await hoursInput.fill('3');
      }

      const adhocPromise = page.waitForResponse(
        (res) => res.url().includes('/api/tasks/adhoc') && res.request().method() === 'POST'
      );
      await adhocDialog.getByRole('button', { name: /create|save|submit/i }).first().click();
      expect([200, 201]).toContain((await adhocPromise).status());

      // 3. Open Global SSE Live Logs Drawer
      const banner = page.getByRole('banner');
      const logsToggle = banner.getByRole('button', { name: /logs/i }).first();
      await logsToggle.click();
      await expect(logsToggle).toHaveAttribute('aria-expanded', 'true');
      await page.keyboard.press('Escape');
      await expect(logsToggle).toHaveAttribute('aria-expanded', 'false');

      // 4. EOD Closure
      const closeBtn = page.getByRole('button', { name: /close.*today|eod.*clos|end of day/i }).first();
      await expect(closeBtn).toBeVisible();
      await closeBtn.click();

      const closeConfirm = page
        .getByRole('dialog')
        .getByRole('button', { name: /confirm|close/i })
        .or(page.getByRole('button', { name: /confirm.*clos/i }))
        .first();
      if (await closeConfirm.isVisible({ timeout: 2000 }).catch(() => false)) {
        const closePromise = page.waitForResponse(
          (res) => res.url().includes('/api/tasks/close-today') && res.request().method() === 'POST'
        );
        await closeConfirm.click();
        expect((await closePromise).status()).toBe(200);
      }

      // 5. Journal UI & CSV/JSON Exports
      await page.goto(`${server.baseUrl}/journal`, { waitUntil: 'domcontentloaded' });
      await assertLandmarks(page);
      await expect(page.locator('main#main')).toContainText(/Hotfix Auth Token Validation|ACTIVATED/i);

      const csvRes = await request.get(`${server.baseUrl}/api/journal/export?format=csv`, { headers });
      expect(csvRes.status()).toBe(200);
      expect(await csvRes.text()).toMatch(/ACTIVATED/i);

      const jsonRes = await request.get(`${server.baseUrl}/api/journal/export?format=json`, { headers });
      expect(jsonRes.status()).toBe(200);
      const journalEntries = unwrapArray(await jsonRes.json(), ['entries', 'items', 'journal', 'records']);
      expect(journalEntries.length).toBeGreaterThanOrEqual(2);
    } finally {
      await server.stop();
    }
  });

  test('[Tier 4][Scenario 2] Workspace Onboarding & Sprint Planning Workflow (Settings -> Roster -> Calendar -> Plan -> Explorer -> Burndown)', async ({
    page,
  }) => {
    test.setTimeout(60_000);
    const server = await startAcceptanceServer({ authMode: 'basic' });
    try {
      const headers = { Authorization: server.basicAdminHeader };
      const [holidayDate, planDate] = getWeekdayWindow(2, 2);

      // Seed a source task for the new member we will onboard
      seedDailyTask(server, {
        id: 202,
        personName: 'Eve Adams',
        assignedTo: 'eve@workops.test',
        isoDate: getNextWeekdayIso(1, todayIsoDate()),
        state: 'Active',
      });

      await page.setExtraHTTPHeaders(headers);

      // 1. Settings
      await page.goto(`${server.baseUrl}/settings`, { waitUntil: 'domcontentloaded' });
      await assertLandmarks(page);
      const prefixInput = page.getByLabel(/title prefix/i).first();
      await prefixInput.fill('SprintOps |');
      const saveSettingsPromise = page.waitForResponse(
        (res) => res.url().includes('/api/config/settings') && res.request().method() === 'POST'
      );
      await page.getByRole('button', { name: /save.*settings|save configuration|save/i }).first().click();
      expect((await saveSettingsPromise).status()).toBe(200);

      // 2. Roster Add
      await page.goto(`${server.baseUrl}/people`, { waitUntil: 'domcontentloaded' });
      await assertLandmarks(page);
      await page.getByRole('button', { name: /add\s+(member|person)|new\s+member/i }).first().click();
      const memberDialog = page.getByRole('dialog').first();
      await expect(memberDialog).toBeVisible();
      await memberDialog.getByLabel(/key/i).first().fill('eve');
      await memberDialog.getByLabel(/name/i).first().fill('Eve Adams');
      await memberDialog.getByLabel(/assigned|email/i).first().fill('eve@workops.test');
      const sourceInput = memberDialog.getByLabel(/source task/i).first();
      if (await sourceInput.isVisible().catch(() => false)) {
        await sourceInput.fill('202');
      }
      const addPersonPromise = page.waitForResponse(
        (res) => res.url().includes('/api/config/people') && res.request().method() === 'POST'
      );
      await memberDialog.getByRole('button', { name: /save|add|create/i }).first().click();
      expect([200, 201]).toContain((await addPersonPromise).status());
      await expect(page.locator('main#main')).toContainText(/Eve Adams/i);

      // 3. Calendar Holiday
      await page.goto(`${server.baseUrl}/calendar`, { waitUntil: 'domcontentloaded' });
      await assertLandmarks(page);
      const startInput = page.getByLabel(/start date/i).first();
      if (await startInput.isVisible().catch(() => false)) {
        await startInput.fill(holidayDate);
        const endInput = page.getByLabel(/end date/i).first();
        if (await endInput.isVisible().catch(() => false)) {
          await endInput.fill(holidayDate);
        }
        const noteInput = page.getByLabel(/note|reason|label/i).first();
        if (await noteInput.isVisible().catch(() => false)) {
          await noteInput.fill('Sprint Planning Holiday');
        }
        const calSaveBtn = page.getByRole('button', { name: /add exception|save calendar|save/i }).first();
        if (await calSaveBtn.isVisible().catch(() => false)) {
          await calSaveBtn.click();
        }
      }

      // 4. Planner PlanToken Execute
      await page.goto(`${server.baseUrl}/planner`, { waitUntil: 'domcontentloaded' });
      await assertLandmarks(page);
      const asOfInput = page.getByLabel(/as of|date/i).first();
      if (await asOfInput.isVisible().catch(() => false)) {
        await asOfInput.fill(planDate);
      }
      const planPromise = page.waitForResponse(
        (res) => res.url().includes('/api/tasks/plan') && res.request().method() === 'POST'
      );
      await page.getByRole('button', { name: /generate plan|preview plan|plan tasks|plan/i }).first().click();
      expect((await planPromise).status()).toBe(200);

      await page.getByRole('button', { name: /execute|create tasks|apply plan/i }).first().click();
      const planModal = page.getByRole('dialog').first();
      await expect(planModal).toBeVisible();
      const execPromise = page.waitForResponse(
        (res) => res.url().includes('/api/tasks/execute') && res.request().method() === 'POST'
      );
      await planModal.getByRole('button', { name: /confirm|execute|create/i }).first().click();
      expect((await execPromise).status()).toBe(200);

      // 5. Explorer Verify
      await page.goto(`${server.baseUrl}/explorer?startDate=${planDate}&endDate=${planDate}`, {
        waitUntil: 'domcontentloaded',
      });
      await assertLandmarks(page);
      await expect(page.locator('main#main')).toContainText(/Alice Chen|Bob Patel|Eve Adams/i);

      // 6. Burndown Matrix
      await page.goto(`${server.baseUrl}/burndown`, { waitUntil: 'domcontentloaded' });
      await assertLandmarks(page);
      await assertNoHorizontalOverflow(page);
      await expect(page.locator('main#main')).toContainText(/Alice Chen|Bob Patel/i);
    } finally {
      await server.stop();
    }
  });

  test('[Tier 4][Scenario 3] Scrum Master Unassigned Triage & Enterprise POD Navigation', async ({
    page,
    request,
  }) => {
    const server = await startAcceptanceServer({
      authMode: 'basic',
      readOnlyAzureDb: true,
      azureDbTeamCount: 260,
    });
    try {
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
      await page.setExtraHTTPHeaders(headers);

      // 1. Azure Overview
      await page.goto(`${server.baseUrl}/azure-overview`, { waitUntil: 'domcontentloaded' });
      await assertLandmarks(page);
      await expect(page.locator('main#main')).toContainText(/TestProject/i);

      // 2. Azure Builds/Tests
      await page.goto(`${server.baseUrl}/azure-builds`, { waitUntil: 'domcontentloaded' });
      await assertLandmarks(page);
      await expect(page.locator('main#main')).toContainText(/B-3001|WorkOps CI Build|succeeded/i);

      // 3. 260-team POD Search & Paginate
      await page.goto(`${server.baseUrl}/azure-teams`, { waitUntil: 'domcontentloaded' });
      await assertLandmarks(page);
      const searchBox = page.getByRole('searchbox').or(page.getByLabel(/search/i)).first();
      if (await searchBox.isVisible().catch(() => false)) {
        await searchBox.fill('POD-245');
        await expect(page.locator('main#main')).toContainText(/POD-245/i);
      }

      // 4. Unassigned Triage Assign
      const beforeRes = await request.get(`${server.baseUrl}/api/azure-data/work-items/unassigned?limit=10&offset=0`, {
        headers,
      });
      const beforeTotal = ((await beforeRes.json()) as { total: number }).total;

      await page.goto(`${server.baseUrl}/unassigned`, { waitUntil: 'domcontentloaded' });
      await assertLandmarks(page);
      const assignPromise = page.waitForResponse(
        (res) => res.url().includes('/api/azure-data/work-items/assign') && res.request().method() === 'POST'
      );
      await page.getByRole('button', { name: /assign/i }).first().click();
      const dialog = page.getByRole('dialog').first();
      if (await dialog.isVisible({ timeout: 1000 }).catch(() => false)) {
        await dialog.getByRole('button', { name: /confirm|assign|save/i }).first().click();
      }
      expect((await assignPromise).status()).toBe(200);

      const afterRes = await request.get(`${server.baseUrl}/api/azure-data/work-items/unassigned?limit=10&offset=0`, {
        headers,
      });
      expect(((await afterRes.json()) as { total: number }).total).toBe(beforeTotal - 1);

      // 5. Sprint Progress
      await page.goto(`${server.baseUrl}/sprint-progress`, { waitUntil: 'domcontentloaded' });
      await assertLandmarks(page);
      await expect(page.locator('main#main')).toContainText(/Sprint 41|Sprint 42/i);
    } finally {
      await server.stop();
    }
  });

  test('[Tier 4][Scenario 4] Governance & Auto-Closure Compliance Lifecycle (Rules -> Dry-Run -> Confirm -> Audit -> Export -> Clear)', async ({
    page,
    request,
  }) => {
    const server = await startAcceptanceServer({ authMode: 'basic' });
    try {
      const headers = { Authorization: server.basicAdminHeader };
      seedDailyTask(server, {
        id: 1401,
        personName: 'Alice Chen',
        assignedTo: 'alice@workops.test',
        isoDate: todayIsoDate(),
        state: 'Active',
      });

      // 1. Configure & Enable Policy Rules
      const getCfg = await request.get(`${server.baseUrl}/api/auto-closure/config`, { headers });
      expect(getCfg.status()).toBe(200);
      const cfg = (await getCfg.json()) as Record<string, unknown>;
      const putCfg = await request.put(`${server.baseUrl}/api/auto-closure/config`, {
        headers,
        data: { ...cfg, enabled: true },
      });
      expect(putCfg.status()).toBe(200);

      // 2. Dry-Run
      const dryRun = await request.post(`${server.baseUrl}/api/auto-closure/run`, {
        headers,
        data: { dryRun: true },
      });
      expect(dryRun.status()).toBe(200);

      // 3. Confirmed Run
      const confirmRun = await request.post(`${server.baseUrl}/api/auto-closure/run`, {
        headers,
        data: { dryRun: false, confirm: true },
      });
      expect(confirmRun.status()).toBe(200);

      // 4. Audit Trail in UI & API
      const auditRes = await request.get(`${server.baseUrl}/api/auto-closure/audit`, { headers });
      expect(auditRes.status()).toBe(200);
      const auditRows = unwrapArray(await auditRes.json(), ['entries', 'logs', 'items', 'audit']);
      expect(auditRows.length).toBeGreaterThan(0);

      await page.setExtraHTTPHeaders(headers);
      await page.goto(`${server.baseUrl}/scheduler`, { waitUntil: 'domcontentloaded' });
      await assertLandmarks(page);
      await expect(page.locator('main#main')).toContainText(/auto.?closure|audit|policy/i);

      // 5. Export
      const exportRes = await request.get(`${server.baseUrl}/api/auto-closure/audit/export`, { headers });
      expect(exportRes.status()).toBe(200);
      expect((await exportRes.text()).length).toBeGreaterThan(10);

      // 6. Clear Audit
      const clearRes = await request.delete(`${server.baseUrl}/api/auto-closure/audit`, { headers });
      expect([200, 204]).toContain(clearRes.status());

      const afterClear = await request.get(`${server.baseUrl}/api/auto-closure/audit`, { headers });
      const remaining = unwrapArray(await afterClear.json(), ['entries', 'logs', 'items', 'audit']);
      expect(remaining.length).toBe(0);
    } finally {
      await server.stop();
    }
  });

  test('[Tier 4][Scenario 5] EOD Closure Manual Override Justification & Audit Attribution', async ({
    page,
    request,
  }) => {
    const server = await startAcceptanceServer({ authMode: 'basic' });
    try {
      const headers = { Authorization: server.basicAdminHeader };
      const today = todayIsoDate();

      // Clear GitHub PRs and commits so Bob has zero PR/commit evidence
      server.mockGitHub.seedPrs([], true);
      server.mockGitHub.seedCommits([], true);

      seedDailyTask(server, {
        id: 1501,
        personName: 'Bob Patel',
        assignedTo: 'bob@workops.test',
        isoDate: today,
        state: 'Active',
      });

      const overrideReason = 'Pair programming review completed offline with lead sign-off';

      await page.setExtraHTTPHeaders(headers);
      await page.goto(`${server.baseUrl}/mywork`, { waitUntil: 'domcontentloaded' });
      await assertLandmarks(page);

      // Preview EOD closure in Cockpit UI
      const closeBtn = page.getByRole('button', { name: /close.*today|eod.*clos|end of day/i }).first();
      await expect(closeBtn).toBeVisible();
      await closeBtn.click();

      // Trigger manual override in UI if available, else verify API contract with UI reload
      const overrideToggle = page.getByLabel(/manual override|override/i).first();
      if (await overrideToggle.isVisible({ timeout: 2000 }).catch(() => false)) {
        if ((await overrideToggle.getAttribute('type')) === 'checkbox') {
          await overrideToggle.check();
        } else {
          await overrideToggle.click();
        }
        const reasonInput = page.getByLabel(/reason|justification/i).first();
        await reasonInput.fill(overrideReason);
        const confirmBtn = page
          .getByRole('dialog')
          .getByRole('button', { name: /confirm|close/i })
          .or(page.getByRole('button', { name: /confirm.*clos/i }))
          .first();
        const closePromise = page.waitForResponse(
          (res) => res.url().includes('/api/tasks/close-today') && res.request().method() === 'POST'
        );
        await confirmBtn.click();
        expect((await closePromise).status()).toBe(200);
      } else {
        const apiClose = await request.post(`${server.baseUrl}/api/tasks/close-today`, {
          headers,
          data: {
            dryRun: false,
            confirm: true,
            personKeys: ['bob'],
            manualOverride: true,
            overrideReason,
          },
        });
        expect(apiClose.status()).toBe(200);
      }

      const closedItem = server.mockAzure.getWorkItem(1501);
      expect(['Closed', 'Done', 'Completed']).toContain(String(closedItem?.fields['System.State']));

      const auditRes = await request.get(`${server.baseUrl}/api/auto-closure/audit`, { headers });
      expect(auditRes.status()).toBe(200);
      expect(await auditRes.text()).toContain(overrideReason);

      const journalRes = await request.get(`${server.baseUrl}/api/journal`, { headers });
      expect(journalRes.status()).toBe(200);
      const journalText = await journalRes.text();
      expect(journalText).toMatch(/bob|admin/i);
    } finally {
      await server.stop();
    }
  });

  test('[Tier 4][Scenario 6] Explorer Gap Remediation & Bulk Lifecycle Activation', async ({
    page,
    request,
  }) => {
    const server = await startAcceptanceServer({ authMode: 'basic' });
    try {
      const headers = { Authorization: server.basicAdminHeader };
      const [day1, day2] = getWeekdayWindow(2, 6);

      // Seed only 1 of 4 expected cells (alice on day1)
      seedDailyTask(server, {
        id: 1601,
        personName: 'Alice Chen',
        assignedTo: 'alice@workops.test',
        isoDate: day1,
        state: 'New',
      });

      const beforeExp = await request.get(`${server.baseUrl}/api/explorer?startDate=${day1}&endDate=${day2}`, {
        headers,
      });
      expect(beforeExp.status()).toBe(200);
      const beforeData = (await beforeExp.json()) as {
        summary: { missingCount: number; overallCoveragePercent: number };
      };
      expect(beforeData.summary.missingCount).toBe(3);
      expect(beforeData.summary.overallCoveragePercent).toBe(25);

      await page.setExtraHTTPHeaders(headers);
      await page.goto(`${server.baseUrl}/explorer?startDate=${day1}&endDate=${day2}`, {
        waitUntil: 'domcontentloaded',
      });
      await assertLandmarks(page);

      const createMissingPromise = page.waitForResponse(
        (res) => res.url().includes('/api/explorer/create-missing') && res.request().method() === 'POST'
      );
      await page.getByRole('button', { name: /create missing/i }).first().click();
      const dialog = page.getByRole('dialog').first();
      if (await dialog.isVisible({ timeout: 1000 }).catch(() => false)) {
        await dialog.getByRole('button', { name: /confirm|create|proceed/i }).first().click();
      }
      expect((await createMissingPromise).status()).toBe(200);

      const afterExp = await request.get(`${server.baseUrl}/api/explorer?startDate=${day1}&endDate=${day2}`, {
        headers,
      });
      const afterData = (await afterExp.json()) as {
        summary: { missingCount: number; overallCoveragePercent: number };
      };
      expect(afterData.summary.missingCount).toBe(0);
      expect(afterData.summary.overallCoveragePercent).toBe(100);

      // Bulk Lifecycle Activation & Closure on /lifecycle
      await page.goto(`${server.baseUrl}/lifecycle`, { waitUntil: 'domcontentloaded' });
      await assertLandmarks(page);
      await assertNoHorizontalOverflow(page);

      const activateBulkBtn = page.getByRole('button', { name: /activate/i }).first();
      await expect(activateBulkBtn).toBeVisible();
      const actRes = await request.post(`${server.baseUrl}/api/tasks/activate-today`, {
        headers,
        data: { dryRun: false, confirm: true, all: true, asOf: day1 },
      });
      expect(actRes.status()).toBe(200);
      expect(server.mockAzure.getWorkItem(1601)?.fields['System.State']).toBe('Active');

      const closeRes = await request.post(`${server.baseUrl}/api/tasks/close-today`, {
        headers,
        data: {
          dryRun: false,
          confirm: true,
          all: true,
          asOf: day1,
          manualOverride: true,
          overrideReason: 'Lifecycle bulk completion',
        },
      });
      expect(closeRes.status()).toBe(200);
      expect(['Closed', 'Done', 'Completed']).toContain(
        String(server.mockAzure.getWorkItem(1601)?.fields['System.State'])
      );
    } finally {
      await server.stop();
    }
  });

  test('[Tier 4][Scenario 7] Multi-Role Security & RBAC Audit Isolation (Anonymous -> Auditor -> Admin)', async ({
    page,
    request,
  }) => {
    const server = await startAcceptanceServer({ authMode: 'oidc' });
    try {
      // 1. Anonymous requests rejected
      for (const path of ['/api/config', '/api/journal', '/api/explorer']) {
        const res = await request.get(`${server.baseUrl}${path}`);
        expect(res.status(), `Anonymous GET ${path} must return 401`).toBe(401);
      }

      // Malformed JWTs rejected with 401
      const badTokens = [
        server.mockOidc.mintToken({ expired: true }),
        server.mockOidc.mintToken({ wrongAudience: true }),
        server.mockOidc.mintToken({ wrongAlg: true }),
        server.mockOidc.mintToken({ omitNbf: true }),
        server.mockOidc.mintToken({ wrongSignature: true }),
      ];
      for (const bad of badTokens) {
        const res = await request.get(`${server.baseUrl}/api/config`, {
          headers: { Authorization: `Bearer ${bad}` },
        });
        expect(res.status(), 'Malformed JWT must return 401').toBe(401);
      }

      // 2. Auditor allowed reads/exports, blocked writes
      const auditorToken = server.mockOidc.mintToken({
        sub: 'auditor-user',
        email: 'auditor@workops.test',
        name: 'Audit Reviewer',
        roles: ['Auditor'],
      });
      const auditorHeaders = { Authorization: `Bearer ${auditorToken}` };

      expect((await request.get(`${server.baseUrl}/api/config`, { headers: auditorHeaders })).status()).toBe(200);
      expect((await request.get(`${server.baseUrl}/api/journal/export?format=csv`, { headers: auditorHeaders })).status()).toBe(200);
      expect(
        (
          await request.post(`${server.baseUrl}/api/config/settings`, {
            headers: auditorHeaders,
            data: { titlePrefix: 'Blocked |' },
          })
        ).status()
      ).toBe(403);
      expect(
        (
          await request.delete(`${server.baseUrl}/api/auto-closure/audit`, {
            headers: auditorHeaders,
          })
        ).status()
      ).toBe(403);

      // 3. Admin allowed full mutations & UI renders Admin role
      const adminToken = server.mockOidc.mintToken({
        sub: 'admin-user',
        email: 'admin@workops.test',
        name: 'Platform Admin',
        roles: ['Admin'],
      });
      const adminHeaders = { Authorization: `Bearer ${adminToken}` };

      expect(
        (
          await request.post(`${server.baseUrl}/api/config/settings`, {
            headers: adminHeaders,
            data: { titlePrefix: 'VerifiedAdmin |' },
          })
        ).status()
      ).toBe(200);

      await page.setExtraHTTPHeaders(adminHeaders);
      await page.goto(`${server.baseUrl}/mywork`, { waitUntil: 'domcontentloaded' });
      await assertLandmarks(page);
      await expect(page.getByRole('banner')).toContainText(/admin/i);
    } finally {
      await server.stop();
    }
  });

  test('[Tier 4][Scenario 8] Server Restart & Relational Persistence Integrity (Zero Resurrection)', async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000);
    const server = await startAcceptanceServer({ authMode: 'basic' });
    try {
      const headers = { Authorization: server.basicAdminHeader };
      const [excStart, excEnd, planDate] = getWeekdayWindow(3, 3);

      // 1. Mutate roster: create frank, edit bob, delete alice
      const createRes = await request.post(`${server.baseUrl}/api/config/people`, {
        headers,
        data: {
          key: 'frank',
          name: 'Frank Miller',
          assignedTo: 'frank@workops.test',
          enabled: true,
          autoCloseEnabled: true,
          pod: 'POD-008 Core',
          role: 'Developer',
          sourceTaskId: 201,
        },
      });
      expect([200, 201]).toContain(createRes.status());

      expect(
        (
          await request.put(`${server.baseUrl}/api/config/people/bob`, {
            headers,
            data: { pod: 'POD-088 Persisted' },
          })
        ).status()
      ).toBe(200);

      expect(
        (await request.delete(`${server.baseUrl}/api/config/people/alice`, { headers })).status()
      ).toBeLessThan(300);

      // 2. Mutate calendar
      const calGet = (await (await request.get(`${server.baseUrl}/api/calendar`, { headers })).json()) as {
        calendar: { version: number };
      };
      expect(
        (
          await request.post(`${server.baseUrl}/api/calendar`, {
            headers,
            data: {
              version: calGet.calendar.version,
              defaultHours: 8,
              memberHours: { frank: 7 },
              exceptions: [
                {
                  id: 'exc-annual-shutdown',
                  startDate: excStart,
                  endDate: excEnd,
                  kind: 'holiday',
                  memberKeys: ['frank'],
                  note: 'Annual Shutdown Window',
                },
              ],
            },
          })
        ).status()
      ).toBe(200);

      // 3. Plan + execute + adhoc
      const planRes = await request.post(`${server.baseUrl}/api/tasks/plan`, {
        headers,
        data: { asOf: planDate },
      });
      const { planToken } = (await planRes.json()) as { planToken: string };
      expect(
        (
          await request.post(`${server.baseUrl}/api/tasks/execute`, {
            headers,
            data: { planToken, confirm: true },
          })
        ).status()
      ).toBe(200);

      const preJournalRes = await request.get(`${server.baseUrl}/api/journal`, { headers });
      const preJournalCount = unwrapArray(await preJournalRes.json(), ['entries', 'items', 'journal', 'records']).length;
      expect(preJournalCount).toBeGreaterThan(0);

      // 4. Restart server
      await server.restart();

      // 5. Verify zero resurrection & full state intact in API and UI
      const postCfg = (await (await request.get(`${server.baseUrl}/api/config`, { headers })).json()) as {
        people: Array<Record<string, unknown>>;
      };
      expect(postCfg.people.some((p) => p.key === 'alice')).toBe(false);
      expect(postCfg.people.some((p) => p.key === 'frank' && p.name === 'Frank Miller')).toBe(true);
      expect(postCfg.people.find((p) => p.key === 'bob')?.pod).toBe('POD-088 Persisted');

      const postCal = (await (await request.get(`${server.baseUrl}/api/calendar`, { headers })).json()) as {
        calendar: { memberHours?: Record<string, number>; exceptions?: Array<Record<string, unknown>> };
      };
      expect(postCal.calendar.memberHours?.frank).toBe(7);
      expect(
        (postCal.calendar.exceptions ?? []).some((e) => e.note === 'Annual Shutdown Window')
      ).toBe(true);

      const postJournalCount = unwrapArray(
        await (await request.get(`${server.baseUrl}/api/journal`, { headers })).json(),
        ['entries', 'items', 'journal', 'records']
      ).length;
      expect(postJournalCount).toBe(preJournalCount);

      await page.setExtraHTTPHeaders(headers);
      await page.goto(`${server.baseUrl}/people`, { waitUntil: 'domcontentloaded' });
      await expect(page.locator('main#main')).toContainText(/Frank Miller/i);
      await expect(page.locator('main#main')).not.toContainText(/Alice Chen/i);
    } finally {
      await server.stop();
    }
  });

  test('[Tier 4][Scenario 9] Degraded Upstream Resilience & Health/Readiness Separation', async ({
    page,
    request,
  }) => {
    const server = await startAcceptanceServer({ authMode: 'basic' });
    try {
      const headers = { Authorization: server.basicAdminHeader };
      const readyBefore = await request.get(`${server.baseUrl}/api/ready`, { headers });
      expect(readyBefore.status()).toBe(200);
      expect(((await readyBefore.json()) as { ready: boolean }).ready).toBe(true);

      server.mockAzure.setUnavailable(true, 503);
      server.mockGitHub.setUnavailable(true, 503);

      // Liveness stays 200 while readiness degrades
      const healthRes = await request.get(`${server.baseUrl}/api/health`);
      expect(healthRes.status()).toBe(200);
      expect(((await healthRes.json()) as { status: string }).status).toBe('ok');

      const readyDegraded = await request.get(`${server.baseUrl}/api/ready`, { headers });
      expect(((await readyDegraded.json()) as { ready: boolean }).ready).toBe(false);

      await page.setExtraHTTPHeaders(headers);
      await page.goto(`${server.baseUrl}/dashboard`, { waitUntil: 'domcontentloaded' });
      await assertLandmarks(page);
      await expect(page.locator('main#main')).toContainText(/degraded|unavailable|offline|error|attention/i);

      // Recover upstream services
      server.mockAzure.setUnavailable(false);
      server.mockGitHub.setUnavailable(false);

      const readyAfter = await request.get(`${server.baseUrl}/api/ready`, { headers });
      expect(readyAfter.status()).toBe(200);
      expect(((await readyAfter.json()) as { ready: boolean }).ready).toBe(true);

      await page.reload({ waitUntil: 'domcontentloaded' });
      await assertLandmarks(page);
    } finally {
      await server.stop();
    }
  });

  test('[Tier 4][Scenario 10] Cross-Viewport Responsive & Accessibility Traversal (Desktop/Tablet/Mobile)', async ({
    page,
    gotoRoute,
  }) => {
    const viewports = [
      { name: 'Desktop', width: 1280, height: 800, collapsedNav: false },
      { name: 'Tablet', width: 768, height: 1024, collapsedNav: true },
      { name: 'Mobile', width: 375, height: 667, collapsedNav: true },
    ];
    const keyRoutes = ['/mywork', '/dashboard', '/planner', '/explorer', '/people', '/scheduler', '/azure-teams'];

    for (const vp of viewports) {
      await page.setViewportSize({ width: vp.width, height: vp.height });

      for (const route of keyRoutes) {
        await gotoRoute(route);
        await assertLandmarks(page);
        await assertNoHorizontalOverflow(page);

        const nav = page.getByRole('navigation', { name: 'Main navigation' });
        if (!vp.collapsedNav) {
          await expect(nav).toBeVisible();
        } else {
          const mainBox = await page.locator('main#main').boundingBox();
          expect(mainBox).not.toBeNull();
          if (mainBox && !(await nav.isVisible().catch(() => false))) {
            expect(mainBox.x, `Hidden sidebar gap on ${vp.name} at ${route}`).toBeLessThanOrEqual(48);
          }
        }
      }

      if (vp.collapsedNav) {
        await gotoRoute('/mywork');
        const navToggle = page.locator('button[aria-expanded][aria-controls]').first();
        await expect(navToggle).toBeVisible();
        await navToggle.focus();
        await page.keyboard.press('Enter');
        await expect(navToggle).toHaveAttribute('aria-expanded', 'true');
        await page.keyboard.press('Escape');
        await expect(navToggle).toHaveAttribute('aria-expanded', 'false');
        await expect(navToggle).toBeFocused();
      }
    }

    // Verify modal keyboard Escape + focus restoration at desktop viewport
    await page.setViewportSize({ width: 1280, height: 800 });
    await gotoRoute('/people');
    const addTrigger = page.getByRole('button', { name: /add\s+(member|person)|new\s+member/i }).first();
    const modal = page.getByRole('dialog').first();
    await assertKeyboardDialogBehavior(page, addTrigger, modal);
  });
});
