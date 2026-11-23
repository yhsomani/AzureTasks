import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import http from 'node:http';
import express from 'express';
import { createAzureDataRouter } from '../../../src/presentation/api/azure-data-routes.js';
import { IAzureDataRepository } from '../../../src/domain/ports/azure-data-repository.js';

function createMockRepo(overrides?: Partial<IAzureDataRepository>): IAzureDataRepository {
  return {
    isAvailable: vi.fn(() => true),
    getProjectOverview: vi.fn(async () => [
      {
        projectId: 'p1',
        name: 'Project 1',
        workItems: 5,
        repositories: 2,
        pullRequests: 3,
        pipelines: 10,
        builds: 50,
        releases: 8,
        testRuns: 20,
        syncedAt: '2026-11-22T00:00:00Z',
      },
    ]),
    getBuildHealth: vi.fn(async () => [
      {
        projectId: 'p1',
        definitionId: 1,
        definitionName: 'Build Def 1',
        totalRuns: 20,
        succeeded: 18,
        failed: 2,
        successRate: 90.0,
        latestFinishedAt: '2026-11-22T10:00:00Z',
      },
    ]),
    getTestHealth: vi.fn(async () => [
      {
        projectId: 'p1',
        projectName: 'Project 1',
        totalRuns: 20,
        passedTests: 19,
        failedTests: 1,
        successRate: 95.0,
        latestCompletedAt: '2026-11-22T12:00:00Z',
      },
    ]),
    getTeams: vi.fn(async () => [
      {
        teamId: 't1',
        projectId: 'p1',
        projectName: 'Project 1',
        name: 'Team Alpha',
        description: 'Alpha team description',
      },
    ]),
    getTeamCount: vi.fn(async () => 1),
    getRecentReleases: vi.fn(async () => [
      {
        releaseId: 101,
        definitionId: 11,
        projectId: 'p1',
        projectName: 'Project 1',
        name: 'Release-1',
        status: 'active',
        reason: 'manual',
        createdAt: '2026-11-22T08:00:00Z',
        modifiedAt: '2026-11-22T08:30:00Z',
      },
    ]),
    getRecentPipelineRuns: vi.fn(async () => [
      {
        runId: 201,
        pipelineId: 12,
        projectId: 'p1',
        pipelineName: 'Pipe-1',
        runName: 'Run-201',
        state: 'completed',
        result: 'succeeded',
        createdAt: '2026-11-22T07:00:00Z',
        finishedAt: '2026-11-22T07:15:00Z',
      },
    ]),
    getDataFreshness: vi.fn(async () => [
      {
        projectName: 'Project 1',
        datasets: 100,
        lastUpdated: '2026-11-22T00:00:00Z',
      },
    ]),
    getExportStatus: vi.fn(async () => ({
      runId: 'run-1',
      organization: 'Org',
      mode: 'dashboard',
      requestedProjects: 'Project 1',
      status: 'completed',
      startedAt: '2026-11-22T00:00:00Z',
      completedAt: '2026-11-22T00:05:00Z',
      datasetCount: 100,
      errorCount: 0,
    })),
    ...overrides,
  };
}

