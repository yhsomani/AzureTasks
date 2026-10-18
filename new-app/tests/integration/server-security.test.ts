import { afterEach, describe, expect, it, vi } from 'vitest';
import * as http from 'node:http';
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
  it('offers an optional viewer role that cannot execute mutations', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('API_AUTH_TOKEN', 'operator-test-secret');
    vi.stubEnv('API_VIEWER_TOKEN', 'viewer-test-secret');
    vi.stubEnv('API_VIEWER_USER', 'auditor');
    const triggerRunNow = vi.fn(async () => ({ success: true, message: 'triggered' }));
    const plan = vi.fn(async () => ({ personPlans: [] }));
    const closure = vi.fn(async () => ({ totalFound: 0, dryRun: true, results: [] }));
    const deps = {
      getStatus: { execute: async () => ({ connected: false }) },
      config: { getConfig: async () => ({ timezone: 'UTC' }) },
      planTasks: { execute: plan },
      closeDailyTasks: { execute: closure },
      scheduler: { triggerRunNow, getStatus: () => ({ running: false }) },
    } as unknown as ApiDependencies;
    const server = new AppServer(deps, 0);
    const port = await server.start();
    const target = `http://127.0.0.1:${port}`;
    const auth = (name: string, token: string) =>
      `Basic ${Buffer.from(`${name}:${token}`).toString('base64')}`;
    try {
      const health = await fetch(`${target}/api/health`);
      expect(health.status).toBe(200);
      const read = await fetch(`${target}/api/status`, {
        headers: { Authorization: auth('auditor', 'viewer-test-secret') },
      });
      expect(read.status).toBe(200);
      const viewerSession = await fetch(`${target}/api/session`, {
        headers: { Authorization: auth('auditor', 'viewer-test-secret') },
      });
      expect(viewerSession.status).toBe(200);
      expect((await viewerSession.json()).data.role).toBe('viewer');
      const denied = await fetch(`${target}/api/scheduler/run-now`, {
        method: 'POST',
        headers: { Authorization: auth('auditor', 'viewer-test-secret'), 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true, all: true }),
      });
      expect(denied.status).toBe(403);
      expect((await denied.json()).error).toContain('read-only');
      expect(triggerRunNow).not.toHaveBeenCalled();
      const previewPlan = await fetch(`${target}/api/tasks/plan`, {
        method: 'POST',
        headers: { Authorization: auth('auditor', 'viewer-test-secret'), 'Content-Type': 'application/json' },
        body: JSON.stringify({ all: true }),
      });
      expect(previewPlan.status).toBe(200);
      expect(plan).toHaveBeenCalledOnce();
      const duplicatedMembers = await fetch(`${target}/api/tasks/plan`, {
        method: 'POST',
        headers: { Authorization: auth('auditor', 'viewer-test-secret'), 'Content-Type': 'application/json' },
        body: JSON.stringify({ personKeys: ['member-a', ' member-a '] }),
      });
      expect(duplicatedMembers.status).toBe(400);
      expect((await duplicatedMembers.json()).error).toContain('duplicate member keys');
      expect(plan).toHaveBeenCalledOnce();
      const previewEod = await fetch(`${target}/api/tasks/close-today`, {
        method: 'POST',
        headers: { Authorization: auth('auditor', 'viewer-test-secret'), 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun: true, all: true }),
      });
      expect(previewEod.status).toBe(200);
      const forbiddenEod = await fetch(`${target}/api/tasks/close-today`, {
        method: 'POST',
        headers: { Authorization: auth('auditor', 'viewer-test-secret'), 'Content-Type': 'application/json' },
        body: JSON.stringify({ dryRun: false, confirm: true, all: true }),
      });
      expect(forbiddenEod.status).toBe(403);
      expect(closure).toHaveBeenCalledOnce();
      const accepted = await fetch(`${target}/api/scheduler/run-now`, {
        method: 'POST',
        headers: { Authorization: auth('admin', 'operator-test-secret'), 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true, all: true }),
      });
      expect(accepted.status).toBe(200);
      const operatorSession = await fetch(`${target}/api/session`, {
        headers: { Authorization: auth('admin', 'operator-test-secret') },
      });
      expect((await operatorSession.json()).data.role).toBe('operator');
      expect(triggerRunNow).toHaveBeenCalledOnce();
      const unauthenticated = await fetch(`${target}/api/status`);
      expect(unauthenticated.status).toBe(401);
    } finally {
      await server.stop();
    }
  });

  it('rejects identical operator and viewer secrets', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('API_AUTH_TOKEN', 'duplicate-test-token');
    vi.stubEnv('API_VIEWER_TOKEN', 'duplicate-test-token');
    expect(() => new AppServer({} as ApiDependencies, 0))
      .toThrow(/must differ from/);
  });

  it('rejects port collisions in production rather than starting on an unexpected port', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('API_AUTH_TOKEN', 'operator-test-secret');
    const occupied = http.createServer((_req, res) => res.end('fixture'));
    // Match AppServer's default listen host to guarantee the same socket family.
    await new Promise<void>(resolve => occupied.listen(0, resolve));
    const address = occupied.address();
    const port = typeof address === 'object' && address ? address.port : -1;
    const server = new AppServer({} as ApiDependencies, port);
    try {
      await expect(server.start()).rejects.toMatchObject({ code: 'EADDRINUSE' });
    } finally {
      await new Promise<void>(resolve => occupied.close(() => resolve()));
    }
  });

  it('disallows inline scripts in the web security policy', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.stubEnv('API_AUTH_TOKEN', 'test-only-secret');
    const server = new AppServer({} as ApiDependencies, 0);
    const port = await server.start();
    try {
      const response = await fetch(`http://127.0.0.1:${port}/`, {
        headers: { Authorization: `Basic ${Buffer.from('admin:test-only-secret').toString('base64')}` },
      });
      expect(response.headers.get('content-security-policy')).toMatch(/script-src 'self' https:\/\/cdn\.jsdelivr\.net/);
      expect(response.headers.get('content-security-policy')?.split('style-src')[0]).not.toContain('unsafe-inline');
      expect(response.headers.get('content-security-policy')).toContain("object-src 'none'");
    } finally {
      await server.stop();
    }
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
        headers: { Authorization: authorization, Origin: 'https://tasks.example.invalid', 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true, all: true }),
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
