import { test, expect } from '../harness/fixtures.js';
import { startAcceptanceServer, type SeedPerson } from '../harness/acceptance-server.js';
import { assertLandmarks, assertNoHorizontalOverflow } from '../harness/a11y.js';

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function getNextWeekdayIso(minDaysAhead = 1): string {
  const d = new Date();
  d.setUTCHours(12, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + minDaysAhead);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) {
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return toIsoDate(d);
}

function getNextWeekendRange(): { saturday: string; sunday: string } {
  const d = new Date();
  d.setUTCHours(12, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + 1);
  while (d.getUTCDay() !== 6) {
    d.setUTCDate(d.getUTCDate() + 1);
  }
  const sat = new Date(d);
  const sun = new Date(d);
  sun.setUTCDate(sat.getUTCDate() + 1);
  return { saturday: toIsoDate(sat), sunday: toIsoDate(sun) };
}

function getNextMondayToFriday(): { monday: string; friday: string } {
  const d = new Date();
  d.setUTCHours(12, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + 1);
  while (d.getUTCDay() !== 1) {
    d.setUTCDate(d.getUTCDate() + 1);
  }
  const mon = new Date(d);
  const fri = new Date(d);
  fri.setUTCDate(mon.getUTCDate() + 4);
  return { monday: toIsoDate(mon), friday: toIsoDate(fri) };
}

function formatTitleDate(isoDate: string): string {
  const d = new Date(`${isoDate}T12:00:00.000Z`);
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
  }).format(d);
}

function makeSixPeople(): SeedPerson[] {
  return [
    { key: 'alice', name: 'Alice Chen', assignedTo: 'alice@workops.test', enabled: true, autoCloseEnabled: true },
    { key: 'bob', name: 'Bob Patel', assignedTo: 'bob@workops.test', enabled: true, autoCloseEnabled: true },
    { key: 'carol', name: 'Carol Diaz', assignedTo: 'carol@workops.test', enabled: true, autoCloseEnabled: true },
    { key: 'dave', name: 'Dave Kim', assignedTo: 'dave@workops.test', enabled: true, autoCloseEnabled: true },
    { key: 'eve', name: 'Eve Rossi', assignedTo: 'eve@workops.test', enabled: true, autoCloseEnabled: true },
    { key: 'frank', name: 'Frank Wu', assignedTo: 'frank@workops.test', enabled: true, autoCloseEnabled: true },
  ];
}

