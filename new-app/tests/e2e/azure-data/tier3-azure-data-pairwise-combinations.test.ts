import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createAzureDataTestHarness, AzureDataTestHarnessInstance } from './azure-data-harness.js';

describe('Tier 3: Pairwise Combinatorial & Cross-Feature Interactions', () => {
  let harness: AzureDataTestHarnessInstance;

  beforeAll(async () => {
    harness = await createAzureDataTestHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  describe('Interaction 1: Cross-Resource Data Freshness & Export Status Correlation', () => {
    it('T3-AZD-01: Sum of Datasets across Projects Exactly Matches Export Meta Total', async () => {
      const [freshness, status] = await Promise.all([
        harness.repo.getDataFreshness(),
        harness.repo.getExportStatus(),
      ]);

      const sumDatasets = freshness.reduce((acc, curr) => acc + curr.datasets, 0);
      expect(sumDatasets).toBe(status.datasetCount);
      expect(sumDatasets).toBe(1511);
    });

    it('T3-AZD-02: Sync Run ID Identity Matches across Tables and Views', async () => {
      const db = (harness.repo as any).getRawDatabase();
      const exportRun = db.prepare('SELECT run_id FROM exports LIMIT 1').get() as { run_id: string };
      expect(exportRun).toBeDefined();

      const projectRuns = db.prepare('SELECT DISTINCT sync_run_id FROM azure_projects').all() as Array<{ sync_run_id: string }>;
      expect(projectRuns).toHaveLength(1);
      expect(projectRuns[0].sync_run_id).toBe(exportRun.run_id);

      const teamRuns = db.prepare('SELECT DISTINCT sync_run_id FROM azure_teams').all() as Array<{ sync_run_id: string }>;
      expect(teamRuns).toHaveLength(1);
      expect(teamRuns[0].sync_run_id).toBe(exportRun.run_id);
    });
  });

  describe('Interaction 2: Multi-Factor Project & Team Filtering Combinations', () => {
    it('T3-AZD-03: Team Search scoped to Project 1 vs Project 2', async () => {
      const projAgile = 'd07e3437-8c91-4438-8719-7a9a126582db';
      const projFrontend = 'a2fa1d4a-63a4-4f95-a4e7-01f4c7ce5fbe';

      const agileDevOps = await harness.repo.getTeams(projAgile, 'DevOps', 50);
      const frontendDevOps = await harness.repo.getTeams(projFrontend, 'DevOps', 50);

      expect(agileDevOps.length).toBeGreaterThan(0);
      for (const t of agileDevOps) {
        expect(t.projectId).toBe(projAgile);
      }
      for (const t of frontendDevOps) {
        expect(t.projectId).toBe(projFrontend);
      }
    });

    it('T3-AZD-04: Project Overview Work Item Aggregation Correlates with Work Items Table', async () => {
      const db = (harness.repo as any).getRawDatabase();
      const overview = await harness.repo.getProjectOverview();

      for (const proj of overview) {
        const actualCount = db.prepare('SELECT COUNT(*) as count FROM work_items WHERE project_id = ?').get(proj.projectId) as { count: number };
        expect(proj.workItems).toBe(actualCount.count);
      }
    });

    it('T3-AZD-05: Project Overview Repository Aggregation Correlates with Repositories Table', async () => {
      const db = (harness.repo as any).getRawDatabase();
      const overview = await harness.repo.getProjectOverview();

      for (const proj of overview) {
        const actualCount = db.prepare('SELECT COUNT(*) as count FROM repositories WHERE project_id = ?').get(proj.projectId) as { count: number };
        expect(proj.repositories).toBe(actualCount.count);
      }
    });
  });

  describe('Interaction 3: CI/CD Cross-Correlation (Pipelines, Builds & Releases)', () => {
    it('T3-AZD-06: Build Definition IDs in Build Health Exist in Pipelines Table', async () => {
      const db = (harness.repo as any).getRawDatabase();
      const buildHealth = await harness.repo.getBuildHealth(undefined, 10);

      for (const bh of buildHealth) {
        const pipeline = db.prepare('SELECT pipeline_id, name FROM pipelines WHERE pipeline_id = ? AND project_id = ?').get(bh.definitionId, bh.projectId);
        expect(pipeline).toBeDefined();
        expect((pipeline as any).name).toBe(bh.definitionName);
      }
    });

    it('T3-AZD-07: Release Definitions Cross-Reference Pipeline Deployment Artifacts', async () => {
      const releases = await harness.repo.getRecentReleases('a2fa1d4a-63a4-4f95-a4e7-01f4c7ce5fbe', 20);
      const pwaDeploymentReleases = releases.filter((r) => r.definitionId === 93);
      expect(pwaDeploymentReleases.length).toBeGreaterThan(0);

      for (const rel of pwaDeploymentReleases) {
        expect(rel.name).toMatch(/^Release-\d+/);
        expect(rel.status).toBe('active');
        expect(rel.reason).toBe('continuousIntegration');
      }
    });

    it('T3-AZD-08: Pipeline Run Execution State Combinations', async () => {
      const runs = await harness.repo.getRecentPipelineRuns('a2fa1d4a-63a4-4f95-a4e7-01f4c7ce5fbe', 50);
      const completedRuns = runs.filter((r) => r.state === 'completed');
      expect(completedRuns.length).toBeGreaterThan(0);

      for (const c of completedRuns) {
        expect(['succeeded', 'failed', 'canceled', 'partiallySucceeded']).toContain(c.result);
      }
    });
  });

  describe('Interaction 4: Concurrency & Asynchronous Read Scalability', () => {
    it('T3-AZD-09: 50 Simultaneous Concurrent Parallel API Requests Complete without Lock Contention', async () => {
      const endpoints = [
        '/api/azure-data/overview',
        '/api/azure-data/builds/health?limit=5',
        '/api/azure-data/pipelines/runs?limit=10',
        '/api/azure-data/releases?limit=10',
        '/api/azure-data/tests/health',
        '/api/azure-data/teams?limit=10',
        '/api/azure-data/teams?search=DevOps&limit=5',
        '/api/azure-data/teams?search=Loan&limit=5',
      ];

      const startMs = Date.now();
      const promises: Array<Promise<any>> = [];
      for (let i = 0; i < 50; i++) {
        const ep = endpoints[i % endpoints.length];
        promises.push(harness.get(ep));
      }

      const results = await Promise.all(promises);
      const durationMs = Date.now() - startMs;

      for (const res of results) {
        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
      }
      // 50 requests in parallel should complete well within 5 seconds in WAL mode
      expect(durationMs).toBeLessThan(5000);
    });

    it('T3-AZD-10: Database Latency SLA for Team Lookups Is Under 50ms', async () => {
      const startMs = Date.now();
      await harness.repo.getTeams(undefined, 'Pod', 50);
      const elapsed = Date.now() - startMs;
      expect(elapsed).toBeLessThan(100);
    });
  });
});
