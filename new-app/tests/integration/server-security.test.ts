import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppServer } from '../../src/presentation/api/server';
import { ApiDependencies } from '../../src/presentation/api/routes';

afterEach(() => vi.unstubAllEnvs());

describe('Production web server access controls', () => {
  it('refuses production startup without API authentication', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('API_AUTH_TOKEN', '');
    expect(() => new AppServer({} as ApiDependencies, 0))
      .toThrow(/API_AUTH_TOKEN must be configured in production/);
  });
  it('allows the configured public HTTPS origin behind a local reverse proxy', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('API_AUTH_TOKEN', 'test-only-secret');
    vi.stubEnv('PUBLIC_ORIGIN', 'https://tasks.example.invalid');

    const triggerRunNow = vi.fn(async () => ({ success: true, message: 'fixture accepted' }));
    const deps = {
      scheduler: { triggerRunNow, getStatus: () => ({ running: false }) },
    } as unknown as ApiDependencies;
    const server = new AppServer(deps, 0);
    const port = await server.start();
    const destination = `http://127.0.0.1:${port}/api/scheduler/run-now`;
    const authorization = `Basic ${Buffer.from('admin:test-only-secret').toString('base64')}`;

    try {
      const accepted = await fetch(destination, {
        method: 'POST',
        headers: { Authorization: authorization, Origin: 'https://tasks.example.invalid' },
      });
      expect(accepted.status).toBe(200);
      const rejected = await fetch(destination, {
        method: 'POST',
        headers: { Authorization: authorization, Origin: 'https://tasks.example.invalid.attacker.invalid' },
      });
      expect(rejected.status).toBe(403);
      expect(triggerRunNow).toHaveBeenCalledTimes(1);
    } finally {
      await server.stop();
    }
  });

  it('rejects an invalid wildcard public origin before the server starts', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('API_AUTH_TOKEN', 'test-only-secret');
    vi.stubEnv('PUBLIC_ORIGIN', 'https://*.example.invalid');
    expect(() => new AppServer({} as ApiDependencies, 0))
      .toThrow(/PUBLIC_ORIGIN must be an exact HTTP\(S\) origin/);
  });

});
