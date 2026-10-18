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
      executeAdHocTask: vi.fn(async () => ({
        success: true,
        task: { id: 999, title: 'Ad-Hoc Task', isoDate: '2026-10-15', url: 'https://dev.azure.com/_workitems/edit/999' },
      })),
    },
    config: {
      getConfig: vi.fn(async () => ({ organization: 'Org', project: 'Proj' })),
      savePeople: vi.fn(async () => ({ message: 'ok', people: [] })),
      saveSettings: vi.fn(async () => ({ message: 'ok' })),
      savePat: vi.fn(async () => ({ message: 'ok', patMasked: 'abcd...wxyz' })),
    },
    repairRelations: {
      execute: vi.fn(async () => ({ total: 1, repaired: 1, partial: 0, failed: 0, skipped: 0, rows: [] })),
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
      getStatus: vi.fn(() => ({ running: false, timezone: 'UTC', startTime: '09:30', autoStart: false })),
      start: vi.fn(),
      stop: vi.fn(),
      setSchedule: vi.fn(),
      configure: vi.fn(async () => {}),
      triggerRunNow: vi.fn(async () => ({ success: true, message: 'Executed' })),
      triggerAutoCloseNow: vi.fn(async () => ({ success: true, message: 'Auto-close executed' })),
    },
    closeDailyTasks: {
      execute: vi.fn(async () => ({
        targetDate: '2026-10-15',
        timezone: 'Asia/Kolkata',
        dryRun: false,
        totalFound: 1,
        totalClosed: 1,
        totalAlreadyClosed: 0,
        totalFailed: 0,
        results: [],
      })),
    },
    githubClient: {
      resolveUserByEmail: vi.fn(async () => 'test_user'),
      getPrDeliverablesForDate: vi.fn(async () => ({
        username: 'test_user',
        sourceDate: '2026-10-15',
        isToday: true,
        pullRequests: [],
        htmlDescription: '<p>PRs</p>',
        summaryText: 'PRs found',
      })),
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
    expect((await res.json()).status).toBe('alive');
  });

  it('does not grant cross-origin browser access by default', async () => {
    const res = await json('/api/health', {
      headers: { Origin: 'https://attacker.example.invalid' },
    });
    expect(res.headers.get('access-control-allow-origin')).toBeNull();
  });

  it('returns JSON 404 for an unknown API route rather than the dashboard HTML', async () => {
    const response = await json('/api/not-a-real-endpoint');
    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toContain('application/json');
    const body = await response.json();
    expect(body.success).toBe(false);
  });

  it('does not return a success-shaped HTML response for an unknown API mutation', async () => {
    const response = await json('/api/not-a-real-mutation', { method: 'POST' });
    expect(response.status).toBe(404);
    expect((await response.json()).success).toBe(false);
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

  it('rejects implicit all-member creation for an omitted or empty selection', async () => {
    vi.mocked(deps.createTasks.execute).mockClear();
    for (const input of [{}, { personKeys: [] }, { personKeys: 'p1' }]) {
      const response = await json('/api/tasks/execute', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      expect(response.status).toBe(400);
    }
    expect(deps.createTasks.execute).not.toHaveBeenCalled();
  });

  it('allows an intentional all-member creation only with all=true', async () => {
    vi.mocked(deps.createTasks.execute).mockClear();
    const response = await json('/api/tasks/execute', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ all: true }),
    });
    expect(response.status).toBe(200);
    expect(deps.createTasks.execute).toHaveBeenCalledWith(expect.objectContaining({
      all: true,
    }), expect.any(Function));
  });

  it('rejects an empty explicit task-planning selection rather than planning for everyone', async () => {
    vi.mocked(deps.planTasks.execute).mockClear();
    const response = await json('/api/tasks/plan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ personKeys: [] }),
    });
    expect(response.status).toBe(400);
    expect(deps.planTasks.execute).not.toHaveBeenCalled();
  });

  it('rejects implicit all-member Explorer create-missing execution', async () => {
    vi.mocked(deps.createTasks.execute).mockClear();
    for (const input of [{}, { personKeys: [] }]) {
      const response = await json('/api/explorer/create-missing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      });
      expect(response.status).toBe(400);
    }
    expect(deps.createTasks.execute).not.toHaveBeenCalled();
  });

  it('POST /api/tasks/adhoc creates a custom single task', async () => {
    const res = await json('/api/tasks/adhoc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        personKey: 'p1',
        targetIsoDate: '2026-10-15',
        customTitle: 'Custom Task Title',
      }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.task.id).toBe(999);
    expect((deps.createTasks.executeAdHocTask as any)).toHaveBeenCalledWith(expect.objectContaining({
      personKey: 'p1',
      targetIsoDate: '2026-10-15',
      customTitle: 'Custom Task Title',
    }));
  });

  it('POST /api/tasks/repair delegates to repairRelations use case', async () => {
    const res = await json('/api/tasks/repair', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: true }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.repaired).toBe(1);
    expect(deps.repairRelations?.execute).toHaveBeenCalled();
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

  it('rejects ad-hoc duplicate bypass and invalid numeric fields at the HTTP boundary', async () => {
    const bypass = await json('/api/tasks/adhoc', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ personKey: 'p1', targetIsoDate: '2026-11-02', bypassDuplicateCheck: true }),
    });
    expect(bypass.status).toBe(400);
    const badSource = await json('/api/tasks/adhoc', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ personKey: 'p1', targetIsoDate: '2026-11-02', sourceTaskId: '123oops' }),
    });
    expect(badSource.status).toBe(400);
  });

  it('POST /api/scheduler/toggle enables the scheduler', async () => {
    const res = await json('/api/scheduler/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true, persist: true }),
    });
    expect(res.status).toBe(200);
    expect((deps.scheduler.start as any)).toHaveBeenCalledWith(true);
  });

  it('reports a refused scheduler run as HTTP 409, not a successful queued run', async () => {
    (deps.scheduler.triggerRunNow as any).mockResolvedValueOnce({ success: false, message: 'Already executing' });
    const res = await json('/api/scheduler/run-now', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: true, all: true }),
    });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toContain('Already executing');
  });

  it('POST /api/scheduler/config reconfigures schedule settings', async () => {
    const res = await json('/api/scheduler/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ startTime: '10:15', timezone: 'Asia/Kolkata', autoStart: true }),
    });
    expect(res.status).toBe(200);
    expect((deps.scheduler.configure as any)).toHaveBeenCalledWith({
      startTime: '10:15',
      timezone: 'Asia/Kolkata',
      autoStart: true,
    });
  });

  it('POST /api/scheduler/run-now triggers immediate execution', async () => {
    const res = await json('/api/scheduler/run-now', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: true, all: true }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect((deps.scheduler.triggerRunNow as any)).toHaveBeenCalled();
  });

  it('POST /api/tasks/close-today delegates to closeDailyTasks use case', async () => {
    const res = await json('/api/tasks/close-today', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dryRun: false, all: true, asOf: '2026-10-15' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(deps.closeDailyTasks?.execute).toHaveBeenCalledWith(
      expect.objectContaining({ dryRun: false, asOf: '2026-10-15' })
    );
  });

  it('rejects EOD remote writes without an explicit member or all=true scope', async () => {
    const close = deps.closeDailyTasks?.execute as any;
    close.mockClear();
    const res = await json('/api/tasks/close-today', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dryRun: false }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).success).toBe(false);
    expect(close).not.toHaveBeenCalled();
  });

  it('permits a read-only all-member EOD preview without a mutation scope', async () => {
    const res = await json('/api/tasks/close-today', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dryRun: true }),
    });
    expect(res.status).toBe(200);
    expect(deps.closeDailyTasks?.execute).toHaveBeenCalledWith(
      expect.objectContaining({ dryRun: true })
    );
  });

  it('POST /api/scheduler/trigger-autoclose triggers auto-close immediately', async () => {
    const res = await json('/api/scheduler/trigger-autoclose', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: true, all: true }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect((deps.scheduler.triggerAutoCloseNow as any)).toHaveBeenCalled();
  });

  it('blocks unconfirmed repair and scheduler remote operations before use-case execution', async () => {
    const repair = deps.repairRelations?.execute as any;
    const schedule = deps.scheduler.triggerRunNow as any;
    const closure = deps.scheduler.triggerAutoCloseNow as any;
    repair.mockClear();
    schedule.mockClear();
    closure.mockClear();
    for (const path of ['/api/tasks/repair', '/api/scheduler/run-now', '/api/scheduler/trigger-autoclose']) {
      const res = await json(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      expect(res.status).toBe(400);
    }
    expect(repair).not.toHaveBeenCalled();
    expect(schedule).not.toHaveBeenCalled();
    expect(closure).not.toHaveBeenCalled();
  });

  it('GET /api/github/test-user resolves user and returns deliverables', async () => {
    const res = await json('/api/github/test-user?email=test%40org.com');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
    expect(body.data.username).toBe('test_user');
    expect(deps.githubClient?.resolveUserByEmail).toHaveBeenCalledWith('test@org.com');
  });

  it('GET /api/logs/stream responds as an SSE stream', async () => {
    const controller = new AbortController();
    const res = await fetch(base + '/api/logs/stream', { signal: controller.signal });
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    controller.abort();
  });

  it('distinguishes liveness from live Azure DevOps readiness', async () => {
    const health = await json('/api/health');
    expect(health.status).toBe(200);
    expect((await health.json()).status).toBe('alive');

    (deps.getStatus.execute as any).mockResolvedValueOnce({
      connected: false, projectValid: false, workItemTypeValid: false,
    });
    const unavailable = await json('/api/ready');
    expect(unavailable.status).toBe(503);
    expect((await unavailable.json()).data.status).toBe('unavailable');
  });

  it('serves the SPA at /', async () => {
    const res = await json('/');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('3in1 Task Studio');
  });
});

