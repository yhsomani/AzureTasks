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

test.describe('Tier 2 — Team, Calendar & Concurrency Boundaries (F4, F5, F17)', () => {
  // ---------------------------------------------------------------------------
  // F4 Boundaries
  // ---------------------------------------------------------------------------

  test('[F4][Tier 2] POST /api/calendar with stale version returns 409 Conflict (optimistic concurrency)', async ({
    request,
  }) => {
    const server = await startAcceptanceServer({ authMode: 'basic' });
    try {
      const headers = { Authorization: server.basicAdminHeader };
      const getRes = await request.get(`${server.baseUrl}/api/calendar`, { headers });
      expect(getRes.status()).toBe(200);
      const initial = (await getRes.json()) as { calendar: { version: number } };
      const v0 = initial.calendar.version;

      const update1 = await request.post(`${server.baseUrl}/api/calendar`, {
        headers,
        data: {
          version: v0,
          defaultHours: 7,
          memberHours: {},
          exceptions: [],
        },
      });
      expect(update1.status()).toBe(200);

      // Re-submitting with stale v0 must be rejected with 409 Conflict
      const staleUpdate = await request.post(`${server.baseUrl}/api/calendar`, {
        headers,
        data: {
          version: v0,
          defaultHours: 6,
          memberHours: {},
          exceptions: [],
        },
      });
      expect(staleUpdate.status()).toBe(409);
    } finally {
      await server.stop();
    }
  });

  test('[F4][Tier 2] DELETE /api/config/people/:key for nonexistent key returns 404', async ({
    apiDelete,
  }) => {
    const res = await apiDelete('/api/config/people/does-not-exist-999');
    expect(res.status()).toBe(404);
  });

  test('[F4][Tier 2] Deleting a person referenced in journal and calendar retains relational integrity without resurrection after restart', async ({
    request,
  }) => {
    const server = await startAcceptanceServer({ authMode: 'basic' });
    try {
      const headers = { Authorization: server.basicAdminHeader };
      const targetDate = getNextWeekdayIso(2);

      // Create journal reference for bob
      const adhocRes = await request.post(`${server.baseUrl}/api/tasks/adhoc`, {
        headers,
        data: {
          personKey: 'bob',
          date: targetDate,
          title: 'Bob Reference Retention Check',
        },
      });
      expect([200, 201]).toContain(adhocRes.status());

      // Create calendar override and exception referencing bob
      const calGet = await request.get(`${server.baseUrl}/api/calendar`, { headers });
      const calData = (await calGet.json()) as { calendar: { version: number } };
      const calPost = await request.post(`${server.baseUrl}/api/calendar`, {
        headers,
        data: {
          version: calData.calendar.version,
          defaultHours: 8,
          memberHours: { bob: 6 },
          exceptions: [
            {
              id: 'exc-bob-ref',
              startDate: targetDate,
              endDate: targetDate,
              kind: 'leave',
              memberKeys: ['bob'],
              note: 'Bob leave before removal',
            },
          ],
        },
      });
      expect(calPost.status()).toBe(200);

      // Delete bob and verify no 500 FK crash and no resurrection on restart
      const delRes = await request.delete(`${server.baseUrl}/api/config/people/bob`, { headers });
      expect([200, 204]).toContain(delRes.status());

      await server.restart();

      const cfgRes = await request.get(`${server.baseUrl}/api/config`, { headers });
      expect(cfgRes.status()).toBe(200);
      const cfg = (await cfgRes.json()) as { people: Array<{ key: string }> };
      expect(cfg.people.some((p) => p.key === 'bob')).toBe(false);

      // Journal history remains queryable cleanly
      const journalRes = await request.get(`${server.baseUrl}/api/journal`, { headers });
      expect(journalRes.status()).toBe(200);
    } finally {
      await server.stop();
    }
  });

  test('[F4][Tier 2] POST /api/calendar rejects exception with endDate < startDate (400)', async ({
    request,
  }) => {
    const server = await startAcceptanceServer({ authMode: 'basic' });
    try {
      const headers = { Authorization: server.basicAdminHeader };
      const start = getNextWeekdayIso(4);
      const endBeforeStart = getNextWeekdayIso(1);

      const calGet = await request.get(`${server.baseUrl}/api/calendar`, { headers });
      const calData = (await calGet.json()) as { calendar: { version: number } };

      const badRes = await request.post(`${server.baseUrl}/api/calendar`, {
        headers,
        data: {
          version: calData.calendar.version,
          defaultHours: 8,
          memberHours: {},
          exceptions: [
            {
              id: 'bad-range',
              startDate: start,
              endDate: endBeforeStart,
              kind: 'holiday',
              memberKeys: ['alice'],
              note: 'Inverted exception dates',
            },
          ],
        },
      });
      expect(badRes.status()).toBe(400);
    } finally {
      await server.stop();
    }
  });

  test('[F4][Tier 2] POST /api/config/people with duplicate key is rejected (400 or 409)', async ({
    apiPost,
  }) => {
    const dupRes = await apiPost('/api/config/people', {
      key: 'alice',
      name: 'Duplicate Alice',
      assignedTo: 'dup-alice@workops.test',
      enabled: true,
    });
    expect([400, 409]).toContain(dupRes.status());
  });

  // ---------------------------------------------------------------------------
  // F5 Boundaries
  // ---------------------------------------------------------------------------

  test('[F5][Tier 2] Concurrent execute contention returns 409/423 with structured error or serializes cleanly', async ({
    request,
  }) => {
    const server = await startAcceptanceServer({ authMode: 'basic' });
    try {
      const headers = { Authorization: server.basicAdminHeader };
      const targetDate = getNextWeekdayIso(2);

      const responses = await Promise.all([
        request.post(`${server.baseUrl}/api/tasks/execute`, {
          headers,
          data: { asOf: targetDate, confirm: true },
        }),
        request.post(`${server.baseUrl}/api/tasks/execute`, {
          headers,
          data: { asOf: targetDate, confirm: true },
        }),
        request.post(`${server.baseUrl}/api/tasks/execute`, {
          headers,
          data: { asOf: targetDate, confirm: true },
        }),
      ]);

      const statuses = responses.map((r) => r.status());
      expect(statuses.every((s) => [200, 409, 423].includes(s))).toBe(true);
      expect(statuses.some((s) => s === 200)).toBe(true);

      for (const r of responses) {
        if (r.status() === 409 || r.status() === 423) {
          const payload = (await r.json()) as Record<string, unknown>;
          expect(typeof (payload.error ?? payload.message)).toBe('string');
        }
      }
    } finally {
      await server.stop();
    }
  });

  test('[F5][Tier 2] Lock does not leak across failed execute followed by activate-today, close-today, and repair', async ({
    request,
  }) => {
    const server = await startAcceptanceServer({ authMode: 'basic' });
    try {
      const headers = { Authorization: server.basicAdminHeader };
      const targetDate = getNextWeekdayIso(1);

      server.mockAzure.setUnavailable(true, 500);
      const failExec = await request.post(`${server.baseUrl}/api/tasks/execute`, {
        headers,
        data: { asOf: targetDate, confirm: true },
      });
      expect(failExec.status()).toBeGreaterThanOrEqual(400);

      server.mockAzure.setUnavailable(false);

      const okExec = await request.post(`${server.baseUrl}/api/tasks/execute`, {
        headers,
        data: { asOf: targetDate, confirm: true },
      });
      expect(okExec.status()).toBe(200);

      const okAct = await request.post(`${server.baseUrl}/api/tasks/activate-today`, {
        headers,
        data: { asOf: targetDate, confirm: true, all: true },
      });
      expect(okAct.status()).toBe(200);

      const okClose = await request.post(`${server.baseUrl}/api/tasks/close-today`, {
        headers,
        data: {
          asOf: targetDate,
          confirm: true,
          all: true,
          manualOverride: true,
          overrideReason: 'Post-failure lock release check',
        },
      });
      expect(okClose.status()).toBe(200);

      const okRepair = await request.post(`${server.baseUrl}/api/tasks/repair`, {
        headers,
        data: {},
      });
      expect(okRepair.status()).toBe(200);
    } finally {
      await server.stop();
    }
  });

  test('[F5][Tier 2] Rapid sequential POST /api/calendar and PUT /api/config/people updates stay consistent', async ({
    request,
  }) => {
    const server = await startAcceptanceServer({ authMode: 'basic' });
    try {
      const headers = { Authorization: server.basicAdminHeader };

      for (const hours of [7, 7.5, 8]) {
        const calGet = await request.get(`${server.baseUrl}/api/calendar`, { headers });
        const calBody = (await calGet.json()) as { calendar: { version: number } };
        const res = await request.post(`${server.baseUrl}/api/calendar`, {
          headers,
          data: {
            version: calBody.calendar.version,
            defaultHours: hours,
            memberHours: { alice: hours },
            exceptions: [],
          },
        });
        expect(res.status()).toBe(200);
      }

      for (const pod of ['POD-A', 'POD-B', 'POD-C']) {
        const putRes = await request.put(`${server.baseUrl}/api/config/people/alice`, {
          headers,
          data: { pod },
        });
        expect(putRes.status()).toBe(200);
      }

      const finalCfg = (await (await request.get(`${server.baseUrl}/api/config`, { headers })).json()) as {
        people: Array<{ key: string; pod?: string }>;
      };
      expect(finalCfg.people.find((p) => p.key === 'alice')?.pod).toBe('POD-C');

      const finalCal = (await (await request.get(`${server.baseUrl}/api/calendar`, { headers })).json()) as {
        calendar: { defaultHours: number; memberHours: Record<string, number> };
      };
      expect(finalCal.calendar.defaultHours).toBe(8);
      expect(finalCal.calendar.memberHours.alice).toBe(8);
    } finally {
      await server.stop();
    }
  });

  test('[F5][Tier 2] Aborted client request leaves server concurrency lock clean for subsequent calls', async ({
    request,
  }) => {
    const server = await startAcceptanceServer({ authMode: 'basic' });
    try {
      const headers = { Authorization: server.basicAdminHeader };
      const targetDate = getNextWeekdayIso(2);

      const controller = new AbortController();
      const fetchPromise = fetch(`${server.baseUrl}/api/tasks/execute`, {
        method: 'POST',
        headers: {
          ...headers,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ asOf: targetDate, confirm: true }),
        signal: controller.signal,
      }).catch(() => null);

      setTimeout(() => controller.abort(), 5);
      await fetchPromise;

      // Wait briefly for in-flight handler cleanup, then verify lock is not stuck
      await new Promise((r) => setTimeout(r, 150));
      const nextExec = await request.post(`${server.baseUrl}/api/tasks/execute`, {
        headers,
        data: { asOf: getNextWeekdayIso(3), confirm: true },
      });
      expect(nextExec.status()).toBe(200);
    } finally {
      await server.stop();
    }
  });

  test('[F5][Tier 2] Cross-workflow concurrent calls (execute vs repair) do not deadlock', async ({
    request,
  }) => {
    const server = await startAcceptanceServer({ authMode: 'basic' });
    try {
      const headers = { Authorization: server.basicAdminHeader };
      const targetDate = getNextWeekdayIso(2);

      const [execRes, repairRes] = await Promise.all([
        request.post(`${server.baseUrl}/api/tasks/execute`, {
          headers,
          data: { asOf: targetDate, confirm: true },
        }),
        request.post(`${server.baseUrl}/api/tasks/repair`, {
          headers,
          data: {},
        }),
      ]);

      expect([200, 409, 423]).toContain(execRes.status());
      expect([200, 409, 423]).toContain(repairRes.status());
      expect(execRes.status() === 200 || repairRes.status() === 200).toBe(true);
    } finally {
      await server.stop();
    }
  });

  // ---------------------------------------------------------------------------
  // F17 Boundaries
  // ---------------------------------------------------------------------------

  test('[F17][Tier 2] /people Add Member modal validates required fields, non-numeric sourceTaskId, and duplicate key', async ({
    page,
    gotoRoute,
  }) => {
    await gotoRoute('/people');
    await assertLandmarks(page);

    const main = page.locator('main#main');
    const addBtn = main.getByRole('button', { name: /add\s+(member|person)|new\s+member/i }).first();
    await addBtn.click();

    const dialog = page.getByRole('dialog').first();
    await expect(dialog).toBeVisible();

    const saveBtn = dialog.getByRole('button', { name: /save|create|add/i }).first();

    // Attempt empty submission -> dialog stays open with validation message or HTML5 invalid state
    await saveBtn.click();
    await expect(dialog).toBeVisible();

    // Attempt duplicate key 'alice' and non-numeric sourceTaskId
    await dialog.getByLabel(/^key\b|member key/i).first().fill('alice');
    await dialog.getByLabel(/^name\b|full name|display name/i).first().fill('Duplicate Alice');
    await dialog.getByLabel(/assigned to|email/i).first().fill('alice@workops.test');

    const sourceField = dialog.getByLabel(/source task/i).first();
    if ((await sourceField.count()) > 0) {
      const inputType = await sourceField.getAttribute('type');
      if (inputType !== 'number') {
        await sourceField.fill('not-a-number');
      }
    }

    await saveBtn.click();
    await expect(dialog).toBeVisible();
  });

  test('[F17][Tier 2] /people UI persists member edits and enable/disable state across page.reload()', async ({
    page,
  }) => {
    const server = await startAcceptanceServer({ authMode: 'basic' });
    try {
      await page.setExtraHTTPHeaders({ Authorization: server.basicAdminHeader });
      await page.goto(`${server.baseUrl}/people`, { waitUntil: 'domcontentloaded' });
      await assertLandmarks(page);

      const main = page.locator('main#main');
      const aliceRow = main.locator('tr, [role="row"], article, li').filter({ hasText: /Alice Chen/i }).first();
      await aliceRow.getByRole('button', { name: /edit/i }).first().click();

      const dialog = page.getByRole('dialog').first();
      await expect(dialog).toBeVisible();
      await dialog.getByLabel(/pod|team/i).first().fill('POD-777 Persistence');

      const putPromise = page.waitForResponse(
        (res) => res.url().includes('/api/config/people/alice') && res.request().method() === 'PUT'
      );
      await dialog.getByRole('button', { name: /save|update/i }).first().click();
      expect((await putPromise).status()).toBe(200);

      await page.reload({ waitUntil: 'domcontentloaded' });
      await expect(main).toContainText(/POD-777 Persistence/i);
    } finally {
      await server.stop();
    }
  });

  test('[F17][Tier 2] /calendar UI rejects negative and excessive hours (-1 and 25)', async ({
    page,
  }) => {
    const server = await startAcceptanceServer({ authMode: 'basic' });
    try {
      await page.setExtraHTTPHeaders({ Authorization: server.basicAdminHeader });
      await page.goto(`${server.baseUrl}/calendar`, { waitUntil: 'domcontentloaded' });
      await assertLandmarks(page);

      const main = page.locator('main#main');
      const hoursInput = main.getByLabel(/default.*hours|daily hours|standard hours/i).first();
      await expect(hoursInput).toBeVisible();

      const saveBtn = main.getByRole('button', { name: /save/i }).first();

      // Test negative hours (-1)
      let sentInvalidPost = false;
      page.on('response', (res) => {
        if (res.url().includes('/api/calendar') && res.request().method() === 'POST' && res.status() === 200) {
          sentInvalidPost = true;
        }
      });

      await hoursInput.fill('-1');
      await saveBtn.click();
      await expect(hoursInput).toHaveValue('-1');
      expect(sentInvalidPost).toBe(false);

      // Test excessive hours (25)
      await hoursInput.fill('25');
      await saveBtn.click();
      expect(sentInvalidPost).toBe(false);
    } finally {
      await server.stop();
    }
  });

  test('[F17][Tier 2] /calendar UI handles multi-member exceptions and 409 version conflict cleanly', async ({
    page,
    request,
  }) => {
    const server = await startAcceptanceServer({ authMode: 'basic' });
    try {
      const headers = { Authorization: server.basicAdminHeader };
      await page.setExtraHTTPHeaders(headers);
      await page.goto(`${server.baseUrl}/calendar`, { waitUntil: 'domcontentloaded' });
      await assertLandmarks(page);
      await assertNoHorizontalOverflow(page);

      // Simulate external concurrent update so page holds stale version
      const calGet = await request.get(`${server.baseUrl}/api/calendar`, { headers });
      const calData = (await calGet.json()) as { calendar: { version: number } };
      const concurrentPost = await request.post(`${server.baseUrl}/api/calendar`, {
        headers,
        data: {
          version: calData.calendar.version,
          defaultHours: 7,
          memberHours: {},
          exceptions: [],
        },
      });
      expect(concurrentPost.status()).toBe(200);

      const main = page.locator('main#main');
      const hoursInput = main.getByLabel(/default.*hours|daily hours|standard hours/i).first();
      await hoursInput.fill('6.5');

      const conflictPromise = page.waitForResponse(
        (res) => res.url().includes('/api/calendar') && res.request().method() === 'POST'
      );
      await main.getByRole('button', { name: /save/i }).first().click();
      const conflictRes = await conflictPromise;
      expect(conflictRes.status()).toBe(409);

      await expect(main.or(page.locator('[role="alert"], [role="status"], [aria-live="polite"]').first())).toContainText(
        /conflict|version|reload|updated|stale/i
      );
    } finally {
      await server.stop();
    }
  });

  test('[F17][Tier 2] /people member with autoCloseEnabled: false visibly reflects disabled auto-closure state', async ({
    page,
  }) => {
    const people: SeedPerson[] = [
      {
        key: 'alice',
        name: 'Alice Chen',
        assignedTo: 'alice@workops.test',
        enabled: true,
        autoCloseEnabled: true,
      },
      {
        key: 'bob',
        name: 'Bob Patel',
        assignedTo: 'bob@workops.test',
        enabled: true,
        autoCloseEnabled: false,
      },
    ];
    const server = await startAcceptanceServer({ authMode: 'basic', people });
    try {
      await page.setExtraHTTPHeaders({ Authorization: server.basicAdminHeader });
      await page.goto(`${server.baseUrl}/people`, { waitUntil: 'domcontentloaded' });
      await assertLandmarks(page);

      const main = page.locator('main#main');
      const bobRow = main.locator('tr, [role="row"], article, li').filter({ hasText: /Bob Patel/i }).first();
      await expect(bobRow).toBeVisible();
      await expect(bobRow).toContainText(/auto.?close.*off|disabled|manual|no/i);
    } finally {
      await server.stop();
    }
  });
});
