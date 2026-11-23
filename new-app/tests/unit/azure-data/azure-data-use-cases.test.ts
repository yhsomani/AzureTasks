import { describe, it, expect, vi } from 'vitest';
import { IAzureDataRepository } from '../../../src/domain/ports/azure-data-repository.js';
import {
  GetAzureOverviewUseCase,
  GetBuildHealthUseCase,
  GetPipelineRunsUseCase,
  GetRecentReleasesUseCase,
  GetTestHealthUseCase,
  GetAzureTeamsUseCase,
} from '../../../src/application/use-cases/azure-data/index.js';

function createMockRepo(overrides?: Partial<IAzureDataRepository>): IAzureDataRepository {
  return {
    isAvailable: vi.fn(() => true),
    getProjectOverview: vi.fn(async () => [
      {
        projectId: 'proj-1',
        name: 'Project Alpha',
        workItems: 10,
        repositories: 2,
        pullRequests: 5,
        pipelines: 20,
        builds: 100,
        releases: 15,
        testRuns: 50,
        syncedAt: '2026-11-22T00:00:00Z',
      },
    ]),
    getBuildHealth: vi.fn(async (_projectId, _limit) => [
      {
        projectId: 'proj-1',
        definitionId: 101,
        definitionName: 'CI Pipeline',
        totalRuns: 50,
        succeeded: 45,
        failed: 5,
        successRate: 90.0,
        latestFinishedAt: '2026-11-22T10:00:00Z',
      },
    ]),
    getTestHealth: vi.fn(async () => [
      {
        projectId: 'proj-1',
        projectName: 'Project Alpha',
        totalRuns: 100,
        passedTests: 98,
        failedTests: 2,
        successRate: 98.0,
        latestCompletedAt: '2026-11-22T12:00:00Z',
      },
    ]),
    getTeams: vi.fn(async (_projectId, _search, _limit) => [
      {
        teamId: 'team-1',
        projectId: 'proj-1',
        projectName: 'Project Alpha',
        name: 'Core Platform',
        description: '{"POD Size": 8, "Lead PMO": "Jane"}',
      },
    ]),
    getRecentReleases: vi.fn(async (_projectId, _limit) => [
      {
        releaseId: 501,
        definitionId: 90,
        projectId: 'proj-1',
        projectName: 'Project Alpha',
        name: 'Release-1.0',
        status: 'active',
        reason: 'continuousIntegration',
        createdAt: '2026-11-22T09:00:00Z',
        modifiedAt: '2026-11-22T09:30:00Z',
      },
    ]),
    getRecentPipelineRuns: vi.fn(async (_projectId, _limit) => [
      {
        runId: 1001,
        pipelineId: 10,
        projectId: 'proj-1',
        pipelineName: 'Alpha-Build',
        runName: 'Run-1001',
        state: 'completed',
        result: 'succeeded',
        createdAt: '2026-11-22T08:00:00Z',
        finishedAt: '2026-11-22T08:15:00Z',
      },
    ]),
    getDataFreshness: vi.fn(async () => [
      {
        projectName: 'Project Alpha',
        datasets: 150,
        lastUpdated: '2026-11-22T00:00:00Z',
      },
    ]),
    getExportStatus: vi.fn(async () => ({
      runId: 'run-uuid-1',
      organization: 'TestOrg',
      mode: 'dashboard',
      requestedProjects: 'Project Alpha',
      status: 'completed',
      startedAt: '2026-11-22T00:00:00Z',
      completedAt: '2026-11-22T00:05:00Z',
      datasetCount: 150,
      errorCount: 0,
    })),
    ...overrides,
  };
}

