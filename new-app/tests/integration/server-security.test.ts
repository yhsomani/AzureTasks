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
});
