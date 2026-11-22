import { describe, it, expect, vi, beforeEach, afterEach, beforeAll } from 'vitest';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import express from 'express';

// Infrastructure & Domain imports
import { EntraIdAuthProvider } from '../../src/infrastructure/auth/entra-id-auth-provider.js';
import {
  normalizeRole,
  hasRole,
  enforceRbac,
  requireAuth,
  requireRole,
  oidcAuthGuard,
  AuthenticatedUser,
} from '../../src/infrastructure/auth/rbac.js';
import { resolveOperator, sanitizeOperatorEmail } from '../../src/infrastructure/auth/identity.js';
import { tenantGuard } from '../../src/infrastructure/auth/tenant-guard.js';
import { createDatabase, WorkOpsDb } from '../../src/infrastructure/persistence/database.js';
import { SqliteLockManager } from '../../src/infrastructure/lock/distributed-lock-manager.js';
import { WorkerDaemon, WorkerJob } from '../../src/infrastructure/scheduler/worker-daemon.js';
import {
  TokenBucket,
  pLimit,
  executeBoundedBatch,
} from '../../src/infrastructure/azure/rate-limiter.js';
import { AzureDevOpsClient } from '../../src/infrastructure/azure/client.js';
import { GitHubClient } from '../../src/infrastructure/github/github-client.js';
import { createApiRouter } from '../../src/presentation/api/routes.js';
import { createMetricsRouter } from '../../src/presentation/api/metrics-routes.js';
import { asyncHandler, readyHandler, mutationHandler } from '../../src/presentation/api/async-handler.js';
import { MetricsRegistry } from '../../src/infrastructure/telemetry/metrics.js';

