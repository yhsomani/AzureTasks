import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createAzureDataTestHarness, AzureDataTestHarnessInstance } from './azure-data-harness.js';

describe('Tier 4: Real-World Application Scenarios (Persona-Driven Workflows)', () => {
  let harness: AzureDataTestHarnessInstance;

  beforeAll(async () => {
    harness = await createAzureDataTestHarness();
  });

  afterAll(async () => {
    await harness.close();
  });

  describe('Scenario 1: DevOps Engineer CI/CD Build Triage Workflow', () => {
    it('T4-AZD-01: Engineer Diagnoses High-Failure Definitions & Telemetry Timestamps', async () => {
      // 1. Engineer inspects project overview
      const overviewRes = await harness.get('/api/azure-data/overview');
      expect(overviewRes.status).toBe(200);
      const frontendProject = overviewRes.body.projects.find(
        (p: any) => p.name === '3_in_1_AppFrontEnd_Tasks'
      );
      expect(frontendProject).toBeDefined();
      expect(frontendProject.builds).toBeGreaterThan(50000);

      // 2. Engineer queries build health for 3_in_1_AppFrontEnd_Tasks
      const healthRes = await harness.get(
        `/api/azure-data/builds/health?projectId=${frontendProject.projectId}&limit=10`
      );
      expect(healthRes.status).toBe(200);
      const buildHealth = healthRes.body.buildHealth;
      expect(buildHealth.length).toBeGreaterThan(0);

      // 3. Engineer isolates definition with greatest number of failures
      const mostFailing = buildHealth.reduce((prev: any, current: any) =>
        prev.failed > current.failed ? prev : current
      );
      expect(mostFailing.definitionName).toContain('3in1_PWA');
      expect(mostFailing.failed).toBeGreaterThan(1000);
      expect(mostFailing.successRate).toBeLessThan(50);

      // 4. Engineer checks recent pipeline runs for that project
      const runsRes = await harness.get(
        `/api/azure-data/pipelines/runs?projectId=${frontendProject.projectId}&limit=20`
      );
      expect(runsRes.status).toBe(200);
      const runs = runsRes.body.pipelineRuns;
      expect(runs.length).toBeGreaterThan(0);

      // 5. Engineer verifies latest run state and timestamp
      const latestRun = runs[0];
      expect(latestRun.createdAt).toBeTruthy();
      expect(new Date(latestRun.createdAt).getTime()).toBeGreaterThan(0);
      expect(['completed', 'inProgress', 'cancelling']).toContain(latestRun.state);
    });
  });

  describe('Scenario 2: QA Lead Test Quality & POD Coverage Workflow', () => {
    it('T4-AZD-02: QA Lead Audits Test Runs and Test Plan Distributions by Module', async () => {
      // 1. QA Lead inspects test health summary
      const testHealthRes = await harness.get('/api/azure-data/tests/health');
      expect(testHealthRes.status).toBe(200);
      const testHealth = testHealthRes.body.testHealth;
      expect(testHealth).toHaveLength(2);

      const totalTestRunsAcrossOrg = testHealth.reduce(
        (acc: number, item: any) => acc + item.totalRuns,
        0
      );
      expect(totalTestRunsAcrossOrg).toBe(2000);

      // 2. QA Lead inspects test plans in database for financial modules
      const db = (harness.repo as any).getRawDatabase();
      const testPlans = db
        .prepare('SELECT plan_id, name, state FROM test_plans ORDER BY name ASC')
        .all() as Array<{ plan_id: number; name: string; state: string }>;
      expect(testPlans.length).toBe(55);

      // 3. QA Lead verifies test plans exist for critical business lines (Gold Loan, Personal Loan)
      const loanPlans = testPlans.filter((p) =>
        p.name.toLowerCase().includes('loan') || p.name.toLowerCase().includes('fd')
      );
      expect(loanPlans.length).toBeGreaterThan(0);

      // 4. QA Lead verifies test suites mapped under test plans
      const testSuitesCount = db.prepare('SELECT COUNT(*) as count FROM test_suites').get() as {
        count: number;
      };
      expect(testSuitesCount.count).toBe(89);
    });
  });

  describe('Scenario 3: Engineering Manager Team & POD Roster Exploration', () => {
    it('T4-AZD-03: Manager Searches Enterprise PODs & Extracts PMO / SDM Leadership Roles', async () => {
      // 1. Manager queries total team count
      const teamsRes = await harness.get('/api/azure-data/teams?limit=300');
      expect(teamsRes.status).toBe(200);
      expect(teamsRes.body.teams).toHaveLength(247);

      // 2. Manager searches for Banner and Nudge POD
      const bannerPodRes = await harness.get('/api/azure-data/teams?search=Banner');
      expect(bannerPodRes.status).toBe(200);
      expect(bannerPodRes.body.teams.length).toBeGreaterThan(0);

      const bannerPod = bannerPodRes.body.teams[0];
      expect(bannerPod.name).toContain('Banner and Nudge');
      expect(bannerPod.description).toBeTruthy();

      // 3. Manager parses leadership metadata
      const leadership = JSON.parse(bannerPod.description);
      expect(leadership['Lead PMO']).toBe('Ayush Rai4');
      expect(leadership.SDM).toBe('Aman Shinde1');
      expect(leadership['POD Size']).toBe('12');

      // 4. Manager queries team member mappings in database
      const db = (harness.repo as any).getRawDatabase();
      const members = db
        .prepare(
          `SELECT tm.team_id, i.display_name, i.email
           FROM team_members tm
           JOIN identities i ON i.identity_id = tm.identity_id
           WHERE tm.team_id = ?`
        )
        .all(bannerPod.teamId);
      // Team members cross-reference is available
      expect(Array.isArray(members)).toBe(true);
    });
  });

  describe('Scenario 4: Release Manager Deployment Cadence Verification', () => {
    it('T4-AZD-04: Release Manager Reviews Continuous Integration Pipeline Deployments', async () => {
      // 1. Release manager checks recent releases
      const releasesRes = await harness.get('/api/azure-data/releases?limit=15');
      expect(releasesRes.status).toBe(200);
      const releases = releasesRes.body.releases;
      expect(releases).toHaveLength(15);

      // 2. Release manager inspects release definitions
      const release = releases[0];
      expect(release.definitionId).toBeGreaterThan(0);
      expect(release.status).toBe('active');
      expect(release.reason).toBe('continuousIntegration');

      // 3. Release manager verifies deployment definition exists in pipelines/releases schema
      const db = (harness.repo as any).getRawDatabase();
      const totalReleases = db.prepare('SELECT COUNT(*) as count FROM releases').get() as {
        count: number;
      };
      expect(totalReleases.count).toBe(9116);
    });
  });

  describe('Scenario 5: Security Auditor Read-Only Isolation Verification', () => {
    it('T4-AZD-05: Auditor Validates Zero Foreign Key Violations and Full Database Integrity', () => {
      const db = (harness.repo as any).getRawDatabase();

      // 1. Verify PRAGMA integrity_check
      const integrity = db.pragma('integrity_check');
      expect(integrity).toEqual([{ integrity_check: 'ok' }]);

      // 2. Verify PRAGMA foreign_key_check
      const fkCheck = db.pragma('foreign_key_check');
      expect(fkCheck).toEqual([]);

      // 3. Verify write attempts throw read-only error
      expect(() => {
        db.prepare("INSERT INTO azure_projects (project_id, name, synced_at) VALUES ('test', 'test', 'now')").run();
      }).toThrow(/attempt to write a readonly database|readonly/i);
    });
  });

  describe('Scenario 6: System Administrator Sync Health & Diagnostic Audit', () => {
    it('T4-AZD-06: Administrator Audits Sync Steps, Datasets, and Classified Errors', async () => {
      const db = (harness.repo as any).getRawDatabase();

      // 1. Admin queries export status view
      const statusRes = await harness.get('/api/azure-data/overview');
      expect(statusRes.status).toBe(200);
      const exportStatus = statusRes.body.exportStatus;
      expect(exportStatus.organization).toBe('BFLDevOpsOrg');
      expect(exportStatus.datasetCount).toBe(1511);
      expect(exportStatus.errorCount).toBe(216);

      // 2. Admin audits sync_steps table
      const syncStepsCount = db.prepare('SELECT COUNT(*) as count FROM sync_steps').get() as {
        count: number;
      };
      expect(syncStepsCount.count).toBeGreaterThan(2000);

      // 3. Admin audits export_errors table
      const errors = db
        .prepare('SELECT DISTINCT status, COUNT(*) as count FROM export_errors GROUP BY status')
        .all() as Array<{ status: number; count: number }>;
      expect(errors.length).toBeGreaterThan(0);
      const statusCodes = errors.map((e) => e.status);
      expect(statusCodes).toContain(401);
      expect(statusCodes).toContain(404);
    });
  });
});
