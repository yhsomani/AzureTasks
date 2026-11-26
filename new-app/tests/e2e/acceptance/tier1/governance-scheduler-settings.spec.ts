import { test, expect } from '../harness/fixtures.js';
import { startAcceptanceServer } from '../harness/acceptance-server.js';
import { assertLandmarks, assertNoHorizontalOverflow } from '../harness/a11y.js';

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
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

test.describe('Tier 1 — Governance, Scheduler & Settings (F6, F12, F18)', () => {
  // ---------------------------------------------------------------------------
  // F6: Safe Worker Daemon & Scheduler Console
  // ---------------------------------------------------------------------------

  test('[F6][Tier 1] GET /api/scheduler returns canonical state shape', async ({ apiGet }) => {
    const res = await apiGet('/api/scheduler');
    expect(res.status()).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;

    expect(typeof body.enabled).toBe('boolean');
    expect(typeof body.running).toBe('boolean');
    expect(body.config).toBeTruthy();
    expect(typeof body.config).toBe('object');
    expect(Array.isArray(body.jobs)).toBe(true);
    expect(body.nextRuns).toBeTruthy();
    expect(typeof body.nextRuns).toBe('object');
    expect(body.lastRuns).toBeTruthy();
    expect(typeof body.lastRuns).toBe('object');
  });

  test('[F6][Tier 1] POST /api/scheduler/toggle enables and disables scheduler state', async ({ request }) => {
    const server = await startAcceptanceServer({ authMode: 'basic' });
    try {
      const headers = { Authorization: server.basicAdminHeader };

      const enableRes = await request.post(`${server.baseUrl}/api/scheduler/toggle`, {
        headers,
        data: { enabled: true },
      });
      expect(enableRes.status()).toBe(200);

      const afterEnable = await request.get(`${server.baseUrl}/api/scheduler`, { headers });
      expect(afterEnable.status()).toBe(200);
      const enabledBody = (await afterEnable.json()) as { enabled: boolean };
      expect(enabledBody.enabled).toBe(true);

      const disableRes = await request.post(`${server.baseUrl}/api/scheduler/toggle`, {
        headers,
        data: { enabled: false },
      });
      expect(disableRes.status()).toBe(200);

      const afterDisable = await request.get(`${server.baseUrl}/api/scheduler`, { headers });
      expect(afterDisable.status()).toBe(200);
      const disabledBody = (await afterDisable.json()) as { enabled: boolean };
      expect(disabledBody.enabled).toBe(false);
    } finally {
      await server.stop();
    }
  });

  test('[F6][Tier 1] POST /api/scheduler/config updates schedule time and timezone', async ({ request }) => {
    const server = await startAcceptanceServer({ authMode: 'basic' });
    try {
      const headers = { Authorization: server.basicAdminHeader };

      const updateRes = await request.post(`${server.baseUrl}/api/scheduler/config`, {
        headers,
        data: {
          startTime: '10:15',
          timezone: 'America/New_York',
          skipWeekends: true,
        },
      });
      expect(updateRes.status()).toBe(200);

      const getRes = await request.get(`${server.baseUrl}/api/scheduler`, { headers });
      expect(getRes.status()).toBe(200);
      const body = (await getRes.json()) as {
        config: Record<string, unknown>;
        nextRuns: Record<string, unknown>;
      };

      expect(body.config.timezone).toBe('America/New_York');
      const configuredTime = body.config.startTime ?? body.config.scheduleTime;
      expect(configuredTime).toBe('10:15');
      expect(body.nextRuns).toBeTruthy();
    } finally {
      await server.stop();
    }
  });

  test('[F6][Tier 1] POST /api/scheduler/run-now executes cleanly with { confirm: true, all: true }', async ({ request }) => {
    const server = await startAcceptanceServer({ authMode: 'basic' });
    try {
      const headers = { Authorization: server.basicAdminHeader };
      server.mockAzure.clearRequests();

      const res = await request.post(`${server.baseUrl}/api/scheduler/run-now`, {
        headers,
        data: { confirm: true, all: true },
      });
      expect(res.status()).toBe(200);
      const payload = (await res.json()) as Record<string, unknown>;
      expect(payload).toBeTruthy();
      expect(server.mockAzure.getRequests().length).toBeGreaterThan(0);

      const statusRes = await request.get(`${server.baseUrl}/api/scheduler`, { headers });
      expect(statusRes.status()).toBe(200);
      const statusBody = (await statusRes.json()) as { running: boolean; lastRuns: Record<string, unknown> };
      expect(statusBody.running).toBe(false);
      expect(Object.keys(statusBody.lastRuns).length).toBeGreaterThan(0);
    } finally {
      await server.stop();
    }
  });

  test('[F6][Tier 1] POST /api/scheduler/trigger-autoactive and /trigger-autoclose execute cleanly', async ({ request }) => {
    const server = await startAcceptanceServer({ authMode: 'basic' });
    try {
      const headers = { Authorization: server.basicAdminHeader };

      const activeRes = await request.post(`${server.baseUrl}/api/scheduler/trigger-autoactive`, {
        headers,
        data: {},
      });
      expect(activeRes.status()).toBe(200);

      const closeRes = await request.post(`${server.baseUrl}/api/scheduler/trigger-autoclose`, {
        headers,
        data: {},
      });
      expect(closeRes.status()).toBe(200);

      const statusRes = await request.get(`${server.baseUrl}/api/scheduler`, { headers });
      expect(statusRes.status()).toBe(200);
      const statusBody = (await statusRes.json()) as { running: boolean };
      expect(statusBody.running).toBe(false);
    } finally {
      await server.stop();
    }
  });

  test('[F6][Tier 1] GET /api/scheduler reports scheduled jobs and valid weekday nextRuns', async ({ apiGet }) => {
    const res = await apiGet('/api/scheduler');
    expect(res.status()).toBe(200);
    const body = (await res.json()) as {
      jobs: Array<Record<string, unknown>>;
      nextRuns: Record<string, unknown>;
      config: Record<string, unknown>;
    };

    expect(body.jobs.length).toBeGreaterThan(0);
    for (const val of Object.values(body.nextRuns)) {
      if (typeof val === 'string' && val.length > 0) {
        expect(Number.isNaN(Date.parse(val))).toBe(false);
      }
    }
  });

  // ---------------------------------------------------------------------------
  // F12: Complete Backend APIs & Typed Shared Contracts
  // ---------------------------------------------------------------------------

  test('[F12][Tier 1] GET /api/config and POST /api/config/settings persist all workspace fields', async ({ request }) => {
    const server = await startAcceptanceServer({ authMode: 'basic' });
    try {
      const headers = { Authorization: server.basicAdminHeader };
      const settingsPayload = {
        org: 'modern-org',
        project: '3in1_Agile_Projects',
        workItemType: '3in1 Task',
        titlePrefix: 'WorkOps |',
        timezone: 'Europe/London',
        startTime: '08:45',
        defaultState: 'Active',
        copyEstimates: false,
        resetActualWork: false,
        githubOrg: 'workops-enterprise',
        githubRepoSuffix: '-svc',
      };

      const saveRes = await request.post(`${server.baseUrl}/api/config/settings`, {
        headers,
        data: settingsPayload,
      });
      expect(saveRes.status()).toBe(200);

      const getRes = await request.get(`${server.baseUrl}/api/config`, { headers });
      expect(getRes.status()).toBe(200);
      const config = (await getRes.json()) as Record<string, unknown>;

      expect(config.org ?? config.organization).toBe('modern-org');
      expect(config.project).toBe('3in1_Agile_Projects');
      expect(config.workItemType).toBe('3in1 Task');
      expect(config.titlePrefix).toBe('WorkOps |');
      expect(config.timezone).toBe('Europe/London');
      expect(config.startTime).toBe('08:45');
      expect(config.defaultState).toBe('Active');
      expect(config.copyEstimates).toBe(false);
      expect(config.resetActualWork).toBe(false);
      expect(config.githubOrg).toBe('workops-enterprise');
      expect(config.githubRepoSuffix ?? config.githubUserSuffix).toBe('-svc');
    } finally {
      await server.stop();
    }
  });

  test('[F12][Tier 1] POST, PUT, and DELETE /api/config/people manage team member CRUD cleanly', async ({ request }) => {
    const server = await startAcceptanceServer({ authMode: 'basic' });
    try {
      const headers = { Authorization: server.basicAdminHeader };

      const createRes = await request.post(`${server.baseUrl}/api/config/people`, {
        headers,
        data: {
          key: 'carol',
          name: 'Carol Diaz',
          assignedTo: 'carol@workops.test',
          enabled: true,
          autoCloseEnabled: true,
          pod: 'POD-003 Security',
          role: 'Developer',
          githubUsername: 'carol-sec',
        },
      });
      expect([200, 201]).toContain(createRes.status());

      const afterCreateRes = await request.get(`${server.baseUrl}/api/config`, { headers });
      const afterCreate = (await afterCreateRes.json()) as { people: Array<Record<string, unknown>> };
      expect(afterCreate.people.some((p) => p.key === 'carol' && p.name === 'Carol Diaz')).toBe(true);

      const updateRes = await request.put(`${server.baseUrl}/api/config/people/carol`, {
        headers,
        data: {
          name: 'Carol Diaz-Lead',
          pod: 'POD-004 Governance',
          autoCloseEnabled: false,
        },
      });
      expect(updateRes.status()).toBe(200);

      const afterUpdateRes = await request.get(`${server.baseUrl}/api/config`, { headers });
      const afterUpdate = (await afterUpdateRes.json()) as { people: Array<Record<string, unknown>> };
      const updatedCarol = afterUpdate.people.find((p) => p.key === 'carol');
      expect(updatedCarol).toBeTruthy();
      expect(updatedCarol?.name).toBe('Carol Diaz-Lead');
      expect(updatedCarol?.pod).toBe('POD-004 Governance');
      expect(updatedCarol?.autoCloseEnabled).toBe(false);

      const deleteRes = await request.delete(`${server.baseUrl}/api/config/people/carol`, { headers });
      expect([200, 204]).toContain(deleteRes.status());

      const afterDeleteRes = await request.get(`${server.baseUrl}/api/config`, { headers });
      const afterDelete = (await afterDeleteRes.json()) as { people: Array<Record<string, unknown>> };
      expect(afterDelete.people.some((p) => p.key === 'carol')).toBe(false);
    } finally {
      await server.stop();
    }
  });

  test('[F12][Tier 1] GET /api/journal and GET /api/journal/export?format=csv|json return canonical JournalEntry schema', async ({ request }) => {
    const server = await startAcceptanceServer({ authMode: 'basic' });
    try {
      const headers = { Authorization: server.basicAdminHeader };

      const adhocRes = await request.post(`${server.baseUrl}/api/tasks/adhoc`, {
        headers,
        data: {
          personKey: 'alice',
          date: todayIsoDate(),
          title: 'Canonical Journal Schema Verification',
          estimatedHours: 4,
        },
      });
      expect([200, 201]).toContain(adhocRes.status());

      const journalRes = await request.get(`${server.baseUrl}/api/journal`, { headers });
      expect(journalRes.status()).toBe(200);
      const journalBody = await journalRes.json();
      const entries = unwrapArray(journalBody, ['entries', 'items', 'journal', 'records']);
      expect(entries.length).toBeGreaterThan(0);

      const entry = entries[0];
      for (const field of [
        'runId',
        'timestamp',
        'personKey',
        'personName',
        'operatorEmail',
        'actionType',
        'title',
        'createdWorkItemId',
        'fieldCopyStatus',
        'relationCopyStatus',
        'verified',
        'details',
      ]) {
        expect(Object.prototype.hasOwnProperty.call(entry, field), `Missing JournalEntry field: ${field}`).toBe(true);
      }

      const jsonExportRes = await request.get(`${server.baseUrl}/api/journal/export?format=json`, { headers });
      expect(jsonExportRes.status()).toBe(200);
      const jsonExportData = await jsonExportRes.json();
      const exportedEntries = unwrapArray(jsonExportData, ['entries', 'items', 'journal', 'records']);
      expect(exportedEntries.length).toBeGreaterThan(0);

      const csvExportRes = await request.get(`${server.baseUrl}/api/journal/export?format=csv`, { headers });
      expect(csvExportRes.status()).toBe(200);
      const csvText = await csvExportRes.text();
      const lines = csvText.trim().split(/\r?\n/);
      expect(lines.length).toBeGreaterThanOrEqual(2);
      expect(lines[0]).toMatch(/runId/i);
      expect(lines[0]).toMatch(/personKey/i);
      expect(lines[0]).toMatch(/actionType/i);
    } finally {
      await server.stop();
    }
  });

  test('[F12][Tier 1] POST /api/identities/resolve and GET /api/identities/diagnostics resolve seeded users', async ({ apiPost, apiGet }) => {
    const resolveRes = await apiPost('/api/identities/resolve', {
      email: 'alice@workops.test',
    });
    expect(resolveRes.status()).toBe(200);
    const resolved = await resolveRes.json();
    expect(JSON.stringify(resolved)).toMatch(/alice@workops\.test|Alice Chen/i);

    const diagRes = await apiGet('/api/identities/diagnostics');
    expect(diagRes.status()).toBe(200);
    const diagBody = await diagRes.json();
    expect(JSON.stringify(diagBody)).toMatch(/alice/i);
  });

  test('[F12][Tier 1] GET /api/github/daily-prs and GET /api/github/test-user return seeded GitHub data', async ({ apiGet }) => {
    const prsRes = await apiGet(`/api/github/daily-prs?date=${todayIsoDate()}`);
    expect(prsRes.status()).toBe(200);
    const prsBody = await prsRes.json();
    expect(JSON.stringify(prsBody)).toMatch(/daily deliverable/i);

    const userRes = await apiGet('/api/github/test-user?email=alice@workops.test');
    expect(userRes.status()).toBe(200);
    const userBody = await userRes.json();
    expect(JSON.stringify(userBody)).toMatch(/alice-dev|alice@workops\.test/i);
  });

  // ---------------------------------------------------------------------------
  // F18: Governance, Scheduler, Auto-Closure & Settings UI
  // ---------------------------------------------------------------------------

  test('[F18][Tier 1] /journal displays JournalEntry columns, stats, CSV/JSON export, and Repair Relations', async ({ page, request }) => {
    const server = await startAcceptanceServer({ authMode: 'basic' });
    try {
      const headers = { Authorization: server.basicAdminHeader };
      const adhocRes = await request.post(`${server.baseUrl}/api/tasks/adhoc`, {
        headers,
        data: {
          personKey: 'alice',
          date: todayIsoDate(),
          title: 'Journal UI Display Entry',
          estimatedHours: 3,
        },
      });
      expect([200, 201]).toContain(adhocRes.status());

      await page.setExtraHTTPHeaders(headers);
      await page.goto(`${server.baseUrl}/journal`, { waitUntil: 'domcontentloaded' });

      await assertLandmarks(page);
      await assertNoHorizontalOverflow(page);

      const main = page.locator('main#main');
      await expect(main).toContainText(/Alice Chen|alice|Journal UI Display Entry/i);
      await expect(page.getByRole('button', { name: /csv/i }).or(page.getByRole('link', { name: /csv/i })).first()).toBeVisible();
      await expect(page.getByRole('button', { name: /json/i }).or(page.getByRole('link', { name: /json/i })).first()).toBeVisible();

      const repairBtn = page.getByRole('button', { name: /repair/i }).first();
      await expect(repairBtn).toBeVisible();

      const repairResponsePromise = page.waitForResponse(
        (res) => res.url().includes('/api/tasks/repair') && res.request().method() === 'POST'
      );
      await repairBtn.click();
      const repairRes = await repairResponsePromise;
      expect(repairRes.status()).toBe(200);
    } finally {
      await server.stop();
    }
  });

  test('[F18][Tier 1] /scheduler displays jobs, toggle, schedule config, and confirm+all Run-Now', async ({ page, request }) => {
    const server = await startAcceptanceServer({ authMode: 'basic' });
    try {
      const headers = { Authorization: server.basicAdminHeader };
      await page.setExtraHTTPHeaders(headers);
      await page.goto(`${server.baseUrl}/scheduler`, { waitUntil: 'domcontentloaded' });

      await assertLandmarks(page);
      await assertNoHorizontalOverflow(page);

      const main = page.locator('main#main');
      await expect(main).toContainText(/scheduler|schedule|auto/i);

      const toggleControl = page
        .getByRole('switch')
        .or(page.getByRole('button', { name: /enable|disable|toggle|start scheduler|pause/i }))
        .first();
      await expect(toggleControl).toBeVisible();

      const toggleResPromise = page.waitForResponse(
        (res) => res.url().includes('/api/scheduler/toggle') && res.request().method() === 'POST'
      );
      await toggleControl.click();
      const toggleRes = await toggleResPromise;
      expect(toggleRes.status()).toBe(200);

      // Update and submit schedule config via UI
      const timeInput = page.getByLabel(/start\s*time|schedule\s*time|run\s*time/i).first();
      await expect(timeInput).toBeVisible();
      await timeInput.fill('10:30');

      const tzInput = page.getByLabel(/timezone/i).first();
      await expect(tzInput).toBeVisible();
      const tzTagName = await tzInput.evaluate((el) => el.tagName.toLowerCase());
      if (tzTagName === 'select') {
        await tzInput.selectOption('America/New_York');
      } else {
        await tzInput.fill('America/New_York');
      }

      const saveScheduleBtn = page
        .getByRole('button', { name: /save.*schedule|update.*schedule|save.*config|apply.*schedule/i })
        .first();
      await expect(saveScheduleBtn).toBeVisible();
      const saveCfgPromise = page.waitForResponse(
        (res) => res.url().includes('/api/scheduler/config') && res.request().method() === 'POST'
      );
      await saveScheduleBtn.click();
      const saveCfgRes = await saveCfgPromise;
      expect(saveCfgRes.status()).toBe(200);

      const afterCfgRes = await request.get(`${server.baseUrl}/api/scheduler`, { headers });
      expect(afterCfgRes.status()).toBe(200);
      const afterCfgBody = (await afterCfgRes.json()) as { config: Record<string, unknown> };
      expect(afterCfgBody.config.timezone).toBe('America/New_York');
      expect(afterCfgBody.config.startTime ?? afterCfgBody.config.scheduleTime).toBe('10:30');

      // Exercise Run-Now confirmation modal/control via UI
      server.mockAzure.clearRequests();
      const runNowBtn = page.getByRole('button', { name: /run now|run-now/i }).first();
      await expect(runNowBtn).toBeVisible();

      const runNowPromise = page.waitForResponse(
        (res) => res.url().includes('/api/scheduler/run-now') && res.request().method() === 'POST'
      );
      await runNowBtn.click();

      const dialog = page.getByRole('dialog').first();
      if (await dialog.isVisible({ timeout: 2000 }).catch(() => false)) {
        const dialogCheckboxes = dialog.getByRole('checkbox');
        const checkboxCount = await dialogCheckboxes.count();
        for (let i = 0; i < checkboxCount; i++) {
          const cb = dialogCheckboxes.nth(i);
          if (!(await cb.isChecked())) {
            await cb.check();
          }
        }
        const confirmBtn = dialog
          .getByRole('button', { name: /confirm|run\s*now|execute|proceed/i })
          .first();
        await expect(confirmBtn).toBeVisible();
        await confirmBtn.click();
      }

      const runNowRes = await runNowPromise;
      expect(runNowRes.status()).toBe(200);
      const runNowReqBody = runNowRes.request().postDataJSON() as Record<string, unknown> | null;
      expect(runNowReqBody?.confirm).toBe(true);
      expect(runNowReqBody?.all).toBe(true);
      expect(server.mockAzure.getRequests().length).toBeGreaterThan(0);
    } finally {
      await server.stop();
    }
  });

  test('[F18][Tier 1] Auto-Closure Policy Rules CRUD, Dry-Run, Confirm Run, Audit Trail, Export, and Clear', async ({ page, request }) => {
    const server = await startAcceptanceServer({ authMode: 'basic' });
    try {
      const headers = { Authorization: server.basicAdminHeader };
      await page.setExtraHTTPHeaders(headers);
      await page.goto(`${server.baseUrl}/scheduler`, { waitUntil: 'domcontentloaded' });

      await assertLandmarks(page);
      await assertNoHorizontalOverflow(page);

      const main = page.locator('main#main');
      await expect(main).toContainText(/auto.?closure|policy|audit/i);

      // Switch to Auto-Closure tab if section uses tabs
      const autoClosureTab = page.getByRole('tab', { name: /auto.?closure/i }).first();
      if (await autoClosureTab.isVisible().catch(() => false)) {
        await autoClosureTab.click();
      }

      // Edit Auto-Closure policy rules via UI
      const autoCloseEnableToggle = page
        .getByLabel(/enable.*auto.?closure|auto.?closure.*enabled/i)
        .or(page.getByRole('checkbox', { name: /auto.?closure/i }))
        .first();
      if (await autoCloseEnableToggle.isVisible().catch(() => false)) {
        if (!(await autoCloseEnableToggle.isChecked().catch(() => false))) {
          await autoCloseEnableToggle.click();
        }
      }

      const ruleNumericInput = page
        .getByLabel(/min.*commit|grace|inactivity|hours|threshold|idle/i)
        .first();
      if (await ruleNumericInput.isVisible().catch(() => false)) {
        await ruleNumericInput.fill('2');
      }

      const savePolicyBtn = page
        .getByRole('button', { name: /save.*policy|save.*rule|save.*auto.?closure|update.*policy|update.*rule/i })
        .first();
      await expect(savePolicyBtn).toBeVisible();
      const savePolicyPromise = page.waitForResponse(
        (res) => res.url().includes('/api/auto-closure/config') && res.request().method() === 'PUT'
      );
      await savePolicyBtn.click();
      const savePolicyRes = await savePolicyPromise;
      expect(savePolicyRes.status()).toBe(200);

      // Run Dry-Run via UI
      const dryRunBtn = page
        .getByRole('button', { name: /dry.?run|preview.*auto.?closure/i })
        .first();
      await expect(dryRunBtn).toBeVisible();
      const dryRunPromise = page.waitForResponse(
        (res) => res.url().includes('/api/auto-closure/run') && res.request().method() === 'POST'
      );
      await dryRunBtn.click();
      const dryRunRes = await dryRunPromise;
      expect(dryRunRes.status()).toBe(200);
      const dryRunPayload = dryRunRes.request().postDataJSON() as Record<string, unknown> | null;
      expect(dryRunPayload?.dryRun).toBe(true);

      // Confirm Run via UI
      const confirmRunTrigger = page
        .getByRole('button', { name: /run\s*auto.?closure|execute\s*auto.?closure|confirm\s*run|apply\s*auto.?closure/i })
        .first();
      await expect(confirmRunTrigger).toBeVisible();
      const confirmRunPromise = page.waitForResponse(
        (res) => res.url().includes('/api/auto-closure/run') && res.request().method() === 'POST'
      );
      await confirmRunTrigger.click();

      const confirmDialog = page.getByRole('dialog').first();
      if (await confirmDialog.isVisible({ timeout: 2000 }).catch(() => false)) {
        const dialogConfirmBtn = confirmDialog
          .getByRole('button', { name: /confirm|run|execute|proceed/i })
          .first();
        await expect(dialogConfirmBtn).toBeVisible();
        await dialogConfirmBtn.click();
      }
      const confirmRunRes = await confirmRunPromise;
      expect(confirmRunRes.status()).toBe(200);
      const confirmPayload = confirmRunRes.request().postDataJSON() as Record<string, unknown> | null;
      expect(confirmPayload?.confirm).toBe(true);
      expect(Boolean(confirmPayload?.dryRun)).toBe(false);

      // Verify audit trail populated in API & rendered in UI
      const auditRes = await request.get(`${server.baseUrl}/api/auto-closure/audit`, { headers });
      expect(auditRes.status()).toBe(200);
      const auditRows = unwrapArray(await auditRes.json(), ['entries', 'logs', 'items', 'audit']);
      expect(auditRows.length).toBeGreaterThan(0);
      await expect(main).toContainText(/audit|dry.?run|auto.?closure|completed|skipped|closed/i);

      // Export Audit via UI
      const exportAuditControl = page
        .getByRole('button', { name: /export.*audit|download.*audit/i })
        .or(page.getByRole('link', { name: /export.*audit|download.*audit/i }))
        .first();
      await expect(exportAuditControl).toBeVisible();
      const exportPromise = page.waitForResponse(
        (res) => res.url().includes('/api/auto-closure/audit/export') && res.request().method() === 'GET'
      );
      await exportAuditControl.click();
      const exportRes = await exportPromise;
      expect(exportRes.status()).toBe(200);

      // Clear Audit via UI
      const clearAuditBtn = page
        .getByRole('button', { name: /clear.*audit|delete.*audit|purge.*audit|reset.*audit/i })
        .first();
      await expect(clearAuditBtn).toBeVisible();
      const clearPromise = page.waitForResponse(
        (res) => res.url().includes('/api/auto-closure/audit') && res.request().method() === 'DELETE'
      );
      await clearAuditBtn.click();

      const clearDialog = page.getByRole('dialog').first();
      if (await clearDialog.isVisible({ timeout: 2000 }).catch(() => false)) {
        const confirmClearBtn = clearDialog
          .getByRole('button', { name: /confirm|clear|delete|proceed/i })
          .first();
        await expect(confirmClearBtn).toBeVisible();
        await confirmClearBtn.click();
      }
      const clearRes = await clearPromise;
      expect([200, 204]).toContain(clearRes.status());

      const afterClearRes = await request.get(`${server.baseUrl}/api/auto-closure/audit`, { headers });
      expect(afterClearRes.status()).toBe(200);
      const afterClearRows = unwrapArray(await afterClearRes.json(), ['entries', 'logs', 'items', 'audit']);
      expect(afterClearRows.length).toBe(0);
    } finally {
      await server.stop();
    }
  });

  test('[F18][Tier 1] /settings saves full workspace settings and keeps secrets masked', async ({ page, request }) => {
    const server = await startAcceptanceServer({ authMode: 'basic' });
    try {
      const headers = { Authorization: server.basicAdminHeader };
      await page.setExtraHTTPHeaders(headers);
      await page.goto(`${server.baseUrl}/settings`, { waitUntil: 'domcontentloaded' });

      await assertLandmarks(page);
      await assertNoHorizontalOverflow(page);

      const prefixInput = page.getByLabel(/title prefix/i).first();
      await expect(prefixInput).toBeVisible();
      await prefixInput.fill('Studio |');

      const saveBtn = page.getByRole('button', { name: /save.*settings|save configuration|save/i }).first();
      const savePromise = page.waitForResponse(
        (res) => res.url().includes('/api/config/settings') && res.request().method() === 'POST'
      );
      await saveBtn.click();
      const saveRes = await savePromise;
      expect(saveRes.status()).toBe(200);

      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(page.getByLabel(/title prefix/i).first()).toHaveValue('Studio |');

      // Exercise PAT / GitHub secret update UI form (/api/config/pat)
      const azurePatInput = page
        .getByLabel(/azure.*pat|devops.*pat|personal access token/i)
        .first();
      await expect(azurePatInput).toBeVisible();
      await expect(azurePatInput).toHaveAttribute('type', 'password');
      await azurePatInput.fill('updated-e2e-azure-pat-secret-999');

      const githubTokenInput = page.getByLabel(/github.*token|github.*pat/i).first();
      await expect(githubTokenInput).toBeVisible();
      await expect(githubTokenInput).toHaveAttribute('type', 'password');
      await githubTokenInput.fill('ghp_updated_e2e_github_secret_999');

      const savePatBtn = page
        .getByRole('button', { name: /update.*pat|save.*pat|update.*token|save.*token|save.*secret|update.*credential/i })
        .first();
      await expect(savePatBtn).toBeVisible();
      const patPromise = page.waitForResponse(
        (res) => res.url().includes('/api/config/pat') && res.request().method() === 'POST'
      );
      await savePatBtn.click();
      const patRes = await patPromise;
      expect(patRes.status()).toBe(200);

      const bodyText = await page.locator('main#main').innerText();
      expect(bodyText).not.toContain('e2e-mock-azure-pat');
      expect(bodyText).not.toContain('ghp_e2e_mock_github_token');
      expect(bodyText).not.toContain('updated-e2e-azure-pat-secret-999');
      expect(bodyText).not.toContain('ghp_updated_e2e_github_secret_999');

      const cfgRes = await request.get(`${server.baseUrl}/api/config`, { headers });
      expect(cfgRes.status()).toBe(200);
      const cfgText = await cfgRes.text();
      expect(cfgText).not.toContain('e2e-mock-azure-pat');
      expect(cfgText).not.toContain('ghp_e2e_mock_github_token');
      expect(cfgText).not.toContain('updated-e2e-azure-pat-secret-999');
      expect(cfgText).not.toContain('ghp_updated_e2e_github_secret_999');
    } finally {
      await server.stop();
    }
  });

  test('[F18][Tier 1] /settings runs connection tests, Identity Diagnostics, and shows live /api/ready telemetry', async ({ page, request }) => {
    const server = await startAcceptanceServer({ authMode: 'basic' });
    try {
      const headers = { Authorization: server.basicAdminHeader };
      await page.setExtraHTTPHeaders(headers);
      await page.goto(`${server.baseUrl}/settings`, { waitUntil: 'domcontentloaded' });
      await assertLandmarks(page);
      await assertNoHorizontalOverflow(page);

      const main = page.locator('main#main');
      await expect(main).toContainText(/database|azure|github|scheduler/i);

      const readyApiRes = await request.get(`${server.baseUrl}/api/ready`, { headers });
      expect(readyApiRes.status()).toBe(200);
      const readyBody = (await readyApiRes.json()) as {
        ready: boolean;
        checks: Record<string, unknown>;
      };
      expect(readyBody.ready).toBe(true);
      expect(readyBody.checks).toBeTruthy();

      // Test Azure Connection button in UI
      server.mockAzure.clearRequests();
      const testAzureBtn = page
        .getByRole('button', { name: /test.*azure|verify.*azure|check.*azure/i })
        .first();
      await expect(testAzureBtn).toBeVisible();
      const azureTestPromise = page.waitForResponse(
        (res) =>
          (res.url().includes('/api/ready') ||
            res.url().includes('/api/status') ||
            res.url().includes('/api/config/test') ||
            res.url().includes('/api/azure')) &&
          res.status() < 500
      );
      await testAzureBtn.click();
      const azureTestRes = await azureTestPromise;
      expect(azureTestRes.status()).toBe(200);

      // Test GitHub Connection button in UI
      server.mockGitHub.clearRequests();
      const testGithubBtn = page
        .getByRole('button', { name: /test.*github|verify.*github|check.*github/i })
        .first();
      await expect(testGithubBtn).toBeVisible();
      const ghTestPromise = page.waitForResponse(
        (res) =>
          (res.url().includes('/api/github/test-user') ||
            res.url().includes('/api/status') ||
            res.url().includes('/api/ready')) &&
          res.status() < 500
      );
      await testGithubBtn.click();
      const ghTestRes = await ghTestPromise;
      expect(ghTestRes.status()).toBe(200);

      // Identity Diagnostics
      const diagEmailInput = page.getByLabel(/identity.*email|resolve.*email|email/i).first();
      await expect(diagEmailInput).toBeVisible();
      await diagEmailInput.fill('alice@workops.test');

      const resolveBtn = page.getByRole('button', { name: /resolve|check identity|diagnose/i }).first();
      const resolvePromise = page.waitForResponse(
        (res) => res.url().includes('/api/identities/resolve') && res.request().method() === 'POST'
      );
      await resolveBtn.click();
      const resolveRes = await resolvePromise;
      expect(resolveRes.status()).toBe(200);
      await expect(main).toContainText(/Alice Chen|alice@workops\.test/i);
    } finally {
      await server.stop();
    }
  });
});
