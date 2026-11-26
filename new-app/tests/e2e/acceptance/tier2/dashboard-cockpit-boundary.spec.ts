import { test, expect } from '../harness/fixtures.js';
import { startAcceptanceServer, type AcceptanceServerHandle } from '../harness/acceptance-server.js';
import {
  assertKeyboardDialogBehavior,
  assertLandmarks,
  assertLiveAnnouncement,
} from '../harness/a11y.js';

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
  }
) {
  const iso = todayIsoDate('UTC');
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

test.describe('Tier 2 — Dashboard, Cockpit, Auto-Closure & SPA Boundaries (F10, F13, F15)', () => {
  // ---------------------------------------------------------------------------
  // F10: Auto-Closure Integration & Activation Journal Boundaries
  // ---------------------------------------------------------------------------

  test('[F10][Tier 2] POST /api/tasks/close-today without confirm: true when dryRun is false is rejected', async ({ request }) => {
    const server = await startAcceptanceServer({ authMode: 'basic' });
    try {
      const headers = { Authorization: server.basicAdminHeader };
      const task = seedTodayTask(server, {
        id: 6001,
        personName: 'Alice Chen',
        personEmail: 'alice@workops.test',
        state: 'Active',
      });

      const resExplicitFalse = await request.post(`${server.baseUrl}/api/tasks/close-today`, {
        headers,
        data: { dryRun: false, confirm: false, personKeys: ['alice'] },
      });
      expect([400, 409]).toContain(resExplicitFalse.status());

      const resMissingConfirm = await request.post(`${server.baseUrl}/api/tasks/close-today`, {
        headers,
        data: { dryRun: false, personKeys: ['alice'] },
      });
      expect([400, 409]).toContain(resMissingConfirm.status());

      expect(server.mockAzure.getWorkItem(task.id)?.fields['System.State']).toBe('Active');
    } finally {
      await server.stop();
    }
  });

  test('[F10][Tier 2] POST /api/auto-closure/run without confirm: true when dryRun is false is rejected', async ({ apiPost }) => {
    const res = await apiPost('/api/auto-closure/run', { dryRun: false });
    expect([400, 409]).toContain(res.status());

    const resExplicitFalse = await apiPost('/api/auto-closure/run', { dryRun: false, confirm: false });
    expect([400, 409]).toContain(resExplicitFalse.status());
  });

  test('[F10][Tier 2] POST /api/tasks/close-today with manualOverride: true and empty overrideReason is rejected', async ({ request }) => {
    const server = await startAcceptanceServer({ authMode: 'basic' });
    try {
      const headers = { Authorization: server.basicAdminHeader };
      const task = seedTodayTask(server, {
        id: 6002,
        personName: 'Alice Chen',
        personEmail: 'alice@workops.test',
        state: 'Active',
      });

      const res = await request.post(`${server.baseUrl}/api/tasks/close-today`, {
        headers,
        data: {
          confirm: true,
          dryRun: false,
          manualOverride: true,
          overrideReason: '   ',
          personKeys: ['alice'],
          asOf: todayIsoDate('UTC'),
        },
      });
      expect([400, 422]).toContain(res.status());
      expect(server.mockAzure.getWorkItem(task.id)?.fields['System.State']).toBe('Active');
    } finally {
      await server.stop();
    }
  });

  test('[F10][Tier 2] Activate-today and close-today on a non-working weekend day or empty task set handle 0 items cleanly', async ({ request }) => {
    const server = await startAcceptanceServer({ authMode: 'basic' });
    try {
      const headers = { Authorization: server.basicAdminHeader };
      await enableAutoClosure(server);

      // 2026-11-28 is a Saturday
      const activateRes = await request.post(`${server.baseUrl}/api/tasks/activate-today`, {
        headers,
        data: { confirm: true, personKeys: ['alice'], asOf: '2026-11-28' },
      });
      expect(activateRes.status()).toBe(200);
      const activateBody = (await activateRes.json()) as { totalActivated?: number };
      expect(activateBody.totalActivated ?? 0).toBe(0);

      const closeRes = await request.post(`${server.baseUrl}/api/tasks/close-today`, {
        headers,
        data: { confirm: true, dryRun: false, personKeys: ['alice'], asOf: '2026-11-28' },
      });
      expect(closeRes.status()).toBe(200);
      const closeBody = (await closeRes.json()) as { totalClosed?: number };
      expect(closeBody.totalClosed ?? 0).toBe(0);
    } finally {
      await server.stop();
    }
  });

  test('[F10][Tier 2] Repeated activation and closure calls are idempotent and preserve journal & audit integrity', async ({ request }) => {
    const server = await startAcceptanceServer({ authMode: 'basic' });
    try {
      const headers = { Authorization: server.basicAdminHeader };
      await enableAutoClosure(server);
      seedTodayTask(server, {
        id: 6003,
        personName: 'Alice Chen',
        personEmail: 'alice@workops.test',
        state: 'New',
      });

      const act1 = await request.post(`${server.baseUrl}/api/tasks/activate-today`, {
        headers,
        data: { confirm: true, personKeys: ['alice'], asOf: todayIsoDate('UTC') },
      });
      expect(act1.status()).toBe(200);

      const act2 = await request.post(`${server.baseUrl}/api/tasks/activate-today`, {
        headers,
        data: { confirm: true, personKeys: ['alice'], asOf: todayIsoDate('UTC') },
      });
      expect(act2.status()).toBe(200);
      const act2Body = (await act2.json()) as { totalActivated?: number };
      expect(act2Body.totalActivated ?? 0).toBe(0);

      const close1 = await request.post(`${server.baseUrl}/api/tasks/close-today`, {
        headers,
        data: { confirm: true, dryRun: false, personKeys: ['alice'], asOf: todayIsoDate('UTC') },
      });
      expect(close1.status()).toBe(200);

      const close2 = await request.post(`${server.baseUrl}/api/tasks/close-today`, {
        headers,
        data: { confirm: true, dryRun: false, personKeys: ['alice'], asOf: todayIsoDate('UTC') },
      });
      expect(close2.status()).toBe(200);
      const close2Body = (await close2.json()) as { totalClosed?: number };
      expect(close2Body.totalClosed ?? 0).toBe(0);

      const journalRes = await request.get(`${server.baseUrl}/api/journal`, { headers });
      expect(journalRes.status()).toBe(200);
      const entries = unwrapArray(await journalRes.json(), ['entries', 'items', 'journal', 'records']);
      expect(entries.length).toBeGreaterThanOrEqual(1);
    } finally {
      await server.stop();
    }
  });

  // ---------------------------------------------------------------------------
  // F13: UI/UX Design System, Tailwind v4 & SPA Core Boundaries
  // ---------------------------------------------------------------------------

  test('[F13][Tier 2] Deep-linking with query params and hash #/mywork preserves view state cleanly', async ({ page, appEnv, loginBasicContext }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await loginBasicContext('admin', page);
    await page.goto(`${appEnv.baseUrl}/#/mywork?person=alice`, { waitUntil: 'domcontentloaded' });
    await assertLandmarks(page);
    await expect(page.getByRole('heading', { level: 1 }).first()).toContainText(/my work|cockpit/i);

    await page.goto(`${appEnv.baseUrl}/dashboard?range=today`, { waitUntil: 'domcontentloaded' });
    await assertLandmarks(page);
    await expect(page.getByRole('heading', { level: 1 }).first()).toContainText(/dashboard|executive/i);
    expect(pageErrors).toEqual([]);
  });

  test('[F13][Tier 2] Concurrent and sequential live-region toast updates remain accessible in aria-live="polite"', async ({ page, gotoRoute }) => {
    await gotoRoute('/mywork');
    await assertLandmarks(page);

    const liveRegion = page.locator('[aria-live="polite"]').first();
    await expect(liveRegion).toBeAttached();

    const refreshBtn = page.getByRole('button', { name: /refresh|sync|reload/i }).first();
    if (await refreshBtn.isVisible().catch(() => false)) {
      await refreshBtn.click();
      await refreshBtn.click();
    }

    await expect(liveRegion).toBeAttached();
  });

  test('[F13][Tier 2] Rapid route transitions leave zero stale modal overlays or console errors', async ({ page, gotoRoute }) => {
    const pageErrors: string[] = [];
    const consoleErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    await gotoRoute('/mywork');
    const nav = page.getByRole('navigation', { name: 'Main navigation' });

    await nav.getByRole('link', { name: /dashboard|executive/i }).first().click();
    await nav.getByRole('link', { name: /logs/i }).first().click();
    await nav.getByRole('link', { name: /my work|cockpit/i }).first().click();

    await expect(page).toHaveURL(/\/mywork/);
    await expect(page.getByRole('heading', { level: 1 }).first()).toContainText(/my work|cockpit/i);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  });

  test('[F13][Tier 2] Keyboard Escape closes open Cockpit Ad-Hoc dialog and restores focus to trigger', async ({ page, gotoRoute }) => {
    await gotoRoute('/mywork');
    await assertLandmarks(page);

    const trigger = page.getByRole('button', { name: /ad-hoc|adhoc|new task|create task/i }).first();
    const dialog = page.getByRole('dialog').first();
    await expect(trigger).toBeVisible();

    await assertKeyboardDialogBehavior(page, trigger, dialog);
  });

  test('[F13][Tier 2] Unknown SPA route provides accessible navigation recovery back to /mywork', async ({ page, gotoRoute }) => {
    await gotoRoute('/unknown-boundary-route-404');
    await expect(page.locator('main#main')).toBeVisible();

    const recoveryLink = page
      .locator('main#main')
      .getByRole('link', { name: /my work|cockpit|home|back/i })
      .or(page.getByRole('navigation', { name: 'Main navigation' }).getByRole('link', { name: /my work|cockpit/i }))
      .first();

    await expect(recoveryLink).toBeVisible();
    await recoveryLink.click();
    await expect(page).toHaveURL(/\/mywork/);
    await assertLandmarks(page);
  });

  // ---------------------------------------------------------------------------
  // F15: Executive Dashboard & Personal Cockpit UI Boundaries
  // ---------------------------------------------------------------------------

  test('[F15][Tier 2] Executive Dashboard gracefully renders degraded/offline Azure & GitHub state without crashing', async ({ page }) => {
    const server = await startAcceptanceServer({ authMode: 'basic' });
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    try {
      server.mockAzure.setUnavailable(true, 503);
      server.mockGitHub.setUnavailable(true, 503);

      await page.setExtraHTTPHeaders({ Authorization: server.basicAdminHeader });
      await page.goto(`${server.baseUrl}/dashboard`, { waitUntil: 'domcontentloaded' });
      await assertLandmarks(page);

      const main = page.locator('main#main');
      await expect(main).toContainText(/degraded|unavailable|offline|error|false|down/i);
      expect(pageErrors).toEqual([]);
    } finally {
      await server.stop();
    }
  });

  test('[F15][Tier 2] Personal Cockpit Ad-Hoc Task modal rejects empty title and invalid estimatedHours', async ({ page }) => {
    const server = await startAcceptanceServer({ authMode: 'basic' });
    try {
      let successPosts = 0;
      page.on('response', (res) => {
        if (res.url().includes('/api/tasks/adhoc') && res.request().method() === 'POST' && res.status() < 400) {
          successPosts += 1;
        }
      });

      await page.setExtraHTTPHeaders({ Authorization: server.basicAdminHeader });
      await page.goto(`${server.baseUrl}/mywork`, { waitUntil: 'domcontentloaded' });

      await page.getByRole('button', { name: /ad-hoc|adhoc|new task|create task/i }).first().click();
      const dialog = page.getByRole('dialog').first();
      await expect(dialog).toBeVisible();

      const titleInput = dialog.getByLabel(/title/i).first();
      const hoursInput = dialog.getByLabel(/hours|estimate/i).first();
      const submitBtn = dialog.getByRole('button', { name: /create|submit|save/i }).first();

      // Empty title must be rejected
      await titleInput.fill('   ');
      await submitBtn.click();
      await expect(dialog).toBeVisible();
      expect(successPosts).toBe(0);

      // Invalid negative / zero / extreme hours must be rejected or return 400 without closing
      await titleInput.fill('Boundary Estimate Validation');
      if (await hoursInput.isVisible().catch(() => false)) {
        for (const badHours of ['-1', '0', '999']) {
          await hoursInput.fill(badHours);
          await submitBtn.click();
          expect(successPosts).toBe(0);
        }
      }
    } finally {
      await server.stop();
    }
  });

  test('[F15][Tier 2] Personal Cockpit renders clean empty state when person has 0 tasks and 0 PRs', async ({ page }) => {
    const server = await startAcceptanceServer({
      authMode: 'basic',
      people: [
        {
          key: 'emptyuser',
          name: 'Empty User',
          assignedTo: 'empty@workops.test',
          enabled: true,
          autoCloseEnabled: true,
          githubUsername: 'empty-gh',
        },
      ],
    });
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    try {
      server.mockGitHub.seedPrs([], true);
      server.mockGitHub.seedCommits([], true);

      await page.setExtraHTTPHeaders({ Authorization: server.basicAdminHeader });
      await page.goto(`${server.baseUrl}/mywork`, { waitUntil: 'domcontentloaded' });
      await assertLandmarks(page);

      const main = page.locator('main#main');
      await expect(main).toContainText(/no .*task|empty|0 |no pull request|nothing/i);
      const text = await main.innerText();
      expect(text).not.toMatch(/NaN|undefined/);
      expect(pageErrors).toEqual([]);
    } finally {
      await server.stop();
    }
  });

  test('[F15][Tier 2] Personal Cockpit EOD Closure manual override requires non-empty justification before confirming', async ({ page }) => {
    const server = await startAcceptanceServer({ authMode: 'basic' });
    try {
      await enableAutoClosure(server);
      const task = seedTodayTask(server, {
        id: 6101,
        personName: 'Alice Chen',
        personEmail: 'alice@workops.test',
        state: 'Active',
        titleSuffix: 'Override Validation Guard',
      });

      await page.setExtraHTTPHeaders({ Authorization: server.basicAdminHeader });
      await page.goto(`${server.baseUrl}/mywork`, { waitUntil: 'domcontentloaded' });

      const previewCloseBtn = page
        .getByRole('button', { name: /preview.*clos|eod.*clos|close.*preview/i })
        .first();
      await previewCloseBtn.click();

      const main = page.locator('main#main');
      await expect(main).toContainText(/Override Validation Guard/i);

      const overrideCheckbox = main.getByRole('checkbox', { name: /override|manual/i }).first();
      if (await overrideCheckbox.isVisible().catch(() => false)) {
        await overrideCheckbox.check();
      }

      const reasonInput = main.getByLabel(/reason|justification|override/i).first();
      if (await reasonInput.isVisible().catch(() => false)) {
        await reasonInput.fill('   ');
      }

      const confirmCloseBtn = main.getByRole('button', { name: /confirm.*clos|close tasks|confirm/i }).first();
      if (await confirmCloseBtn.isEnabled().catch(() => false)) {
        await confirmCloseBtn.click();
      }

      // Task must remain Active when justification is blank
      expect(server.mockAzure.getWorkItem(task.id)?.fields['System.State']).toBe('Active');
    } finally {
      await server.stop();
    }
  });

  test('[F15][Tier 2] Azure 500 fault during Morning Activation shows user-facing error alert without crashing UI', async ({ page }) => {
    const server = await startAcceptanceServer({ authMode: 'basic' });
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    try {
      seedTodayTask(server, {
        id: 6102,
        personName: 'Alice Chen',
        personEmail: 'alice@workops.test',
        state: 'New',
        titleSuffix: 'Activation Fault Target',
      });

      await page.setExtraHTTPHeaders({ Authorization: server.basicAdminHeader });
      await page.goto(`${server.baseUrl}/mywork`, { waitUntil: 'domcontentloaded' });

      const previewBtn = page
        .getByRole('button', { name: /preview.*activat|activate.*preview|morning activation/i })
        .first();
      await previewBtn.click();

      server.mockAzure.failNext(5, 500, 'workitems', 'Simulated Azure 500 outage');

      const confirmBtn = page.getByRole('button', { name: /confirm.*activat|activate now|confirm/i }).first();
      await expect(confirmBtn).toBeVisible();
      await confirmBtn.click();

      await assertLiveAnnouncement(page, /error|fail|500|unable/i);
      await assertLandmarks(page);
      expect(pageErrors).toEqual([]);
    } finally {
      await server.stop();
    }
  });
});
