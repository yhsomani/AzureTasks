import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '../harness/fixtures.js';
import { startAcceptanceServer } from '../harness/acceptance-server.js';
import { assertLandmarks, assertNoHorizontalOverflow } from '../harness/a11y.js';
import { createMockAzureDataDb } from '../mocks/mock-azure-data-db.js';

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

test.describe('Tier 2 — Azure Read-Only DB & ALM Intelligence Boundaries (F7, F19)', () => {
  // ---------------------------------------------------------------------------
  // F7: Azure Read-Only DB Safety, Sync & Readiness Boundaries
  // ---------------------------------------------------------------------------

  test('[F7][Tier 2] Missing AZURE_DATA_DB degrades /api/ready and /api/azure-data/* gracefully while /api/health stays 200 ok', async ({
    request,
  }) => {
    const server = await startAcceptanceServer({ authMode: 'basic' });
    try {
      const missingPath = path.join(server.tempDir, 'nonexistent-azure-data.db');
      await server.restart({ envOverrides: { AZURE_DATA_DB: missingPath } });

      const headers = { Authorization: server.basicAdminHeader };
      const healthRes = await request.get(`${server.baseUrl}/api/health`);
      expect(healthRes.status()).toBe(200);
      expect(((await healthRes.json()) as { status: string }).status).toBe('ok');

      const readyRes = await request.get(`${server.baseUrl}/api/ready`, { headers });
      expect([200, 503]).toContain(readyRes.status());

      const projectsRes = await request.get(`${server.baseUrl}/api/azure-data/projects`, { headers });
      expect(projectsRes.status()).not.toBe(500);
      expect([200, 404, 503]).toContain(projectsRes.status());

      const overviewRes = await request.get(`${server.baseUrl}/api/azure-data/overview`, { headers });
      expect(overviewRes.status()).not.toBe(500);
      expect([200, 404, 503]).toContain(overviewRes.status());
    } finally {
      await server.stop();
    }
  });

  test('[F7][Tier 2] Corrupt/unreadable azure-data.db fails safely without crashing Node server', async ({
    request,
  }) => {
    const server = await startAcceptanceServer({ authMode: 'basic' });
    try {
      const corruptDbPath = path.join(server.tempDir, 'corrupt-azure-data.db');
      fs.writeFileSync(corruptDbPath, 'CORRUPT_NON_SQLITE_BYTES_0000_INVALID_HEADER', 'utf8');
      await server.restart({ envOverrides: { AZURE_DATA_DB: corruptDbPath } });

      const headers = { Authorization: server.basicAdminHeader };

      const projectsRes = await request.get(`${server.baseUrl}/api/azure-data/projects`, { headers });
      expect([200, 500, 503]).toContain(projectsRes.status());

      const teamsRes = await request.get(`${server.baseUrl}/api/azure-data/teams`, { headers });
      expect([200, 500, 503]).toContain(teamsRes.status());

      // Process must remain alive and healthy after corrupt DB queries
      const healthAfter = await request.get(`${server.baseUrl}/api/health`);
      expect(healthAfter.status()).toBe(200);
      expect(((await healthAfter.json()) as { status: string }).status).toBe('ok');
    } finally {
      await server.stop();
    }
  });

  test('[F7][Tier 2] Read-only 0444 DB inside read-only 0555 parent directory serves queries with zero WAL/SHM creation', async ({
    request,
  }) => {
    const server = await startAcceptanceServer({ authMode: 'basic' });
    const roDir = path.join(server.tempDir, 'ro-azure-dir');
    const roDbPath = path.join(roDir, 'azure-data.db');

    try {
      createMockAzureDataDb(roDbPath, { readOnly: true, teamCount: 260 });
      fs.chmodSync(roDir, 0o555);

      await server.restart({ envOverrides: { AZURE_DATA_DB: roDbPath } });

      const headers = { Authorization: server.basicAdminHeader };
      const projRes = await request.get(`${server.baseUrl}/api/azure-data/projects`, { headers });
      expect(projRes.status()).toBe(200);

      const overviewRes = await request.get(`${server.baseUrl}/api/azure-data/overview`, { headers });
      expect(overviewRes.status()).toBe(200);

      const teamsRes = await request.get(`${server.baseUrl}/api/azure-data/teams?limit=10&offset=0`, { headers });
      expect(teamsRes.status()).toBe(200);

      const dirEntries = fs.readdirSync(roDir);
      expect(dirEntries).toEqual(['azure-data.db']);
      expect(fs.existsSync(`${roDbPath}-wal`)).toBe(false);
      expect(fs.existsSync(`${roDbPath}-shm`)).toBe(false);
    } finally {
      try {
        if (fs.existsSync(roDir)) fs.chmodSync(roDir, 0o755);
        if (fs.existsSync(roDbPath)) fs.chmodSync(roDbPath, 0o644);
      } catch {
        // ignore cleanup permission errors
      }
      await server.stop();
    }
  });

  test('[F7][Tier 2] Pagination boundaries (limit=-1, limit=99999, offset=99999, non-numeric) are clamped/validated cleanly', async ({
    apiGet,
  }) => {
    const boundaryQueries = [
      '/api/azure-data/teams?limit=-1&offset=-5',
      '/api/azure-data/teams?limit=99999&offset=0',
      '/api/azure-data/teams?limit=10&offset=99999',
      '/api/azure-data/teams?limit=abc&offset=xyz',
      '/api/azure-data/work-items/unassigned?limit=-1&offset=99999',
      '/api/azure-data/work-items/unassigned?limit=99999&offset=0',
    ];

    for (const url of boundaryQueries) {
      const res = await apiGet(url);
      expect(res.status(), `Unexpected 5xx for ${url}`).toBeLessThan(500);
      expect([200, 400, 422]).toContain(res.status());

      if (res.status() === 200) {
        const body = await res.json();
        const items = unwrapArray(body, ['teams', 'workItems', 'items', 'rows', 'data']);
        if (url.includes('limit=99999')) {
          expect(items.length).toBeLessThanOrEqual(500);
        }
        if (url.includes('offset=99999')) {
          expect(items.length).toBe(0);
        }
      }
    }
  });

  test('[F7][Tier 2] SQL-injection-like search strings on /teams and /work-items/unassigned are safely parameterized', async ({
    apiGet,
  }) => {
    const payloads = [
      "'; DROP TABLE azure_teams; --",
      "' OR '1'='1",
      "'; DELETE FROM work_items; --",
    ];

    for (const payload of payloads) {
      const teamsRes = await apiGet(`/api/azure-data/teams?search=${encodeURIComponent(payload)}`);
      expect(teamsRes.status()).toBe(200);
      const teamItems = unwrapArray(await teamsRes.json(), ['teams', 'items', 'rows', 'data']);
      expect(teamItems.length).toBe(0);

      const unassignedRes = await apiGet(
        `/api/azure-data/work-items/unassigned?search=${encodeURIComponent(payload)}`
      );
      expect(unassignedRes.status()).toBe(200);
      const unassignedItems = unwrapArray(await unassignedRes.json(), ['workItems', 'items', 'rows', 'data']);
      expect(unassignedItems.length).toBe(0);
    }

    // Verify seeded tables remain completely intact
    const verifyTeams = await apiGet('/api/azure-data/teams?limit=10&offset=0');
    expect(verifyTeams.status()).toBe(200);
    const verifyBody = (await verifyTeams.json()) as Record<string, unknown>;
    expect(Number(verifyBody.total ?? verifyBody.totalCount ?? 260)).toBeGreaterThanOrEqual(260);
  });

  // ---------------------------------------------------------------------------
  // F19: Azure ALM Intelligence & Sprint Progress UI Boundaries
  // ---------------------------------------------------------------------------

  test('[F19][Tier 2] /azure-teams search with zero matching PODs renders clean empty state and disables pagination', async ({
    page,
    gotoRoute,
  }) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    await gotoRoute('/azure-teams');
    await assertLandmarks(page);
    await assertNoHorizontalOverflow(page);

    const main = page.locator('main#main');
    const searchInput = main
      .getByRole('searchbox')
      .or(main.getByPlaceholder(/search/i))
      .or(main.getByLabel(/search/i))
      .first();
    await expect(searchInput).toBeVisible();

    const searchPromise = page.waitForResponse(
      (res) =>
        res.url().includes('/api/azure-data/teams') &&
        res.url().includes('NONEXISTENT_POD_XYZ_9999') &&
        res.status() === 200
    );
    await searchInput.fill('NONEXISTENT_POD_XYZ_9999');
    await searchPromise;

    await expect(main).toContainText(/no\s+(matching\s+)?(teams|pods|results)|0\s+teams|empty/i);

    const prevBtn = main.getByRole('button', { name: /prev/i }).first();
    if (await prevBtn.isVisible().catch(() => false)) {
      await expect(prevBtn).toBeDisabled();
    }
    const nextBtn = main.getByRole('button', { name: /next/i }).first();
    if (await nextBtn.isVisible().catch(() => false)) {
      await expect(nextBtn).toBeDisabled();
    }

    expect(pageErrors).toEqual([]);
  });

  test('[F19][Tier 2] /azure-teams navigating to boundary/last page across 260 teams disables Next button cleanly', async ({
    page,
    gotoRoute,
  }) => {
    await gotoRoute('/azure-teams');
    await assertLandmarks(page);

    const main = page.locator('main#main');
    const prevBtn = main.getByRole('button', { name: /prev/i }).first();
    const nextBtn = main.getByRole('button', { name: /next/i }).first();

    await expect(prevBtn).toBeDisabled();
    await expect(nextBtn).toBeEnabled();

    // Maximize page size if a selector exists to traverse quickly
    const pageSizeSelect = main.getByLabel(/page\s*size|per\s*page|rows|limit/i).first();
    if (await pageSizeSelect.isVisible().catch(() => false)) {
      const maxVal = await pageSizeSelect.evaluate((el) => {
        if (el.tagName.toLowerCase() !== 'select') return '';
        const opts = Array.from((el as HTMLSelectElement).options)
          .map((o) => ({ val: o.value, num: parseInt(o.value, 10) || 0 }))
          .sort((a, b) => b.num - a.num);
        return opts[0]?.val ?? '';
      });
      if (maxVal) {
        await pageSizeSelect.selectOption(maxVal);
      }
    }

    const lastBtn = main.getByRole('button', { name: /^last$/i }).first();
    if (await lastBtn.isVisible().catch(() => false)) {
      await lastBtn.click();
    } else {
      for (let step = 0; step < 30; step++) {
        if (await nextBtn.isDisabled().catch(() => true)) break;
        const pageResPromise = page.waitForResponse(
          (res) => res.url().includes('/api/azure-data/teams') && res.status() === 200
        );
        await nextBtn.click();
        await pageResPromise;
      }
    }

    await expect(nextBtn).toBeDisabled();
    await expect(prevBtn).toBeEnabled();
    await expect(main).toContainText(/POD-260/i);
  });

  test('[F19][Tier 2] /unassigned assigning work item with empty/invalid assignee is rejected with validation', async ({
    page,
    apiPost,
    gotoRoute,
  }) => {
    // API validation checks
    const emptyAssigneeRes = await apiPost('/api/azure-data/work-items/assign', {
      workItemId: 8001,
      assignee: '',
    });
    expect([400, 422]).toContain(emptyAssigneeRes.status());

    const unknownItemRes = await apiPost('/api/azure-data/work-items/assign', {
      workItemId: 9999999,
      assignee: 'alice@workops.test',
    });
    expect([400, 404, 422]).toContain(unknownItemRes.status());

    // UI validation check
    await gotoRoute('/unassigned');
    await assertLandmarks(page);
    const main = page.locator('main#main');
    await expect(main).toContainText(/Unassigned Triage Item/i);

    const assigneeSelect = main.getByRole('combobox').first();
    if (await assigneeSelect.isVisible().catch(() => false)) {
      const hasBlankOpt = await assigneeSelect.evaluate((el) => {
        const opts = Array.from((el as HTMLSelectElement).options);
        return opts.some((o) => o.value === '');
      });
      if (hasBlankOpt) {
        await assigneeSelect.selectOption('');
      }
    }

    const assignBtn = main.getByRole('button', { name: /assign/i }).first();
    await expect(assignBtn).toBeVisible();
    if (await assignBtn.isDisabled()) {
      await expect(assignBtn).toBeDisabled();
    } else {
      let assignSucceeded = false;
      page.on('response', (res) => {
        if (res.url().includes('/api/azure-data/work-items/assign') && res.status() === 200) {
          assignSucceeded = true;
        }
      });
      await assignBtn.click();
      await page.waitForTimeout(400);
      expect(assignSucceeded).toBe(false);
    }
  });

  test('[F19][Tier 2] /azure-overview, /azure-builds, and /sprint-progress render graceful empty/degraded UI when azure-data.db is missing', async ({
    page,
  }) => {
    const server = await startAcceptanceServer({ authMode: 'basic' });
    const pageErrors: string[] = [];
    page.on('pageerror', (err) => pageErrors.push(err.message));

    try {
      const missingPath = path.join(server.tempDir, 'missing-ui-azure-data.db');
      await server.restart({ envOverrides: { AZURE_DATA_DB: missingPath } });

      await page.setExtraHTTPHeaders({ Authorization: server.basicAdminHeader });

      for (const route of ['/azure-overview', '/azure-builds', '/sprint-progress']) {
        await page.goto(`${server.baseUrl}${route}`, { waitUntil: 'domcontentloaded' });
        await assertLandmarks(page);
        await assertNoHorizontalOverflow(page);

        const main = page.locator('main#main');
        await expect(main).toContainText(
          /unavailable|not\s+found|no\s+data|empty|sync|missing|azure\s+data|error/i
        );
      }

      expect(pageErrors).toEqual([]);
    } finally {
      await server.stop();
    }
  });

  test('[F19][Tier 2] Switching project in /azure-overview and /sprint-progress updates metrics cleanly without stale cross-project leakage', async ({
    page,
    gotoRoute,
  }) => {
    await gotoRoute('/azure-overview');
    await assertLandmarks(page);

    const main = page.locator('main#main');
    const overviewSelect = main
      .getByRole('combobox', { name: /project/i })
      .or(main.getByLabel(/project/i))
      .first();
    await expect(overviewSelect).toBeVisible();

    await overviewSelect.selectOption({ label: 'TestProject' }).catch(async () => {
      await overviewSelect.selectOption('proj-agile-01');
    });
    const firstSnapshot = await main.innerText();

    await overviewSelect.selectOption({ label: '3_in_1_AppFrontEnd_Tasks' }).catch(async () => {
      await overviewSelect.selectOption('proj-frontend-02');
    });
    await expect
      .poll(async () => main.innerText(), { timeout: 5000 })
      .not.toBe(firstSnapshot);
    await expect(main).toContainText(/3_in_1_AppFrontEnd_Tasks|proj-frontend-02/i);

    // Verify /sprint-progress project switch clears TestProject-only Sprint 41
    await gotoRoute('/sprint-progress');
    await assertLandmarks(page);

    const sprintSelect = main
      .getByRole('combobox', { name: /project/i })
      .or(main.getByLabel(/project/i))
      .first();
    if (await sprintSelect.isVisible().catch(() => false)) {
      await sprintSelect.selectOption({ label: 'TestProject' }).catch(async () => {
        await sprintSelect.selectOption('proj-agile-01');
      });
      await expect(main).toContainText(/Sprint 41/i);

      await sprintSelect.selectOption({ label: '3_in_1_AppFrontEnd_Tasks' }).catch(async () => {
        await sprintSelect.selectOption('proj-frontend-02');
      });
      await expect(main).toContainText(/Sprint 42/i);
      await expect(main).not.toContainText(/TestProject\\Sprint 41|\bSprint 41\b/i);
    }
  });
});