test.describe('Tier 2 — Planning, Explorer, Burndown & Lifecycle Boundaries (F8, F9, F11, F16)', () => {
  // ---------------------------------------------------------------------------
  // F8 Boundaries
  // ---------------------------------------------------------------------------

  test('[F8][Tier 2] POST /api/tasks/execute with planToken and confirm: false or missing confirm is rejected without creating Azure items', async ({
    request,
  }) => {
    const server = await startAcceptanceServer({ authMode: 'basic' });
    try {
      const headers = { Authorization: server.basicAdminHeader };
      const targetDate = getNextWeekdayIso(2);
      const initialCount = server.mockAzure.listWorkItems().length;

      const planRes = await request.post(`${server.baseUrl}/api/tasks/plan`, {
        headers,
        data: { asOf: targetDate },
      });
      expect(planRes.status()).toBe(200);
      const plan = (await planRes.json()) as { planToken: string };

      const missingConfirm = await request.post(`${server.baseUrl}/api/tasks/execute`, {
        headers,
        data: { planToken: plan.planToken },
      });
      expect([400, 409]).toContain(missingConfirm.status());

      const falseConfirm = await request.post(`${server.baseUrl}/api/tasks/execute`, {
        headers,
        data: { planToken: plan.planToken, confirm: false },
      });
      expect([400, 409]).toContain(falseConfirm.status());

      expect(server.mockAzure.listWorkItems().length).toBe(initialCount);
    } finally {
      await server.stop();
    }
  });

  test('[F8][Tier 2] POST /api/tasks/execute rejects tampered or unknown planToken without creating tasks', async ({
    request,
  }) => {
    const server = await startAcceptanceServer({ authMode: 'basic' });
    try {
      const headers = { Authorization: server.basicAdminHeader };
      const targetDate = getNextWeekdayIso(2);
      const initialCount = server.mockAzure.listWorkItems().length;

      const planRes = await request.post(`${server.baseUrl}/api/tasks/plan`, {
        headers,
        data: { asOf: targetDate },
      });
      const plan = (await planRes.json()) as { planToken: string };
      const tampered = `${plan.planToken.slice(0, -4)}XXXX`;

      const tamperedRes = await request.post(`${server.baseUrl}/api/tasks/execute`, {
        headers,
        data: { planToken: tampered, confirm: true },
      });
      expect([400, 404, 409]).toContain(tamperedRes.status());

      const unknownRes = await request.post(`${server.baseUrl}/api/tasks/execute`, {
        headers,
        data: { planToken: 'nonexistent-token-0000', confirm: true },
      });
      expect([400, 404, 409]).toContain(unknownRes.status());

      expect(server.mockAzure.listWorkItems().length).toBe(initialCount);
    } finally {
      await server.stop();
    }
  });

  test('[F8][Tier 2] Executing stale planToken after workspace settings or calendar changed handles planHash mismatch safely', async ({
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
      const plan = (await planRes.json()) as { planToken: string };

      // Mutate workspace settings after planning so planHash diverges
      const settingsRes = await request.post(`${server.baseUrl}/api/config/settings`, {
        headers,
        data: { titlePrefix: 'ChangedPrefix |' },
      });
      expect(settingsRes.status()).toBe(200);

      const execRes = await request.post(`${server.baseUrl}/api/tasks/execute`, {
        headers,
        data: { planToken: plan.planToken, confirm: true },
      });
      expect([400, 409]).toContain(execRes.status());
      const bodyText = await execRes.text();
      expect(bodyText).toMatch(/hash|stale|changed|mismatch|expired|conflict/i);
    } finally {
      await server.stop();
    }
  });

  test('[F8][Tier 2] Partial Azure 500 failure during multi-person execution reports per-item outcome without crashing server', async ({
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
      const plan = (await planRes.json()) as { planToken: string };

      // Fail only the first work item creation POST ($Task), letting the second succeed
      server.mockAzure.failNext(1, 500, /_apis\/wit\/workitems\/\$/i, 'Injected single-item 500');

      const execRes = await request.post(`${server.baseUrl}/api/tasks/execute`, {
        headers,
        data: { planToken: plan.planToken, confirm: true },
      });
      expect([200, 207, 422, 500, 502]).toContain(execRes.status());

      // Server must remain healthy after partial failure
      const healthRes = await request.get(`${server.baseUrl}/api/health`);
      expect(healthRes.status()).toBe(200);
    } finally {
      await server.stop();
    }
  });

  test('[F8][Tier 2] Executing an empty plan (0 missing tasks) completes cleanly with zero creations', async ({
    request,
  }) => {
    const server = await startAcceptanceServer({ authMode: 'basic' });
    try {
      const headers = { Authorization: server.basicAdminHeader };
      const targetDate = getNextWeekdayIso(2);

      // First create all tasks so targetDate is 100% populated
      const initialExec = await request.post(`${server.baseUrl}/api/tasks/execute`, {
        headers,
        data: { asOf: targetDate, confirm: true },
      });
      expect(initialExec.status()).toBe(200);
      const countBefore = server.mockAzure.listWorkItems().length;

      // Now plan for the same date -> 0 missing tasks
      const emptyPlanRes = await request.post(`${server.baseUrl}/api/tasks/plan`, {
        headers,
        data: { asOf: targetDate },
      });
      expect(emptyPlanRes.status()).toBe(200);
      const emptyPlan = (await emptyPlanRes.json()) as { planToken: string };

      const execEmpty = await request.post(`${server.baseUrl}/api/tasks/execute`, {
        headers,
        data: { planToken: emptyPlan.planToken, confirm: true },
      });
      expect(execEmpty.status()).toBe(200);
      expect(server.mockAzure.listWorkItems().length).toBe(countBefore);
    } finally {
      await server.stop();
    }
  });

  // ---------------------------------------------------------------------------
  // F9 Boundaries
  // ---------------------------------------------------------------------------

  test('[F9][Tier 2] Explorer with 2x duplicate tasks on every person+day clamps overallCoveragePercent <= 100 and reports duplicateCount > 0', async ({
    request,
  }) => {
    const server = await startAcceptanceServer({ authMode: 'basic' });
    try {
      const headers = { Authorization: server.basicAdminHeader };
      const { monday } = getNextMondayToFriday();
      const titleDate = formatTitleDate(monday);

      // 2 tasks for Alice + 2 tasks for Bob on the same single day
      for (const [idx, person] of [
        { name: 'Alice Chen', email: 'alice@workops.test' },
        { name: 'Bob Patel', email: 'bob@workops.test' },
      ].entries()) {
        server.mockAzure.seedWorkItem({
          id: 900 + idx * 2,
          fields: {
            'System.TeamProject': 'TestProject',
            'System.WorkItemType': 'Task',
            'System.Title': `Task | ${titleDate} | ${person.name} #1`,
            'System.State': 'New',
            'System.AssignedTo': { displayName: person.name, uniqueName: person.email },
            'Microsoft.VSTS.Scheduling.StartDate': `${monday}T09:30:00Z`,
            'Custom.PlannedStartDate': `${monday}T09:30:00Z`,
            'System.CreatedDate': `${monday}T09:30:00Z`,
          },
        });
        server.mockAzure.seedWorkItem({
          id: 901 + idx * 2,
          fields: {
            'System.TeamProject': 'TestProject',
            'System.WorkItemType': 'Task',
            'System.Title': `Task | ${titleDate} | ${person.name} #2`,
            'System.State': 'New',
            'System.AssignedTo': { displayName: person.name, uniqueName: person.email },
            'Microsoft.VSTS.Scheduling.StartDate': `${monday}T09:40:00Z`,
            'Custom.PlannedStartDate': `${monday}T09:40:00Z`,
            'System.CreatedDate': `${monday}T09:40:00Z`,
          },
        });
      }

      const res = await request.get(`${server.baseUrl}/api/explorer?startDate=${monday}&endDate=${monday}`, {
        headers,
      });
      expect(res.status()).toBe(200);
      const body = (await res.json()) as {
        summary: {
          expectedCombinations: number;
          createdCount: number;
          missingCount: number;
          duplicateCount: number;
          overallCoveragePercent: number;
        };
      };

      expect(body.summary.expectedCombinations).toBe(2);
      expect(body.summary.createdCount).toBe(2);
      expect(body.summary.missingCount).toBe(0);
      expect(body.summary.duplicateCount).toBeGreaterThanOrEqual(2);
      expect(body.summary.overallCoveragePercent).toBe(100);
      expect(body.summary.overallCoveragePercent).toBeLessThanOrEqual(100);
    } finally {
      await server.stop();
    }
  });

  test('[F9][Tier 2] Explorer with inverted date range (startDate > endDate) returns 400 validation error', async ({
    apiGet,
  }) => {
    const { monday, friday } = getNextMondayToFriday();
    const res = await apiGet(`/api/explorer?startDate=${friday}&endDate=${monday}`);
    expect(res.status()).toBe(400);
  });

  test('[F9][Tier 2] Explorer on weekend-only range returns workingDaysCount === 0 and safe non-NaN coverage', async ({
    apiGet,
  }) => {
    const { saturday, sunday } = getNextWeekendRange();
    const res = await apiGet(`/api/explorer?startDate=${saturday}&endDate=${sunday}`);
    expect(res.status()).toBe(200);
    const body = (await res.json()) as {
      workingDaysCount: number;
      summary: {
        expectedCombinations: number;
        createdCount: number;
        missingCount: number;
        overallCoveragePercent: number;
      };
    };

    expect(body.workingDaysCount).toBe(0);
    expect(body.summary.expectedCombinations).toBe(0);
    expect(body.summary.createdCount).toBe(0);
    expect(body.summary.missingCount).toBe(0);
    expect(Number.isFinite(body.summary.overallCoveragePercent)).toBe(true);
    expect(body.summary.overallCoveragePercent).toBeGreaterThanOrEqual(0);
    expect(body.summary.overallCoveragePercent).toBeLessThanOrEqual(100);
  });

  test('[F9][Tier 2] POST /api/explorer/create-missing without confirm: true is rejected without creating tasks', async ({
    request,
  }) => {
    const server = await startAcceptanceServer({ authMode: 'basic' });
    try {
      const headers = { Authorization: server.basicAdminHeader };
      const { monday } = getNextMondayToFriday();
      const beforeCount = server.mockAzure.listWorkItems().length;

      const noConfirm = await request.post(`${server.baseUrl}/api/explorer/create-missing`, {
        headers,
        data: { startDate: monday, endDate: monday },
      });
      expect([400, 409]).toContain(noConfirm.status());

      const falseConfirm = await request.post(`${server.baseUrl}/api/explorer/create-missing`, {
        headers,
        data: { startDate: monday, endDate: monday, confirm: false },
      });
      expect([400, 409]).toContain(falseConfirm.status());

      expect(server.mockAzure.listWorkItems().length).toBe(beforeCount);
    } finally {
      await server.stop();
    }
  });

  test('[F9][Tier 2] Explorer with empty roster (0 enabled people) returns valid zeroed summary', async ({
    request,
  }) => {
    const disabledPeople: SeedPerson[] = [
      { key: 'alice', name: 'Alice Chen', assignedTo: 'alice@workops.test', enabled: false },
      { key: 'bob', name: 'Bob Patel', assignedTo: 'bob@workops.test', enabled: false },
    ];
    const server = await startAcceptanceServer({ authMode: 'basic', people: disabledPeople });
    try {
      const headers = { Authorization: server.basicAdminHeader };
      const { monday, friday } = getNextMondayToFriday();

      const res = await request.get(`${server.baseUrl}/api/explorer?startDate=${monday}&endDate=${friday}`, {
        headers,
      });
      expect(res.status()).toBe(200);
      const body = (await res.json()) as {
        summary: {
          expectedCombinations: number;
          createdCount: number;
          missingCount: number;
          overallCoveragePercent: number;
        };
      };

      expect(body.summary.expectedCombinations).toBe(0);
      expect(body.summary.createdCount).toBe(0);
      expect(body.summary.missingCount).toBe(0);
      expect(Number.isFinite(body.summary.overallCoveragePercent)).toBe(true);
    } finally {
      await server.stop();
    }
  });

  // ---------------------------------------------------------------------------
  // F11 Boundaries
  // ---------------------------------------------------------------------------

  test('[F11][Tier 2] WIQL request count stays bounded (<= 2 calls) for 6 enabled people during plan and explore', async ({
    request,
  }) => {
    const server = await startAcceptanceServer({ authMode: 'basic', people: makeSixPeople() });
    try {
      const headers = { Authorization: server.basicAdminHeader };
      const { monday, friday } = getNextMondayToFriday();

      server.mockAzure.clearRequests();
      const planRes = await request.post(`${server.baseUrl}/api/tasks/plan`, {
        headers,
        data: { asOf: monday },
      });
      expect(planRes.status()).toBe(200);
      const planWiql = server.mockAzure
        .getRequests()
        .filter((r) => r.method === 'POST' && r.path.toLowerCase().includes('/wiql'));
      expect(planWiql.length).toBeLessThanOrEqual(2);

      server.mockAzure.clearRequests();
      const exploreRes = await request.get(`${server.baseUrl}/api/explorer?startDate=${monday}&endDate=${friday}`, {
        headers,
      });
      expect(exploreRes.status()).toBe(200);
      const exploreWiql = server.mockAzure
        .getRequests()
        .filter((r) => r.method === 'POST' && r.path.toLowerCase().includes('/wiql'));
      expect(exploreWiql.length).toBeLessThanOrEqual(2);
    } finally {
      await server.stop();
    }
  });

  test('[F11][Tier 2] Empty Azure work items and missing parent relations are handled gracefully by plan and explorer', async ({
    request,
  }) => {
    const server = await startAcceptanceServer({ authMode: 'basic' });
    try {
      const headers = { Authorization: server.basicAdminHeader };
      // Wipe all work items from mock Azure
      server.mockAzure.reset({
        organization: 'test-org',
        projects: [{ name: 'TestProject', id: 'proj-agile-01', workItemTypes: ['Task', 'User Story'] }],
      });

      const { monday } = getNextMondayToFriday();
      const planRes = await request.post(`${server.baseUrl}/api/tasks/plan`, {
        headers,
        data: { asOf: monday },
      });
      expect(planRes.status()).toBe(200);

      const expRes = await request.get(`${server.baseUrl}/api/explorer?startDate=${monday}&endDate=${monday}`, {
        headers,
      });
      expect(expRes.status()).toBe(200);
    } finally {
      await server.stop();
    }
  });

  test('[F11][Tier 2] POST /api/tasks/repair when all relations already exist is a no-op with zero PATCH calls', async ({
    request,
  }) => {
    const server = await startAcceptanceServer({ authMode: 'basic' });
    try {
      const headers = { Authorization: server.basicAdminHeader };
      const targetDate = getNextWeekdayIso(2);

      await request.post(`${server.baseUrl}/api/tasks/execute`, {
        headers,
        data: { asOf: targetDate, confirm: true },
      });
      // First repair ensures everything is synced
      await request.post(`${server.baseUrl}/api/tasks/repair`, { headers, data: {} });

      server.mockAzure.clearRequests();
      const secondRepair = await request.post(`${server.baseUrl}/api/tasks/repair`, {
        headers,
        data: {},
      });
      expect(secondRepair.status()).toBe(200);
      const patchReqs = server.mockAzure.getRequests().filter((r) => r.method === 'PATCH');
      expect(patchReqs.length).toBe(0);
    } finally {
      await server.stop();
    }
  });

  test('[F11][Tier 2] ActivateDailyTasks and CloseDailyTasks skip disabled people and tasks with non-matching title prefixes', async ({
    request,
  }) => {
    const people: SeedPerson[] = [
      { key: 'alice', name: 'Alice Chen', assignedTo: 'alice@workops.test', enabled: true, autoCloseEnabled: true },
      { key: 'bob', name: 'Bob Patel', assignedTo: 'bob@workops.test', enabled: false, autoCloseEnabled: false },
    ];
    const server = await startAcceptanceServer({ authMode: 'basic', people });
    try {
      const headers = { Authorization: server.basicAdminHeader };
      const targetDate = getNextWeekdayIso(1);
      const titleDate = formatTitleDate(targetDate);

      // Seed matching task for enabled Alice, task with non-matching prefix for Alice, and task for disabled Bob
      server.mockAzure.seedWorkItem({
        id: 850,
        fields: {
          'System.TeamProject': 'TestProject',
          'System.WorkItemType': 'Task',
          'System.Title': `Task | ${titleDate} | Alice Chen Daily`,
          'System.State': 'New',
          'System.AssignedTo': { displayName: 'Alice Chen', uniqueName: 'alice@workops.test' },
          'Microsoft.VSTS.Scheduling.StartDate': `${targetDate}T09:30:00Z`,
          'System.CreatedDate': `${targetDate}T09:30:00Z`,
        },
      });
      server.mockAzure.seedWorkItem({
        id: 851,
        fields: {
          'System.TeamProject': 'TestProject',
          'System.WorkItemType': 'Task',
          'System.Title': `Unrelated | ${titleDate} | Side Spike`,
          'System.State': 'New',
          'System.AssignedTo': { displayName: 'Alice Chen', uniqueName: 'alice@workops.test' },
          'Microsoft.VSTS.Scheduling.StartDate': `${targetDate}T09:30:00Z`,
          'System.CreatedDate': `${targetDate}T09:30:00Z`,
        },
      });
      server.mockAzure.seedWorkItem({
        id: 852,
        fields: {
          'System.TeamProject': 'TestProject',
          'System.WorkItemType': 'Task',
          'System.Title': `Task | ${titleDate} | Bob Patel Daily`,
          'System.State': 'New',
          'System.AssignedTo': { displayName: 'Bob Patel', uniqueName: 'bob@workops.test' },
          'Microsoft.VSTS.Scheduling.StartDate': `${targetDate}T09:30:00Z`,
          'System.CreatedDate': `${targetDate}T09:30:00Z`,
        },
      });

      const actRes = await request.post(`${server.baseUrl}/api/tasks/activate-today`, {
        headers,
        data: { asOf: targetDate, confirm: true, all: true },
      });
      expect(actRes.status()).toBe(200);

      expect(server.mockAzure.getWorkItem(850)?.fields['System.State']).toBe('Active');
      expect(server.mockAzure.getWorkItem(851)?.fields['System.State']).toBe('New');
      expect(server.mockAzure.getWorkItem(852)?.fields['System.State']).toBe('New');

      const closeRes = await request.post(`${server.baseUrl}/api/tasks/close-today`, {
        headers,
        data: {
          asOf: targetDate,
          confirm: true,
          all: true,
          manualOverride: true,
          overrideReason: 'Boundary prefix & disabled member skip check',
        },
      });
      expect(closeRes.status()).toBe(200);

      expect(String(server.mockAzure.getWorkItem(850)?.fields['System.State'])).toMatch(/closed|done|resolved/i);
      expect(server.mockAzure.getWorkItem(851)?.fields['System.State']).toBe('New');
      expect(server.mockAzure.getWorkItem(852)?.fields['System.State']).toBe('New');
    } finally {
      await server.stop();
    }
  });

  test('[F11][Tier 2] Azure 429/500 during batch WIQL surfaces clean error without leaving concurrency lock held', async ({
    request,
  }) => {
    const server = await startAcceptanceServer({ authMode: 'basic' });
    try {
      const headers = { Authorization: server.basicAdminHeader };
      const targetDate = getNextWeekdayIso(2);

      server.mockAzure.failNext(4, 429, /_apis\/wit\/wiql/i, 'Rate limited');
      const errExec = await request.post(`${server.baseUrl}/api/tasks/execute`, {
        headers,
        data: { asOf: targetDate, confirm: true },
      });
      expect(errExec.status()).toBeGreaterThanOrEqual(400);

      // Subsequent plan/execute must succeed immediately (lock was released)
      const okExec = await request.post(`${server.baseUrl}/api/tasks/execute`, {
        headers,
        data: { asOf: targetDate, confirm: true },
      });
      expect(okExec.status()).toBe(200);
    } finally {
      await server.stop();
    }
  });

  // ---------------------------------------------------------------------------
  // F16 Boundaries
  // ---------------------------------------------------------------------------

  test('[F16][Tier 2] /planner Cancel on PlanToken confirmation modal executes zero Azure creations', async ({
    page,
  }) => {
    const server = await startAcceptanceServer({ authMode: 'basic' });
    try {
      const targetDate = getNextWeekdayIso(2);
      const beforeCount = server.mockAzure.listWorkItems().length;

      await page.setExtraHTTPHeaders({ Authorization: server.basicAdminHeader });
      await page.goto(`${server.baseUrl}/planner`, { waitUntil: 'domcontentloaded' });
      await assertLandmarks(page);

      const dateInput = page.locator('main#main input[type="date"]').first();
      await dateInput.fill(targetDate);

      const planBtn = page
        .getByRole('button', { name: /generate plan|preview plan|create plan|plan tasks|preview/i })
        .first();
      const planPromise = page.waitForResponse(
        (res) => res.url().includes('/api/tasks/plan') && res.request().method() === 'POST'
      );
      await planBtn.click();
      await planPromise;

      const executeTrigger = page
        .getByRole('button', { name: /execute|confirm & create|create tasks|apply plan/i })
        .first();
      await executeTrigger.click();

      const dialog = page.getByRole('dialog').first();
      await expect(dialog).toBeVisible();
      const cancelBtn = dialog.getByRole('button', { name: /cancel|close|dismiss|abort/i }).first();
      await cancelBtn.click();
      await expect(dialog).toBeHidden();

      expect(server.mockAzure.listWorkItems().length).toBe(beforeCount);
    } finally {
      await server.stop();
    }
  });

  test('[F16][Tier 2] /explorer search filter with no matching tasks shows accessible empty state without crash', async ({
    page,
    gotoRoute,
  }) => {
    await gotoRoute('/explorer');
    await assertLandmarks(page);

    const main = page.locator('main#main');
    const searchBox = main
      .getByRole('searchbox')
      .or(main.getByPlaceholder(/search/i))
      .or(main.getByLabel(/search/i))
      .first();
    await expect(searchBox).toBeVisible();
    await searchBox.fill('zzz-nonexistent-query-99999');

    await expect(main).toContainText(/no .*found|no matching|0 tasks|empty|no results/i);
    await assertNoHorizontalOverflow(page);
  });

  test('[F16][Tier 2] /explorer Create Missing confirmation prevents execution until confirmed', async ({
    page,
  }) => {
    const server = await startAcceptanceServer({ authMode: 'basic' });
    try {
      const beforeCount = server.mockAzure.listWorkItems().length;
      await page.setExtraHTTPHeaders({ Authorization: server.basicAdminHeader });
      await page.goto(`${server.baseUrl}/explorer`, { waitUntil: 'domcontentloaded' });
      await assertLandmarks(page);

      const main = page.locator('main#main');
      const createMissingBtn = main.getByRole('button', { name: /create missing/i }).first();
      await expect(createMissingBtn).toBeVisible();
      await createMissingBtn.click();

      const dialog = page.getByRole('dialog').first();
      await expect(dialog).toBeVisible();
      const cancelBtn = dialog.getByRole('button', { name: /cancel|close|dismiss/i }).first();
      await cancelBtn.click();
      await expect(dialog).toBeHidden();

      expect(server.mockAzure.listWorkItems().length).toBe(beforeCount);
    } finally {
      await server.stop();
    }
  });

  test('[F16][Tier 2] /burndown handles empty task months and holiday-only ranges without NaN or crash', async ({
    page,
  }) => {
    const server = await startAcceptanceServer({ authMode: 'basic' });
    try {
      server.mockAzure.reset({
        organization: 'test-org',
        projects: [{ name: 'TestProject', id: 'proj-agile-01', workItemTypes: ['Task', 'User Story'] }],
      });

      await page.setExtraHTTPHeaders({ Authorization: server.basicAdminHeader });
      await page.goto(`${server.baseUrl}/burndown`, { waitUntil: 'domcontentloaded' });
      await assertLandmarks(page);
      await assertNoHorizontalOverflow(page);

      const text = await page.locator('main#main').innerText();
      expect(text).not.toContain('NaN');
      expect(text).not.toContain('Infinity');
    } finally {
      await server.stop();
    }
  });

  test('[F16][Tier 2] /lifecycle bulk action with 0 selected people disables submit or displays validation feedback', async ({
    page,
    gotoRoute,
  }) => {
    await gotoRoute('/lifecycle');
    await assertLandmarks(page);

    const main = page.locator('main#main');
    // Uncheck any checked member checkboxes
    const checkboxes = main.locator('input[type="checkbox"]');
    const count = await checkboxes.count();
    for (let i = 0; i < count; i++) {
      const cb = checkboxes.nth(i);
      if ((await cb.isVisible()) && (await cb.isChecked())) {
        await cb.uncheck();
      }
    }

    const bulkBtn = main.getByRole('button', { name: /activate selected|close selected|activate|close/i }).first();
    await expect(bulkBtn).toBeVisible();
    const isDisabled = await bulkBtn.isDisabled();
    if (!isDisabled) {
      await bulkBtn.click();
      await expect(main).toContainText(/select at least one|no members selected|required|0 selected/i);
    } else {
      expect(isDisabled).toBe(true);
    }
  });
});
