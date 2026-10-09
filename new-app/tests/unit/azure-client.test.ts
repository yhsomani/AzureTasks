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
});