describe('Azure Data Application Use Cases Unit Tests', () => {
  describe('GetAzureOverviewUseCase', () => {
    it('successfully aggregates projects, freshness, and export status', async () => {
      const mockRepo = createMockRepo();
      const useCase = new GetAzureOverviewUseCase(mockRepo);

      const result = await useCase.execute();
      expect(result.projects).toHaveLength(1);
      expect(result.projects[0].name).toBe('Project Alpha');
      expect(result.freshness).toHaveLength(1);
      expect(result.exportStatus?.organization).toBe('TestOrg');
      expect(mockRepo.getProjectOverview).toHaveBeenCalledOnce();
      expect(mockRepo.getDataFreshness).toHaveBeenCalledOnce();
      expect(mockRepo.getExportStatus).toHaveBeenCalledOnce();
    });

    it('throws error when database is unavailable', async () => {
      const mockRepo = createMockRepo({ isAvailable: () => false });
      const useCase = new GetAzureOverviewUseCase(mockRepo);

      await expect(useCase.execute()).rejects.toThrow(/unavailable/i);
    });
  });

  describe('GetBuildHealthUseCase', () => {
    it('executes query with optional filter parameters', async () => {
      const mockRepo = createMockRepo();
      const useCase = new GetBuildHealthUseCase(mockRepo);

      const result = await useCase.execute({ projectId: 'proj-1', limit: 15 });
      expect(result).toHaveLength(1);
      expect(mockRepo.getBuildHealth).toHaveBeenCalledWith('proj-1', 15);
    });

    it('rejects negative limit parameter', async () => {
      const mockRepo = createMockRepo();
      const useCase = new GetBuildHealthUseCase(mockRepo);

      await expect(useCase.execute({ limit: -10 })).rejects.toThrow('Invalid limit parameter');
    });

    it('rejects non-numeric NaN limit parameter', async () => {
      const mockRepo = createMockRepo();
      const useCase = new GetBuildHealthUseCase(mockRepo);

      await expect(useCase.execute({ limit: NaN })).rejects.toThrow('Invalid limit parameter');
    });

    it('throws error when repository reports unavailable', async () => {
      const mockRepo = createMockRepo({ isAvailable: () => false });
      const useCase = new GetBuildHealthUseCase(mockRepo);

      await expect(useCase.execute()).rejects.toThrow(/unavailable/i);
    });
  });

  describe('GetPipelineRunsUseCase', () => {
    it('executes query and retrieves pipeline runs', async () => {
      const mockRepo = createMockRepo();
      const useCase = new GetPipelineRunsUseCase(mockRepo);

      const result = await useCase.execute({ projectId: 'proj-1', limit: 25 });
      expect(result).toHaveLength(1);
      expect(result[0].runName).toBe('Run-1001');
      expect(mockRepo.getRecentPipelineRuns).toHaveBeenCalledWith('proj-1', 25);
    });

    it('rejects invalid limit parameter', async () => {
      const mockRepo = createMockRepo();
      const useCase = new GetPipelineRunsUseCase(mockRepo);

      await expect(useCase.execute({ limit: -5 })).rejects.toThrow('Invalid limit parameter');
    });

    it('throws error when repository is unavailable', async () => {
      const mockRepo = createMockRepo({ isAvailable: () => false });
      const useCase = new GetPipelineRunsUseCase(mockRepo);

      await expect(useCase.execute()).rejects.toThrow(/unavailable/i);
    });
  });

  describe('GetRecentReleasesUseCase', () => {
    it('executes query and retrieves recent releases', async () => {
      const mockRepo = createMockRepo();
      const useCase = new GetRecentReleasesUseCase(mockRepo);

      const result = await useCase.execute({ limit: 10 });
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Release-1.0');
      expect(mockRepo.getRecentReleases).toHaveBeenCalledWith(undefined, 10);
    });

    it('rejects invalid limit parameter', async () => {
      const mockRepo = createMockRepo();
      const useCase = new GetRecentReleasesUseCase(mockRepo);

      await expect(useCase.execute({ limit: -1 })).rejects.toThrow('Invalid limit parameter');
    });

    it('throws when repository is unavailable', async () => {
      const mockRepo = createMockRepo({ isAvailable: () => false });
      const useCase = new GetRecentReleasesUseCase(mockRepo);

      await expect(useCase.execute()).rejects.toThrow(/unavailable/i);
    });
  });

  describe('GetTestHealthUseCase', () => {
    it('executes query and returns test health records', async () => {
      const mockRepo = createMockRepo();
      const useCase = new GetTestHealthUseCase(mockRepo);

      const result = await useCase.execute();
      expect(result).toHaveLength(1);
      expect(result[0].passedTests).toBe(98);
      expect(mockRepo.getTestHealth).toHaveBeenCalledOnce();
    });

    it('throws when repository is unavailable', async () => {
      const mockRepo = createMockRepo({ isAvailable: () => false });
      const useCase = new GetTestHealthUseCase(mockRepo);

      await expect(useCase.execute()).rejects.toThrow(/unavailable/i);
    });
  });

  describe('GetAzureTeamsUseCase', () => {
    it('executes query with search and limit filters', async () => {
      const mockRepo = createMockRepo();
      const useCase = new GetAzureTeamsUseCase(mockRepo);

      const result = await useCase.execute({ projectId: 'proj-1', search: 'Core', limit: 10 });
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Core Platform');
      expect(mockRepo.getTeams).toHaveBeenCalledWith('proj-1', 'Core', 10);
    });

    it('rejects invalid limit parameter', async () => {
      const mockRepo = createMockRepo();
      const useCase = new GetAzureTeamsUseCase(mockRepo);

      await expect(useCase.execute({ limit: -20 })).rejects.toThrow('Invalid limit parameter');
    });

    it('throws when repository is unavailable', async () => {
      const mockRepo = createMockRepo({ isAvailable: () => false });
      const useCase = new GetAzureTeamsUseCase(mockRepo);

      await expect(useCase.execute()).rejects.toThrow(/unavailable/i);
    });

    it('counts teams using repo.getTeamCount when available', async () => {
      const mockRepo = createMockRepo({
        getTeamCount: vi.fn(async () => 42),
      });
      const useCase = new GetAzureTeamsUseCase(mockRepo);

      const count = await useCase.count({ projectId: 'proj-1', search: 'Core' });
      expect(count).toBe(42);
      expect(mockRepo.getTeamCount).toHaveBeenCalledWith('proj-1', 'Core');
    });

    it('falls back to getTeams when repo.getTeamCount is not defined', async () => {
      const mockRepo = createMockRepo();
      const useCase = new GetAzureTeamsUseCase(mockRepo);

      const count = await useCase.count({ projectId: 'proj-1', search: 'Core' });
      expect(count).toBe(1);
      expect(mockRepo.getTeams).toHaveBeenCalledWith('proj-1', 'Core', 500);
    });
  });
});
