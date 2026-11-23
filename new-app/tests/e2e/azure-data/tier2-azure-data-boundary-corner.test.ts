import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import { createAzureDataTestHarness, AzureDataTestHarnessInstance } from './azure-data-harness.js';

describe('Tier 2: Boundary & Corner Cases - Input Robustness & System Limits', () => {
  let harness: AzureDataTestHarnessInstance;

  beforeAll(async () => {
    harness = await createAzureDataTestHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  describe('Boundary Group 1: Missing Database & System Degradation', () => {
    it('T2-AZD-01: Non-Existent Database Path Gracefully Reports Unavailable', async () => {
      const nonExistentPath = path.join(os.tmpdir(), `missing-azure-db-${Date.now()}.db`);
      const isolatedHarness = await createAzureDataTestHarness(nonExistentPath);
      expect(isolatedHarness.repo.isAvailable()).toBe(false);

      const res = await isolatedHarness.get('/api/azure-data/overview');
      expect(res.status).toBe(503);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('unavailable');

      await isolatedHarness.close();
    });

    it('T2-AZD-02: Read-Only Enforcement Prevents Any Mutating Operations on Database', () => {
      const db = (harness.repo as any).getRawDatabase();
      expect(() => {
        db.prepare('CREATE TABLE test_mutation (id INTEGER)').run();
      }).toThrow(/attempt to write a readonly database|readonly/i);

      expect(() => {
        db.prepare('DELETE FROM azure_projects').run();
      }).toThrow(/attempt to write a readonly database|readonly/i);
    });
  });

  describe('Boundary Group 2: Limit Parameter Boundary Value Analysis', () => {
    it('T2-AZD-03: Negative Limit Rejection (HTTP 400 Bad Request)', async () => {
      const res = await harness.get('/api/azure-data/builds/health?limit=-5');
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('Invalid limit');
    });

    it('T2-AZD-04: Non-Numeric Limit Parameter Rejection (HTTP 400 Bad Request)', async () => {
      const res = await harness.get('/api/azure-data/pipelines/runs?limit=not_a_number');
      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.error).toContain('Invalid limit');
    });

    it('T2-AZD-05: Minimal Boundary Limit = 1 Returns Exactly One Record', async () => {
      const res = await harness.get('/api/azure-data/releases?limit=1');
      expect(res.status).toBe(200);
      expect(res.body.releases).toHaveLength(1);
    });

    it('T2-AZD-06: Excessive Limit Capped at Safety Ceiling (500)', async () => {
      const res = await harness.get('/api/azure-data/teams?limit=99999');
      expect(res.status).toBe(200);
      // All teams in DB is 247, so it returns at most 247 even if limit is 99999
      expect(res.body.teams.length).toBeLessThanOrEqual(500);
      expect(res.body.teams).toHaveLength(247);
    });

    it('T2-AZD-07: Boundary Limit = 0 Clamped to Minimal Valid Record (1)', async () => {
      // Direct repo call with limit=0 clamps to 1
      const res = await harness.repo.getBuildHealth(undefined, 0);
      expect(res.length).toBe(1);
    });
  });

  describe('Boundary Group 3: Project Identifier Corner Cases', () => {
    it('T2-AZD-08: Non-Existent Project UUID Returns Empty Array without Error', async () => {
      const nonExistentUuid = '00000000-0000-0000-0000-000000000000';
      const res = await harness.get(`/api/azure-data/builds/health?projectId=${nonExistentUuid}`);
      expect(res.status).toBe(200);
      expect(res.body.buildHealth).toEqual([]);
    });

    it('T2-AZD-09: Empty String Project Parameter Handled as Global Unfiltered Query', async () => {
      const res = await harness.get('/api/azure-data/builds/health?projectId=');
      expect(res.status).toBe(200);
      expect(res.body.buildHealth.length).toBeGreaterThan(0);
    });

    it('T2-AZD-10: Whitespace-Only Project Parameter Sanitized Cleanly', async () => {
      const res = await harness.get('/api/azure-data/pipelines/runs?projectId=%20%20%20');
      expect(res.status).toBe(200);
      expect(res.body.pipelineRuns.length).toBeGreaterThan(0);
    });

    it('T2-AZD-11: Malformed and Special Character Project Identifiers Safely Isolated', async () => {
      const malformedId = '!@#$%^&*()_+-=[]{}|;:",.<>?';
      const res = await harness.get(`/api/azure-data/releases?projectId=${encodeURIComponent(malformedId)}`);
      expect(res.status).toBe(200);
      expect(res.body.releases).toEqual([]);
    });
  });

  describe('Boundary Group 4: SQL Injection Immunity & Metacharacter Escaping', () => {
    it('T2-AZD-12: SQL Injection String in projectId Does Not Leak Data', async () => {
      const injectionPayload = "' OR '1'='1";
      const res = await harness.get(`/api/azure-data/builds/health?projectId=${encodeURIComponent(injectionPayload)}`);
      expect(res.status).toBe(200);
      // Prepared statement treats this as a literal value, finding 0 matching projects
      expect(res.body.buildHealth).toEqual([]);
    });

    it('T2-AZD-13: SQL Injection Union Payload Safely Handled', async () => {
      const unionPayload = "d07e3437' UNION SELECT 1,2,3,4,5,6,7,8 --";
      const res = await harness.get(`/api/azure-data/builds/health?projectId=${encodeURIComponent(unionPayload)}`);
      expect(res.status).toBe(200);
      expect(res.body.buildHealth).toEqual([]);
    });

    it('T2-AZD-14: Search String with SQL Wildcards (% and _) Handled Safely', async () => {
      const res = await harness.get('/api/azure-data/teams?search=%25%25');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });

    it('T2-AZD-15: Search String with SQLite Glob Characters (* and ?)', async () => {
      const res = await harness.get('/api/azure-data/teams?search=*');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  describe('Boundary Group 5: Extreme Input Length & Unicode Boundaries', () => {
    it('T2-AZD-16: Extremely Long Search String (4,000 characters) Handled without Timeout', async () => {
      const hugeSearch = 'A'.repeat(4000);
      const res = await harness.get(`/api/azure-data/teams?search=${encodeURIComponent(hugeSearch)}`);
      expect(res.status).toBe(200);
      expect(res.body.teams).toEqual([]);
    });

    it('T2-AZD-17: Unicode and Non-ASCII Characters in Search Parameter', async () => {
      const unicodeSearch = 'POD_🚀_日本語_Special';
      const res = await harness.get(`/api/azure-data/teams?search=${encodeURIComponent(unicodeSearch)}`);
      expect(res.status).toBe(200);
      expect(res.body.teams).toEqual([]);
    });
  });
});
