import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, apiRequest } from '../../src/presentation/web/src/api/client.js';

describe('React SPA API client data-loading contracts', () => {
  beforeEach(() => {
    api.invalidateCache();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    api.invalidateCache();
  });

  it('caches GET responses within the 10s SWR window and bypasses cache with skipCache', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ success: true, data: { version: fetchMock.mock.calls.length } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    const first = await api.get<{ version: number }>('/api/status');
    const cached = await api.get<{ version: number }>('/api/status');
    const fresh = await api.get<{ version: number }>('/api/status', { skipCache: true });

    expect(first).toEqual({ version: 1 });
    expect(cached).toEqual({ version: 1 });
    expect(fresh).toEqual({ version: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('invalidates cached GET entries selectively by pattern or completely', async () => {
    const fetchMock = vi.fn(async (url: string) =>
      new Response(JSON.stringify({ success: true, data: { url, hit: fetchMock.mock.calls.length } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    await api.get('/api/explorer?preset=week');
    await api.get('/api/config');

    api.invalidateCache('/explorer');

    await api.get('/api/config');
    expect(fetchMock).toHaveBeenCalledTimes(2);

    await api.get('/api/explorer?preset=week');
    expect(fetchMock).toHaveBeenCalledTimes(3);

    api.invalidateCache();
    await api.get('/api/config');
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it('unwraps json.data when present and returns full JSON payload otherwise', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true, data: { wrapped: true } }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: true, status: 'alive' }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        })
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(api.get('/api/wrapped')).resolves.toEqual({ wrapped: true });
    await expect(api.get('/api/health')).resolves.toEqual({ success: true, status: 'alive' });
  });

  it('surfaces clear error messages for 401, 403, and success=false API responses', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }))
      .mockResolvedValueOnce(new Response('Forbidden', { status: 403 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ success: false, error: 'Explicit confirm=true is required.' }), {
          status: 400,
          headers: { 'content-type': 'application/json' },
        })
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(api.get('/api/status')).rejects.toThrow(/Authentication required/);
    await expect(api.post('/api/tasks/execute', { confirm: true })).rejects.toThrow(/Access denied/);
    await expect(api.post('/api/tasks/execute', { confirm: false })).rejects.toThrow(
      'Explicit confirm=true is required.'
    );
  });

  it('normalizes aborted/timed-out requests to a deterministic timeout error', async () => {
    const fetchMock = vi.fn(async () => {
      throw new DOMException('The operation was aborted.', 'AbortError');
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiRequest('/api/slow', { timeoutMs: 250 })).rejects.toThrow('Request timed out after 250ms.');
  });

  it('sends JSON Content-Type on mutations and never reads mutations from GET cache', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ success: true, data: { ok: true } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );
    vi.stubGlobal('fetch', fetchMock);

    await api.get('/api/auto-closure/config');
    await api.put('/api/auto-closure/config', { enabled: true, rules: [] });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, putInit] = fetchMock.mock.calls[1] as unknown as [string, RequestInit];
    expect(putInit.method).toBe('PUT');
    expect((putInit.headers as Headers).get('Content-Type')).toBe('application/json');
  });
});
