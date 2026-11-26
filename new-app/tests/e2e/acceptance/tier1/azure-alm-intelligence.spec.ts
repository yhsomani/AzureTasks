import fs from 'node:fs';
import { test, expect } from '../harness/fixtures.js';
import { startAcceptanceServer } from '../harness/acceptance-server.js';
import { assertLandmarks, assertNoHorizontalOverflow } from '../harness/a11y.js';

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

function extractTotal(payload: unknown, fallbackLength: number): number {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const record = payload as Record<string, unknown>;
    if (typeof record.total === 'number') return record.total;
    if (typeof record.totalCount === 'number') return record.totalCount;
    if (typeof record.count === 'number') return record.count;
  }
  return fallbackLength;
}

test.describe('Tier 1 — Azure Read-Only DB Safety, Readiness & ALM Intelligence (F7, F19)', () => {
  // ---------------------------------------------------------------------------
  // F7: Azure Read-Only DB Safety, Sync & Readiness
  // ---------------------------------------------------------------------------

  test('[F7][Tier 1] App starts and serves /api/azure-data/* cleanly when azure-data.db is 0444 read-only without WAL/SHM', async ({
    request,
  }) => {
    const server = await startAcceptanceServer({ authMode: 'basic', readOnlyAzureDb: true });
    try {
      const statBefore = fs.statSync(server.azureDataDbPath);
      expect(statBefore.mode & 0o777).toBe(0o444);
      expect(fs.existsSync(`${server.azureDataDbPath}-wal`)).toBe(false);
      expect(fs.existsSync(`${server.azureDataDbPath}-shm`)).toBe(false);

      const headers = { Authorization: server.basicAdminHeader };
      const endpoints = [
        '/api/azure-data/projects',
        '/api/azure-data/overview',
        '/api/azure-data/teams?limit=10&offset=0',
        '/api/azure-data/sprints',
        '/api/azure-data/work-items/unassigned?limit=10&offset=0',
      ];

      for (const ep of endpoints) {
        const res = await request.get(`${server.baseUrl}${ep}`, { headers });
        expect(res.status(), `Expected 200 on ${ep} with 0444 DB`).toBe(200);
      }

      const statAfter = fs.statSync(server.azureDataDbPath);
      expect(statAfter.mode & 0o777).toBe(0o444);
      expect(statAfter.mtimeMs).toBe(statBefore.mtimeMs);
      expect(fs.existsSync(`${server.azureDataDbPath}-wal`)).toBe(false);
      expect(fs.existsSync(`${server.azureDataDbPath}-shm`)).toBe(false);
    } finally {
      await server.stop();
    }
  });

  test('[F7][Tier 1] GET /api/ready reports database, azure, github, and scheduler checks accurately when azure-data.db is present', async ({
    apiGet,
  }) => {
    const healthRes = await apiGet('/api/health');
    expect(healthRes.status()).toBe(200);
    const healthBody = (await healthRes.json()) as Record<string, unknown>;
    expect(healthBody.status).toBe('ok');
    expect(typeof healthBody.uptimeSeconds).toBe('number');
    expect(typeof healthBody.timestamp).toBe('string');

    const readyRes = await apiGet('/api/ready');
    expect(readyRes.status()).toBe(200);
    const readyBody = (await readyRes.json()) as {
      ready: boolean;
      checks: Record<string, unknown>;
      details?: Record<string, unknown>;
    };

    expect(readyBody.ready).toBe(true);
    expect(readyBody.checks).toBeTruthy();
    for (const key of ['database', 'azure', 'github', 'scheduler']) {
      expect(Object.prototype.hasOwnProperty.call(readyBody.checks, key), `Missing readiness check: ${key}`).toBe(true);
    }
  });

  test('[F7][Tier 1] GET /api/azure-data/projects returns seeded projects (TestProject, 3_in_1_AppFrontEnd_Tasks)', async ({
    apiGet,
  }) => {
    const res = await apiGet('/api/azure-data/projects');
    expect(res.status()).toBe(200);
    const body = await res.json();
    const projects = unwrapArray(body, ['projects', 'items', 'data', 'rows']);
    expect(projects.length).toBeGreaterThanOrEqual(2);

    const names = projects.map((p) => String(p.name ?? p.projectName ?? ''));
    expect(names).toContain('TestProject');
    expect(names).toContain('3_in_1_AppFrontEnd_Tasks');
  });

  test('[F7][Tier 1] GET /api/azure-data/overview, builds/health, pipelines/runs, releases, and tests/health return seeded metrics without modifying DB', async ({
    request,
  }) => {
    const server = await startAcceptanceServer({ authMode: 'basic', readOnlyAzureDb: true });
    try {
      const statBefore = fs.statSync(server.azureDataDbPath);
      const headers = { Authorization: server.basicAdminHeader };

      const overviewRes = await request.get(`${server.baseUrl}/api/azure-data/overview`, { headers });
      expect(overviewRes.status()).toBe(200);
      const overviewText = JSON.stringify(await overviewRes.json());
      expect(overviewText).toMatch(/TestProject|proj-agile-01|work_items|workItems/i);

      const buildsRes = await request.get(`${server.baseUrl}/api/azure-data/builds/health`, { headers });
      expect(buildsRes.status()).toBe(200);
      const buildsBody = await buildsRes.json();
      expect(JSON.stringify(buildsBody)).toMatch(/succeeded|failed|runs|101|B-300/i);

      const pipelinesRes = await request.get(`${server.baseUrl}/api/azure-data/pipelines/runs`, { headers });
      expect(pipelinesRes.status()).toBe(200);
      expect(JSON.stringify(await pipelinesRes.json())).toMatch(/20261125|WorkOps CI Build|succeeded/i);

      const releasesRes = await request.get(`${server.baseUrl}/api/azure-data/releases`, { headers });
      expect(releasesRes.status()).toBe(200);
      expect(JSON.stringify(await releasesRes.json())).toMatch(/Release-42\.1/i);

      const testsRes = await request.get(`${server.baseUrl}/api/azure-data/tests/health`, { headers });
      expect(testsRes.status()).toBe(200);
      expect(JSON.stringify(await testsRes.json())).toMatch(/Unit & Integration Suite|passed|successful|runs/i);

      const statAfter = fs.statSync(server.azureDataDbPath);
      expect(statAfter.mtimeMs).toBe(statBefore.mtimeMs);
      expect(statAfter.mode & 0o777).toBe(0o444);
    } finally {
      await server.stop();
    }
  });

  test('[F7][Tier 1] GET /api/azure-data/teams, /work-items/unassigned, and /sprints support real pagination and filtering', async ({
    apiGet,
  }) => {
    // Paginated teams
    const page1Res = await apiGet('/api/azure-data/teams?limit=25&offset=0');
    expect(page1Res.status()).toBe(200);
    const page1Body = await page1Res.json();
    const page1Items = unwrapArray(page1Body, ['teams', 'items', 'rows', 'data']);
    expect(page1Items.length).toBe(25);
    expect(extractTotal(page1Body, page1Items.length)).toBeGreaterThanOrEqual(260);

    const page2Res = await apiGet('/api/azure-data/teams?limit=25&offset=25');
    expect(page2Res.status()).toBe(200);
    const page2Body = await page2Res.json();
    const page2Items = unwrapArray(page2Body, ['teams', 'items', 'rows', 'data']);
    expect(page2Items.length).toBe(25);
    expect(page2Items[0]?.team_id ?? page2Items[0]?.teamId ?? page2Items[0]?.id ?? page2Items[0]?.name).not.toBe(
      page1Items[0]?.team_id ?? page1Items[0]?.teamId ?? page1Items[0]?.id ?? page1Items[0]?.name
    );

    // Search teams
    const teamSearchRes = await apiGet('/api/azure-data/teams?search=POD-042');
    expect(teamSearchRes.status()).toBe(200);
    const teamSearchBody = await teamSearchRes.json();
    const teamSearchItems = unwrapArray(teamSearchBody, ['teams', 'items', 'rows', 'data']);
    expect(teamSearchItems.length).toBeGreaterThanOrEqual(1);
    expect(teamSearchItems.length).toBeLessThan(260);
    expect(JSON.stringify(teamSearchItems)).toContain('POD-042');

    // Paginated & filtered unassigned work items
    const unassignedRes = await apiGet('/api/azure-data/work-items/unassigned?limit=5&offset=0');
    expect(unassignedRes.status()).toBe(200);
    const unassignedBody = await unassignedRes.json();
    const unassignedItems = unwrapArray(unassignedBody, ['workItems', 'items', 'rows', 'data']);
    expect(unassignedItems.length).toBe(5);
    expect(extractTotal(unassignedBody, unassignedItems.length)).toBe(12);

    const unassignedSearchRes = await apiGet('/api/azure-data/work-items/unassigned?search=' + encodeURIComponent('Item #3'));
    expect(unassignedSearchRes.status()).toBe(200);
    const unassignedSearchItems = unwrapArray(await unassignedSearchRes.json(), ['workItems', 'items', 'rows', 'data']);
    expect(unassignedSearchItems.length).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(unassignedSearchItems)).toContain('Item #3');

    // Sprints
    const sprintsRes = await apiGet('/api/azure-data/sprints');
    expect(sprintsRes.status()).toBe(200);
    const sprintsText = JSON.stringify(await sprintsRes.json());
    expect(sprintsText).toContain('Sprint 41');
    expect(sprintsText).toContain('Sprint 42');
  });

  // ---------------------------------------------------------------------------
  // F19: Azure ALM Intelligence & Sprint Progress UI
  // ---------------------------------------------------------------------------

  test('[F19][Tier 1] /azure-overview renders dynamic project selector from /api/azure-data/projects and overview metrics', async ({
    page,
    gotoRoute,
  }) => {
    const projectsPromise = page.waitForResponse(
      (res) => res.url().includes('/api/azure-data/projects') && res.status() === 200
    );
    await gotoRoute('/azure-overview');
    await projectsPromise;

    await assertLandmarks(page);
    await assertNoHorizontalOverflow(page);

    const main = page.locator('main#main');
    await expect(main).toContainText(/TestProject|3_in_1_AppFrontEnd_Tasks/);

    const projectSelect = main
      .getByRole('combobox', { name: /project/i })
      .or(main.getByLabel(/project/i))
      .first();
    if (await projectSelect.isVisible().catch(() => false)) {
      const optionsText = await projectSelect.innerText();
      expect(optionsText).toContain('TestProject');
      expect(optionsText).toContain('3_in_1_AppFrontEnd_Tasks');
    }

    await expect(main).toContainText(/work\s*items|repositories|pull\s*requests|pipelines|builds|releases/i);
  });

  test('[F19][Tier 1] /azure-builds renders Builds, Pipelines, Releases, and Test Health data from azure-data.db', async ({
    page,
    gotoRoute,
  }) => {
    await gotoRoute('/azure-builds');
    await assertLandmarks(page);
    await assertNoHorizontalOverflow(page);

    const main = page.locator('main#main');
    await expect(main).toContainText(/build|pipeline|release|test/i);
    await expect(main).toContainText(/WorkOps CI Build|B-3001|Release-42\.1|Unit & Integration Suite|20261125/i);
  });

  test('[F19][Tier 1] /azure-teams renders paginated Enterprise POD Directory (260 seeded teams) with search and pagination', async ({
    page,
    gotoRoute,
  }) => {
    await gotoRoute('/azure-teams');
    await assertLandmarks(page);
    await assertNoHorizontalOverflow(page);

    const main = page.locator('main#main');
    await expect(main).toContainText(/POD-001/i);
    await expect(main).toContainText(/260/);

    const nextBtn = main.getByRole('button', { name: /next/i }).first();
    await expect(nextBtn).toBeVisible();
    const nextPagePromise = page.waitForResponse(
      (res) => res.url().includes('/api/azure-data/teams') && res.status() === 200
    );
    await nextBtn.click();
    await nextPagePromise;

    const searchInput = main
      .getByRole('searchbox')
      .or(main.getByPlaceholder(/search/i))
      .or(main.getByLabel(/search/i))
      .first();
    await expect(searchInput).toBeVisible();

    const searchResPromise = page.waitForResponse(
      (res) => res.url().includes('/api/azure-data/teams') && res.url().includes('POD-150') && res.status() === 200
    );
    await searchInput.fill('POD-150');
    await searchResPromise;

    await expect(main).toContainText(/POD-150/i);
    await expect(main).not.toContainText(/POD-001\b/i);
  });

  test('[F19][Tier 1] /unassigned renders Unassigned Backlog Triage table and performs real Assignment via UI', async ({
    page,
  }) => {
    const server = await startAcceptanceServer({ authMode: 'basic', readOnlyAzureDb: true });
    try {
      // Seed work items 8001..8012 into MockAzureServer so PATCH on assignment succeeds upstream too
      for (let u = 1; u <= 12; u++) {
        server.mockAzure.seedWorkItem({
          id: 8000 + u,
          fields: {
            'System.TeamProject': u <= 9 ? 'TestProject' : '3_in_1_AppFrontEnd_Tasks',
            'System.WorkItemType': u % 3 === 0 ? 'Bug' : 'Task',
            'System.Title': `Unassigned Triage Item #${u} — Backlog Remediation`,
            'System.State': 'New',
          },
        });
      }

      const headers = { Authorization: server.basicAdminHeader };
      await page.setExtraHTTPHeaders(headers);
      await page.goto(`${server.baseUrl}/unassigned`, { waitUntil: 'domcontentloaded' });

      await assertLandmarks(page);
      await assertNoHorizontalOverflow(page);

      const main = page.locator('main#main');
      await expect(main).toContainText(/Unassigned Triage Item #1/i);

      // Select assignee on first row or global assignee picker, then trigger Assign
      const assigneeSelect = main.getByRole('combobox').first();
      if (await assigneeSelect.isVisible().catch(() => false)) {
        const optionValue = await assigneeSelect.evaluate((sel) => {
          const selectEl = sel as HTMLSelectElement;
          const opt = Array.from(selectEl.options).find((o) =>
            /alice/i.test(`${o.value} ${o.textContent || ''}`)
          );
          return opt ? opt.value : '';
        });
        if (optionValue) {
          await assigneeSelect.selectOption(optionValue);
        }
      }

      const assignBtn = main.getByRole('button', { name: /assign/i }).first();
      await expect(assignBtn).toBeVisible();

      const assignResPromise = page.waitForResponse(
        (res) => res.url().includes('/api/azure-data/work-items/assign') && res.request().method() === 'POST'
      );
      await assignBtn.click();

      // Handle optional confirmation/assignment modal if Assign button opens a dialog
      const dialog = page.getByRole('dialog').first();
      if (await dialog.isVisible({ timeout: 1500 }).catch(() => false)) {
        const modalSelect = dialog.getByRole('combobox').first();
        if (await modalSelect.isVisible().catch(() => false)) {
          const modalVal = await modalSelect.evaluate((sel) => {
            const selectEl = sel as HTMLSelectElement;
            const opt = Array.from(selectEl.options).find((o) =>
              /alice/i.test(`${o.value} ${o.textContent || ''}`)
            );
            return opt ? opt.value : '';
          });
          if (modalVal) {
            await modalSelect.selectOption(modalVal);
          }
        } else {
          const modalInput = dialog.getByRole('textbox').first();
          if (await modalInput.isVisible().catch(() => false)) {
            await modalInput.fill('alice@workops.test');
          }
        }
        const modalSubmit = dialog.getByRole('button', { name: /assign|confirm|save/i }).first();
        await expect(modalSubmit).toBeVisible();
        await modalSubmit.click();
      }

      const assignRes = await assignResPromise;
      expect(assignRes.status()).toBe(200);
      const assignReqBody = assignRes.request().postDataJSON() as Record<string, unknown> | null;
      expect(assignReqBody).toBeTruthy();
    } finally {
      await server.stop();
    }
  });

  test('[F19][Tier 1] /sprint-progress renders Sprint Progress metrics from /api/azure-data/sprints with filtering', async ({
    page,
    gotoRoute,
  }) => {
    const sprintsPromise = page.waitForResponse(
      (res) => res.url().includes('/api/azure-data/sprints') && res.status() === 200
    );
    await gotoRoute('/sprint-progress');
    await sprintsPromise;

    await assertLandmarks(page);
    await assertNoHorizontalOverflow(page);

    const main = page.locator('main#main');
    await expect(main).toContainText(/Sprint 41|Sprint 42/i);

    const filterControl = main
      .getByRole('combobox', { name: /project|sprint/i })
      .or(main.getByLabel(/project|sprint/i))
      .first();
    if (await filterControl.isVisible().catch(() => false)) {
      const targetOption = await filterControl.evaluate((el) => {
        if (el.tagName.toLowerCase() !== 'select') return '';
        const selectEl = el as HTMLSelectElement;
        const opt = Array.from(selectEl.options).find(
          (o) => /3_in_1_AppFrontEnd_Tasks|Sprint 42/i.test(`${o.value} ${o.textContent || ''}`)
        );
        return opt ? opt.value : '';
      });
      if (targetOption) {
        await filterControl.selectOption(targetOption);
        await expect(main).toContainText(/Sprint 42/i);
      }
    }
  });
});
