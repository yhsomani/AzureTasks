import { test, expect } from '../harness/fixtures.js';
import { startAcceptanceServer, type AcceptanceServerHandle } from '../harness/acceptance-server.js';
import { assertLandmarks, assertLiveAnnouncement, assertNoHorizontalOverflow } from '../harness/a11y.js';

function todayIsoDate(timeZone = 'UTC'): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === 'year')?.value ?? '2026';
  const m = parts.find((p) => p.type === 'month')?.value ?? '01';
  const d = parts.find((p) => p.type === 'day')?.value ?? '01';
  return `${y}-${m}-${d}`;
}

function todayTitleDate(timeZone = 'UTC'): string {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    month: 'short',
    day: 'numeric',
  }).format(new Date());
}

function seedTodayTask(
  server: AcceptanceServerHandle,
  options: {
    id: number;
    personName: string;
    personEmail: string;
    state: 'New' | 'Active' | 'Closed';
    titleSuffix?: string;
    dateIso?: string;
  }
) {
  const iso = options.dateIso ?? todayIsoDate('UTC');
  const titleDate = todayTitleDate('UTC');
  return server.mockAzure.seedWorkItem({
    id: options.id,
    fields: {
      'System.TeamProject': 'TestProject',
      'System.WorkItemType': 'Task',
      'System.Title': `Task | ${titleDate} | ${options.personName} ${options.titleSuffix ?? 'Daily Work'}`,
      'System.State': options.state,
      'System.AssignedTo': { displayName: options.personName, uniqueName: options.personEmail },
      'System.AreaPath': 'TestProject\\Platform',
      'System.IterationPath': 'TestProject\\Sprint 42',
      'Microsoft.VSTS.Scheduling.StartDate': `${iso}T09:30:00Z`,
      'Custom.PlannedStartDate': `${iso}T09:30:00Z`,
      'Microsoft.VSTS.Scheduling.OriginalEstimate': 8,
      'Microsoft.VSTS.Scheduling.RemainingWork': options.state === 'Closed' ? 0 : 4,
      'Microsoft.VSTS.Scheduling.CompletedWork': options.state === 'Closed' ? 8 : 4,
      'Microsoft.VSTS.Common.Activity': 'Development',
      'System.CreatedDate': `${iso}T09:30:00Z`,
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

function unwrapArray(payload: unknown, keys: string[]): Array<Record<string, unknown>> {
  if (Array.isArray(payload)) {
    return payload as Array<Record<string, unknown>>;
  }
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>;
    for (const key of keys) {
      if (Array.isArray(record[key])) {
        return record[key] as Array<Record<string, unknown>>;
      }
    }
    if (Array.isArray(record.data)) {
      return record.data as Array<Record<string, unknown>>;
    }
    if (record.data && typeof record.data === 'object') {
      const nested = record.data as Record<string, unknown>;
      for (const key of keys) {
        if (Array.isArray(nested[key])) {
          return nested[key] as Array<Record<string, unknown>>;
        }
      }
    }
  }
  return [];
}

async function enableAutoClosure(server: AcceptanceServerHandle): Promise<void> {
  const headers = { Authorization: server.basicAdminHeader };
  const getRes = await fetch(`${server.baseUrl}/api/auto-closure/config`, { headers });
  const cfg = getRes.ok ? ((await getRes.json()) as Record<string, unknown>) : {};
  await fetch(`${server.baseUrl}/api/auto-closure/config`, {
    method: 'PUT',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...cfg, enabled: true }),
  });
}

test.describe('Tier 1 — Dashboard, Cockpit, Auto-Closure & SPA Core (F10, F13, F15)', () => {
  // ---------------------------------------------------------------------------
  // F10: Auto-Closure Integration & Activation Journal
  // ---------------------------------------------------------------------------

  test('[F10][Tier 1] POST /api/tasks/activate-today activates New tasks and records ACTIVATED in /api/journal', async ({ request }) => {
    const server = await startAcceptanceServer({ authMode: 'basic' });
    try {
      const headers = { Authorization: server.basicAdminHeader };
      const task = seedTodayTask(server, {
        id: 5001,
        personName: 'Alice Chen',
        personEmail: 'alice@workops.test',
        state: 'New',
      });

      const res = await request.post(`${server.baseUrl}/api/tasks/activate-today`, {
        headers,
        data: { confirm: true, personKeys: ['alice'], asOf: todayIsoDate('UTC') },
      });
      expect(res.status()).toBe(200);
      const body = (await res.json()) as { totalActivated?: number };
      expect(body.totalActivated ?? 0).toBeGreaterThanOrEqual(1);

      const updated = server.mockAzure.getWorkItem(task.id);
      expect(updated?.fields['System.State']).toBe('Active');

      const journalRes = await request.get(`${server.baseUrl}/api/journal`, { headers });
      expect(journalRes.status()).toBe(200);
      const entries = unwrapArray(await journalRes.json(), ['entries', 'items', 'journal', 'records']);
      expect(
        entries.some((e) => e.personKey === 'alice' && String(e.actionType || '').toUpperCase() === 'ACTIVATED')
      ).toBe(true);
    } finally {
      await server.stop();
    }
  });

  test('[F10][Tier 1] POST /api/tasks/close-today with dryRun: true returns preview and PR/commit evidence without mutating tasks', async ({ request }) => {
    const server = await startAcceptanceServer({ authMode: 'basic' });
    try {
      const headers = { Authorization: server.basicAdminHeader };
      await enableAutoClosure(server);
      const task = seedTodayTask(server, {
        id: 5002,
        personName: 'Alice Chen',
        personEmail: 'alice@workops.test',
        state: 'Active',
      });

      const res = await request.post(`${server.baseUrl}/api/tasks/close-today`, {
        headers,
        data: { dryRun: true, personKeys: ['alice'], asOf: todayIsoDate('UTC') },
      });
      expect(res.status()).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      const text = JSON.stringify(body);
      expect(text).toMatch(/alice|Daily Work|5002/i);

      // Dry-run must NOT close the task in Azure
      expect(server.mockAzure.getWorkItem(task.id)?.fields['System.State']).toBe('Active');
    } finally {
      await server.stop();
    }
  });

  test('[F10][Tier 1] POST /api/tasks/close-today with confirm: true closes matching tasks and writes /api/auto-closure/audit', async ({ request }) => {
    const server = await startAcceptanceServer({ authMode: 'basic' });
    try {
      const headers = { Authorization: server.basicAdminHeader };
      await enableAutoClosure(server);
      const task = seedTodayTask(server, {
        id: 5003,
        personName: 'Alice Chen',
        personEmail: 'alice@workops.test',
        state: 'Active',
      });

      const res = await request.post(`${server.baseUrl}/api/tasks/close-today`, {
        headers,
        data: { confirm: true, dryRun: false, personKeys: ['alice'], asOf: todayIsoDate('UTC') },
      });
      expect(res.status()).toBe(200);

      const updated = server.mockAzure.getWorkItem(task.id);
      expect(updated?.fields['System.State']).toBe('Closed');

      const auditRes = await request.get(`${server.baseUrl}/api/auto-closure/audit`, { headers });
      expect(auditRes.status()).toBe(200);
      const auditRows = unwrapArray(await auditRes.json(), ['entries', 'logs', 'items', 'audit']);
      expect(auditRows.length).toBeGreaterThan(0);
    } finally {
      await server.stop();
    }
  });

  test('[F10][Tier 1] POST /api/tasks/close-today respects person autoCloseEnabled flag', async ({ request }) => {
    const server = await startAcceptanceServer({
      authMode: 'basic',
      people: [
        {
          key: 'alice',
          name: 'Alice Chen',
          assignedTo: 'alice@workops.test',
          enabled: true,
          autoCloseEnabled: false,
          githubUsername: 'alice-dev',
          githubRepositories: ['workops/core'],
        },
        {
          key: 'bob',
          name: 'Bob Patel',
          assignedTo: 'bob@workops.test',
          enabled: true,
          autoCloseEnabled: true,
          githubUsername: 'bob-lead',
          githubRepositories: ['workops/web'],
        },
      ],
    });
    try {
      const headers = { Authorization: server.basicAdminHeader };
      await enableAutoClosure(server);

      const aliceTask = seedTodayTask(server, {
        id: 5004,
        personName: 'Alice Chen',
        personEmail: 'alice@workops.test',
        state: 'Active',
      });
      const bobTask = seedTodayTask(server, {
        id: 5005,
        personName: 'Bob Patel',
        personEmail: 'bob@workops.test',
        state: 'Active',
      });

      const closeRes = await request.post(`${server.baseUrl}/api/tasks/close-today`, {
        headers,
        data: { confirm: true, dryRun: false, all: true, asOf: todayIsoDate('UTC') },
      });
      expect(closeRes.status()).toBe(200);

      expect(server.mockAzure.getWorkItem(aliceTask.id)?.fields['System.State']).toBe('Active');
      expect(server.mockAzure.getWorkItem(bobTask.id)?.fields['System.State']).toBe('Closed');
    } finally {
      await server.stop();
    }
  });

  test('[F10][Tier 1] Sequential activation and closure records both lifecycle outcomes in journal and audit history', async ({ request }) => {
    const server = await startAcceptanceServer({ authMode: 'basic' });
    try {
      const headers = { Authorization: server.basicAdminHeader };
      await enableAutoClosure(server);
      const task = seedTodayTask(server, {
        id: 5006,
        personName: 'Alice Chen',
        personEmail: 'alice@workops.test',
        state: 'New',
      });

      const activateRes = await request.post(`${server.baseUrl}/api/tasks/activate-today`, {
        headers,
        data: { confirm: true, personKeys: ['alice'], asOf: todayIsoDate('UTC') },
      });
      expect(activateRes.status()).toBe(200);
      expect(server.mockAzure.getWorkItem(task.id)?.fields['System.State']).toBe('Active');

      const closeRes = await request.post(`${server.baseUrl}/api/tasks/close-today`, {
        headers,
        data: { confirm: true, dryRun: false, personKeys: ['alice'], asOf: todayIsoDate('UTC') },
      });
      expect(closeRes.status()).toBe(200);
      expect(server.mockAzure.getWorkItem(task.id)?.fields['System.State']).toBe('Closed');

      const journalRes = await request.get(`${server.baseUrl}/api/journal`, { headers });
      const journalEntries = unwrapArray(await journalRes.json(), ['entries', 'items', 'journal', 'records']);
      expect(
        journalEntries.some((e) => String(e.actionType || e.action || '').toUpperCase() === 'ACTIVATED')
      ).toBe(true);

      const auditRes = await request.get(`${server.baseUrl}/api/auto-closure/audit`, { headers });
      const auditRows = unwrapArray(await auditRes.json(), ['entries', 'logs', 'items', 'audit']);
      expect(auditRows.length).toBeGreaterThan(0);
    } finally {
      await server.stop();
    }
  });

  // ---------------------------------------------------------------------------
  // F13: UI/UX Design System, Tailwind v4 & SPA Core
  // ---------------------------------------------------------------------------

  test('[F13][Tier 1] Clean URL navigation across /mywork, /dashboard, and /logs updates active view and heading', async ({ page, gotoRoute }) => {
    await gotoRoute('/mywork');
    await assertLandmarks(page);
    await assertNoHorizontalOverflow(page);

    const nav = page.getByRole('navigation', { name: 'Main navigation' });
    const h1 = page.getByRole('heading', { level: 1 }).first();

    const dashLink = nav.getByRole('link', { name: /dashboard|executive/i }).first();
    await expect(dashLink).toBeVisible();
    await dashLink.click();
    await expect(page).toHaveURL(/\/dashboard/);
    await expect(h1).toContainText(/dashboard|executive/i);

    const logsLink = nav.getByRole('link', { name: /logs/i }).first();
    await expect(logsLink).toBeVisible();
    await logsLink.click();
    await expect(page).toHaveURL(/\/logs/);
    await expect(h1).toContainText(/logs/i);

    const cockpitLink = nav.getByRole('link', { name: /my work|cockpit/i }).first();
    await expect(cockpitLink).toBeVisible();
    await cockpitLink.click();
    await expect(page).toHaveURL(/\/mywork/);
    await expect(h1).toContainText(/my work|cockpit/i);
  });

  test('[F13][Tier 1] Hash fallback routes (#/dashboard and #/mywork) resolve cleanly', async ({ page, appEnv, loginBasicContext }) => {
    await loginBasicContext('admin', page);

    await page.goto(`${appEnv.baseUrl}/#/dashboard`, { waitUntil: 'domcontentloaded' });
    await assertLandmarks(page);
    await expect(page.getByRole('heading', { level: 1 }).first()).toContainText(/dashboard|executive/i);

    await page.goto(`${appEnv.baseUrl}/#/mywork`, { waitUntil: 'domcontentloaded' });
    await assertLandmarks(page);
    await expect(page.getByRole('heading', { level: 1 }).first()).toContainText(/my work|cockpit/i);
  });

  test('[F13][Tier 1] TanStack Query mutation invalidation refreshes Cockpit UI without full page reload', async ({ page }) => {
    const server = await startAcceptanceServer({ authMode: 'basic' });
    try {
      await page.setExtraHTTPHeaders({ Authorization: server.basicAdminHeader });
      await page.goto(`${server.baseUrl}/mywork`, { waitUntil: 'domcontentloaded' });
      await page.getByLabel(/select team member/i).selectOption({ label: 'Alice Chen (Developer)' });
      await assertLandmarks(page);

      await page.evaluate(() => {
        (window as unknown as { __spaNoReloadSentinel?: string }).__spaNoReloadSentinel = 'preserved';
      });

      const adhocTrigger = page.getByRole('button', { name: /ad-hoc|adhoc|new task|create task/i }).first();
      await expect(adhocTrigger).toBeVisible();
      await adhocTrigger.click();

      const dialog = page.getByRole('dialog').first();
      await expect(dialog).toBeVisible();

      const titleInput = dialog.getByLabel(/title/i).first();
      await titleInput.fill('TanStack Invalidation Hotfix');

      const hoursInput = dialog.getByLabel(/hours|estimate/i).first();
      if (await hoursInput.isVisible().catch(() => false)) {
        await hoursInput.fill('3');
      }

      const submitBtn = dialog.getByRole('button', { name: /create|submit|save/i }).first();
      const postPromise = page.waitForResponse(
        (res) => res.url().includes('/api/tasks/adhoc') && res.request().method() === 'POST'
      );
      await submitBtn.click();
      const postRes = await postPromise;
      expect([200, 201]).toContain(postRes.status());

      await expect(page.locator('main#main')).toContainText(/TanStack Invalidation Hotfix/i);
      const sentinel = await page.evaluate(
        () => (window as unknown as { __spaNoReloadSentinel?: string }).__spaNoReloadSentinel
      );
      expect(sentinel).toBe('preserved');
    } finally {
      await server.stop();
    }
  });

  test('[F13][Tier 1] Workspace timezone date formatting is consistent and free of Invalid Date', async ({ page }) => {
    const server = await startAcceptanceServer({ authMode: 'basic', timezone: 'America/New_York' });
    try {
      await page.setExtraHTTPHeaders({ Authorization: server.basicAdminHeader });
      await page.goto(`${server.baseUrl}/mywork`, { waitUntil: 'domcontentloaded' });
      await assertLandmarks(page);

      const mainText = await page.locator('main#main').innerText();
      expect(mainText).not.toMatch(/Invalid Date|NaN/i);

      await page.goto(`${server.baseUrl}/dashboard`, { waitUntil: 'domcontentloaded' });
      await assertLandmarks(page);
      const dashText = await page.locator('main#main').innerText();
      expect(dashText).not.toMatch(/Invalid Date|NaN/i);
    } finally {
      await server.stop();
    }
  });

  test('[F13][Tier 1] Semantic landmarks and polite live-region announce user actions', async ({ page }) => {
    const server = await startAcceptanceServer({ authMode: 'basic' });
    try {
      await page.setExtraHTTPHeaders({ Authorization: server.basicAdminHeader });
      await page.goto(`${server.baseUrl}/mywork`, { waitUntil: 'domcontentloaded' });
      await assertLandmarks(page);

      const adhocTrigger = page.getByRole('button', { name: /ad-hoc|adhoc|new task|create task/i }).first();
      await adhocTrigger.click();

      const dialog = page.getByRole('dialog').first();
      await expect(dialog).toBeVisible();
      await dialog.getByLabel(/title/i).first().fill('Live Region Toast Verification');

      const submitBtn = dialog.getByRole('button', { name: /create|submit|save/i }).first();
      await submitBtn.click();

      await assertLiveAnnouncement(page, /created|success|task|live region toast/i);
    } finally {
      await server.stop();
    }
  });

  // ---------------------------------------------------------------------------
  // F15: Executive Dashboard & Personal Cockpit UI
  // ---------------------------------------------------------------------------

  test('[F15][Tier 1] /dashboard renders live /api/ready KPIs, Needs Attention insights, SVG charts, and ALM summary', async ({ page, gotoRoute }) => {
    await gotoRoute('/dashboard');
    await assertLandmarks(page);
    await assertNoHorizontalOverflow(page);

    const main = page.locator('main#main');
    await expect(main).toContainText(/database|azure|github|scheduler/i);
    await expect(main).toContainText(/attention|insight|summary|pull request|pr/i);

    const svgCount = await main.locator('svg').count();
    expect(svgCount).toBeGreaterThan(0);

    const hasChartJs = await page.evaluate(() => Boolean((window as unknown as Record<string, unknown>).Chart));
    expect(hasChartJs).toBe(false);
  });

  test('[F15][Tier 1] /mywork Personal Cockpit displays today tasks and GitHub PR evidence', async ({ page }) => {
    const server = await startAcceptanceServer({ authMode: 'basic' });
    try {
      seedTodayTask(server, {
        id: 5101,
        personName: 'Alice Chen',
        personEmail: 'alice@workops.test',
        state: 'Active',
        titleSuffix: 'Cockpit Visibility Check',
      });

      await page.setExtraHTTPHeaders({ Authorization: server.basicAdminHeader });
      await page.goto(`${server.baseUrl}/mywork`, { waitUntil: 'domcontentloaded' });
      await assertLandmarks(page);
      await assertNoHorizontalOverflow(page);

      const main = page.locator('main#main');
      await expect(main).toContainText(/Cockpit Visibility Check/i);
      await expect(main).toContainText(/today's pull requests/i);
    } finally {
      await server.stop();
    }
  });

  test('[F15][Tier 1] Personal Cockpit executes Preview-then-Confirm Morning Activation workflow', async ({ page }) => {
    const server = await startAcceptanceServer({ authMode: 'basic' });
    try {
      const task = seedTodayTask(server, {
        id: 5102,
        personName: 'Alice Chen',
        personEmail: 'alice@workops.test',
        state: 'New',
        titleSuffix: 'Morning Activation Target',
      });

      await page.setExtraHTTPHeaders({ Authorization: server.basicAdminHeader });
      await page.goto(`${server.baseUrl}/mywork`, { waitUntil: 'domcontentloaded' });

      const previewBtn = page
        .getByRole('button', { name: /preview.*activat|activate.*preview|morning activation/i })
        .first();
      await expect(previewBtn).toBeVisible();

      const previewResPromise = page.waitForResponse(
        (res) => res.url().includes('/api/tasks/activate-today') && res.request().method() === 'POST'
      );
      await previewBtn.click();
      const previewRes = await previewResPromise;
      expect(previewRes.status()).toBe(200);

      // Task must still be New after preview-only
      expect(server.mockAzure.getWorkItem(task.id)?.fields['System.State']).toBe('New');

      const confirmBtn = page.getByRole('button', { name: /confirm.*activat|activate now|confirm/i }).first();
      await expect(confirmBtn).toBeVisible();

      const confirmResPromise = page.waitForResponse(
        (res) => res.url().includes('/api/tasks/activate-today') && res.request().method() === 'POST'
      );
      await confirmBtn.click();
      const confirmRes = await confirmResPromise;
      expect(confirmRes.status()).toBe(200);

      expect(server.mockAzure.getWorkItem(task.id)?.fields['System.State']).toBe('Active');
    } finally {
      await server.stop();
    }
  });

  test('[F15][Tier 1] Personal Cockpit EOD Closure displays preview table and supports manual override justification', async ({ page }) => {
    const server = await startAcceptanceServer({ authMode: 'basic' });
    try {
      await enableAutoClosure(server);
      const task = seedTodayTask(server, {
        id: 5103,
        personName: 'Alice Chen',
        personEmail: 'alice@workops.test',
        state: 'Active',
        titleSuffix: 'EOD Override Closure Target',
      });

      await page.setExtraHTTPHeaders({ Authorization: server.basicAdminHeader });
      await page.goto(`${server.baseUrl}/mywork`, { waitUntil: 'domcontentloaded' });

      const previewCloseBtn = page
        .getByRole('button', { name: /preview.*clos|eod.*clos|close.*preview/i })
        .first();
      await expect(previewCloseBtn).toBeVisible();

      const previewPromise = page.waitForResponse(
        (res) => res.url().includes('/api/tasks/close-today') && res.request().method() === 'POST'
      );
      await previewCloseBtn.click();
      const previewRes = await previewPromise;
      expect(previewRes.status()).toBe(200);

      const main = page.locator('main#main');
      await expect(main).toContainText(/EOD Override Closure Target/i);

      const overrideCheckbox = main.getByRole('checkbox', { name: /override|manual/i }).first();
      if (await overrideCheckbox.isVisible().catch(() => false)) {
        await overrideCheckbox.check();
      }

      const reasonInput = main.getByLabel(/reason|justification|override/i).first();
      if (await reasonInput.isVisible().catch(() => false)) {
        await reasonInput.fill('Offline architecture review completed');
      }

      const confirmCloseBtn = main.getByRole('button', { name: /confirm.*clos|close tasks|confirm/i }).first();
      await expect(confirmCloseBtn).toBeVisible();

      const confirmPromise = page.waitForResponse(
        (res) => res.url().includes('/api/tasks/close-today') && res.request().method() === 'POST'
      );
      await confirmCloseBtn.click();
      const confirmRes = await confirmPromise;
      expect(confirmRes.status()).toBe(200);

      expect(server.mockAzure.getWorkItem(task.id)?.fields['System.State']).toBe('Closed');
    } finally {
      await server.stop();
    }
  });

  test('[F15][Tier 1] Personal Cockpit Ad-Hoc Task modal creates task via POST /api/tasks/adhoc', async ({ page }) => {
    const server = await startAcceptanceServer({ authMode: 'basic' });
    try {
      await page.setExtraHTTPHeaders({ Authorization: server.basicAdminHeader });
      await page.goto(`${server.baseUrl}/mywork`, { waitUntil: 'domcontentloaded' });

      await page.getByLabel(/select team member/i).selectOption({ label: 'Alice Chen (Developer)' });
      const openModalBtn = page.getByRole('button', { name: /add task/i }).first();
      await expect(openModalBtn).toBeVisible();
      await openModalBtn.click();

      const dialog = page.getByRole('dialog').first();
      await expect(dialog).toBeVisible();

      await dialog.getByLabel(/title/i).first().fill('Cockpit AdHoc Feature Deliverable');
      const hoursInput = dialog.getByLabel(/hours|estimate/i).first();
      if (await hoursInput.isVisible().catch(() => false)) {
        await hoursInput.fill('2.5');
      }

      const createPromise = page.waitForResponse(
        (res) => res.url().includes('/api/tasks/adhoc') && res.request().method() === 'POST'
      );
      await dialog.getByRole('button', { name: /add task|create|submit|save/i }).first().click();
      const createRes = await createPromise;
      expect([200, 201]).toContain(createRes.status());

      const createdInAzure = server.mockAzure
        .listWorkItems()
        .some((item) => String(item.fields['System.Title'] || '').includes('Cockpit AdHoc Feature Deliverable'));
      expect(createdInAzure).toBe(true);
      await expect(page.locator('main#main')).toContainText(/Cockpit AdHoc Feature Deliverable/i);
    } finally {
      await server.stop();
    }
  });
});