describe('Adversarial Tier 5: Security, Concurrency, External Adapters & Telemetry Hardening', () => {
  // =========================================================================
  // 1. Authentication & Granular RBAC Adversarial Stress Tests
  // =========================================================================
  describe('1. Authentication, Token Validation & RBAC Privilege Hardening', () => {
    let privateKey: crypto.KeyObject;
    let publicKey: crypto.KeyObject;
    let attackerPrivateKey: crypto.KeyObject;
    const kid = 'trusted-key-id-001';
    const issuer = 'https://login.microsoftonline.com/tenant-security-hardening/v2.0';
    const clientId = 'workops-core-app';
    const audience = 'workops-api';

    beforeAll(() => {
      const trustedPair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
      privateKey = trustedPair.privateKey;
      publicKey = trustedPair.publicKey;

      const attackerPair = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
      attackerPrivateKey = attackerPair.privateKey;
    });

    function createJwt(claims: Record<string, any>, key: crypto.KeyObject = privateKey, keyId: string = kid): string {
      const header = { alg: 'RS256', typ: 'JWT', kid: keyId };
      const hB64 = Buffer.from(JSON.stringify(header)).toString('base64url');
      const pB64 = Buffer.from(JSON.stringify(claims)).toString('base64url');
      const input = `${hB64}.${pB64}`;

      const signer = crypto.createSign('RSA-SHA256');
      signer.update(input);
      const sig = signer.sign(key).toString('base64url');
      return `${input}.${sig}`;
    }

    it('rejects a forged JWT signed by an attacker private key with HTTP 401 INVALID_SIGNATURE', async () => {
      const provider = new EntraIdAuthProvider({ clientId, issuer, audience });
      provider.jwksCache.setKey(kid, publicKey);

      const now = Math.floor(Date.now() / 1000);
      const forgedToken = createJwt(
        {
          sub: 'attacker-id',
          email: 'attacker@evil.com',
          name: 'Malicious Actor',
          roles: ['Admin'],
          tenantId: 'tenant-enterprise-01',
          iss: issuer,
          aud: audience,
          iat: now,
          exp: now + 3600,
        },
        attackerPrivateKey,
        kid
      );

      const result = await provider.verifyToken(forgedToken);
      expect(result.valid).toBe(false);
      expect(result.status).toBe(401);
      expect(result.error).toMatch(/INVALID_SIGNATURE/);
    });

    it('rejects a tampered payload when claims are modified in transit without signature recalculation', async () => {
      const provider = new EntraIdAuthProvider({ clientId, issuer, audience });
      provider.jwksCache.setKey(kid, publicKey);

      const now = Math.floor(Date.now() / 1000);
      const validToken = createJwt({
        sub: 'dev-001',
        email: 'dev@workops.test',
        name: 'Developer User',
        roles: ['Developer'],
        iss: issuer,
        aud: audience,
        iat: now,
        exp: now + 3600,
      });

      // Tamper with payload: alter role from Developer to Admin
      const [hB64, pB64, sigB64] = validToken.split('.');
      const decodedPayload = JSON.parse(Buffer.from(pB64, 'base64url').toString('utf8'));
      decodedPayload.roles = ['Admin'];
      const tamperedPayloadB64 = Buffer.from(JSON.stringify(decodedPayload)).toString('base64url');
      const tamperedToken = `${hB64}.${tamperedPayloadB64}.${sigB64}`;

      const result = await provider.verifyToken(tamperedToken);
      expect(result.valid).toBe(false);
      expect(result.status).toBe(401);
      expect(result.error).toMatch(/INVALID_SIGNATURE/);
    });

    it('rejects tokens signed with unknown kid missing from JWKS cache', async () => {
      const provider = new EntraIdAuthProvider({ clientId, issuer, audience });
      // JWKS cache only has trusted kid
      provider.jwksCache.setKey(kid, publicKey);

      const now = Math.floor(Date.now() / 1000);
      const tokenWithUnknownKid = createJwt(
        {
          sub: 'unknown-key-user',
          roles: ['Developer'],
          iss: issuer,
          aud: audience,
          iat: now,
          exp: now + 3600,
        },
        privateKey,
        'non-existent-kid-999'
      );

      const result = await provider.verifyToken(tokenWithUnknownKid);
      expect(result.valid).toBe(false);
      expect(result.status).toBe(401);
    });

    it('rejects an expired token at exact 1-second boundary (exp = now - 1)', async () => {
      const provider = new EntraIdAuthProvider({ clientId, issuer, audience });
      provider.jwksCache.setKey(kid, publicKey);

      const now = Math.floor(Date.now() / 1000);
      const expiredToken = createJwt({
        sub: 'expired-user-1',
        email: 'user@workops.test',
        roles: ['Developer'],
        iss: issuer,
        aud: audience,
        iat: now - 3600,
        exp: now - 1,
      });

      const result = await provider.verifyToken(expiredToken);
      expect(result.valid).toBe(false);
      expect(result.status).toBe(401);
      expect(result.error).toBe('TOKEN_EXPIRED');
    });

    it('rejects tokens with mismatched issuer or mismatched audience', async () => {
      const provider = new EntraIdAuthProvider({ clientId, issuer, audience });
      provider.jwksCache.setKey(kid, publicKey);

      const now = Math.floor(Date.now() / 1000);

      // Mismatched issuer
      const rogueIssuerToken = createJwt({
        sub: 'rogue-iss',
        email: 'user@workops.test',
        roles: ['Developer'],
        iss: 'https://rogue-identity-provider.com/v2.0',
        aud: audience,
        iat: now,
        exp: now + 3600,
      });
      const resIss = await provider.verifyToken(rogueIssuerToken);
      expect(resIss.valid).toBe(false);
      expect(resIss.status).toBe(401);
      expect(resIss.error).toBe('INVALID_ISSUER');

      // Mismatched audience
      const rogueAudToken = createJwt({
        sub: 'rogue-aud',
        email: 'user@workops.test',
        roles: ['Developer'],
        iss: issuer,
        aud: 'malicious-third-party-api',
        iat: now,
        exp: now + 3600,
      });
      const resAud = await provider.verifyToken(rogueAudToken);
      expect(resAud.valid).toBe(false);
      expect(resAud.status).toBe(403);
      expect(resAud.error).toBe('INVALID_AUDIENCE');
    });

    it('rejects malformed tokens: empty strings, missing parts, and non-JSON payloads', async () => {
      const provider = new EntraIdAuthProvider({ clientId, issuer, audience });
      provider.jwksCache.setKey(kid, publicKey);

      expect((await provider.verifyToken('')).error).toBe('TOKEN_MISSING');
      expect((await provider.verifyToken(null as any)).error).toBe('TOKEN_MISSING');
      expect((await provider.verifyToken('just-one-part')).error).toBe('TOKEN_INVALID_FORMAT');
      expect((await provider.verifyToken('part1.part2')).error).toBe('TOKEN_INVALID_FORMAT');
      expect((await provider.verifyToken('p1.p2.p3.p4')).error).toBe('TOKEN_INVALID_FORMAT');
      expect((await provider.verifyToken('not-json.not-json.not-sig')).error).toBe('TOKEN_MALFORMED');
    });

    it('enforces RBAC privilege boundaries: Developer cannot execute team plans or delete tenants', () => {
      // Developer cannot execute team plan
      const execResult = enforceRbac(['Developer'], 'execute_team_plan');
      expect(execResult.allowed).toBe(false);
      expect(execResult.status).toBe(403);
      expect(execResult.error).toContain("cannot execute team plans");

      // Developer cannot delete tenant
      const deleteResult = enforceRbac(['Developer'], 'delete_tenant');
      expect(deleteResult.allowed).toBe(false);
      expect(deleteResult.status).toBe(403);
      expect(deleteResult.error).toContain("Global tenant management requires role 'Admin'");

      // Lead cannot delete tenant
      const leadDelete = enforceRbac(['Lead'], 'delete_tenant');
      expect(leadDelete.allowed).toBe(false);
      expect(leadDelete.status).toBe(403);

      // Admin CAN execute plan and delete tenant
      expect(enforceRbac(['Admin'], 'execute_team_plan').allowed).toBe(true);
      expect(enforceRbac(['Admin'], 'delete_tenant').allowed).toBe(true);

      // Lead CAN execute plan
      expect(enforceRbac(['Lead'], 'execute_team_plan').allowed).toBe(true);
    });

    it('strictly blocks Auditor from performing state mutations via RBAC middleware and policy', () => {
      // Auditor attempting mutation action
      const mutateResult = enforceRbac(['Auditor'], 'mutate_task');
      expect(mutateResult.allowed).toBe(false);
      expect(mutateResult.status).toBe(403);
      expect(mutateResult.error).toContain("Role 'Auditor' is read-only");

      // Test requireRole middleware with Auditor attempting POST mutation
      const middleware = requireRole(['Developer', 'Auditor']);
      const req: any = {
        method: 'POST',
        user: { id: 'auditor-1', email: 'auditor@workops.test', roles: ['Auditor'] },
      };
      const res: any = {
        statusCode: 200,
        status(code: number) { this.statusCode = code; return this; },
        json: vi.fn(),
      };
      const next = vi.fn();

      middleware(req, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(403);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        error: "Role 'Auditor' is read-only.",
      }));
    });

    it('resolveOperator strictly prioritizes verified JWT identity over spoofed header email', () => {
      const verifiedUser: AuthenticatedUser = {
        id: 'user-real',
        email: 'genuine.engineer@workops.test',
        name: 'Genuine Engineer',
        roles: ['Developer'],
        tenantId: 'tenant-01',
      };
      const spoofedHeader = 'imposter.admin@workops.test';

      const resolved = resolveOperator(verifiedUser, spoofedHeader);
      expect(resolved).toBe('genuine.engineer@workops.test');
      expect(resolved).not.toBe('imposter.admin@workops.test');
    });

    it('enforces Cross-Tenant Isolation: Developer/Lead denied access to alien tenant, Admin allowed', () => {
      const guard = tenantGuard({ requireTenant: true });

      // Case A: Developer in tenant-alpha attempts to access tenant-beta via X-Tenant-ID header
      const devReq: any = {
        headers: { 'x-tenant-id': 'tenant-beta' },
        query: {},
        user: { id: 'dev-1', email: 'dev@workops.test', roles: ['Developer'], tenantId: 'tenant-alpha' },
      };
      const devRes: any = {
        statusCode: 200,
        status(code: number) { this.statusCode = code; return this; },
        json: vi.fn(),
      };
      const devNext = vi.fn();

      guard(devReq, devRes, devNext);
      expect(devNext).not.toHaveBeenCalled();
      expect(devRes.statusCode).toBe(403);
      expect(devRes.json).toHaveBeenCalledWith(expect.objectContaining({
        error: 'CROSS_TENANT_ACCESS_FORBIDDEN',
      }));

      // Case B: Lead in tenant-alpha attempts cross-tenant query
      const leadReq: any = {
        headers: {},
        query: { tenantId: 'tenant-beta' },
        user: { id: 'lead-1', email: 'lead@workops.test', roles: ['Lead'], tenantId: 'tenant-alpha' },
      };
      const leadRes: any = {
        statusCode: 200,
        status(code: number) { this.statusCode = code; return this; },
        json: vi.fn(),
      };
      const leadNext = vi.fn();

      guard(leadReq, leadRes, leadNext);
      expect(leadNext).not.toHaveBeenCalled();
      expect(leadRes.statusCode).toBe(403);
      expect(leadRes.json).toHaveBeenCalledWith(expect.objectContaining({
        error: 'CROSS_TENANT_ACCESS_FORBIDDEN',
      }));

      // Case C: Admin in tenant-alpha accesses tenant-beta -> permitted, binds req.tenant
      const adminReq: any = {
        headers: { 'x-tenant-id': 'tenant-beta' },
        query: {},
        user: { id: 'admin-1', email: 'admin@workops.test', roles: ['Admin'], tenantId: 'tenant-alpha' },
      };
      const adminRes: any = { status: vi.fn(), json: vi.fn() };
      const adminNext = vi.fn();

      guard(adminReq, adminRes, adminNext);
      expect(adminNext).toHaveBeenCalled();
      expect(adminReq.tenant?.organizationId).toBe('tenant-beta');
    });

    it('tenantGuard rejects with HTTP 400 when requireTenant is true and no tenant context is provided', () => {
      const guard = tenantGuard({ requireTenant: true });
      const req: any = { headers: {}, query: {}, user: undefined };
      const res: any = {
        statusCode: 200,
        status(code: number) { this.statusCode = code; return this; },
        json: vi.fn(),
      };
      const next = vi.fn();

      guard(req, res, next);
      expect(next).not.toHaveBeenCalled();
      expect(res.statusCode).toBe(400);
      expect(res.json).toHaveBeenCalledWith(expect.objectContaining({
        error: 'TENANT_IDENTIFIER_REQUIRED',
      }));
    });

    it('requireAuth() blocks unauthenticated sessions, oidcAuthGuard() enforces roles, and identity helpers sanitize input', () => {
      // requireAuth blocks unauthenticated request
      const authMiddleware = requireAuth();
      const unauthReq: any = { user: undefined };
      const unauthRes: any = {
        statusCode: 200,
        status(code: number) { this.statusCode = code; return this; },
        json: vi.fn(),
      };
      const next1 = vi.fn();
      authMiddleware(unauthReq, unauthRes, next1);
      expect(next1).not.toHaveBeenCalled();
      expect(unauthRes.statusCode).toBe(401);

      // oidcAuthGuard blocks Developer from Lead/Admin operations
      const guard = oidcAuthGuard(['Admin', 'Lead']);
      const devReq: any = {
        method: 'GET',
        user: { id: 'dev-1', email: 'dev@workops.test', roles: ['Developer'], tenantId: 'tenant-1' },
      };
      const devRes: any = {
        statusCode: 200,
        status(code: number) { this.statusCode = code; return this; },
        json: vi.fn(),
      };
      const next2 = vi.fn();
      guard(devReq, devRes, next2);
      expect(next2).not.toHaveBeenCalled();
      expect(devRes.statusCode).toBe(403);

      // normalizeRole & hasRole helpers
      expect(normalizeRole('admin')).toBe('Admin');
      expect(normalizeRole('lead')).toBe('Lead');
      expect(normalizeRole('auditor')).toBe('Auditor');
      expect(normalizeRole('unknown-role')).toBe('Developer');
      expect(hasRole(devReq.user, ['Developer'])).toBe(true);
      expect(hasRole(devReq.user, ['Admin'])).toBe(false);

      // sanitizeOperatorEmail
      expect(sanitizeOperatorEmail('  OPERATOR@WORKOPS.TEST  ')).toBe('operator@workops.test');
      expect(() => sanitizeOperatorEmail('')).toThrow(/Operator identity required/);
    });
  });

  // =========================================================================
  // 2. Distributed Locking & Worker Concurrency Stress Tests
  // =========================================================================
  describe('2. Distributed Locking & Worker Concurrency Stress Tests', () => {
    let tempDir: string;
    let sqlitePath: string;
    let db: WorkOpsDb;
    let lockManager: SqliteLockManager;

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workops-adv-lock-'));
      sqlitePath = path.join(tempDir, 'adversarial-locks.db');
      db = createDatabase({ sqlitePath, engine: 'sqlite' });
      lockManager = new SqliteLockManager((db as any).sqlite);
    });

    afterEach(() => {
      if (db && db.engine === 'sqlite') {
        db.close();
      }
      if (fs.existsSync(tempDir)) {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });

    it('contested lock acquisition: 30 concurrent processes race for the same resource — exactly 1 wins, 29 fail safely', async () => {
      const resource = 'critical-financial-sync-lock';
      const concurrency = 30;

      // Spawn 30 concurrent acquisition attempts simultaneously
      const attempts = Array.from({ length: concurrency }, (_, i) =>
        lockManager.acquire(resource, 60000, `worker-node-${i}`)
      );

      const results = await Promise.all(attempts);

      const winners = results.filter((h) => h !== null);
      const losers = results.filter((h) => h === null);

      expect(winners.length).toBe(1);
      expect(losers.length).toBe(concurrency - 1);

      const winningHandle = winners[0]!;
      expect(winningHandle.resource).toBe(resource);
      expect(winningHandle.ownerToken).toMatch(/^worker-node-\d+$/);

      // Verify resource is locked
      expect(await lockManager.isLocked(resource)).toBe(true);

      // Winner releases lock
      const released = await lockManager.release(winningHandle);
      expect(released).toBe(true);
      expect(await lockManager.isLocked(resource)).toBe(false);

      // Now another worker can acquire it
      const nextHandle = await lockManager.acquire(resource, 60000, 'worker-successor');
      expect(nextHandle).not.toBeNull();
      expect(nextHandle?.ownerToken).toBe('worker-successor');
    });

    it('worker crash / fatal exception resilience: lock is guaranteed to be released in finally block', async () => {
      const daemon = new WorkerDaemon({ lockManager, timezone: 'UTC' });
      let handlerRan = false;

      const fatalJob: WorkerJob = {
        id: 'fatal-crashing-job',
        name: 'Fatal Crashing Job',
        maxRetries: 0, // Fail fast to DLQ without waiting
        handler: vi.fn().mockImplementation(async () => {
          handlerRan = true;
          throw new Error('Fatal worker unhandled SIGBUS / exception emulation');
        }),
      };

      daemon.start();
      const success = await daemon.runJobWithRetry(fatalJob);

      expect(success).toBe(false);
      expect(handlerRan).toBe(true);

      // Active jobs count must return to 0
      expect(daemon.getActiveJobsCount()).toBe(0);

      // DLQ contains the failed job
      const dlq = daemon.getDlq();
      expect(dlq.length).toBe(1);
      expect(dlq[0].name).toBe('Fatal Crashing Job');
      expect(dlq[0].error).toContain('Fatal worker unhandled SIGBUS');

      // The deduplication lock MUST be released and free to acquire
      const today = new Date().toISOString().slice(0, 10);
      const expectedLockKey = `workops:worker:dedup:${fatalJob.id}:${today}`;
      expect(await lockManager.isLocked(expectedLockKey)).toBe(false);

      // Another worker can immediately acquire this lock key
      const reacquired = await lockManager.acquire(expectedLockKey, 60000, 'recovery-daemon');
      expect(reacquired).not.toBeNull();

      await daemon.stop();
    });

    it('fraudulent lock release protection: wrong owner token cannot release a lock held by another process', async () => {
      const resource = 'secure-pipeline-resource';
      const legitimateHandle = await lockManager.acquire(resource, 30000, 'legitimate-owner-token');
      expect(legitimateHandle).not.toBeNull();

      // Attacker attempts to release with mismatched token
      const attackerReleased = await lockManager.release(resource, 'attacker-fraudulent-token');
      expect(attackerReleased).toBe(false);

      // Lock MUST still be held
      expect(await lockManager.isLocked(resource)).toBe(true);

      // Legitimate owner successfully releases
      const legitimateReleased = await lockManager.release(legitimateHandle!);
      expect(legitimateReleased).toBe(true);
      expect(await lockManager.isLocked(resource)).toBe(false);
    });

    it('lock TTL expiration and extension behavior under extended job durations', async () => {
      const resource = 'extended-run-resource';
      const shortTtlMs = 60; // 60ms TTL

      const handle = await lockManager.acquire(resource, shortTtlMs, 'extended-worker');
      expect(handle).not.toBeNull();
      expect(await lockManager.isLocked(resource)).toBe(true);

      // Extend the lock before expiration
      const extended = await lockManager.extend(handle!, 120);
      expect(extended).toBe(true);

      // Wait for extension to expire
      await new Promise((r) => setTimeout(r, 150));

      // Now the lock must be expired
      expect(await lockManager.isLocked(resource)).toBe(false);

      // Extending an already-expired lock must return false
      const postExpiryExtend = await lockManager.extend(handle!, 100);
      expect(postExpiryExtend).toBe(false);

      // Another worker can now acquire the expired lock seamlessly
      const newHandle = await lockManager.acquire(resource, 30000, 'replacement-worker');
      expect(newHandle).not.toBeNull();
      expect(newHandle?.ownerToken).toBe('replacement-worker');
    });
  });

  // =========================================================================
  // 3. External API Resilience & Rate Limiting Stress Tests
  // =========================================================================
  describe('3. External API Resilience, Token Bucket & Circuit Breaking Tests', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    it('token bucket saturates under sudden burst and rejects immediate subsequent requests', async () => {
      const bucket = new TokenBucket({ capacity: 10, refillRatePerSecond: 1 });

      // Burst: consume all 10 available tokens
      for (let i = 0; i < 10; i++) {
        expect(bucket.consume(1)).toBe(true);
      }
      expect(bucket.getRemainingTokens()).toBe(0);

      // 11th token request must be immediately rejected
      expect(bucket.consume(1)).toBe(false);

      // Requesting more tokens than total capacity throws an immediate error
      await expect(bucket.acquire(15)).rejects.toThrow(/exceeds bucket capacity/);
    });

    it('pLimit bounds concurrency strictly to N under 25 simultaneous asynchronous tasks', async () => {
      const concurrencyLimit = 3;
      const limiter = pLimit(concurrencyLimit);
      let activeTasks = 0;
      let maxSimultaneousActive = 0;

      const runTask = (id: number) =>
        limiter(async () => {
          activeTasks++;
          maxSimultaneousActive = Math.max(maxSimultaneousActive, activeTasks);
          // Small synthetic delay to test overlap
          await new Promise((r) => setTimeout(r, 10));
          activeTasks--;
          return id * 10;
        });

      const promises = Array.from({ length: 25 }, (_, i) => runTask(i));
      const results = await Promise.all(promises);

      expect(results.length).toBe(25);
      expect(maxSimultaneousActive).toBeLessThanOrEqual(concurrencyLimit);
      expect(activeTasks).toBe(0);
    });

    it('executeBoundedBatch chunks tasks, bounds concurrency, and handles abort cancellation cleanly', async () => {
      const items = [1, 2, 3, 4, 5, 6, 7, 8];
      let maxActiveChunks = 0;
      let activeChunks = 0;

      const results = await executeBoundedBatch(
        items,
        async (chunk) => {
          activeChunks++;
          maxActiveChunks = Math.max(maxActiveChunks, activeChunks);
          await new Promise((r) => setTimeout(r, 15));
          activeChunks--;
          return chunk.map((n) => n * 2);
        },
        { chunkSize: 2, concurrency: 2 }
      );

      expect(results).toEqual([2, 4, 6, 8, 10, 12, 14, 16]);
      expect(maxActiveChunks).toBeLessThanOrEqual(2);
      expect(activeChunks).toBe(0);

      // Test abort signal
      const controller = new AbortController();
      controller.abort();
      await expect(
        executeBoundedBatch(
          items,
          async (chunk) => chunk,
          { signal: controller.signal }
        )
      ).rejects.toThrow(/cancelled/i);
    });

    it('AzureDevOpsClient: respects Retry-After on replay-safe GET requests and retries successfully', async () => {
      let callCount = 0;
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return new Response(JSON.stringify({ error: 'Rate limit exceeded' }), {
            status: 429,
            headers: { 'Retry-After': '0' },
          });
        }
        return new Response(JSON.stringify({ count: 42, value: [] }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      });

      const client = new AzureDevOpsClient({
        organization: 'enterprise-org',
        pat: 'valid-pat-secret',
        maxRetries: 2,
        initialRetryDelayMs: 0,
      });

      const result = await client.get<{ count: number }>('/_apis/wit/workitems');
      expect(result.count).toBe(42);
      expect(callCount).toBe(2);
      expect(fetchSpy).toHaveBeenCalledTimes(2);
    });

    it('AzureDevOpsClient: fails fast immediately on HTTP 429 for non-replay-safe POST write requests', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ error: 'Rate limit exceeded' }), {
          status: 429,
          headers: { 'Retry-After': '10' },
        })
      );

      const client = new AzureDevOpsClient({
        organization: 'enterprise-org',
        pat: 'valid-pat-secret',
        maxRetries: 3,
        initialRetryDelayMs: 0,
      });

      // Write POST: creating a task must NEVER be blindly replayed after 429
      await expect(
        client.post('/Project/_apis/wit/workitems/$Task?api-version=7.0', [
          { op: 'add', path: '/fields/System.Title', value: 'High Value Task' },
        ])
      ).rejects.toThrow(/rate-limited a write request.*inspect Azure before retrying/i);

      // Exactly 1 call was made — no retry was attempted
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('AzureDevOpsClient: circuit-breaks and fails fast on HTTP 503 for non-replay-safe PATCH mutations', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
        new Response(JSON.stringify({ error: 'Service Unavailable' }), { status: 503 })
      );

      const client = new AzureDevOpsClient({
        organization: 'enterprise-org',
        pat: 'valid-pat-secret',
        maxRetries: 3,
        initialRetryDelayMs: 0,
      });

      // Patching a task on 503 must fail fast to prevent duplicated or split-brain state
      await expect(
        client.patch('/_apis/wit/workitems/9001?api-version=7.0', [
          { op: 'replace', path: '/fields/System.State', value: 'Closed' },
        ])
      ).rejects.toThrow(/outcome is uncertain; inspect Azure before retrying/i);

      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });

    it('GitHubClient: detects secondary rate limit and backs off with retry', async () => {
      let callCount = 0;
      const customFetch = vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return {
            status: 403,
            ok: false,
            text: async () => 'You have triggered an abuse detection mechanism / secondary rate limit.',
            headers: new Headers({ 'retry-after': '0' }),
          };
        }
        return {
          status: 200,
          ok: true,
          json: async () => ({ total_count: 1, incomplete_results: false, items: [] }),
          text: async () => JSON.stringify({ total_count: 1, incomplete_results: false, items: [] }),
          headers: new Headers(),
        };
      });

      const client = new GitHubClient({
        token: 'ghp_fake_token',
        fetchFn: customFetch as any,
        maxRetries: 2,
        initialRetryDelayMs: 0,
      });

      const prs = await client.getUserPullRequests('octocat', { org: 'github' });
      expect(Array.isArray(prs)).toBe(true);
      expect(callCount).toBe(2);
    });

    it('GitHubClient: fails fast with clear error message when rate limit persists past maximum retries', async () => {
      const customFetch = vi.fn().mockImplementation(async () => ({
        status: 429,
        ok: false,
        text: async () => 'API rate limit exceeded',
        headers: new Headers({ 'retry-after': '0' }),
      }));

      const client = new GitHubClient({
        token: 'ghp_fake_token',
        fetchFn: customFetch as any,
        maxRetries: 1,
        initialRetryDelayMs: 0,
      });

      await expect(client.getUserPullRequests('octocat')).rejects.toThrow(
        /GitHub API rate limit exceeded/i
      );
    });
  });

  // =========================================================================
  // 4. Telemetry, Health Probes & Malformed Error Handling
  // =========================================================================
  describe('4. Telemetry, Health Probes & Malformed Error Handling', () => {
    let server: http.Server;
    let baseUrl: string;

    afterEach(async () => {
      if (server) {
        await new Promise<void>((resolve) => server.close(() => resolve()));
      }
      delete process.env.METRICS_AUTH_TOKEN;
    });

    it('GET /api/health always returns HTTP 200 alive without depending on downstream subsystems', async () => {
      const app = express();
      const router = createApiRouter({
        createTasks: {} as any,
        planTasks: {} as any,
        executeTasks: {} as any,
        closeDailyTasks: {} as any,
        exploreTasks: {} as any,
        getStatus: {} as any,
        config: {} as any,
        journal: {} as any,
        scheduler: {} as any,
        autoClosureConfigRepo: {} as any,
      });
      app.use('/api', router);

      server = app.listen(0);
      const port = (server.address() as any).port;
      baseUrl = `http://127.0.0.1:${port}`;

      const res = await fetch(`${baseUrl}/api/health`);
      expect(res.status).toBe(200);

      const data: any = await res.json();
      expect(data.status).toBe('alive');
      expect(data.dependenciesChecked).toBe(false);
      expect(data.timestamp).toBeDefined();
    });

    it('GET /api/ready returns HTTP 200 when all subsystems are healthy, but HTTP 503 when Database or LockManager degrades', async () => {
      let isDbHealthy = true;
      let isLockHealthy = true;
      let isAzureHealthy = true;

      const app = express();
      const router = createApiRouter({
        createTasks: {} as any,
        planTasks: {} as any,
        executeTasks: {} as any,
        closeDailyTasks: {} as any,
        exploreTasks: {} as any,
        getStatus: {
          execute: vi.fn().mockImplementation(async () => ({
            connected: isAzureHealthy,
            projectValid: isAzureHealthy,
            workItemTypeValid: isAzureHealthy,
          })),
        } as any,
        checkDatabase: vi.fn().mockImplementation(async () => isDbHealthy),
        checkLockManager: vi.fn().mockImplementation(async () => isLockHealthy),
        checkSecretManager: vi.fn().mockResolvedValue(true),
        config: {} as any,
        journal: {} as any,
        scheduler: {} as any,
        autoClosureConfigRepo: {} as any,
      });
      app.use('/api', router);

      server = app.listen(0);
      const port = (server.address() as any).port;
      baseUrl = `http://127.0.0.1:${port}`;

      // Scenario A: All subsystems healthy
      const resReady = await fetch(`${baseUrl}/api/ready`);
      expect(resReady.status).toBe(200);
      const readyData: any = await resReady.json();
      expect(readyData.status).toBe('ready');
      expect(readyData.checks.database).toBe('up');
      expect(readyData.checks.lockManager).toBe('up');
      expect(readyData.checks.azureApi).toBe('up');

      // Scenario B: Database degrades (simulated network partition or pool exhaustion)
      isDbHealthy = false;
      const resDegradedDb = await fetch(`${baseUrl}/api/ready`);
      expect(resDegradedDb.status).toBe(503);
      const degradedDbData: any = await resDegradedDb.json();
      expect(degradedDbData.status).toBe('not_ready');
      expect(degradedDbData.checks.database).toBe('down');

      // Recover DB, degrade Lock Manager
      isDbHealthy = true;
      isLockHealthy = false;
      const resDegradedLock = await fetch(`${baseUrl}/api/ready`);
      expect(resDegradedLock.status).toBe(503);
      const degradedLockData: any = await resDegradedLock.json();
      expect(degradedLockData.status).toBe('not_ready');
      expect(degradedLockData.checks.lockManager).toBe('down');

      // Recover Lock, degrade Azure DevOps
      isLockHealthy = true;
      isAzureHealthy = false;
      const resDegradedAzure = await fetch(`${baseUrl}/api/ready`);
      expect(resDegradedAzure.status).toBe(503);
      const degradedAzureData: any = await resDegradedAzure.json();
      expect(degradedAzureData.status).toBe('not_ready');
      expect(degradedAzureData.checks.azureApi).toBe('down');
    });

    it('Prometheus /metrics complies strictly with Prometheus text exposition syntax', async () => {
      const registry = new MetricsRegistry();
      registry.recordHttpRequest('GET', '/api/tasks', 200, 0.045);
      registry.incrementTasksCreated(12);
      registry.setActiveJobs(3);
      registry.setAzureRateLimitRemaining(90);

      const metricsText = registry.renderPrometheusMetrics();

      // Syntax checks
      expect(metricsText.endsWith('\n')).toBe(true);

      const lines = metricsText.trim().split('\n');
      expect(lines.length).toBeGreaterThan(10);

      // Verify HELP and TYPE comment pairs exist for core metrics
      const expectedMetrics = [
        'http_requests_total',
        'http_request_duration_seconds_bucket',
        'workops_tasks_created_total',
        'workops_active_jobs',
        'workops_azure_rate_limit_remaining',
        'workops_up',
      ];

      for (const m of expectedMetrics) {
        expect(lines.some((l) => l.startsWith(`# HELP ${m}`))).toBe(true);
        expect(lines.some((l) => l.startsWith(`# TYPE ${m}`))).toBe(true);
      }

      // Verify values
      expect(lines.some((l) => l === 'workops_tasks_created_total 12')).toBe(true);
      expect(lines.some((l) => l === 'workops_active_jobs 3')).toBe(true);
      expect(lines.some((l) => l === 'workops_azure_rate_limit_remaining 90')).toBe(true);
      expect(lines.some((l) => l === 'workops_up 1')).toBe(true);
    });

    it('enforces METRICS_AUTH_TOKEN when configured: requires valid Bearer token', async () => {
      process.env.METRICS_AUTH_TOKEN = 'secret-metrics-token-12345';

      const app = express();
      app.use(createMetricsRouter());

      server = app.listen(0);
      const port = (server.address() as any).port;
      baseUrl = `http://127.0.0.1:${port}`;

      // 1. Missing Authorization header -> 401
      const resNoAuth = await fetch(`${baseUrl}/metrics`);
      expect(resNoAuth.status).toBe(401);

      // 2. Invalid token -> 403
      const resWrongToken = await fetch(`${baseUrl}/metrics`, {
        headers: { Authorization: 'Bearer wrong-token' },
      });
      expect(resWrongToken.status).toBe(403);

      // 3. Valid token -> 200
      const resValid = await fetch(`${baseUrl}/metrics`, {
        headers: { Authorization: 'Bearer secret-metrics-token-12345' },
      });
      expect(resValid.status).toBe(200);
      expect(resValid.headers.get('content-type')).toContain('text/plain');
      const text = await resValid.text();
      expect(text).toContain('workops_up 1');
    });

    it('zero unhandled promise rejections on malformed requests via asyncHandler wrappers', async () => {
      const app = express();
      app.use(express.json());

      // Route that throws an unexpected error
      app.get(
        '/test/crash',
        asyncHandler(async () => {
          throw new Error('Unexpected database socket disconnect');
        })
      );

      // Route with readyHandler that throws
      app.get(
        '/test/ready-crash',
        readyHandler(async () => {
          throw new Error('Fatal dependency check failure');
        })
      );

      // Route with mutationHandler that throws custom status
      app.post(
        '/test/mutate-crash',
        mutationHandler(async () => {
          const err: any = new Error('Malformed mutation entity payload');
          err.statusCode = 422;
          throw err;
        })
      );

      server = app.listen(0);
      const port = (server.address() as any).port;
      baseUrl = `http://127.0.0.1:${port}`;

      // Call route 1: should return 500 JSON without unhandled rejection
      const res1 = await fetch(`${baseUrl}/test/crash`);
      expect(res1.status).toBe(500);
      const body1: any = await res1.json();
      expect(body1.success).toBe(false);
      expect(body1.error).toBe('Unexpected database socket disconnect');

      // Call route 2: should return 503 JSON gracefully
      const res2 = await fetch(`${baseUrl}/test/ready-crash`);
      expect(res2.status).toBe(503);
      const body2: any = await res2.json();
      expect(body2.success).toBe(false);
      expect(body2.data.status).toBe('unavailable');

      // Call route 3: should return 422 JSON
      const res3 = await fetch(`${baseUrl}/test/mutate-crash`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ invalid: true }),
      });
      expect(res3.status).toBe(422);
      const body3: any = await res3.json();
      expect(body3.success).toBe(false);
      expect(body3.error).toBe('Malformed mutation entity payload');
    });
  });
});
