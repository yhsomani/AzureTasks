import { describe, it, expect, vi, afterEach } from 'vitest';
import { AzureDevOpsClient } from '../../src/infrastructure/azure/client';

afterEach(() => vi.restoreAllMocks());

describe('AzureDevOpsClient', () => {
  it('fails fast without a PAT and never performs a network call', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const client = new AzureDevOpsClient({ organization: 'org', pat: '' });
    await expect(client.get('/x')).rejects.toThrow(/not configured/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('does not retry authentication failures', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('', { status: 401 }));
    const client = new AzureDevOpsClient({ organization: 'org', pat: 'x', initialRetryDelayMs: 0 });
    await expect(client.get('/x')).rejects.toThrow(/Authentication failed/i);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('retries on 5xx and then succeeds', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response('', { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const client = new AzureDevOpsClient({ organization: 'org', pat: 'x', initialRetryDelayMs: 0 });
    const result = await client.get<{ ok: boolean }>('/x');
    expect(result.ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('converts a low-level fetch failure into an actionable message', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('fetch failed'));
    const client = new AzureDevOpsClient({
      organization: 'org',
      pat: 'x',
      maxRetries: 0,
      initialRetryDelayMs: 0,
    });
    await expect(client.get('/x')).rejects.toThrow(/Network error contacting Azure DevOps/);
  });

  it('reads the organization live so config edits apply without a restart', async () => {
    const cfg = { organization: 'org-a', pat: 'x' };
    const client = new AzureDevOpsClient(cfg);
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

    cfg.organization = 'org-b';
    await client.get('/x');

    expect(String(fetchSpy.mock.calls[0][0])).toContain('/org-b/');
  });

  it('resolves the PAT from the environment when no explicit PAT is pinned', async () => {
    const prev = process.env.AZURE_DEVOPS_PAT;
    process.env.AZURE_DEVOPS_PAT = 'env-pat';
    try {
      const client = new AzureDevOpsClient({ organization: 'org' });
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));

      await client.get('/x');

      const headers = fetchSpy.mock.calls[0][1]?.headers as Record<string, string>;
      const expected = `Basic ${Buffer.from(':env-pat').toString('base64')}`;
      expect(headers.Authorization).toBe(expected);
    } finally {
      if (prev === undefined) delete process.env.AZURE_DEVOPS_PAT;
      else process.env.AZURE_DEVOPS_PAT = prev;
    }
  });

  it('sends application/json-patch+json Content-Type on PATCH requests by default', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const client = new AzureDevOpsClient({ organization: 'org', pat: 'x' });

    await client.patch('/_apis/wit/workitems/123?api-version=7.0', [{ op: 'add', path: '/fields/System.Title', value: 'Test' }]);

    const headers = fetchSpy.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json-patch+json');
  });

  it('sends application/json-patch+json Content-Type on work item creation POST requests', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const client = new AzureDevOpsClient({ organization: 'org', pat: 'x' });

    await client.post('/Proj/_apis/wit/workitems/$Task?api-version=7.0', [{ op: 'add', path: '/fields/System.Title', value: 'Test' }]);

    const headers = fetchSpy.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json-patch+json');
  });

  it('returns an actionable error after the final HTTP 429 rather than a generic retry failure', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('', { status: 429, headers: { 'Retry-After': '0' } }));
    const client = new AzureDevOpsClient({ organization: 'org', pat: 'x', maxRetries: 1, initialRetryDelayMs: 0 });
    await expect(client.get('/x')).rejects.toThrow(/rate limit exceeded.*429/i);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it('reports the final 5xx response after retry exhaustion', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('', { status: 503 }));
    const client = new AzureDevOpsClient({ organization: 'org', pat: 'x', maxRetries: 0 });
    await expect(client.get('/x')).rejects.toThrow(/HTTP 503/);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('sends application/json Content-Type on standard POST requests', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const client = new AzureDevOpsClient({ organization: 'org', pat: 'x' });

    await client.post('/Proj/_apis/wit/wiql?api-version=7.0', { query: 'SELECT [System.Id] FROM WorkItems' });

    const headers = fetchSpy.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('allows overriding Content-Type in request options', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    const client = new AzureDevOpsClient({ organization: 'org', pat: 'x' });

    await client.post('/custom', { foo: 'bar' }, { headers: { 'Content-Type': 'application/custom+json' } });

    const headers = fetchSpy.mock.calls[0][1]?.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/custom+json');
  });
  it('does not replay a work-item creation after HTTP 503', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 503 }));
    const client = new AzureDevOpsClient({ organization: 'org', pat: 'x', maxRetries: 3, initialRetryDelayMs: 0 });
    await expect(client.post('/Proj/_apis/wit/workitems/$Task?api-version=7.0', []))
      .rejects.toThrow(/outcome is uncertain/i);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('does not replay a JSON PATCH when the response times out', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('socket closed'));
    const client = new AzureDevOpsClient({ organization: 'org', pat: 'x', maxRetries: 3, initialRetryDelayMs: 0 });
    await expect(client.patch('/_apis/wit/workitems/42?api-version=7.0', []))
      .rejects.toThrow(/outcome may have been committed/i);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

});
