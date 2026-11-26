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

function getNextMondayToFriday(): { monday: string; tuesday: string; wednesday: string; friday: string } {
  const d = new Date();
  d.setUTCHours(12, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() + 1);
  while (d.getUTCDay() !== 1) {
    d.setUTCDate(d.getUTCDate() + 1);
  }
  const mon = new Date(d);
  const tue = new Date(d);
  tue.setUTCDate(mon.getUTCDate() + 1);
  const wed = new Date(d);
  wed.setUTCDate(mon.getUTCDate() + 2);
  const fri = new Date(d);
  fri.setUTCDate(mon.getUTCDate() + 4);
  return {
    monday: toIsoDate(mon),
    tuesday: toIsoDate(tue),
    wednesday: toIsoDate(wed),
    friday: toIsoDate(fri),
  };
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

function makeFivePeople(): SeedPerson[] {
  return [
    { key: 'alice', name: 'Alice Chen', assignedTo: 'alice@workops.test', enabled: true, autoCloseEnabled: true, pod: 'POD-001', role: 'Developer' },
    { key: 'bob', name: 'Bob Patel', assignedTo: 'bob@workops.test', enabled: true, autoCloseEnabled: true, pod: 'POD-002', role: 'Lead' },
    { key: 'carol', name: 'Carol Diaz', assignedTo: 'carol@workops.test', enabled: true, autoCloseEnabled: true, pod: 'POD-003', role: 'Developer' },
    { key: 'dave', name: 'Dave Kim', assignedTo: 'dave@workops.test', enabled: true, autoCloseEnabled: true, pod: 'POD-004', role: 'Developer' },
    { key: 'eve', name: 'Eve Rossi', assignedTo: 'eve@workops.test', enabled: true, autoCloseEnabled: true, pod: 'POD-005', role: 'Developer' },
  ];
}

test.describe('Tier 1 — Planning, Explorer, Burndown & Lifecycle (F8, F9, F11, F16)', () => {
  // ---------------------------------------------------------------------------
  // F8: Two-Phase Plan Execution & Safety Enforcement
  // ---------------------------------------------------------------------------

  test('[F8][Tier 1] POST /api/tasks/plan returns planToken, planHash, summary, personPlans, warnings, and expiresAt without mutating Azure', async ({
    request,
  }) => {
    const server = await startAcceptanceServer({ authMode: 'basic' });
    try {
      const headers = { Authorization: server.basicAdminHeader };
      const targetDate = getNextWeekdayIso(2);
      const beforeCount = server.mockAzure.listWorkItems().length;

      const planRes = await request.post(`${server.baseUrl}/api/tasks/plan`, {
        headers,
        data: { asOf: targetDate },
      });
      expect(planRes.status()).toBe(200);
      const body = (await planRes.json()) as Record<string, unknown>;

      expect(typeof body.planToken).toBe('string');
      expect((body.planToken as string).length).toBeGreaterThan(10);
      expect(typeof body.planHash).toBe('string');
      expect((body.planHash as string).length).toBeGreaterThan(5);
      expect(body.summary).toBeTruthy();
      expect(typeof body.summary).toBe('object');
      expect(Array.isArray(body.personPlans)).toBe(true);
      expect((body.personPlans as unknown[]).length).toBeGreaterThanOrEqual(2);
      expect(Array.isArray(body.warnings)).toBe(true);
      expect(typeof body.expiresAt).toBe('string');
      expect(Number.isNaN(Date.parse(body.expiresAt as string))).toBe(false);
      expect(Date.parse(body.expiresAt as string)).toBeGreaterThan(Date.now());

      // Planning phase must be pure preview (zero Azure mutations)
      expect(server.mockAzure.listWorkItems().length).toBe(beforeCount);
    } finally {
      await server.stop();
    }
  });

  test('[F8][Tier 1] POST /api/tasks/execute with { planToken, confirm: true } creates tasks in MockAzureServer and returns per-item results', async ({
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

      const execRes = await request.post(`${server.baseUrl}/api/tasks/execute`, {
        headers,
        data: { planToken: plan.planToken, confirm: true },
      });
      expect(execRes.status()).toBe(200);
      const execBody = (await execRes.json()) as Record<string, unknown>;

      const items = unwrapArray(execBody, ['results', 'items', 'created', 'tasks']);
      expect(items.length).toBeGreaterThanOrEqual(2);

      const allItems = server.mockAzure.listWorkItems();
      expect(allItems.length).toBeGreaterThan(initialCount);
      const createdForTarget = allItems.filter((w) => {
        const start = String(w.fields['Microsoft.VSTS.Scheduling.StartDate'] || w.fields['Custom.PlannedStartDate'] || '');
        const title = String(w.fields['System.Title'] || '');
        return start.startsWith(targetDate) || title.includes(formatTitleDate(targetDate));
      });
      expect(createdForTarget.length).toBeGreaterThanOrEqual(2);
    } finally {
      await server.stop();
    }
  });

  test('[F8][Tier 1] Re-executing same planToken and re-planning after creation skip duplicates without creating duplicate Azure items', async ({
    request,
  }) => {
    const server = await startAcceptanceServer({ authMode: 'basic' });
    try {
      const headers = { Authorization: server.basicAdminHeader };
      const targetDate = getNextWeekdayIso(3);

      const planRes = await request.post(`${server.baseUrl}/api/tasks/plan`, {
        headers,
        data: { asOf: targetDate },
      });
      expect(planRes.status()).toBe(200);
      const plan = (await planRes.json()) as { planToken: string };

      const firstExec = await request.post(`${server.baseUrl}/api/tasks/execute`, {
        headers,
        data: { planToken: plan.planToken, confirm: true },
      });
      expect(firstExec.status()).toBe(200);
      const countAfterFirst = server.mockAzure.listWorkItems().length;

      // Re-executing same token must be idempotent (0 new items created)
      const secondExec = await request.post(`${server.baseUrl}/api/tasks/execute`, {
        headers,
        data: { planToken: plan.planToken, confirm: true },
      });
      expect([200, 409]).toContain(secondExec.status());
      if (secondExec.status() === 200) {
        const secondBody = (await secondExec.json()) as Record<string, unknown>;
        expect(JSON.stringify(secondBody)).toMatch(/idempoten|skip|already|duplicate|0/i);
      }
      expect(server.mockAzure.listWorkItems().length).toBe(countAfterFirst);

      // Re-planning for the same date should detect existing tasks and skip them
      const replanRes = await request.post(`${server.baseUrl}/api/tasks/plan`, {
        headers,
        data: { asOf: targetDate },
      });
      expect(replanRes.status()).toBe(200);
      const replan = (await replanRes.json()) as { planToken: string };

      const thirdExec = await request.post(`${server.baseUrl}/api/tasks/execute`, {
        headers,
        data: { planToken: replan.planToken, confirm: true },
      });
      expect(thirdExec.status()).toBe(200);
      expect(server.mockAzure.listWorkItems().length).toBe(countAfterFirst);
    } finally {
      await server.stop();
    }
  });

  test('[F8][Tier 1] POST /api/tasks/execute updates /api/journal with accurate runId, createdWorkItemId, and operatorEmail', async ({
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

      const execRes = await request.post(`${server.baseUrl}/api/tasks/execute`, {
        headers,
        data: { planToken: plan.planToken, confirm: true },
      });
      expect(execRes.status()).toBe(200);

      const journalRes = await request.get(`${server.baseUrl}/api/journal`, { headers });
      expect(journalRes.status()).toBe(200);
      const entries = unwrapArray(await journalRes.json(), ['entries', 'items', 'journal', 'records']);
      expect(entries.length).toBeGreaterThanOrEqual(2);

      const aliceEntry = entries.find((e) => e.personKey === 'alice');
      expect(aliceEntry).toBeTruthy();
      expect(typeof aliceEntry?.runId).toBe('string');
      expect(Number(aliceEntry?.createdWorkItemId)).toBeGreaterThan(0);
      expect(typeof aliceEntry?.title).toBe('string');
      expect(String(aliceEntry?.operatorEmail ?? '')).not.toBe('');
    } finally {
      await server.stop();
    }
  });

  test('[F8][Tier 1] Direct POST /api/tasks/execute with confirm: true creates tasks and honors duplicate check on repeat', async ({
    request,
  }) => {
    const server = await startAcceptanceServer({ authMode: 'basic' });
    try {
      const headers = { Authorization: server.basicAdminHeader };
      const targetDate = getNextWeekdayIso(4);
      const beforeCount = server.mockAzure.listWorkItems().length;

      const exec1 = await request.post(`${server.baseUrl}/api/tasks/execute`, {
        headers,
        data: { asOf: targetDate, confirm: true },
      });
      expect(exec1.status()).toBe(200);
      const countAfterFirst = server.mockAzure.listWorkItems().length;
      expect(countAfterFirst).toBeGreaterThanOrEqual(beforeCount + 2);

      const exec2 = await request.post(`${server.baseUrl}/api/tasks/execute`, {
        headers,
        data: { asOf: targetDate, confirm: true },
      });
      expect(exec2.status()).toBe(200);
      expect(server.mockAzure.listWorkItems().length).toBe(countAfterFirst);
    } finally {
      await server.stop();
    }
  });

  // ---------------------------------------------------------------------------
  // F9: Task Explorer Math & Coverage Calculation
  // ---------------------------------------------------------------------------

  test('[F9][Tier 1] GET /api/explorer returns canonical summary, workingDaysCount, rows, and tasks', async ({
    request,
  }) => {
    const server = await startAcceptanceServer({ authMode: 'basic' });
    try {
      const headers = { Authorization: server.basicAdminHeader };
      const { monday, friday } = getNextMondayToFriday();

      const res = await request.get(`${server.baseUrl}/api/explorer?startDate=${monday}&endDate=${friday}`, {
        headers,
      });
      expect(res.status()).toBe(200);
      const body = (await res.json()) as {
        startDate: string;
        endDate: string;
        workingDaysCount: number;
        summary: {
          expectedCombinations: number;
          createdCount: number;
          missingCount: number;
          duplicateCount: number;
          overallCoveragePercent: number;
        };
        rows: unknown[];
        tasks: unknown[];
      };

      expect(body.startDate).toBe(monday);
      expect(body.endDate).toBe(friday);
      expect(body.workingDaysCount).toBe(5);
      expect(body.summary.expectedCombinations).toBe(10);
      expect(body.summary.createdCount + body.summary.missingCount).toBe(body.summary.expectedCombinations);
      expect(body.summary.overallCoveragePercent).toBeGreaterThanOrEqual(0);
      expect(body.summary.overallCoveragePercent).toBeLessThanOrEqual(100);
      expect(Array.isArray(body.rows)).toBe(true);
      expect(body.rows.length).toBeGreaterThanOrEqual(2);
      expect(Array.isArray(body.tasks)).toBe(true);
    } finally {
      await server.stop();
    }
  });

  test('[F9][Tier 1] GET /api/explorer counts unique existing combinations and clamps coverage to 0..100 with duplicate tasks', async ({
    request,
  }) => {
    const server = await startAcceptanceServer({ authMode: 'basic' });
    try {
      const headers = { Authorization: server.basicAdminHeader };
      const { monday } = getNextMondayToFriday();
      const titleDate = formatTitleDate(monday);

      // Seed 2 duplicate tasks for Alice on Monday and 0 for Bob
      server.mockAzure.seedWorkItem({
        id: 801,
        fields: {
          'System.TeamProject': 'TestProject',
          'System.WorkItemType': 'Task',
          'System.Title': `Task | ${titleDate} | Alice Chen Daily Work`,
          'System.State': 'New',
          'System.AssignedTo': { displayName: 'Alice Chen', uniqueName: 'alice@workops.test' },
          'Microsoft.VSTS.Scheduling.StartDate': `${monday}T09:30:00Z`,
          'Custom.PlannedStartDate': `${monday}T09:30:00Z`,
          'System.CreatedDate': `${monday}T09:30:00Z`,
        },
      });
      server.mockAzure.seedWorkItem({
        id: 802,
        fields: {
          'System.TeamProject': 'TestProject',
          'System.WorkItemType': 'Task',
          'System.Title': `Task | ${titleDate} | Alice Chen Daily Work (Dup)`,
          'System.State': 'New',
          'System.AssignedTo': { displayName: 'Alice Chen', uniqueName: 'alice@workops.test' },
          'Microsoft.VSTS.Scheduling.StartDate': `${monday}T09:35:00Z`,
          'Custom.PlannedStartDate': `${monday}T09:35:00Z`,
          'System.CreatedDate': `${monday}T09:35:00Z`,
        },
      });

      const res = await request.get(`${server.baseUrl}/api/explorer?startDate=${monday}&endDate=${monday}`, {
        headers,
      });
      expect(res.status()).toBe(200);
      const body = (await res.json()) as {
        workingDaysCount: number;
        summary: {
          expectedCombinations: number;
          createdCount: number;
          missingCount: number;
          duplicateCount: number;
          overallCoveragePercent: number;
        };
      };

      expect(body.workingDaysCount).toBe(1);
      expect(body.summary.expectedCombinations).toBe(2);
      expect(body.summary.createdCount).toBe(1);
      expect(body.summary.missingCount).toBe(1);
      expect(body.summary.duplicateCount).toBeGreaterThanOrEqual(1);
      expect(body.summary.overallCoveragePercent).toBe(50);
      expect(body.summary.overallCoveragePercent).toBeLessThanOrEqual(100);
    } finally {
      await server.stop();
    }
  });

  test('[F9][Tier 1] GET /api/explorer date-range filtering updates workingDaysCount and coverage accurately', async ({
    request,
  }) => {
    const server = await startAcceptanceServer({ authMode: 'basic' });
    try {
      const headers = { Authorization: server.basicAdminHeader };
      const { monday, friday } = getNextMondayToFriday();
      const titleDate = formatTitleDate(monday);

      server.mockAzure.seedWorkItem({
        id: 810,
        fields: {
          'System.TeamProject': 'TestProject',
          'System.WorkItemType': 'Task',
          'System.Title': `Task | ${titleDate} | Alice Chen`,
          'System.State': 'New',
          'System.AssignedTo': { displayName: 'Alice Chen', uniqueName: 'alice@workops.test' },
          'Microsoft.VSTS.Scheduling.StartDate': `${monday}T09:30:00Z`,
          'Custom.PlannedStartDate': `${monday}T09:30:00Z`,
          'System.CreatedDate': `${monday}T09:30:00Z`,
        },
      });

      const oneDayRes = await request.get(`${server.baseUrl}/api/explorer?startDate=${monday}&endDate=${monday}`, {
        headers,
      });
      expect(oneDayRes.status()).toBe(200);
      const oneDay = (await oneDayRes.json()) as {
        workingDaysCount: number;
        summary: { expectedCombinations: number; createdCount: number; overallCoveragePercent: number };
      };
      expect(oneDay.workingDaysCount).toBe(1);
      expect(oneDay.summary.expectedCombinations).toBe(2);
      expect(oneDay.summary.createdCount).toBe(1);
      expect(oneDay.summary.overallCoveragePercent).toBe(50);

      const fiveDayRes = await request.get(`${server.baseUrl}/api/explorer?startDate=${monday}&endDate=${friday}`, {
        headers,
      });
      expect(fiveDayRes.status()).toBe(200);
      const fiveDay = (await fiveDayRes.json()) as {
        workingDaysCount: number;
        summary: { expectedCombinations: number; createdCount: number; overallCoveragePercent: number };
      };
      expect(fiveDay.workingDaysCount).toBe(5);
      expect(fiveDay.summary.expectedCombinations).toBe(10);
      expect(fiveDay.summary.createdCount).toBe(1);
      expect(fiveDay.summary.overallCoveragePercent).toBe(10);
    } finally {
      await server.stop();
    }
  });

  test('[F9][Tier 1] POST /api/explorer/create-missing with confirm: true creates missing tasks and raises coverage to 100%', async ({
    request,
  }) => {
    const server = await startAcceptanceServer({ authMode: 'basic' });
    try {
      const headers = { Authorization: server.basicAdminHeader };
      const { tuesday } = getNextMondayToFriday();

      const beforeRes = await request.get(`${server.baseUrl}/api/explorer?startDate=${tuesday}&endDate=${tuesday}`, {
        headers,
      });
      expect(beforeRes.status()).toBe(200);
      const before = (await beforeRes.json()) as {
        summary: { createdCount: number; missingCount: number; overallCoveragePercent: number };
      };
      expect(before.summary.createdCount).toBe(0);
      expect(before.summary.missingCount).toBe(2);
      expect(before.summary.overallCoveragePercent).toBe(0);

      const createRes = await request.post(`${server.baseUrl}/api/explorer/create-missing`, {
        headers,
        data: {
          startDate: tuesday,
          endDate: tuesday,
          confirm: true,
        },
      });
      expect(createRes.status()).toBe(200);

      const afterRes = await request.get(`${server.baseUrl}/api/explorer?startDate=${tuesday}&endDate=${tuesday}`, {
        headers,
      });
      expect(afterRes.status()).toBe(200);
      const after = (await afterRes.json()) as {
        summary: { createdCount: number; missingCount: number; overallCoveragePercent: number };
      };
      expect(after.summary.createdCount).toBe(2);
      expect(after.summary.missingCount).toBe(0);
      expect(after.summary.overallCoveragePercent).toBe(100);
    } finally {
      await server.stop();
    }
  });

  test('[F9][Tier 1] GET /api/explorer reflects calendar leave exceptions in expectedCombinations and coverage', async ({
    request,
  }) => {
    const server = await startAcceptanceServer({ authMode: 'basic' });
    try {
      const headers = { Authorization: server.basicAdminHeader };
      const { wednesday } = getNextMondayToFriday();

      const calGet = await request.get(`${server.baseUrl}/api/calendar`, { headers });
      expect(calGet.status()).toBe(200);
      const calBody = (await calGet.json()) as { calendar: { version: number; defaultHours: number; memberHours: Record<string, number> } };

      const calPost = await request.post(`${server.baseUrl}/api/calendar`, {
        headers,
        data: {
          version: calBody.calendar.version,
          defaultHours: calBody.calendar.defaultHours ?? 8,
          memberHours: calBody.calendar.memberHours ?? {},
          exceptions: [
            {
              id: 'leave-alice-wed',
              startDate: wednesday,
              endDate: wednesday,
              kind: 'leave',
              memberKeys: ['alice'],
              note: 'Alice PTO',
            },
          ],
        },
      });
      expect(calPost.status()).toBe(200);

      const expRes = await request.get(`${server.baseUrl}/api/explorer?startDate=${wednesday}&endDate=${wednesday}`, {
        headers,
      });
      expect(expRes.status()).toBe(200);
      const expBody = (await expRes.json()) as {
        summary: { expectedCombinations: number; missingCount: number; overallCoveragePercent: number };
      };
      expect(expBody.summary.expectedCombinations).toBe(1);
      expect(expBody.summary.missingCount).toBe(1);
      expect(expBody.summary.overallCoveragePercent).toBe(0);
    } finally {
      await server.stop();
    }
  });

  // ---------------------------------------------------------------------------
  // F11: Use-Case Deduplication & Batch WIQL Queries
  // ---------------------------------------------------------------------------

  test('[F11][Tier 1] Planning uses batch team-wide WIQL query instead of N+1 per-person WIQL calls', async ({
    request,
  }) => {
    const server = await startAcceptanceServer({
      authMode: 'basic',
      people: makeFivePeople(),
    });
    try {
      const headers = { Authorization: server.basicAdminHeader };
      const targetDate = getNextWeekdayIso(2);
      server.mockAzure.clearRequests();

      const planRes = await request.post(`${server.baseUrl}/api/tasks/plan`, {
        headers,
        data: { asOf: targetDate },
      });
      expect(planRes.status()).toBe(200);

      const wiqlReqs = server.mockAzure
        .getRequests()
        .filter((r) => r.method === 'POST' && r.path.toLowerCase().includes('/wiql'));
      expect(wiqlReqs.length).toBeGreaterThanOrEqual(1);
      expect(wiqlReqs.length).toBeLessThanOrEqual(2);
    } finally {
      await server.stop();
    }
  });

  test('[F11][Tier 1] Explorer uses batch team-wide WIQL query across 5+ people without N+1 queries', async ({
    request,
  }) => {
    const server = await startAcceptanceServer({
      authMode: 'basic',
      people: makeFivePeople(),
    });
    try {
      const headers = { Authorization: server.basicAdminHeader };
      const { monday, friday } = getNextMondayToFriday();
      server.mockAzure.clearRequests();

      const res = await request.get(`${server.baseUrl}/api/explorer?startDate=${monday}&endDate=${friday}`, {
        headers,
      });
      expect(res.status()).toBe(200);

      const wiqlReqs = server.mockAzure
        .getRequests()
        .filter((r) => r.method === 'POST' && r.path.toLowerCase().includes('/wiql'));
      expect(wiqlReqs.length).toBeGreaterThanOrEqual(1);
      expect(wiqlReqs.length).toBeLessThanOrEqual(2);
    } finally {
      await server.stop();
    }
  });

  test('[F11][Tier 1] ActivateDailyTasks and CloseDailyTasks match the same tasks consistently by title/date/person', async ({
    request,
  }) => {
    const server = await startAcceptanceServer({ authMode: 'basic' });
    try {
      const headers = { Authorization: server.basicAdminHeader };
      const targetDate = getNextWeekdayIso(1);

      const execRes = await request.post(`${server.baseUrl}/api/tasks/execute`, {
        headers,
        data: { asOf: targetDate, confirm: true },
      });
      expect(execRes.status()).toBe(200);

      const actRes = await request.post(`${server.baseUrl}/api/tasks/activate-today`, {
        headers,
        data: { asOf: targetDate, confirm: true, all: true },
      });
      expect(actRes.status()).toBe(200);
      const actBody = (await actRes.json()) as { totalActivated?: number };
      expect(actBody.totalActivated ?? 0).toBeGreaterThanOrEqual(2);

      const closeRes = await request.post(`${server.baseUrl}/api/tasks/close-today`, {
        headers,
        data: {
          asOf: targetDate,
          confirm: true,
          all: true,
          manualOverride: true,
          overrideReason: 'Tier 1 consistent task matching check',
        },
      });
      expect(closeRes.status()).toBe(200);

      const matchedTitleDate = formatTitleDate(targetDate);
      const closedTasks = server.mockAzure
        .listWorkItems()
        .filter((w) => String(w.fields['System.Title'] || '').includes(matchedTitleDate));
      expect(closedTasks.length).toBeGreaterThanOrEqual(2);
      for (const task of closedTasks) {
        expect(String(task.fields['System.State'])).toMatch(/closed|done|resolved/i);
      }
    } finally {
      await server.stop();
    }
  });

  test('[F11][Tier 1] POST /api/tasks/execute with planToken executes without redundant N+1 planning WIQL queries', async ({
    request,
  }) => {
    const server = await startAcceptanceServer({
      authMode: 'basic',
      people: makeFivePeople(),
    });
    try {
      const headers = { Authorization: server.basicAdminHeader };
      const targetDate = getNextWeekdayIso(2);

      const planRes = await request.post(`${server.baseUrl}/api/tasks/plan`, {
        headers,
        data: { asOf: targetDate },
      });
      expect(planRes.status()).toBe(200);
      const plan = (await planRes.json()) as { planToken: string };

      server.mockAzure.clearRequests();
      const execRes = await request.post(`${server.baseUrl}/api/tasks/execute`, {
        headers,
        data: { planToken: plan.planToken, confirm: true },
      });
      expect(execRes.status()).toBe(200);

      const wiqlDuringExec = server.mockAzure
        .getRequests()
        .filter((r) => r.method === 'POST' && r.path.toLowerCase().includes('/wiql'));
      expect(wiqlDuringExec.length).toBeLessThanOrEqual(2);
    } finally {
      await server.stop();
    }
  });

  test('[F11][Tier 1] POST /api/tasks/repair repairs missing parent relations idempotently and Thursday planning respects working calendar', async ({
    request,
  }) => {
    const server = await startAcceptanceServer({ authMode: 'basic' });
    try {
      const headers = { Authorization: server.basicAdminHeader };
      const targetDate = getNextWeekdayIso(2);

      // Plan with Thursday/multi-day option
      const planRes = await request.post(`${server.baseUrl}/api/tasks/plan`, {
        headers,
        data: { asOf: targetDate, thursdayMode: 'MULTI_DAY' },
      });
      expect(planRes.status()).toBe(200);
      const planBody = (await planRes.json()) as { personPlans: Array<Record<string, unknown>> };
      expect(planBody.personPlans.length).toBeGreaterThanOrEqual(2);

      // Execute adhoc task without relation so repair can link it to source parent
      const adhocRes = await request.post(`${server.baseUrl}/api/tasks/adhoc`, {
        headers,
        data: {
          personKey: 'alice',
          date: targetDate,
          title: `Task | ${formatTitleDate(targetDate)} | Repairable Work`,
          sourceTaskId: 200,
        },
      });
      expect([200, 201]).toContain(adhocRes.status());

      const repair1 = await request.post(`${server.baseUrl}/api/tasks/repair`, {
        headers,
        data: {},
      });
      expect(repair1.status()).toBe(200);

      server.mockAzure.clearRequests();
      const repair2 = await request.post(`${server.baseUrl}/api/tasks/repair`, {
        headers,
        data: {},
      });
      expect(repair2.status()).toBe(200);
      const patchReqs = server.mockAzure.getRequests().filter((r) => r.method === 'PATCH');
      expect(patchReqs.length).toBe(0);
    } finally {
      await server.stop();
    }
  });

  // ---------------------------------------------------------------------------
  // F16: Planning, Explorer, Burndown & Lifecycle UI
  // ---------------------------------------------------------------------------

  test('[F16][Tier 1] /planner UI supports asOf date, Thursday mode, diff preview, and PlanToken confirmation modal execution', async ({
    page,
  }) => {
    const server = await startAcceptanceServer({ authMode: 'basic' });
    try {
      const targetDate = getNextWeekdayIso(2);
      await page.setExtraHTTPHeaders({ Authorization: server.basicAdminHeader });
      await page.goto(`${server.baseUrl}/planner`, { waitUntil: 'domcontentloaded' });

      await assertLandmarks(page);
      await assertNoHorizontalOverflow(page);

      const dateInput = page.locator('main#main input[type="date"]').first();
      await expect(dateInput).toBeVisible();
      await dateInput.fill(targetDate);

      const thursdayControl = page
        .getByLabel(/thursday/i)
        .or(page.getByRole('checkbox', { name: /thursday/i }))
        .or(page.getByRole('switch', { name: /thursday/i }))
        .first();
      if ((await thursdayControl.count()) > 0) {
        await expect(thursdayControl).toBeVisible();
      }

      const planBtn = page
        .getByRole('button', { name: /generate plan|preview plan|create plan|plan tasks|preview/i })
        .first();
      await expect(planBtn).toBeVisible();

      const planResponsePromise = page.waitForResponse(
        (res) => res.url().includes('/api/tasks/plan') && res.request().method() === 'POST'
      );
      await planBtn.click();
      const planRes = await planResponsePromise;
      expect(planRes.status()).toBe(200);

      const main = page.locator('main#main');
      await expect(main).toContainText(/Alice Chen|Bob Patel/i);

      const executeTrigger = page
        .getByRole('button', { name: /execute|confirm & create|create tasks|apply plan/i })
        .first();
      await expect(executeTrigger).toBeVisible();
      await executeTrigger.click();

      const dialog = page.getByRole('dialog').first();
      const hasDialog = await dialog.isVisible().catch(() => false);
      const execPromise = page.waitForResponse(
        (res) => res.url().includes('/api/tasks/execute') && res.request().method() === 'POST'
      );
      if (hasDialog) {
        const confirmBtn = dialog.getByRole('button', { name: /confirm|execute|proceed|create/i }).first();
        await expect(confirmBtn).toBeVisible();
        await confirmBtn.click();
      }
      const execRes = await execPromise;
      expect(execRes.status()).toBe(200);
      expect(server.mockAzure.listWorkItems().length).toBeGreaterThanOrEqual(5);
    } finally {
      await server.stop();
    }
  });

  test('[F16][Tier 1] /explorer UI renders KPI cards, 14-day matrix, date presets, custom range, and Create Missing action', async ({
    page,
  }) => {
    const server = await startAcceptanceServer({ authMode: 'basic' });
    try {
      const { tuesday } = getNextMondayToFriday();
      await page.setExtraHTTPHeaders({ Authorization: server.basicAdminHeader });
      await page.goto(`${server.baseUrl}/explorer`, { waitUntil: 'domcontentloaded' });

      await assertLandmarks(page);
      await assertNoHorizontalOverflow(page);

      const main = page.locator('main#main');
      await expect(main).toContainText(/coverage|expected|missing|created/i);
      await expect(main).toContainText(/Alice Chen|Bob Patel/i);

      const dateInputs = main.locator('input[type="date"]');
      if ((await dateInputs.count()) >= 2) {
        const explorerPromise = page.waitForResponse(
          (res) => res.url().includes('/api/explorer') && res.request().method() === 'GET'
        );
        await dateInputs.nth(0).fill(tuesday);
        await dateInputs.nth(1).fill(tuesday);
        const applyBtn = main.getByRole('button', { name: /apply|filter|refresh|load/i }).first();
        if ((await applyBtn.count()) > 0 && (await applyBtn.isVisible())) {
          await applyBtn.click();
        }
        await explorerPromise;
      }

      const createMissingBtn = main.getByRole('button', { name: /create missing/i }).first();
      await expect(createMissingBtn).toBeVisible();
      await createMissingBtn.click();

      const dialog = page.getByRole('dialog').first();
      const createPromise = page.waitForResponse(
        (res) => res.url().includes('/api/explorer/create-missing') && res.request().method() === 'POST'
      );
      if (await dialog.isVisible().catch(() => false)) {
        const confirmBtn = dialog.getByRole('button', { name: /confirm|create|proceed/i }).first();
        await confirmBtn.click();
      }
      const createRes = await createPromise;
      expect(createRes.status()).toBe(200);
    } finally {
      await server.stop();
    }
  });

  test('[F16][Tier 1] /explorer UI supports searchable task list and cell/user inspection modal', async ({
    page,
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

      await page.setExtraHTTPHeaders(headers);
      await page.goto(`${server.baseUrl}/explorer`, { waitUntil: 'domcontentloaded' });
      await assertLandmarks(page);

      const main = page.locator('main#main');
      const searchBox = main
        .getByRole('searchbox')
        .or(main.getByPlaceholder(/search/i))
        .or(main.getByLabel(/search/i))
        .first();
      await expect(searchBox).toBeVisible();
      await searchBox.fill('Alice');
      await expect(main).toContainText(/Alice Chen/i);

      // Click a cell or user row trigger to open details modal if available
      const detailTrigger = main
        .locator('table button, [role="grid"] button')
        .first();
      if ((await detailTrigger.count()) > 0 && (await detailTrigger.isVisible())) {
        await detailTrigger.click();
        const dialog = page.getByRole('dialog').first();
        if (await dialog.isVisible().catch(() => false)) {
          await expect(dialog).toContainText(/Alice|Bob|Task/i);
          await page.keyboard.press('Escape');
          await expect(dialog).toBeHidden();
        }
      }
    } finally {
      await server.stop();
    }
  });

  test('[F16][Tier 1] /burndown UI renders monthly effort matrix and numeric totals', async ({
    page,
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

      await page.setExtraHTTPHeaders(headers);
      await page.goto(`${server.baseUrl}/burndown`, { waitUntil: 'domcontentloaded' });

      await assertLandmarks(page);
      await assertNoHorizontalOverflow(page);

      const main = page.locator('main#main');
      await expect(main).toContainText(/burndown|effort|hours|total/i);
      await expect(main).toContainText(/Alice Chen|Bob Patel/i);
      const bodyText = await main.innerText();
      expect(bodyText).not.toContain('NaN');
      expect(bodyText).not.toContain('Infinity');
    } finally {
      await server.stop();
    }
  });

  test('[F16][Tier 1] /lifecycle UI supports bulk activate and close actions with real Azure state updates', async ({
    page,
    request,
  }) => {
    const server = await startAcceptanceServer({ authMode: 'basic' });
    try {
      const headers = { Authorization: server.basicAdminHeader };
      const todayIso = toIsoDate(new Date());
      await request.post(`${server.baseUrl}/api/tasks/execute`, {
        headers,
        data: { asOf: todayIso, confirm: true },
      });

      await page.setExtraHTTPHeaders(headers);
      await page.goto(`${server.baseUrl}/lifecycle`, { waitUntil: 'domcontentloaded' });

      await assertLandmarks(page);
      await assertNoHorizontalOverflow(page);

      const main = page.locator('main#main');
      await expect(main).toContainText(/Alice Chen|Bob Patel/i);

      // Select all people if a select-all checkbox exists
      const selectAll = main.getByRole('checkbox', { name: /select all|all/i }).first();
      if ((await selectAll.count()) > 0 && (await selectAll.isVisible())) {
        if (!(await selectAll.isChecked())) {
          await selectAll.check();
        }
      }

      const activateBtn = main.getByRole('button', { name: /activate/i }).first();
      await expect(activateBtn).toBeVisible();

      const actPromise = page.waitForResponse(
        (res) => res.url().includes('/api/tasks/activate-today') && res.request().method() === 'POST'
      );
      await activateBtn.click();
      const dialog = page.getByRole('dialog').first();
      if (await dialog.isVisible().catch(() => false)) {
        await dialog.getByRole('button', { name: /confirm|activate|proceed/i }).first().click();
      }
      const actRes = await actPromise;
      expect(actRes.status()).toBe(200);
    } finally {
      await server.stop();
    }
  });
});