describe('API auth (HTTP Basic, opt-in via API_AUTH_TOKEN)', () => {
  let authServer: AppServer;
  let authDeps: ApiDependencies;
  let authBase: string;
  const prev = { token: process.env.API_AUTH_TOKEN, user: process.env.API_AUTH_USER };

  beforeAll(async () => {
    process.env.API_AUTH_TOKEN = 'sekret';
    process.env.API_AUTH_USER = 'admin';
    authDeps = makeDeps();
    authServer = new AppServer(authDeps, 0);
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

  it('rejects credentialed cross-origin scheduler POST before any mutation runs', async () => {
    vi.mocked(authDeps.scheduler.triggerRunNow!).mockClear();
    const res = await fetch(authBase + '/api/scheduler/run-now', {
      method: 'POST',
      headers: { ...basic('admin:sekret'), Origin: 'https://attacker.example.invalid' },
    });
    expect(res.status).toBe(403);
    expect((await res.json()).success).toBe(false);
    expect(authDeps.scheduler.triggerRunNow).not.toHaveBeenCalled();
  });

  it('rejects Origin: null and a forged similar-host origin', async () => {
    for (const origin of ['null', new URL(authBase).origin + '.attacker.example.invalid']) {
      const res = await fetch(authBase + '/api/scheduler/run-now', {
        method: 'POST',
        headers: { ...basic('admin:sekret'), Origin: origin },
      });
      expect(res.status).toBe(403);
    }
  });

  it('rejects browser Fetch Metadata cross-site mutations without Origin', async () => {
    const res = await fetch(authBase + '/api/scheduler/run-now', {
      method: 'POST',
      headers: { ...basic('admin:sekret'), 'Sec-Fetch-Site': 'cross-site' },
    });
    expect(res.status).toBe(403);
  });

  it('accepts same-origin browser mutation and a non-browser CLI request', async () => {
    vi.mocked(authDeps.scheduler.triggerRunNow!).mockClear();
    const ownOrigin = new URL(authBase).origin;
    const sameOrigin = await fetch(authBase + '/api/scheduler/run-now', {
      method: 'POST',
      headers: { ...basic('admin:sekret'), 'Content-Type': 'application/json', Origin: ownOrigin, 'Sec-Fetch-Site': 'same-origin' },
      body: JSON.stringify({ confirm: true, all: true }),
    });
    expect(sameOrigin.status).toBe(200);
    const cli = await fetch(authBase + '/api/scheduler/run-now', {
      method: 'POST',
      headers: { ...basic('admin:sekret'), 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirm: true, all: true }),
    });
    expect(cli.status).toBe(200);
    expect(authDeps.scheduler.triggerRunNow).toHaveBeenCalledTimes(2);
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
