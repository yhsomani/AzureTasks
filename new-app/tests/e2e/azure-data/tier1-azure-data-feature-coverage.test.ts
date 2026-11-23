import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createAzureDataTestHarness, AzureDataTestHarnessInstance } from './azure-data-harness.js';

describe('Tier 1: Feature Coverage - Azure Data Endpoints & Capabilities', () => {
  let harness: AzureDataTestHarnessInstance;

  beforeAll(async () => {
    harness = await createAzureDataTestHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  describe('Feature 1: Repository Availability & Connection', () => {
    it('T1-AZD-01: SQLite Database Connection & Availability Verification', () => {
      expect(harness.repo.isAvailable()).toBe(true);
      const db = (harness.repo as any).getRawDatabase();
      const integrity = db.pragma('integrity_check');
      expect(integrity).toEqual([{ integrity_check: 'ok' }]);
    });

    it('T1-AZD-02: Database Journal Mode Operates in WAL for Concurrent Read Scalability', () => {
      const db = (harness.repo as any).getRawDatabase();
      const journalMode = db.pragma('journal_mode');
      expect(journalMode[0].journal_mode.toLowerCase()).toBe('wal');
    });
  });

  describe('Feature 2: Project Overview & Summaries (/api/azure-data/overview)', () => {
    it('T1-AZD-03: HTTP 200 Overview Response Payload Structure', async () => {
      const res = await harness.get('/api/azure-data/overview');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.projects)).toBe(true);
      expect(Array.isArray(res.body.freshness)).toBe(true);
      expect(res.body.exportStatus).toBeDefined();
    });

    it('T1-AZD-04: Project Overview Enumerates Exactly 2 Expected Azure Projects', async () => {
      const projects = await harness.repo.getProjectOverview();
      expect(projects).toHaveLength(2);
      const projectNames = projects.map((p) => p.name);
      expect(projectNames).toContain('3_in_1_AppFrontEnd_Tasks');
      expect(projectNames).toContain('3in1_Agile_Projects');
    });

    it('T1-AZD-05: Project Overview Metric Counts Match Relational Aggregates', async () => {
      const projects = await harness.repo.getProjectOverview();
      const frontendProject = projects.find((p) => p.name === '3_in_1_AppFrontEnd_Tasks')!;
      expect(frontendProject).toBeDefined();
      expect(frontendProject.pipelines).toBeGreaterThanOrEqual(200);
      expect(frontendProject.builds).toBeGreaterThanOrEqual(50000);
      expect(frontendProject.releases).toBeGreaterThanOrEqual(9000);
      expect(frontendProject.testRuns).toBe(1000);
      expect(new Date(frontendProject.syncedAt).getTime()).toBeGreaterThan(0);
    });

    it('T1-AZD-06: Data Freshness Reports Dataset Counts per Project Scope', async () => {
      const freshness = await harness.repo.getDataFreshness();
      expect(freshness.length).toBeGreaterThanOrEqual(2);
      const frontendScope = freshness.find((f: any) => f.projectName === '3_in_1_AppFrontEnd_Tasks');
      expect(frontendScope).toBeDefined();
      expect(frontendScope.datasets).toBeGreaterThanOrEqual(1300);
    });

    it('T1-AZD-07: Export Status Corresponds to BFLDevOpsOrg Pipeline Run Metadata', async () => {
      const status = await harness.repo.getExportStatus();
      expect(status).not.toBeNull();
      expect(status.organization).toBe('BFLDevOpsOrg');
      expect(status.mode).toBe('dashboard');
      expect(status.datasetCount).toBeGreaterThanOrEqual(1500);
      expect(status.errorCount).toBeGreaterThanOrEqual(200);
    });
  });

  describe('Feature 3: Build Health Aggregations (/api/azure-data/builds/health)', () => {
    it('T1-AZD-08: HTTP 200 Build Health Default Aggregations', async () => {
      const res = await harness.get('/api/azure-data/builds/health');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(Array.isArray(res.body.buildHealth)).toBe(true);
      expect(res.body.buildHealth.length).toBeLessThanOrEqual(20);
    });

    it('T1-AZD-09: Build Health Limit Parameter Enforcement', async () => {
      const res = await harness.get('/api/azure-data/builds/health?limit=5');
      expect(res.status).toBe(200);
      expect(res.body.buildHealth).toHaveLength(5);
    });

    it('T1-AZD-10: Build Health Filters Correctly by Project UUID', async () => {
      const targetProjectId = 'a2fa1d4a-63a4-4f95-a4e7-01f4c7ce5fbe';
      const res = await harness.get(`/api/azure-data/builds/health?projectId=${targetProjectId}&limit=10`);
      expect(res.status).toBe(200);
      for (const rec of res.body.buildHealth) {
        expect(rec.projectId).toBe(targetProjectId);
      }
    });

    it('T1-AZD-11: Build Health Success Rate Mathematical Integrity', async () => {
      const records = await harness.repo.getBuildHealth(undefined, 20);
      expect(records.length).toBeGreaterThan(0);
      for (const r of records) {
        expect(r.totalRuns).toBeGreaterThanOrEqual(r.succeeded + r.failed);
        const expectedRate = Math.round((r.succeeded / r.totalRuns) * 1000) / 10;
        expect(r.successRate).toBeCloseTo(expectedRate, 1);
        expect(r.definitionName).toBeTruthy();
      }
    });

    it('T1-AZD-12: High-Volume Build Definitions Present in Top Ranks', async () => {
      const records = await harness.repo.getBuildHealth(undefined, 20);
      const definitionNames = records.map((r) => r.definitionName);
      expect(definitionNames.some((name) => name.includes('3in1_PWA') || name.includes('3in1_Android'))).toBe(true);
    });
  });

  describe('Feature 4: Pipeline Runs Telemetry (/api/azure-data/pipelines/runs)', () => {
    it('T1-AZD-13: HTTP 200 Pipeline Runs Telemetry Query', async () => {
      const res = await harness.get('/api/azure-data/pipelines/runs?limit=15');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.pipelineRuns).toHaveLength(15);
    });

    it('T1-AZD-14: Pipeline Run Record Schema Compliance', async () => {
      const runs = await harness.repo.getRecentPipelineRuns(undefined, 5);
      expect(runs.length).toBe(5);
      const first = runs[0];
      expect(first).toHaveProperty('runId');
      expect(first).toHaveProperty('pipelineId');
      expect(first).toHaveProperty('pipelineName');
      expect(first).toHaveProperty('runName');
      expect(first).toHaveProperty('state');
      expect(first).toHaveProperty('createdAt');
    });

    it('T1-AZD-15: Pipeline Runs Sorted in Chronological Descending Order', async () => {
      const runs = await harness.repo.getRecentPipelineRuns(undefined, 20);
      for (let i = 0; i < runs.length - 1; i++) {
        const curr = new Date(runs[i].createdAt).getTime();
        const next = new Date(runs[i + 1].createdAt).getTime();
        expect(curr).toBeGreaterThanOrEqual(next);
      }
    });

    it('T1-AZD-16: Pipeline Runs Contain Varied Execution States and Results', async () => {
      const runs = await harness.repo.getRecentPipelineRuns(undefined, 100);
      const states = new Set(runs.map((r: any) => r.state));
      expect(states.has('completed')).toBe(true);
      const results = new Set(runs.map((r: any) => r.result));
      expect(results.has('succeeded')).toBe(true);
    });
  });

  describe('Feature 5: Release Tracking (/api/azure-data/releases)', () => {
    it('T1-AZD-17: HTTP 200 Releases Query with Pagination Limit', async () => {
      const res = await harness.get('/api/azure-data/releases?limit=10');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.releases).toHaveLength(10);
    });

    it('T1-AZD-18: Release Record Schema Fields & Non-Null Values', async () => {
      const releases = await harness.repo.getRecentReleases(undefined, 5);
      const rel = releases[0];
      expect(rel.releaseId).toBeGreaterThan(0);
      expect(rel.definitionId).toBeGreaterThan(0);
      expect(rel.name).toMatch(/^Release-\d+/);
      expect(rel.status).toBe('active');
      expect(rel.reason).toBe('continuousIntegration');
      expect(new Date(rel.createdAt).getTime()).toBeGreaterThan(0);
    });

    it('T1-AZD-19: Releases Filter by Project Identifier', async () => {
      const targetProjectId = 'a2fa1d4a-63a4-4f95-a4e7-01f4c7ce5fbe';
      const releases = await harness.repo.getRecentReleases(targetProjectId, 10);
      for (const r of releases) {
        expect(r.projectId).toBe(targetProjectId);
      }
    });
  });

  describe('Feature 6: Test Health Quality Metrics (/api/azure-data/tests/health)', () => {
    it('T1-AZD-20: HTTP 200 Test Health Summary Query', async () => {
      const res = await harness.get('/api/azure-data/tests/health');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.testHealth).toHaveLength(2);
    });

    it('T1-AZD-21: Test Health Aggregate Counts for Both Projects', async () => {
      const testHealth = await harness.repo.getTestHealth();
      expect(testHealth).toHaveLength(2);
      for (const th of testHealth) {
        expect(th.totalRuns).toBe(1000);
        expect(th.passedTests).toBeGreaterThanOrEqual(0);
        expect(th.failedTests).toBeGreaterThanOrEqual(0);
        expect(th.projectName).toBeTruthy();
      }
    });
  });

  describe('Feature 7: Enterprise Teams & POD Directory (/api/azure-data/teams)', () => {
    it('T1-AZD-22: HTTP 200 Teams Query Returns Default 50 Teams', async () => {
      const res = await harness.get('/api/azure-data/teams');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.teams).toHaveLength(50);
      expect(res.body.totalCount).toBe(247);
    });

    it('T1-AZD-23: Total Enterprise Teams Count in azure-data.db Equals 247', async () => {
      const allTeams = await harness.repo.getTeams(undefined, undefined, 500);
      expect(allTeams).toHaveLength(247);
    });

    it('T1-AZD-24: Team Search Filter by Keyword "DevOps"', async () => {
      const res = await harness.get('/api/azure-data/teams?search=DevOps&limit=20');
      expect(res.status).toBe(200);
      expect(res.body.teams.length).toBeGreaterThan(0);
      for (const team of res.body.teams) {
        const matchesName = team.name.toLowerCase().includes('devops');
        const matchesDesc = team.description?.toLowerCase().includes('devops');
        expect(matchesName || matchesDesc).toBe(true);
      }
    });

    it('T1-AZD-25: Team Description JSON Parsing for Managed PODs', async () => {
      const teams = await harness.repo.getTeams(undefined, 'Banner and Nudge', 5);
      expect(teams.length).toBeGreaterThan(0);
      const teamWithJson = teams.find((t) => t.description && t.description.startsWith('{'));
      expect(teamWithJson).toBeDefined();
      const meta = JSON.parse(teamWithJson!.description!);
      expect(meta).toHaveProperty('POD Size');
      expect(meta).toHaveProperty('Lead PMO');
      expect(meta).toHaveProperty('SDM');
      expect(meta.Modules).toBe('Banner and Nudge');
    });

    it('T1-AZD-26: Team Project Mapping Consistency', async () => {
      const teams = await harness.repo.getTeams('d07e3437-8c91-4438-8719-7a9a126582db', undefined, 20);
      expect(teams.length).toBeGreaterThan(0);
      for (const t of teams) {
        expect(t.projectId).toBe('d07e3437-8c91-4438-8719-7a9a126582db');
        expect(t.projectName).toBe('3in1_Agile_Projects');
      }
    });
  });
});
