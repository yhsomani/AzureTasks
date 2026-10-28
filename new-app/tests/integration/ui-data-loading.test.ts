import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it, vi } from 'vitest';

const source = readFileSync(new URL('../../src/presentation/web/public/app.js', import.meta.url), 'utf8');

function harness(fetcher: typeof fetch) {
  const context = {
    document: { querySelector: () => null, querySelectorAll: () => [], addEventListener: () => undefined },
    window: {}, location: { hash: '#dashboard' }, console, setTimeout, clearTimeout,
    AbortController, DOMException, fetch: fetcher,
  };
  runInNewContext(source, context);
  return context;
}

describe('shared frontend read coordinator', () => {
  it('does not replace a completed forced refresh with an older ordinary response', async () => {
    const responses: Array<(response: Response) => void> = [];
    const context = harness(vi.fn(() => new Promise<Response>(resolve => responses.push(resolve))));
    const ordinary = runInNewContext('api.get("/status")', context);
    const fresh = runInNewContext('api.get("/status", { forceFresh: true })', context);
    responses[1](new Response(JSON.stringify({ data: { version: 2 } })));
    await fresh;
    responses[0](new Response(JSON.stringify({ data: { version: 1 } })));
    await ordinary;
    expect(runInNewContext('state.cache.get("/status").data.version', context)).toBe(2);
  });

  it('does not return cached success after an obsolete request was cancelled', async () => {
    const responses: Array<(response: Response) => void> = [];
    const context = harness(vi.fn(() => new Promise<Response>(resolve => responses.push(resolve))));
    runInNewContext('state.cache.set("/old", { data: { stale: true }, timestamp: 0 })', context);
    const obsolete = runInNewContext('api.get("/old", { abortKey: "scope", forceFresh: true })', context);
    const current = runInNewContext('api.get("/new", { abortKey: "scope" })', context);
    responses[0](new Response(JSON.stringify({ data: { stale: true } })));
    await expect(obsolete).rejects.toThrow('superseded');
    responses[1](new Response(JSON.stringify({ data: { current: true } })));
    await expect(current).resolves.toEqual({ current: true });
  });

  it('forces a new transport instead of joining an older ordinary read', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ data: {} })));
    const context = harness(fetcher);
    await runInNewContext('Promise.all([api.get("/status"), api.get("/status", { forceFresh: true })])', context);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('invalidates cached reads when a remote mutation succeeds', async () => {
    const context = harness(vi.fn(async () => new Response(JSON.stringify({ data: {} }))));
    await runInNewContext('api.get("/explorer")', context);
    await runInNewContext('api.post("/tasks/execute", { confirm: true })', context);
    expect(runInNewContext('state.cache.size', context)).toBe(0);
  });

  it('does not execute all-team planning when opening the dashboard', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ data: {} })));
    const context = harness(fetcher);
    const requested = await runInNewContext(`(async () => {
      const reads = [];
      api.get = async url => { reads.push(url); throw new Error('offline'); };
      api.post = async () => { throw new Error('Dashboard must not plan'); };
      refreshDashboard();
      await new Promise(resolve => setTimeout(resolve, 0));
      return reads;
    })()`, context);
    expect(requested.filter((url: string) => url.startsWith('/explorer'))).toHaveLength(1);
    const dashboard = source.slice(source.indexOf('async function refreshDashboard()'), source.indexOf('let dailyPrTimer'));
    expect(dashboard).not.toContain("api.post('/tasks/plan'");
  });

  it('shares one transport for simultaneous identical requests', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ data: { connected: true } })));
    const context = harness(fetcher);
    const values = await runInNewContext('Promise.all(Array.from({ length: 10 }, () => api.get("/status")))', context);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(values).toHaveLength(10);
  });

  it('does not repopulate invalidated cache from an older response', async () => {
    let respond!: (response: Response) => void;
    const context = harness(vi.fn(() => new Promise<Response>(resolve => { respond = resolve; })));
    const pending = runInNewContext('api.get("/explorer")', context);
    runInNewContext('api.invalidateCache("/explorer")', context);
    respond(new Response(JSON.stringify({ data: { old: true } })));
    await pending;
    expect(runInNewContext('state.cache.has("/explorer")', context)).toBe(false);
  });

  it('bounds cache growth to fifty read scopes', async () => {
    const context = harness(vi.fn(async () => new Response(JSON.stringify({ data: [] }))));
    await runInNewContext('(async () => { for (let index = 0; index < 70; index++) await api.get(`/scope?index=${index}`); })()', context);
    expect(runInNewContext('state.cache.size', context)).toBe(50);
  });

  it('allows viewers to preview activation without allowing live activation', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ data: { dryRun: true } })));
    const context = harness(fetcher);
    runInNewContext('state.viewerMode = true', context);
    await expect(runInNewContext('api.post("/tasks/activate-today", { dryRun: true })', context)).resolves.toEqual({ dryRun: true });
    await expect(runInNewContext('api.post("/tasks/activate-today", { confirm: true })', context)).rejects.toThrow('Read-only');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});