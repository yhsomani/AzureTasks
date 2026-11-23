import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import os from 'node:os';
import { SqliteAzureDataRepository } from '../../../src/infrastructure/persistence/sqlite-azure-data-repo.js';

describe('SqliteAzureDataRepository Unit Tests', () => {
  let repo: SqliteAzureDataRepository;

  beforeAll(() => {
    repo = new SqliteAzureDataRepository();
  });

  afterAll(() => {
    repo.close();
  });

  describe('Connection & Availability', () => {
    it('isAvailable returns true for the valid azure-data.db database', () => {
      expect(repo.isAvailable()).toBe(true);
    });

    it('isAvailable returns false when initialized with a non-existent file path', () => {
      const nonExistentPath = path.join(os.tmpdir(), `missing-db-${Date.now()}.db`);
      const missingRepo = new SqliteAzureDataRepository(nonExistentPath);
      expect(missingRepo.isAvailable()).toBe(false);
      missingRepo.close();
    });

    it('getRawDatabase throws if database is unavailable', () => {
      const nonExistentPath = path.join(os.tmpdir(), `missing-db-${Date.now()}.db`);
      const missingRepo = new SqliteAzureDataRepository(nonExistentPath);
      expect(() => missingRepo.getRawDatabase()).toThrow(/Database is not available/);
      missingRepo.close();
    });

    it('PRAGMA integrity check confirms database is healthy', () => {
      const db = repo.getRawDatabase();
      const integrity = db.pragma('integrity_check');
      expect(integrity).toEqual([{ integrity_check: 'ok' }]);
    });

    it('PRAGMA foreign_key_check confirms zero constraint violations', () => {
      const db = repo.getRawDatabase();
      const fkErrors = db.pragma('foreign_key_check');
      expect(fkErrors).toEqual([]);
    });

    it('Database operates in WAL mode for concurrent read scalability', () => {
      const db = repo.getRawDatabase();
      const journalMode = db.pragma('journal_mode') as Array<{ journal_mode: string }>;
      expect(journalMode[0].journal_mode.toLowerCase()).toBe('wal');
    });

    it('Enforces read-only behavior by throwing on mutating SQL', () => {
      const db = repo.getRawDatabase();
      expect(() => {
        db.prepare('CREATE TABLE test_disallowed (id INTEGER)').run();
      }).toThrow(/readonly/i);
    });
  });

  describe('getProjectOverview', () => {
    it('returns summary records for both Azure DevOps projects', async () => {
      const projects = await repo.getProjectOverview();
      expect(projects).toHaveLength(2);

      const frontend = projects.find((p) => p.name === '3_in_1_AppFrontEnd_Tasks');
      expect(frontend).toBeDefined();
      expect(frontend!.builds).toBeGreaterThan(50000);
      expect(frontend!.pipelines).toBeGreaterThan(200);
      expect(frontend!.releases).toBeGreaterThan(9000);
      expect(frontend!.testRuns).toBe(1000);
      expect(new Date(frontend!.syncedAt).getTime()).toBeGreaterThan(0);

      const agile = projects.find((p) => p.name === '3in1_Agile_Projects');
      expect(agile).toBeDefined();
      expect(agile!.testRuns).toBe(1000);
    });

    it('throws if database is unavailable', async () => {
      const missingRepo = new SqliteAzureDataRepository(path.join(os.tmpdir(), `missing-${Date.now()}.db`));
      await expect(missingRepo.getProjectOverview()).rejects.toThrow(/Database is not available/);
      missingRepo.close();
    });
  });

  describe('getBuildHealth', () => {
    it('returns default 20 build health definitions ordered by runs descending', async () => {
      const records = await repo.getBuildHealth();
      expect(records).toHaveLength(20);
      for (let i = 1; i < records.length; i++) {
        expect(records[i - 1].totalRuns).toBeGreaterThanOrEqual(records[i].totalRuns);
      }
      expect(records[0].definitionName).toBeTruthy();
      expect(records[0].successRate).toBeGreaterThanOrEqual(0);
      expect(records[0].successRate).toBeLessThanOrEqual(100);
    });

    it('respects custom limit parameter', async () => {
      const records = await repo.getBuildHealth(undefined, 7);
      expect(records).toHaveLength(7);
    });

    it('clamps limit = 0 to minimal valid record count of 1', async () => {
      const records = await repo.getBuildHealth(undefined, 0);
      expect(records).toHaveLength(1);
    });

    it('filters accurately by projectId', async () => {
      const targetProjectId = 'a2fa1d4a-63a4-4f95-a4e7-01f4c7ce5fbe';
      const records = await repo.getBuildHealth(targetProjectId, 10);
      expect(records.length).toBeGreaterThan(0);
      for (const r of records) {
        expect(r.projectId).toBe(targetProjectId);
      }
    });

    it('returns empty array when projectId is not found', async () => {
      const records = await repo.getBuildHealth('00000000-0000-0000-0000-000000000000', 10);
      expect(records).toEqual([]);
    });
  });

  describe('getTestHealth', () => {
    it('returns test quality metrics for both projects', async () => {
      const testHealth = await repo.getTestHealth();
      expect(testHealth).toHaveLength(2);
      for (const th of testHealth) {
        expect(th.totalRuns).toBe(1000);
        expect(th.passedTests).toBeGreaterThanOrEqual(0);
        expect(th.failedTests).toBeGreaterThanOrEqual(0);
        expect(th.passedTests + th.failedTests).toBe(th.totalRuns);
        expect(th.projectName).toBeTruthy();
      }
    });
  });

  describe('getTeams', () => {
    it('returns default 50 teams sorted by name', async () => {
      const teams = await repo.getTeams();
      expect(teams).toHaveLength(50);
      for (let i = 1; i < teams.length; i++) {
        expect(teams[i - 1].name.localeCompare(teams[i].name)).toBeLessThanOrEqual(0);
      }
    });

    it('returns all 247 enterprise teams when limit is set high', async () => {
      const teams = await repo.getTeams(undefined, undefined, 500);
      expect(teams).toHaveLength(247);
    });

    it('filters teams by search query matching name or description', async () => {
      const teams = await repo.getTeams(undefined, 'DevOps', 20);
      expect(teams.length).toBeGreaterThan(0);
      for (const t of teams) {
        const matchesName = t.name.toLowerCase().includes('devops');
        const matchesDesc = t.description?.toLowerCase().includes('devops');
        expect(matchesName || matchesDesc).toBe(true);
      }
    });

    it('filters teams by projectId', async () => {
      const targetProjectId = 'd07e3437-8c91-4438-8719-7a9a126582db';
      const teams = await repo.getTeams(targetProjectId, undefined, 20);
      expect(teams.length).toBeGreaterThan(0);
      for (const t of teams) {
        expect(t.projectId).toBe(targetProjectId);
        expect(t.projectName).toBe('3in1_Agile_Projects');
      }
    });

    it('returns total count of 247 teams via getTeamCount', async () => {
      const count = await repo.getTeamCount();
      expect(count).toBe(247);
    });

    it('returns accurate count with projectId filter via getTeamCount', async () => {
      const targetProjectId = 'd07e3437-8c91-4438-8719-7a9a126582db';
      const count = await repo.getTeamCount(targetProjectId);
      expect(count).toBe(230);
    });

    it('returns accurate count with search filter via getTeamCount', async () => {
      const count = await repo.getTeamCount(undefined, 'DevOps');
      expect(count).toBeGreaterThan(0);
    });
  });

  describe('getRecentReleases', () => {
    it('returns default 25 recent releases ordered by creation timestamp descending', async () => {
      const releases = await repo.getRecentReleases();
      expect(releases).toHaveLength(25);
      for (let i = 1; i < releases.length; i++) {
        expect(new Date(releases[i - 1].createdAt).getTime()).toBeGreaterThanOrEqual(
          new Date(releases[i].createdAt).getTime()
        );
      }
    });

    it('filters releases by projectId', async () => {
      const targetProjectId = 'a2fa1d4a-63a4-4f95-a4e7-01f4c7ce5fbe';
      const releases = await repo.getRecentReleases(targetProjectId, 10);
      expect(releases.length).toBeGreaterThan(0);
      for (const r of releases) {
        expect(r.projectId).toBe(targetProjectId);
      }
    });
  });

  describe('getRecentPipelineRuns', () => {
    it('returns default 25 recent pipeline runs ordered by creation timestamp descending', async () => {
      const runs = await repo.getRecentPipelineRuns();
      expect(runs).toHaveLength(25);
      for (let i = 1; i < runs.length; i++) {
        expect(new Date(runs[i - 1].createdAt).getTime()).toBeGreaterThanOrEqual(
          new Date(runs[i].createdAt).getTime()
        );
      }
    });
  });

  describe('getDataFreshness and getExportStatus', () => {
    it('getDataFreshness returns dataset counts per project', async () => {
      const freshness = await repo.getDataFreshness();
      expect(freshness.length).toBeGreaterThanOrEqual(2);
      const frontend = freshness.find((f) => f.projectName === '3_in_1_AppFrontEnd_Tasks');
      expect(frontend).toBeDefined();
      expect(frontend!.datasets).toBeGreaterThanOrEqual(1300);
    });

    it('getExportStatus returns latest export metadata', async () => {
      const status = await repo.getExportStatus();
      expect(status).not.toBeNull();
      expect(status!.organization).toBe('BFLDevOpsOrg');
      expect(status!.mode).toBe('dashboard');
      expect(status!.datasetCount).toBeGreaterThanOrEqual(1500);
    });

    it('getExportErrors returns classified sync errors', async () => {
      const errors = await repo.getExportErrors!();
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toHaveProperty('statusCode');
      expect(errors[0]).toHaveProperty('scope');
    });
  });
});
