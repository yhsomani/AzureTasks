/**
 * Express Presentation Routes for Azure DevOps ALM Intelligence.
 * 
 * Exposes /api/azure-data/* REST endpoints querying azure-data.db via use cases
 * and hexagonal architecture.
 */

import { Router, Request, Response, NextFunction } from 'express';
import { IAzureDataRepository } from '../../domain/ports/azure-data-repository.js';
import { SqliteAzureDataRepository } from '../../infrastructure/persistence/sqlite-azure-data-repo.js';
import {
  GetAzureOverviewUseCase,
  GetBuildHealthUseCase,
  GetPipelineRunsUseCase,
  GetRecentReleasesUseCase,
  GetTestHealthUseCase,
  GetAzureTeamsUseCase,
} from '../../application/use-cases/azure-data/index.js';

export interface AzureDataRouterOptions {
  repo?: IAzureDataRepository;
}

/**
 * Creates an Express Router providing the standard /api/azure-data/* REST endpoints.
 */
export function createAzureDataRouter(repoOrOptions?: IAzureDataRepository | AzureDataRouterOptions): Router {
  const repo: IAzureDataRepository =
    repoOrOptions && 'isAvailable' in repoOrOptions
      ? repoOrOptions
      : (repoOrOptions?.repo || new SqliteAzureDataRepository());

  const overviewUseCase = new GetAzureOverviewUseCase(repo);
  const buildHealthUseCase = new GetBuildHealthUseCase(repo);
  const pipelineRunsUseCase = new GetPipelineRunsUseCase(repo);
  const releasesUseCase = new GetRecentReleasesUseCase(repo);
  const testHealthUseCase = new GetTestHealthUseCase(repo);
  const teamsUseCase = new GetAzureTeamsUseCase(repo);

  const router = Router();

  // Availability guard middleware
  const checkAvailability = (_req: Request, res: Response, next: NextFunction) => {
    if (!repo.isAvailable()) {
      return res.status(503).json({
        success: false,
        error: 'Azure data database is currently unavailable.',
      });
    }
    next();
  };

  router.use(checkAvailability);

  // GET /api/azure-data/overview
  router.get('/overview', async (_req: Request, res: Response) => {
    try {
      const data = await overviewUseCase.execute();
      res.json({
        success: true,
        projects: data.projects,
        freshness: data.freshness,
        exportStatus: data.exportStatus,
      });
    } catch (err: any) {
      if (err.message && err.message.includes('unavailable')) {
        return res.status(503).json({ success: false, error: err.message });
      }
      res.status(500).json({ success: false, error: err.message || 'Failed to retrieve project overview.' });
    }
  });

  // GET /api/azure-data/builds/health
  router.get('/builds/health', async (req: Request, res: Response) => {
    try {
      const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : undefined;
      let limit = 20;
      if (req.query.limit !== undefined) {
        limit = parseInt(req.query.limit as string, 10);
        if (isNaN(limit) || limit < 0) {
          return res.status(400).json({ success: false, error: 'Invalid limit parameter' });
        }
      }

      const buildHealth = await buildHealthUseCase.execute({ projectId, limit });
      res.json({ success: true, buildHealth });
    } catch (err: any) {
      if (err.message === 'Invalid limit parameter') {
        return res.status(400).json({ success: false, error: err.message });
      }
      res.status(500).json({ success: false, error: err.message || 'Failed to retrieve build health.' });
    }
  });

  // GET /api/azure-data/pipelines/runs
  router.get('/pipelines/runs', async (req: Request, res: Response) => {
    try {
      const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : undefined;
      let limit = 25;
      if (req.query.limit !== undefined) {
        limit = parseInt(req.query.limit as string, 10);
        if (isNaN(limit) || limit < 0) {
          return res.status(400).json({ success: false, error: 'Invalid limit parameter' });
        }
      }

      const pipelineRuns = await pipelineRunsUseCase.execute({ projectId, limit });
      res.json({ success: true, pipelineRuns });
    } catch (err: any) {
      if (err.message === 'Invalid limit parameter') {
        return res.status(400).json({ success: false, error: err.message });
      }
      res.status(500).json({ success: false, error: err.message || 'Failed to retrieve pipeline runs.' });
    }
  });

  // GET /api/azure-data/releases
  router.get('/releases', async (req: Request, res: Response) => {
    try {
      const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : undefined;
      let limit = 25;
      if (req.query.limit !== undefined) {
        limit = parseInt(req.query.limit as string, 10);
        if (isNaN(limit) || limit < 0) {
          return res.status(400).json({ success: false, error: 'Invalid limit parameter' });
        }
      }

      const releases = await releasesUseCase.execute({ projectId, limit });
      res.json({ success: true, releases });
    } catch (err: any) {
      if (err.message === 'Invalid limit parameter') {
        return res.status(400).json({ success: false, error: err.message });
      }
      res.status(500).json({ success: false, error: err.message || 'Failed to retrieve releases.' });
    }
  });

  // GET /api/azure-data/tests/health
  router.get('/tests/health', async (_req: Request, res: Response) => {
    try {
      const testHealth = await testHealthUseCase.execute();
      res.json({ success: true, testHealth });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message || 'Failed to retrieve test health.' });
    }
  });

  // GET /api/azure-data/teams
  router.get('/teams', async (req: Request, res: Response) => {
    try {
      const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : undefined;
      const search = typeof req.query.search === 'string' ? req.query.search : undefined;
      let limit = 50;
      if (req.query.limit !== undefined) {
        limit = parseInt(req.query.limit as string, 10);
        if (isNaN(limit) || limit < 0) {
          return res.status(400).json({ success: false, error: 'Invalid limit parameter' });
        }
      }

      // Execute page query and count query concurrently
      const [teams, totalCount] = await Promise.all([
        teamsUseCase.execute({ projectId, search, limit }),
        teamsUseCase.count({ projectId, search }),
      ]);
      res.json({ success: true, teams, totalCount });
    } catch (err: any) {
      if (err.message === 'Invalid limit parameter') {
        return res.status(400).json({ success: false, error: err.message });
      }
      res.status(500).json({ success: false, error: err.message || 'Failed to retrieve teams.' });
    }
  });

  return router;
}
