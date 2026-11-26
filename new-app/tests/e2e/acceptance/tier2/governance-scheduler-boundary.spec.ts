import { test, expect } from '../harness/fixtures.js';
import { startAcceptanceServer } from '../harness/acceptance-server.js';
import { assertLandmarks, assertNoHorizontalOverflow } from '../harness/a11y.js';

test.describe('Tier 2 — Governance, Scheduler & Settings Boundaries (F6, F12, F18)', () => {
  // ---------------------------------------------------------------------------
  // F6: Safe Worker Daemon & Scheduler Boundaries
  // ---------------------------------------------------------------------------

  test('[F6][Tier 2] POST /api/scheduler/run-now rejects missing or partial confirmation ({}, confirm:false, all:false)', async ({
    request,
  }) => {
    const server = await startAcceptanceServer({ authMode: 'basic' });
    try {
      const headers = { Authorization: server.basicAdminHeader };
      server.mockAzure.clearRequests();

      const invalidPayloads = [
        {},
        { confirm: false, all: true },
        { confirm: true, all: false },
        { confirm: true },
        { all: true },
      ];

      for (const payload of invalidPayloads) {
        const res = await request.post(`${server.baseUrl}/api/scheduler/run-now`, {
          headers,
          data: payload,
        });
        expect([400, 409, 422], `Expected rejection for payload ${JSON.stringify(payload)}`).toContain(res.status());
      }

      const patchOrPostAzure = server.mockAzure
        .getRequests()
        .filter((r) => r.method === 'POST' && r.path.includes('/workitems/$'));
      expect(patchOrPostAzure.length).toBe(0);
    } finally {
      await server.stop();
    }
  });

  test('[F6][Tier 2] POST /api/scheduler/config rejects invalid scheduleTime, cron, and timezone', async ({
    request,
  }) => {
    const server = await startAcceptanceServer({ authMode: 'basic' });
    try {
      const headers = { Authorization: server.basicAdminHeader };

      const beforeRes = await request.get(`${server.baseUrl}/api/scheduler`, { headers });
      expect(beforeRes.status()).toBe(200);
      const beforeBody = (await beforeRes.json()) as { config: Record<string, unknown> };
      const initialTz = beforeBody.config.timezone;

      const badTimeRes = await request.post(`${server.baseUrl}/api/scheduler/config`, {
        headers,
        data: { startTime: '25:99', scheduleTime: '25:99', timezone: 'UTC' },
      });
      expect([400, 422]).toContain(badTimeRes.status());

      const badTzRes = await request.post(`${server.baseUrl}/api/scheduler/config`, {
        headers,
        data: { startTime: '09:30', timezone: 'Mars/Olympus_Mons' },
      });
      expect([400, 422]).toContain(badTzRes.status());

      const badCronRes = await request.post(`${server.baseUrl}/api/scheduler/config`, {
        headers,
        data: { cron: 'invalid-cron-expr', timezone: 'UTC' },
      });
      expect([400, 422]).toContain(badCronRes.status());

      const afterRes = await request.get(`${server.baseUrl}/api/scheduler`, { headers });
      expect(afterRes.status()).toBe(200);
      const afterBody = (await afterRes.json()) as { config: Record<string, unknown> };
      expect(afterBody.config.timezone).toBe(initialTz);
    } finally {
      await server.stop();
    }
  });

  test('[F6][Tier 2] Enabled scheduler respects non-schedule-time/weekend guard without looping continuously', async ({
    request,
  }) => {
    const server = await startAcceptanceServer({ authMode: 'basic' });
    try {
      const headers = { Authorization: server.basicAdminHeader };
      const now = new Date();
      const offHour = String((now.getUTCHours() + 6) % 24).padStart(2, '0');
      const offTime = `${offHour}:47`;

      const cfgRes = await request.post(`${server.baseUrl}/api/scheduler/config`, {
        headers,
        data: {
          startTime: offTime,
          timezone: 'UTC',
          skipWeekends: true,
        },
      });
      expect(cfgRes.status()).toBe(200);

      server.mockAzure.clearRequests();
      const toggleRes = await request.post(`${server.baseUrl}/api/scheduler/toggle`, {
        headers,
        data: { enabled: true },
      });
      expect(toggleRes.status()).toBe(200);

      await new Promise((resolve) => setTimeout(resolve, 1500));

      const statusRes = await request.get(`${server.baseUrl}/api/scheduler`, { headers });
      expect(statusRes.status()).toBe(200);
      const statusBody = (await statusRes.json()) as { enabled: boolean; running: boolean };
      expect(statusBody.enabled).toBe(true);
      expect(statusBody.running).toBe(false);

      const createdRequests = server.mockAzure
        .getRequests()
        .filter((r) => r.method === 'POST' && r.path.includes('/workitems/$'));
      expect(createdRequests.length).toBe(0);
    } finally {
      await server.stop();
    }
  });

  test('[F6][Tier 2] Rapid duplicate trigger-autoactive and trigger-autoclose requests are guarded cleanly', async ({
    request,
  }) => {
    const server = await startAcceptanceServer({ authMode: 'basic' });
    try {
      const headers = { Authorization: server.basicAdminHeader };

      const [a1, a2] = await Promise.all([
        request.post(`${server.baseUrl}/api/scheduler/trigger-autoactive`, { headers, data: {} }),
        request.post(`${server.baseUrl}/api/scheduler/trigger-autoactive`, { headers, data: {} }),
      ]);
      expect([200, 409]).toContain(a1.status());
      expect([200, 409]).toContain(a2.status());
      expect(a1.status() < 500 && a2.status() < 500).toBe(true);

      const [c1, c2] = await Promise.all([
        request.post(`${server.baseUrl}/api/scheduler/trigger-autoclose`, { headers, data: {} }),
        request.post(`${server.baseUrl}/api/scheduler/trigger-autoclose`, { headers, data: {} }),
      ]);
      expect([200, 409]).toContain(c1.status());
      expect([200, 409]).toContain(c2.status());
      expect(c1.status() < 500 && c2.status() < 500).toBe(true);

      const statusRes = await request.get(`${server.baseUrl}/api/scheduler`, { headers });
      expect(statusRes.status()).toBe(200);
      const statusBody = (await statusRes.json()) as { running: boolean };
      expect(statusBody.running).toBe(false);
    } finally {
      await server.stop();
    }
  });

  test('[F6][Tier 2] Scheduler state and configuration survive server restart cleanly', async ({ request }) => {
    const server = await startAcceptanceServer({ authMode: 'basic' });
    try {
      const headers = { Authorization: server.basicAdminHeader };

      const cfgRes = await request.post(`${server.baseUrl}/api/scheduler/config`, {
        headers,
        data: {
          startTime: '11:45',
          timezone: 'America/Chicago',
          skipWeekends: true,
        },
      });
      expect(cfgRes.status()).toBe(200);

      const toggleRes = await request.post(`${server.baseUrl}/api/scheduler/toggle`, {
        headers,
        data: { enabled: true },
      });
      expect(toggleRes.status()).toBe(200);

      await server.restart();

      const afterRes = await request.get(`${server.baseUrl}/api/scheduler`, { headers });
      expect(afterRes.status()).toBe(200);
      const afterBody = (await afterRes.json()) as {
        enabled: boolean;
        running: boolean;
        config: Record<string, unknown>;
      };

      expect(afterBody.running).toBe(false);
      expect(afterBody.enabled).toBe(true);
      expect(afterBody.config.timezone).toBe('America/Chicago');
      expect(afterBody.config.startTime ?? afterBody.config.scheduleTime).toBe('11:45');
    } finally {
      await server.stop();
    }
  });

  // ---------------------------------------------------------------------------
  // F12: Complete Backend APIs & Typed Contracts Boundaries
  // ---------------------------------------------------------------------------

  test('[F12][Tier 2] POST /api/config/settings rejects invalid timezone or empty org and preserves unmentioned fields', async ({
    request,
  }) => {
    const server = await startAcceptanceServer({ authMode: 'basic' });
    try {
      const headers = { Authorization: server.basicAdminHeader };

      const seedRes = await request.post(`${server.baseUrl}/api/config/settings`, {
        headers,
        data: {
          org: 'test-org',
          project: 'TestProject',
          workItemType: 'Task',
          titlePrefix: 'Baseline |',
          timezone: 'UTC',
        },
      });
      expect(seedRes.status()).toBe(200);

      const invalidTzRes = await request.post(`${server.baseUrl}/api/config/settings`, {
        headers,
        data: { timezone: 'Invalid/Timezone_999' },
      });
      expect([400, 422]).toContain(invalidTzRes.status());

      const emptyOrgRes = await request.post(`${server.baseUrl}/api/config/settings`, {
        headers,
        data: { org: '' },
      });
      expect([400, 422]).toContain(emptyOrgRes.status());

      // Partial update must preserve unmentioned fields
      const partialRes = await request.post(`${server.baseUrl}/api/config/settings`, {
        headers,
        data: { titlePrefix: 'UpdatedPartial |' },
      });
      expect(partialRes.status()).toBe(200);

      const getRes = await request.get(`${server.baseUrl}/api/config`, { headers });
      expect(getRes.status()).toBe(200);
      const cfg = (await getRes.json()) as Record<string, unknown>;
      expect(cfg.titlePrefix).toBe('UpdatedPartial |');
      expect(cfg.org ?? cfg.organization).toBe('test-org');
      expect(cfg.project).toBe('TestProject');
      expect(cfg.workItemType).toBe('Task');
      expect(cfg.timezone).toBe('UTC');
    } finally {
      await server.stop();
    }
  });

  test('[F12][Tier 2] PUT and DELETE /api/config/people/:key return 404 for unknown key and 400 on invalid POST payload', async ({
    apiPost,
    apiPut,
    apiDelete,
  }) => {
    const putUnknown = await apiPut('/api/config/people/unknown-member-xyz-999', {
      name: 'Ghost User',
    });
    expect(putUnknown.status()).toBe(404);

    const deleteUnknown = await apiDelete('/api/config/people/unknown-member-xyz-999');
    expect(deleteUnknown.status()).toBe(404);

    const invalidCreate = await apiPost('/api/config/people', {
      key: '',
      name: '',
    });
    expect([400, 422]).toContain(invalidCreate.status());
  });

  test('[F12][Tier 2] POST /api/auto-closure/run rejects execution without confirm: true when dryRun is false', async ({
    apiPost,
  }) => {
    const missingConfirm = await apiPost('/api/auto-closure/run', { dryRun: false });
    expect([400, 409, 422]).toContain(missingConfirm.status());

    const falseConfirm = await apiPost('/api/auto-closure/run', { dryRun: false, confirm: false });
    expect([400, 409, 422]).toContain(falseConfirm.status());

    const dryRunOk = await apiPost('/api/auto-closure/run', { dryRun: true });
    expect(dryRunOk.status()).toBe(200);
  });

  test('[F12][Tier 2] GET /api/journal/export rejects unsupported format (xml) with 400', async ({ apiGet }) => {
    const xmlRes = await apiGet('/api/journal/export?format=xml');
    expect(xmlRes.status()).toBe(400);
  });

  test('[F12][Tier 2] POST /api/identities/resolve handles empty payload and unknown email cleanly without 500', async ({
    apiPost,
  }) => {
    const emptyRes = await apiPost('/api/identities/resolve', {});
    expect(emptyRes.status()).toBeLessThan(500);
    expect([400, 422]).toContain(emptyRes.status());

    const unknownRes = await apiPost('/api/identities/resolve', {
      email: 'nobody-known-999@nonexistent.workops.test',
    });
    expect(unknownRes.status()).toBeLessThan(500);
  });

  // ---------------------------------------------------------------------------
  // F18: Governance, Scheduler & Settings UI Boundaries
  // ---------------------------------------------------------------------------

  test('[F18][Tier 2] Auditor role cannot perform destructive actions on /journal, /scheduler, or /settings', async ({
    page,
    apiPost,
    apiDelete,
    auditorHeaders,
    gotoRoute,
  }) => {
    // API RBAC enforcement
    const repairApi = await apiPost('/api/tasks/repair', {}, auditorHeaders);
    expect(repairApi.status()).toBe(403);

    const runNowApi = await apiPost('/api/scheduler/run-now', { confirm: true, all: true }, auditorHeaders);
    expect(runNowApi.status()).toBe(403);

    const clearAuditApi = await apiDelete('/api/auto-closure/audit', auditorHeaders);
    expect(clearAuditApi.status()).toBe(403);

    const saveSettingsApi = await apiPost('/api/config/settings', { titlePrefix: 'Hijack |' }, auditorHeaders);
    expect(saveSettingsApi.status()).toBe(403);

    const savePatApi = await apiPost('/api/config/pat', { azurePat: 'hijack-pat' }, auditorHeaders);
    expect(savePatApi.status()).toBe(403);

    // UI enforcement across /journal, /scheduler, /settings
    await gotoRoute('/journal', { role: 'auditor' });
    await assertLandmarks(page);
    const repairBtn = page.getByRole('button', { name: /repair/i }).first();
    if (await repairBtn.isVisible().catch(() => false)) {
      const disabled = await repairBtn.isDisabled();
      if (!disabled) {
        const resPromise = page.waitForResponse((r) => r.url().includes('/api/tasks/repair'));
        await repairBtn.click();
        const res = await resPromise;
        expect(res.status()).toBe(403);
      }
    }

    await gotoRoute('/scheduler', { role: 'auditor' });
    await assertLandmarks(page);
    const runNowBtn = page.getByRole('button', { name: /run now|run-now/i }).first();
    if (await runNowBtn.isVisible().catch(() => false)) {
      const disabled = await runNowBtn.isDisabled();
      if (!disabled) {
        const resPromise = page.waitForResponse((r) => r.url().includes('/api/scheduler/run-now'));
        await runNowBtn.click();
        const dialog = page.getByRole('dialog').first();
        if (await dialog.isVisible({ timeout: 1000 }).catch(() => false)) {
          await dialog.getByRole('button', { name: /confirm|run|execute/i }).first().click();
        }
        const res = await resPromise;
        expect(res.status()).toBe(403);
      }
    }

    await gotoRoute('/settings', { role: 'auditor' });
    await assertLandmarks(page);
    const saveSettingsBtn = page.getByRole('button', { name: /save.*settings|save configuration/i }).first();
    if (await saveSettingsBtn.isVisible().catch(() => false)) {
      const disabled = await saveSettingsBtn.isDisabled();
      if (!disabled) {
        const resPromise = page.waitForResponse((r) => r.url().includes('/api/config/settings'));
        await saveSettingsBtn.click();
        const res = await resPromise;
        expect(res.status()).toBe(403);
      }
    }
  });

  test('[F18][Tier 2] /journal with 0 matching filter rows renders clean empty state without errors', async ({
    page,
    gotoRoute,
  }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await gotoRoute('/journal');
    await assertLandmarks(page);
    await assertNoHorizontalOverflow(page);

    const main = page.locator('main#main');
    const filterInput = main
      .getByRole('searchbox')
      .or(main.getByPlaceholder(/search|filter/i))
      .or(main.getByLabel(/search|filter|person|query/i))
      .first();
    await expect(filterInput).toBeVisible();
    await filterInput.fill('__NONEXISTENT_JOURNAL_QUERY_ZZZ_999__');

    await expect(main).toContainText(/no\s+(matching\s+)?(journal|entries|records|results)|empty|0\s+entries/i);
    await assertNoHorizontalOverflow(page);
    expect(pageErrors).toEqual([]);
  });

  test('[F18][Tier 2] /settings secret inputs remain masked and submitting blank PAT does not overwrite existing PAT', async ({
    page,
    request,
  }) => {
    const server = await startAcceptanceServer({ authMode: 'basic' });
    try {
      const headers = { Authorization: server.basicAdminHeader };
      await page.setExtraHTTPHeaders(headers);
      await page.goto(`${server.baseUrl}/settings`, { waitUntil: 'domcontentloaded' });

      await assertLandmarks(page);

      const azurePatInput = page
        .getByLabel(/azure.*pat|devops.*pat|personal access token/i)
        .first();
      await expect(azurePatInput).toBeVisible();
      await expect(azurePatInput).toHaveAttribute('type', 'password');
      const currentPatValue = await azurePatInput.inputValue();
      expect(currentPatValue).not.toContain('e2e-mock-azure-pat');

      const githubTokenInput = page.getByLabel(/github.*token|github.*pat/i).first();
      await expect(githubTokenInput).toBeVisible();
      await expect(githubTokenInput).toHaveAttribute('type', 'password');
      const currentGhValue = await githubTokenInput.inputValue();
      expect(currentGhValue).not.toContain('ghp_e2e_mock_github_token');

      // Clear both inputs and attempt submit
      await azurePatInput.fill('');
      await githubTokenInput.fill('');
      const savePatBtn = page
        .getByRole('button', { name: /update.*pat|save.*pat|update.*token|save.*token|save.*secret|update.*credential/i })
        .first();
      await expect(savePatBtn).toBeVisible();
      if (await savePatBtn.isEnabled()) {
        await savePatBtn.click();
      }

      // Existing stored credentials must remain intact and functional
      const resolveRes = await request.post(`${server.baseUrl}/api/identities/resolve`, {
        headers,
        data: { email: 'alice@workops.test' },
      });
      expect(resolveRes.status()).toBe(200);

      const ghRes = await request.get(`${server.baseUrl}/api/github/test-user?email=alice@workops.test`, { headers });
      expect(ghRes.status()).toBe(200);
    } finally {
      await server.stop();
    }
  });

  test('[F18][Tier 2] /scheduler Auto-Closure rule validation rejects invalid negative threshold/hours', async ({
    page,
    request,
  }) => {
    const server = await startAcceptanceServer({ authMode: 'basic' });
    try {
      const headers = { Authorization: server.basicAdminHeader };

      // API boundary rejection for invalid numeric rules
      const badConfigRes = await request.put(`${server.baseUrl}/api/auto-closure/config`, {
        headers,
        data: {
          enabled: true,
          minCommits: -5,
          graceHours: -10,
          inactivityHours: -1,
          maxPendingHours: -2,
        },
      });
      expect([400, 422]).toContain(badConfigRes.status());

      await page.setExtraHTTPHeaders(headers);
      await page.goto(`${server.baseUrl}/scheduler`, { waitUntil: 'domcontentloaded' });
      await assertLandmarks(page);

      const autoClosureTab = page.getByRole('tab', { name: /auto.?closure/i }).first();
      if (await autoClosureTab.isVisible().catch(() => false)) {
        await autoClosureTab.click();
      }

      const ruleInput = page
        .getByLabel(/min.*commit|grace|inactivity|hours|threshold|idle/i)
        .first();
      if (await ruleInput.isVisible().catch(() => false)) {
        await ruleInput.fill('-5');
        const savePolicyBtn = page
          .getByRole('button', { name: /save.*policy|save.*rule|save.*auto.?closure|update.*policy|update.*rule/i })
          .first();
        await expect(savePolicyBtn).toBeVisible();

        let putStatus: number | null = null;
        page.once('response', (res) => {
          if (res.url().includes('/api/auto-closure/config') && res.request().method() === 'PUT') {
            putStatus = res.status();
          }
        });
        await savePolicyBtn.click();
        await page.waitForTimeout(400);

        // Either native/client validation blocked the PUT, or server rejected with 400/422
        if (putStatus !== null) {
          expect([400, 422]).toContain(putStatus);
        } else {
          const isInvalid = await ruleInput.evaluate((el) => {
            const input = el as HTMLInputElement;
            return !input.checkValidity();
          });
          const hasAlert = await page
            .locator('[role="alert"], [aria-live="polite"]')
            .first()
            .isVisible()
            .catch(() => false);
          expect(isInvalid || hasAlert).toBe(true);
        }
      }
    } finally {
      await server.stop();
    }
  });

  test('[F18][Tier 2] /settings Identity Diagnostics surfaces clean error banner when MockAzureServer fails', async ({
    page,
  }) => {
    const server = await startAcceptanceServer({ authMode: 'basic' });
    try {
      const headers = { Authorization: server.basicAdminHeader };
      await page.setExtraHTTPHeaders(headers);
      await page.goto(`${server.baseUrl}/settings`, { waitUntil: 'domcontentloaded' });
      await assertLandmarks(page);

      server.mockAzure.failNext(3, 500, '/identities', 'Injected Azure Identity failure');

      const diagEmailInput = page.getByLabel(/identity.*email|resolve.*email|email/i).first();
      await expect(diagEmailInput).toBeVisible();
      await diagEmailInput.fill('alice@workops.test');

      const resolveBtn = page.getByRole('button', { name: /resolve|check identity|diagnose/i }).first();
      const resolvePromise = page.waitForResponse(
        (res) => res.url().includes('/api/identities/resolve') && res.request().method() === 'POST'
      );
      await resolveBtn.click();
      const resolveRes = await resolvePromise;
      expect(resolveRes.status()).toBeGreaterThanOrEqual(400);

      await expect(
        page.locator('main#main, [role="alert"], [aria-live="polite"]').first()
      ).toContainText(/error|failed|unavailable|unable|could not/i);
    } finally {
      await server.stop();
    }
  });
});
