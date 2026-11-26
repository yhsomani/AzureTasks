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

function formatTitleDate(isoDate: string): string {
  const d = new Date(`${isoDate}T12:00:00.000Z`);
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
  }).format(d);
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

test.describe('Tier 1 — Team, Calendar & Concurrency Lifecycle (F4, F5, F17)', () => {
  // ---------------------------------------------------------------------------
  // F4: Relational Persistence & Calendar Fidelity
  // ---------------------------------------------------------------------------

  test('[F4][Tier 1] POST, PUT, and DELETE /api/config/people persist in SQLite across server restart without resurrection', async ({
    request,
  }) => {
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
          autoCloseEnabled: false,
          pod: 'POD-009 Core',
          titlePrefix: 'Core |',
          sourceTaskId: 200,
          githubRepositories: ['workops/api'],
          githubBranches: ['main'],
        },
      });
      expect([200, 201]).toContain(createRes.status());

      const updateRes = await request.put(`${server.baseUrl}/api/config/people/carol`, {
        headers,
        data: {
          name: 'Carol Diaz Updated',
          pod: 'POD-010 Platform',
        },
      });
      expect(updateRes.status()).toBe(200);

      // Delete seeded member bob (exists in people.json!) to verify zero resurrection across restart
      const delRes = await request.delete(`${server.baseUrl}/api/config/people/bob`, { headers });
      expect([200, 204]).toContain(delRes.status());

      await server.restart();

      const afterRes = await request.get(`${server.baseUrl}/api/config`, { headers });
      expect(afterRes.status()).toBe(200);
      const afterCfg = (await afterRes.json()) as { people: Array<Record<string, unknown>> };

      const carol = afterCfg.people.find((p) => p.key === 'carol');
      expect(carol).toBeTruthy();
      expect(carol?.name).toBe('Carol Diaz Updated');
      expect(carol?.pod).toBe('POD-010 Platform');
      expect(carol?.autoCloseEnabled).toBe(false);
      expect(afterCfg.people.some((p) => p.key === 'bob')).toBe(false);
    } finally {
      await server.stop();
    }
  });

  test('[F4][Tier 1] Multi-team and alias members load without duplicates across server restart', async ({
    request,
  }) => {
    const peopleWithAliases: SeedPerson[] = [
      {
        key: 'alice',
        name: 'Alice Chen',
        assignedTo: 'alice@workops.test',
        enabled: true,
        autoCloseEnabled: true,
        pod: 'POD-001 Platform',
        aliases: ['alice.chen@workops.test', 'achen@workops.test'],
        canonicalId: 'canon-alice-01',
      },
      {
        key: 'bob',
        name: 'Bob Patel',
        assignedTo: 'bob@workops.test',
        enabled: true,
        autoCloseEnabled: true,
        pod: 'POD-002 Web',
        aliases: ['bob.patel@workops.test', 'bpatel@workops.test'],
        canonicalId: 'canon-bob-02',
      },
    ];
    const server = await startAcceptanceServer({ authMode: 'basic', people: peopleWithAliases });
    try {
      const headers = { Authorization: server.basicAdminHeader };
      await server.restart();

      const cfgRes = await request.get(`${server.baseUrl}/api/config`, { headers });
      expect(cfgRes.status()).toBe(200);
      const cfg = (await cfgRes.json()) as { people: Array<{ key: string }> };

      const aliceMatches = cfg.people.filter((p) => p.key === 'alice');
      const bobMatches = cfg.people.filter((p) => p.key === 'bob');
      expect(aliceMatches.length).toBe(1);
      expect(bobMatches.length).toBe(1);
      expect(cfg.people.length).toBe(2);
    } finally {
      await server.stop();
    }
  });

  test('[F4][Tier 1] POST /api/calendar persists defaultHours, memberHours, and multi-day exceptions across server restart', async ({
    request,
  }) => {
    const server = await startAcceptanceServer({ authMode: 'basic' });
    try {
      const headers = { Authorization: server.basicAdminHeader };
      const start = getNextWeekdayIso(2);
      const end = getNextWeekdayIso(4);

      const getRes1 = await request.get(`${server.baseUrl}/api/calendar`, { headers });
      expect(getRes1.status()).toBe(200);
      const cal1 = (await getRes1.json()) as { calendar: { version: number } };

      const postRes = await request.post(`${server.baseUrl}/api/calendar`, {
        headers,
        data: {
          version: cal1.calendar.version,
          defaultHours: 7.5,
          memberHours: {
            alice: 6,
            bob: 8,
          },
          exceptions: [
            {
              id: 'exc-sprint-holiday',
              startDate: start,
              endDate: end,
              kind: 'leave',
              memberKeys: ['alice'],
              note: 'Annual multi-day leave',
            },
          ],
        },
      });
      expect(postRes.status()).toBe(200);

      await server.restart();

      const getRes2 = await request.get(`${server.baseUrl}/api/calendar`, { headers });
      expect(getRes2.status()).toBe(200);
      const cal2 = (await getRes2.json()) as {
        calendar: {
          defaultHours: number;
          memberHours: Record<string, number>;
          exceptions: Array<{
            id: string;
            startDate: string;
            endDate: string;
            kind: string;
            memberKeys?: string[];
            note?: string;
          }>;
        };
      };

      expect(cal2.calendar.defaultHours).toBe(7.5);
      expect(cal2.calendar.memberHours.alice).toBe(6);
      expect(cal2.calendar.memberHours.bob).toBe(8);
      const savedExc = cal2.calendar.exceptions.find((e) => e.id === 'exc-sprint-holiday');
      expect(savedExc).toBeTruthy();
      expect(savedExc?.startDate).toBe(start);
      expect(savedExc?.endDate).toBe(end);
      expect(savedExc?.kind).toBe('leave');
      expect(savedExc?.memberKeys).toEqual(['alice']);
      expect(savedExc?.note).toBe('Annual multi-day leave');
    } finally {
      await server.stop();
    }
  });

  test('[F4][Tier 1] GET /api/journal honors limit/filters and POST /api/tasks/repair persists relationCopyStatus updates', async ({
    request,
  }) => {
    const server = await startAcceptanceServer({ authMode: 'basic' });
    try {
      const headers = { Authorization: server.basicAdminHeader };
      const targetDate = getNextWeekdayIso(2);

      // Create two adhoc entries (with sourceTaskId to allow parent relation check/repair)
      await request.post(`${server.baseUrl}/api/tasks/adhoc`, {
        headers,
        data: {
          personKey: 'alice',
          date: targetDate,
          title: `Task | ${formatTitleDate(targetDate)} | Alice Journal Filter`,
          sourceTaskId: 200,
        },
      });
      await request.post(`${server.baseUrl}/api/tasks/adhoc`, {
        headers,
        data: {
          personKey: 'bob',
          date: targetDate,
          title: `Task | ${formatTitleDate(targetDate)} | Bob Journal Filter`,
          sourceTaskId: 201,
        },
      });

      const limitedRes = await request.get(`${server.baseUrl}/api/journal?limit=1`, { headers });
      expect(limitedRes.status()).toBe(200);
      const limitedEntries = unwrapArray(await limitedRes.json(), ['entries', 'items', 'journal', 'records']);
      expect(limitedEntries.length).toBe(1);

      const repairRes = await request.post(`${server.baseUrl}/api/tasks/repair`, {
        headers,
        data: {},
      });
      expect(repairRes.status()).toBe(200);

      await server.restart();

      const afterRes = await request.get(`${server.baseUrl}/api/journal?limit=10`, { headers });
      expect(afterRes.status()).toBe(200);
      const afterEntries = unwrapArray(await afterRes.json(), ['entries', 'items', 'journal', 'records']);
      expect(afterEntries.length).toBeGreaterThanOrEqual(2);
      for (const entry of afterEntries) {
        expect(typeof entry.relationCopyStatus).toBe('string');
      }
    } finally {
      await server.stop();
    }
  });

  test('[F4][Tier 1] Workspace respects custom org and project from people.json without hardcoded org overrides', async ({
    request,
  }) => {
    const server = await startAcceptanceServer({
      authMode: 'basic',
      organization: 'custom-enterprise-org',
      project: 'CustomWorkspaceProj',
    });
    try {
      const headers = { Authorization: server.basicAdminHeader };
      const cfgRes = await request.get(`${server.baseUrl}/api/config`, { headers });
      expect(cfgRes.status()).toBe(200);
      const cfg = (await cfgRes.json()) as Record<string, unknown>;

      expect(cfg.organization ?? cfg.org).toBe('custom-enterprise-org');
      expect(cfg.project).toBe('CustomWorkspaceProj');

      server.mockAzure.clearRequests();
      const targetDate = getNextWeekdayIso(2);
      const planRes = await request.post(`${server.baseUrl}/api/tasks/plan`, {
        headers,
        data: { asOf: targetDate },
      });
      expect(planRes.status()).toBe(200);

      const azureReqs = server.mockAzure.getRequests();
      expect(azureReqs.length).toBeGreaterThan(0);
      const paths = azureReqs.map((r) => r.path).join('\n');
      expect(paths).toContain('custom-enterprise-org');
    } finally {
      await server.stop();
    }
  });

  // ---------------------------------------------------------------------------
  // F5: Unified Concurrency Locking
  // ---------------------------------------------------------------------------

  test('[F5][Tier 1] Simultaneous POST /api/tasks/execute calls serialize or reject cleanly without creating duplicate tasks', async ({
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

      const [resA, resB] = await Promise.all([
        request.post(`${server.baseUrl}/api/tasks/execute`, {
          headers,
          data: { planToken: plan.planToken, confirm: true },
        }),
        request.post(`${server.baseUrl}/api/tasks/execute`, {
          headers,
          data: { planToken: plan.planToken, confirm: true },
        }),
      ]);

      expect([200, 409, 423]).toContain(resA.status());
      expect([200, 409, 423]).toContain(resB.status());
      expect(resA.status() === 200 || resB.status() === 200).toBe(true);

      const titleDate = formatTitleDate(targetDate);
      const aliceCreated = server.mockAzure
        .listWorkItems()
        .filter((w) => String(w.fields['System.Title'] || '').includes(titleDate) && JSON.stringify(w.fields['System.AssignedTo']).includes('alice'));
      expect(aliceCreated.length).toBe(1);
    } finally {
      await server.stop();
    }
  });

  test('[F5][Tier 1] Simultaneous POST /api/tasks/activate-today requests do not corrupt state or double-activate', async ({
    request,
  }) => {
    const server = await startAcceptanceServer({ authMode: 'basic' });
    try {
      const headers = { Authorization: server.basicAdminHeader };
      const targetDate = getNextWeekdayIso(1);

      await request.post(`${server.baseUrl}/api/tasks/execute`, {
        headers,
        data: { asOf: targetDate, confirm: true },
      });

      const [resA, resB] = await Promise.all([
        request.post(`${server.baseUrl}/api/tasks/activate-today`, {
          headers,
          data: { asOf: targetDate, confirm: true, all: true },
        }),
        request.post(`${server.baseUrl}/api/tasks/activate-today`, {
          headers,
          data: { asOf: targetDate, confirm: true, all: true },
        }),
      ]);

      expect([200, 409, 423]).toContain(resA.status());
      expect([200, 409, 423]).toContain(resB.status());
      expect(resA.status() === 200 || resB.status() === 200).toBe(true);

      const titleDate = formatTitleDate(targetDate);
      const tasks = server.mockAzure
        .listWorkItems()
        .filter((w) => String(w.fields['System.Title'] || '').includes(titleDate));
      expect(tasks.length).toBeGreaterThanOrEqual(2);
      for (const t of tasks) {
        expect(String(t.fields['System.State'])).toBe('Active');
      }
    } finally {
      await server.stop();
    }
  });

  test('[F5][Tier 1] Simultaneous POST /api/tasks/close-today requests serialize or guard cleanly', async ({
    request,
  }) => {
    const server = await startAcceptanceServer({ authMode: 'basic' });
    try {
      const headers = { Authorization: server.basicAdminHeader };
      const targetDate = getNextWeekdayIso(1);

      await request.post(`${server.baseUrl}/api/tasks/execute`, {
        headers,
        data: { asOf: targetDate, confirm: true },
      });
      await request.post(`${server.baseUrl}/api/tasks/activate-today`, {
        headers,
        data: { asOf: targetDate, confirm: true, all: true },
      });

      const payload = {
        asOf: targetDate,
        confirm: true,
        all: true,
        manualOverride: true,
        overrideReason: 'Concurrent close verification',
      };
      const [resA, resB] = await Promise.all([
        request.post(`${server.baseUrl}/api/tasks/close-today`, { headers, data: payload }),
        request.post(`${server.baseUrl}/api/tasks/close-today`, { headers, data: payload }),
      ]);

      expect([200, 409, 423]).toContain(resA.status());
      expect([200, 409, 423]).toContain(resB.status());
      expect(resA.status() === 200 || resB.status() === 200).toBe(true);

      const titleDate = formatTitleDate(targetDate);
      const tasks = server.mockAzure
        .listWorkItems()
        .filter((w) => String(w.fields['System.Title'] || '').includes(titleDate));
      for (const t of tasks) {
        expect(String(t.fields['System.State'])).toMatch(/closed|done|resolved/i);
      }
    } finally {
      await server.stop();
    }
  });

  test('[F5][Tier 1] Simultaneous POST /api/tasks/repair calls remain atomic and safe', async ({
    request,
  }) => {
    const server = await startAcceptanceServer({ authMode: 'basic' });
    try {
      const headers = { Authorization: server.basicAdminHeader };
      const targetDate = getNextWeekdayIso(2);

      await request.post(`${server.baseUrl}/api/tasks/adhoc`, {
        headers,
        data: {
          personKey: 'alice',
          date: targetDate,
          title: `Task | ${formatTitleDate(targetDate)} | Concurrent Repair`,
          sourceTaskId: 200,
        },
      });

      const [resA, resB] = await Promise.all([
        request.post(`${server.baseUrl}/api/tasks/repair`, { headers, data: {} }),
        request.post(`${server.baseUrl}/api/tasks/repair`, { headers, data: {} }),
      ]);

      expect([200, 409, 423]).toContain(resA.status());
      expect([200, 409, 423]).toContain(resB.status());
      expect(resA.status() === 200 || resB.status() === 200).toBe(true);
    } finally {
      await server.stop();
    }
  });

  test('[F5][Tier 1] Concurrency lock is released cleanly after a failing upstream Azure request so subsequent execution succeeds', async ({
    request,
  }) => {
    const server = await startAcceptanceServer({ authMode: 'basic' });
    try {
      const headers = { Authorization: server.basicAdminHeader };
      const targetDate = getNextWeekdayIso(2);

      server.mockAzure.setUnavailable(true, 503);
      const failedExec = await request.post(`${server.baseUrl}/api/tasks/execute`, {
        headers,
        data: { asOf: targetDate, confirm: true },
      });
      expect(failedExec.status()).toBeGreaterThanOrEqual(400);

      server.mockAzure.setUnavailable(false);
      const recoveryExec = await request.post(`${server.baseUrl}/api/tasks/execute`, {
        headers,
        data: { asOf: targetDate, confirm: true },
      });
      expect(recoveryExec.status()).toBe(200);
    } finally {
      await server.stop();
    }
  });

  // ---------------------------------------------------------------------------
  // F17: Team Roster & Work Calendar Management UI
  // ---------------------------------------------------------------------------

  test('[F17][Tier 1] /people UI renders roster table and Add Member modal persists full PersonConfig fields', async ({
    page,
    request,
  }) => {
    const server = await startAcceptanceServer({ authMode: 'basic' });
    try {
      const headers = { Authorization: server.basicAdminHeader };
      await page.setExtraHTTPHeaders(headers);
      await page.goto(`${server.baseUrl}/people`, { waitUntil: 'domcontentloaded' });

      await assertLandmarks(page);
      await assertNoHorizontalOverflow(page);

      const main = page.locator('main#main');
      await expect(main).toContainText(/Alice Chen/i);
      await expect(main).toContainText(/Bob Patel/i);

      const addBtn = main.getByRole('button', { name: /add\s+(member|person)|new\s+member/i }).first();
      await expect(addBtn).toBeVisible();
      await addBtn.click();

      const dialog = page.getByRole('dialog').first();
      await expect(dialog).toBeVisible();

      await dialog.getByLabel(/^key\b|member key/i).first().fill('carol');
      await dialog.getByLabel(/^name\b|full name|display name/i).first().fill('Carol Diaz');
      await dialog.getByLabel(/assigned to|email/i).first().fill('carol@workops.test');

      const podField = dialog.getByLabel(/pod|team/i).first();
      if ((await podField.count()) > 0) await podField.fill('POD-003 Security');

      const prefixField = dialog.getByLabel(/title prefix|prefix/i).first();
      if ((await prefixField.count()) > 0) await prefixField.fill('Sec |');

      const sourceField = dialog.getByLabel(/source task/i).first();
      if ((await sourceField.count()) > 0) await sourceField.fill('200');

      const reposField = dialog.getByLabel(/repositor/i).first();
      if ((await reposField.count()) > 0) await reposField.fill('workops/sec');

      const branchesField = dialog.getByLabel(/branch/i).first();
      if ((await branchesField.count()) > 0) await branchesField.fill('main');

      const createPromise = page.waitForResponse(
        (res) => res.url().includes('/api/config/people') && res.request().method() === 'POST'
      );
      await dialog.getByRole('button', { name: /save|create|add/i }).first().click();
      const createRes = await createPromise;
      expect([200, 201]).toContain(createRes.status());

      await expect(main).toContainText(/Carol Diaz/i);

      const cfgRes = await request.get(`${server.baseUrl}/api/config`, { headers });
      const cfg = (await cfgRes.json()) as { people: Array<Record<string, unknown>> };
      expect(cfg.people.some((p) => p.key === 'carol' && p.name === 'Carol Diaz')).toBe(true);
    } finally {
      await server.stop();
    }
  });

  test('[F17][Tier 1] /people UI Edit Member updates fields and persists across reload', async ({
    page,
  }) => {
    const server = await startAcceptanceServer({ authMode: 'basic' });
    try {
      await page.setExtraHTTPHeaders({ Authorization: server.basicAdminHeader });
      await page.goto(`${server.baseUrl}/people`, { waitUntil: 'domcontentloaded' });
      await assertLandmarks(page);

      const main = page.locator('main#main');
      const bobRow = main.locator('tr, [role="row"], article, li').filter({ hasText: /Bob Patel/i }).first();
      await expect(bobRow).toBeVisible();

      const editBtn = bobRow.getByRole('button', { name: /edit/i }).first();
      await expect(editBtn).toBeVisible();
      await editBtn.click();

      const dialog = page.getByRole('dialog').first();
      await expect(dialog).toBeVisible();

      const podField = dialog.getByLabel(/pod|team/i).first();
      await podField.fill('POD-999 Architecture');

      const putPromise = page.waitForResponse(
        (res) => res.url().includes('/api/config/people/bob') && res.request().method() === 'PUT'
      );
      await dialog.getByRole('button', { name: /save|update/i }).first().click();
      const putRes = await putPromise;
      expect(putRes.status()).toBe(200);

      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(main).toContainText(/POD-999 Architecture/i);
    } finally {
      await server.stop();
    }
  });

  test('[F17][Tier 1] /people UI Enable/Disable toggle and Delete Member remove member from table', async ({
    page,
    request,
  }) => {
    const server = await startAcceptanceServer({ authMode: 'basic' });
    try {
      const headers = { Authorization: server.basicAdminHeader };
      await page.setExtraHTTPHeaders(headers);
      await page.goto(`${server.baseUrl}/people`, { waitUntil: 'domcontentloaded' });

      const main = page.locator('main#main');
      const bobRow = main.locator('tr, [role="row"], article, li').filter({ hasText: /Bob Patel/i }).first();
      await expect(bobRow).toBeVisible();

      const toggleCtrl = bobRow
        .getByRole('switch')
        .or(bobRow.getByRole('checkbox', { name: /enable|active/i }))
        .or(bobRow.getByRole('button', { name: /disable|enable/i }))
        .first();
      if ((await toggleCtrl.count()) > 0 && (await toggleCtrl.isVisible())) {
        const putPromise = page.waitForResponse(
          (res) => res.url().includes('/api/config/people/bob') && res.request().method() === 'PUT'
        );
        await toggleCtrl.click();
        const putRes = await putPromise;
        expect(putRes.status()).toBe(200);
      }

      const deleteBtn = bobRow.getByRole('button', { name: /delete|remove/i }).first();
      await expect(deleteBtn).toBeVisible();

      const delPromise = page.waitForResponse(
        (res) => res.url().includes('/api/config/people/bob') && res.request().method() === 'DELETE'
      );
      await deleteBtn.click();
      const dialog = page.getByRole('dialog').first();
      if (await dialog.isVisible().catch(() => false)) {
        await dialog.getByRole('button', { name: /confirm|delete|remove/i }).first().click();
      }
      const delRes = await delPromise;
      expect([200, 204]).toContain(delRes.status());

      await expect(main).not.toContainText(/Bob Patel/i);
      const cfgRes = await request.get(`${server.baseUrl}/api/config`, { headers });
      const cfg = (await cfgRes.json()) as { people: Array<{ key: string }> };
      expect(cfg.people.some((p) => p.key === 'bob')).toBe(false);
    } finally {
      await server.stop();
    }
  });

  test('[F17][Tier 1] /calendar UI updates default hours and per-member hour overrides across reload', async ({
    page,
  }) => {
    const server = await startAcceptanceServer({ authMode: 'basic' });
    try {
      await page.setExtraHTTPHeaders({ Authorization: server.basicAdminHeader });
      await page.goto(`${server.baseUrl}/calendar`, { waitUntil: 'domcontentloaded' });

      await assertLandmarks(page);
      await assertNoHorizontalOverflow(page);

      const main = page.locator('main#main');
      const defaultHoursInput = main.getByLabel(/default.*hours|daily hours|standard hours/i).first();
      await expect(defaultHoursInput).toBeVisible();
      await defaultHoursInput.fill('7.5');

      const aliceRow = main.locator('tr, [role="row"], div').filter({ hasText: /Alice Chen/i }).first();
      const aliceHours = aliceRow.locator('input[type="number"]').first();
      if ((await aliceHours.count()) > 0 && (await aliceHours.isVisible())) {
        await aliceHours.fill('6');
      }

      const saveBtn = main.getByRole('button', { name: /save/i }).first();
      const postPromise = page.waitForResponse(
        (res) => res.url().includes('/api/calendar') && res.request().method() === 'POST'
      );
      await saveBtn.click();
      const postRes = await postPromise;
      expect(postRes.status()).toBe(200);

      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(main.getByLabel(/default.*hours|daily hours|standard hours/i).first()).toHaveValue('7.5');
    } finally {
      await server.stop();
    }
  });

  test('[F17][Tier 1] /calendar UI creates and deletes multi-day leave/holiday exceptions', async ({
    page,
    request,
  }) => {
    const server = await startAcceptanceServer({ authMode: 'basic' });
    try {
      const headers = { Authorization: server.basicAdminHeader };
      const start = getNextWeekdayIso(2);
      const end = getNextWeekdayIso(3);

      await page.setExtraHTTPHeaders(headers);
      await page.goto(`${server.baseUrl}/calendar`, { waitUntil: 'domcontentloaded' });
      await assertLandmarks(page);

      const main = page.locator('main#main');
      const addExcBtn = main.getByRole('button', { name: /add exception|new exception|add leave|add holiday/i }).first();
      if ((await addExcBtn.count()) > 0 && (await addExcBtn.isVisible())) {
        await addExcBtn.click();
      }

      const scope = (await page.getByRole('dialog').first().isVisible().catch(() => false))
        ? page.getByRole('dialog').first()
        : main;

      const startInput = scope.getByLabel(/start date/i).first();
      const endInput = scope.getByLabel(/end date/i).first();
      await expect(startInput).toBeVisible();
      await startInput.fill(start);
      if ((await endInput.count()) > 0) {
        await endInput.fill(end);
      }

      const noteInput = scope.getByLabel(/note|reason|description|label/i).first();
      if ((await noteInput.count()) > 0) {
        await noteInput.fill('Company Summit Leave');
      }

      const postPromise = page.waitForResponse(
        (res) => res.url().includes('/api/calendar') && res.request().method() === 'POST'
      );
      const submitExcBtn = scope.getByRole('button', { name: /save|add|create/i }).last();
      await submitExcBtn.click();
      const postRes = await postPromise;
      expect(postRes.status()).toBe(200);

      await expect(main).toContainText(/Company Summit Leave/i);

      const calRes = await request.get(`${server.baseUrl}/api/calendar`, { headers });
      const calData = (await calRes.json()) as { calendar: { exceptions: Array<{ note?: string }> } };
      expect(calData.calendar.exceptions.some((e) => e.note === 'Company Summit Leave')).toBe(true);

      // Delete exception from UI
      const excRow = main.locator('tr, li, div').filter({ hasText: /Company Summit Leave/i }).first();
      const delExcBtn = excRow.getByRole('button', { name: /delete|remove/i }).first();
      if ((await delExcBtn.count()) > 0 && (await delExcBtn.isVisible())) {
        const delPromise = page.waitForResponse(
          (res) => res.url().includes('/api/calendar') && res.request().method() === 'POST'
        );
        await delExcBtn.click();
        await delPromise;
      }
    } finally {
      await server.stop();
    }
  });
});
