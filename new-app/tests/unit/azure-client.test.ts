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
});