describe('Azure Data Routes Unit Tests', () => {
  let app: express.Application;
  let server: http.Server;
  let baseUrl: string;
  let mockRepo: IAzureDataRepository;

  beforeAll(async () => {
    mockRepo = createMockRepo();
    app = express();
    app.use(express.json());
    app.use('/api/azure-data', createAzureDataRouter(mockRepo));

    server = http.createServer(app);
    await new Promise<void>((resolve) => {
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const addr = server.address() as any;
    baseUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  });

  describe('Availability Middleware', () => {
    it('returns HTTP 503 when repo is unavailable', async () => {
      const unavailableRepo = createMockRepo({ isAvailable: () => false });
      const isolatedApp = express();
      isolatedApp.use('/api/azure-data', createAzureDataRouter(unavailableRepo));

      const isolatedServer = http.createServer(isolatedApp);
      await new Promise<void>((resolve) => isolatedServer.listen(0, '127.0.0.1', () => resolve()));
      const port = (isolatedServer.address() as any).port;

      const res = await fetch(`http://127.0.0.1:${port}/api/azure-data/overview`);
      expect(res.status).toBe(503);
      const body = await res.json() as any;
      expect(body.success).toBe(false);
      expect(body.error).toContain('unavailable');

      await new Promise<void>((resolve) => isolatedServer.close(() => resolve()));
    });
  });

  describe('GET /api/azure-data/overview', () => {
    it('returns 200 with projects, freshness, and export status', async () => {
      const res = await fetch(`${baseUrl}/api/azure-data/overview`);
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.success).toBe(true);
      expect(body.projects).toHaveLength(1);
      expect(body.freshness).toHaveLength(1);
      expect(body.exportStatus.runId).toBe('run-1');
    });
  });

  describe('GET /api/azure-data/builds/health', () => {
    it('returns 200 with build health list', async () => {
      const res = await fetch(`${baseUrl}/api/azure-data/builds/health?limit=10&projectId=p1`);
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.success).toBe(true);
      expect(body.buildHealth).toHaveLength(1);
      expect(mockRepo.getBuildHealth).toHaveBeenCalledWith('p1', 10);
    });

    it('returns 400 Bad Request on negative limit', async () => {
      const res = await fetch(`${baseUrl}/api/azure-data/builds/health?limit=-5`);
      expect(res.status).toBe(400);
      const body = await res.json() as any;
      expect(body.success).toBe(false);
      expect(body.error).toContain('Invalid limit');
    });

    it('returns 400 Bad Request on non-numeric limit', async () => {
      const res = await fetch(`${baseUrl}/api/azure-data/builds/health?limit=abc`);
      expect(res.status).toBe(400);
      const body = await res.json() as any;
      expect(body.success).toBe(false);
      expect(body.error).toContain('Invalid limit');
    });
  });

  describe('GET /api/azure-data/pipelines/runs', () => {
    it('returns 200 with pipeline runs', async () => {
      const res = await fetch(`${baseUrl}/api/azure-data/pipelines/runs?limit=15`);
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.success).toBe(true);
      expect(body.pipelineRuns).toHaveLength(1);
      expect(mockRepo.getRecentPipelineRuns).toHaveBeenCalledWith(undefined, 15);
    });

    it('returns 400 Bad Request on invalid limit', async () => {
      const res = await fetch(`${baseUrl}/api/azure-data/pipelines/runs?limit=-1`);
      expect(res.status).toBe(400);
      const body = await res.json() as any;
      expect(body.success).toBe(false);
    });
  });

  describe('GET /api/azure-data/releases', () => {
    it('returns 200 with releases', async () => {
      const res = await fetch(`${baseUrl}/api/azure-data/releases?limit=20`);
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.success).toBe(true);
      expect(body.releases).toHaveLength(1);
    });

    it('returns 400 on negative limit', async () => {
      const res = await fetch(`${baseUrl}/api/azure-data/releases?limit=-2`);
      expect(res.status).toBe(400);
    });
  });

  describe('GET /api/azure-data/tests/health', () => {
    it('returns 200 with test health records', async () => {
      const res = await fetch(`${baseUrl}/api/azure-data/tests/health`);
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.success).toBe(true);
      expect(body.testHealth).toHaveLength(1);
    });
  });

  describe('GET /api/azure-data/teams', () => {
    it('returns 200 with teams and totalCount', async () => {
      const res = await fetch(`${baseUrl}/api/azure-data/teams?search=Alpha&limit=5`);
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.success).toBe(true);
      expect(body.teams).toHaveLength(1);
      expect(body.totalCount).toBe(1);
      expect(mockRepo.getTeams).toHaveBeenCalledWith(undefined, 'Alpha', 5);
    });

    it('returns 400 on invalid limit', async () => {
      const res = await fetch(`${baseUrl}/api/azure-data/teams?limit=-10`);
      expect(res.status).toBe(400);
    });
  });
});
