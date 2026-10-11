import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { AppServer } from '../../src/presentation/api/server';
import { ApiDependencies } from '../../src/presentation/api/routes';

function makeDeps(): ApiDependencies {
  return {
    getStatus: {
      execute: vi.fn(async () => ({ connected: true, organization: 'Org', project: 'Proj' })),
    },
    planTasks: {
      execute: vi.fn(async () => ({ todayIso: '2026-10-08', nextThursdayIso: '2026-10-08', personPlans: [] })),
    },
    exploreTasks: {
      execute: vi.fn(async () => ({
        dateRange: { startDate: '2026-10-08', endDate: '2026-10-15', totalDays: 8, workingDays: 6, todayIso: '2026-10-08', nextThursdayIso: '2026-10-15' },
        summary: { totalSelectedUsers: 1, totalWorkingDates: 6, expectedCombinations: 6, existingCombinations: 4, missingCombinations: 2, duplicateCombinations: 0, overallCoveragePercent: 67, stateCounts: { New: 1, Active: 2, Closed: 1, Resolved: 0, Other: 0 }, totalCompletedWork: 16, totalRemainingWork: 8 },
        users: [{ key: 'p1', name: 'Person 1', assignedTo: 'p1@org.com' }],
        dates: [],
        matrix: [],
        detailedTasks: [],
      })),
    },
    createTasks: {
      execute: vi.fn(async () => ({
        totalCreatedCount: 1,
        totalDuplicateCount: 0,
        totalTaskFailureCount: 0,
        totalSourceFailureCount: 0,
        personResults: [],
      })),
    },
    config: {
      getConfig: vi.fn(async () => ({ organization: 'Org', project: 'Proj' })),
      savePeople: vi.fn(async () => ({ message: 'ok', people: [] })),
      saveSettings: vi.fn(async () => ({ message: 'ok' })),
      savePat: vi.fn(async () => ({ message: 'ok', patMasked: 'abcd...wxyz' })),
    },
    journal: {
      record: vi.fn(async () => {}),
      getEntries: vi.fn(async () => []),
      getUnfinishedRelations: vi.fn(async () => []),
      markRepaired: vi.fn(async () => true),
      exportCsv: vi.fn(async () => 'a,b\n1,2'),
      exportJson: vi.fn(async () => '[]'),
    },
    scheduler: {
      getStatus: vi.fn(() => ({ running: false, timezone: 'UTC' })),
      start: vi.fn(),
      stop: vi.fn(),
      setSchedule: vi.fn(),
    },
  } as unknown as ApiDependencies;
}

let deps: ApiDependencies;
let server: AppServer;
let base: string;

beforeAll(async () => {
  deps = makeDeps();
  server = new AppServer(deps, 0); // ephemeral port
  const port = await server.start();
  base = `http://127.0.0.1:${port}`;
});

afterAll(async () => {
  await server.stop();
});

const json = (path: string, init?: RequestInit) => fetch(base + path, init);

describe('API routes', () => {
  it('GET /api/health', async () => {
    const res = await json('/api/health');
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe('healthy');
  });

  it('GET /api/status wraps use-case output', async () => {
    const res = await json('/api/status');
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data.organization).toBe('Org');
  });

  it('POST /api/tasks/plan defaults to all people', async () => {
    const res = await json('/api/tasks/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    expect((deps.planTasks.execute as any).mock.calls[0][0]).toMatchObject({ all: true });
  });

  it('POST /api/tasks/plan returns 400 on use-case failure', async () => {
    (deps.planTasks.execute as any).mockRejectedValueOnce(new Error('no PAT'));
    const res = await json('/api/tasks/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('no PAT');
  });

  it('POST /api/tasks/execute forwards onProgress and forces yes=true', async () => {
    await json('/api/tasks/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ all: true }),
    });
    const [input, onProgress] = (deps.createTasks.execute as any).mock.calls[0];
    expect(input.yes).toBe(true);
    expect(typeof onProgress).toBe('function');
  });

  it('GET /api/explorer delegates to exploreTasks use case with query params', async () => {
    const res = await json('/api/explorer?preset=current_month&users=p1,p2');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.summary.overallCoveragePercent).toBe(67);
    expect((deps.exploreTasks.execute as any).mock.calls[0][0]).toMatchObject({
      preset: 'current_month',
      personKeys: ['p1', 'p2'],
    });
  });

  it('POST /api/explorer/create-missing calls createTasks and returns count summary', async () => {
    const res = await json('/api/explorer/create-missing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ personKeys: ['p1'] }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.message).toContain('evaluated and created');
  });

  it('GET /api/journal reports counts', async () => {
    (deps.journal.getEntries as any).mockResolvedValueOnce([{ runId: 'r' }]);
    const res = await json('/api/journal?limit=10');
    const body = await res.json();
    expect(body.data.totalEntries).toBe(1);
    expect(body.data.entries).toHaveLength(1);
  });

  it('GET /api/journal/export?format=csv sets a download header', async () => {
    const res = await json('/api/journal/export?format=csv');
    expect(res.headers.get('content-type')).toContain('text/csv');
    expect(res.headers.get('content-disposition')).toContain('attachment');
  });

  it('POST /api/scheduler/toggle enables the scheduler', async () => {
    const res = await json('/api/scheduler/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true }),
    });
    expect(res.status).toBe(200);
    expect((deps.scheduler.start as any)).toHaveBeenCalled();
  });

  it('GET /api/logs/stream responds as an SSE stream', async () => {
    const controller = new AbortController();
    const res = await fetch(base + '/api/logs/stream', { signal: controller.signal });
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    controller.abort();
  });

  it('serves the SPA at /', async () => {
    const res = await json('/');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('3in1 Task Studio');
  });
});

describe('API auth (HTTP Basic, opt-in via API_AUTH_TOKEN)', () => {
  let authServer: AppServer;
  let authBase: string;
  const prev = { token: process.env.API_AUTH_TOKEN, user: process.env.API_AUTH_USER };

  beforeAll(async () => {
    process.env.API_AUTH_TOKEN = 'sekret';
    process.env.API_AUTH_USER = 'admin';
    authServer = new AppServer(makeDeps(), 0);
    const port = await authServer.start();
    authBase = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await authServer.stop();
    if (prev.token === undefined) delete process.env.API_AUTH_TOKEN;
    else process.env.API_AUTH_TOKEN = prev.token;
    if (prev.user === undefined) delete process.env.API_AUTH_USER;
    else process.env.API_AUTH_USER = prev.user;
  });

  const basic = (creds: string) => ({
    Authorization: `Basic ${Buffer.from(creds).toString('base64')}`,
  });

  it('rejects unauthenticated API calls with a Basic challenge', async () => {
    const res = await fetch(authBase + '/api/status');
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toContain('Basic');
  });

  it('accepts the correct credentials', async () => {
    const res = await fetch(authBase + '/api/status', { headers: basic('admin:sekret') });
    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
  });

  it('rejects wrong credentials', async () => {
    const res = await fetch(authBase + '/api/status', { headers: basic('admin:wrong') });
    expect(res.status).toBe(401);
  });

  it('keeps the health probe public', async () => {
    const res = await fetch(authBase + '/api/health');
    expect(res.status).toBe(200);
  });
});
