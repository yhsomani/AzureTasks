/**
 * Azure Data E2E Test Harness
 * 
 * Provides opaque-box access to azure-data.db, IAzureDataRepository port,
 * and an Express test server hosting /api/azure-data/* endpoints.
 */

import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';
import express, { Request, Response, Router } from 'express';
import Database from 'better-sqlite3';

export interface ProjectOverview {
  projectId: string;
  name: string;
  workItems: number;
  repositories: number;
  pullRequests: number;
  pipelines: number;
  builds: number;
  releases: number;
  testRuns: number;
  syncedAt: string;
}

export interface BuildHealthRecord {
  projectId: string;
  definitionId: number;
  definitionName: string;
  totalRuns: number;
  succeeded: number;
  failed: number;
  successRate: number;
  latestFinishedAt: string | null;
}

export interface TestHealthRecord {
  projectId: string;
  projectName: string;
  totalRuns: number;
  passedTests: number;
  failedTests: number;
  successRate: number;
  latestCompletedAt: string | null;
}

export interface AzureTeamSummary {
  teamId: string;
  projectId: string;
  projectName: string;
  name: string;
  description: string | null;
}

export interface IAzureDataRepository {
  isAvailable(): boolean;
  getProjectOverview(): Promise<ProjectOverview[]>;
  getBuildHealth(projectId?: string, limit?: number): Promise<BuildHealthRecord[]>;
  getTestHealth(): Promise<TestHealthRecord[]>;
  getTeams(projectId?: string, search?: string, limit?: number): Promise<AzureTeamSummary[]>;
  getTeamCount?(projectId?: string, search?: string): Promise<number>;
  getRecentReleases(projectId?: string, limit?: number): Promise<any[]>;
  getRecentPipelineRuns(projectId?: string, limit?: number): Promise<any[]>;
  getDataFreshness(): Promise<any[]>;
  getExportStatus(): Promise<any>;
}

export class SqliteAzureDataRepository implements IAzureDataRepository {
  private db: Database.Database | null = null;
  public readonly dbPath: string;

  constructor(customPath?: string) {
    this.dbPath = customPath || path.resolve(process.cwd(), 'azure-data.db');
    this.init();
  }

  private init(): void {
    if (fs.existsSync(this.dbPath)) {
      try {
        this.db = new Database(this.dbPath, { readonly: true, fileMustExist: true });
        this.db.pragma('journal_mode = WAL');
      } catch {
        this.db = null;
      }
    } else {
      this.db = null;
    }
  }

  public isAvailable(): boolean {
    if (!this.db) return false;
    try {
      this.db.prepare('SELECT 1').get();
      return true;
    } catch {
      return false;
    }
  }

  public getRawDatabase(): Database.Database {
    if (!this.db) throw new Error('Database is not available.');
    return this.db;
  }

  public async getProjectOverview(): Promise<ProjectOverview[]> {
    if (!this.db) throw new Error('Database is not available.');
    const rows = this.db.prepare(`
      SELECT 
        project_id as projectId, 
        name, 
        work_items as workItems, 
        repositories, 
        pull_requests as pullRequests, 
        pipelines, 
        builds, 
        releases, 
        test_runs as testRuns, 
        synced_at as syncedAt 
      FROM v_project_overview 
      ORDER BY name ASC
    `).all() as ProjectOverview[];
    return rows;
  }

  public async getBuildHealth(projectId?: string, limit: number = 20): Promise<BuildHealthRecord[]> {
    if (!this.db) throw new Error('Database is not available.');
    const effectiveLimit = Math.max(1, Math.min(limit, 500));
    let sql = `
      SELECT 
        bh.project_id as projectId,
        bh.definition_id as definitionId,
        COALESCE(p.name, 'Definition ' || bh.definition_id) as definitionName,
        bh.runs as totalRuns,
        bh.succeeded,
        bh.failed,
        CASE WHEN bh.runs > 0 THEN ROUND((CAST(bh.succeeded AS REAL) / bh.runs) * 100.0, 1) ELSE 0.0 END as successRate,
        bh.latest_finished_at as latestFinishedAt
      FROM v_build_health bh
      LEFT JOIN pipelines p ON p.pipeline_id = bh.definition_id AND p.project_id = bh.project_id
    `;
    const params: any[] = [];
    if (projectId && projectId.trim() !== '') {
      sql += ' WHERE bh.project_id = ?';
      params.push(projectId.trim());
    }
    sql += ' ORDER BY bh.runs DESC LIMIT ?';
    params.push(effectiveLimit);

    return this.db.prepare(sql).all(...params) as BuildHealthRecord[];
  }

  public async getTestHealth(): Promise<TestHealthRecord[]> {
    if (!this.db) throw new Error('Database is not available.');
    const rows = this.db.prepare(`
      SELECT 
        th.project_id as projectId,
        p.name as projectName,
        th.runs as totalRuns,
        th.successful as passedTests,
        (th.runs - th.successful) as failedTests,
        CASE WHEN th.runs > 0 THEN ROUND((CAST(th.successful AS REAL) / th.runs) * 100.0, 1) ELSE 0.0 END as successRate,
        th.latest_completed_at as latestCompletedAt
      FROM v_test_health th
      JOIN azure_projects p ON p.project_id = th.project_id
      ORDER BY p.name ASC
    `).all() as TestHealthRecord[];
    return rows;
  }

  public async getTeams(projectId?: string, search?: string, limit: number = 50): Promise<AzureTeamSummary[]> {
    if (!this.db) throw new Error('Database is not available.');
    const effectiveLimit = Math.max(1, Math.min(limit, 500));
    let sql = `
      SELECT 
        t.team_id as teamId,
        t.project_id as projectId,
        p.name as projectName,
        t.name,
        t.description
      FROM azure_teams t
      JOIN azure_projects p ON p.project_id = t.project_id
    `;
    const conditions: string[] = [];
    const params: any[] = [];

    if (projectId && projectId.trim() !== '') {
      conditions.push('t.project_id = ?');
      params.push(projectId.trim());
    }
    if (search && search.trim() !== '') {
      conditions.push('(t.name LIKE ? OR t.description LIKE ?)');
      params.push(`%${search.trim()}%`);
      params.push(`%${search.trim()}%`);
    }

    if (conditions.length > 0) {
      sql += ' WHERE ' + conditions.join(' AND ');
    }
    sql += ' ORDER BY t.name ASC LIMIT ?';
    params.push(effectiveLimit);

    return this.db.prepare(sql).all(...params) as AzureTeamSummary[];
  }

  public async getRecentReleases(projectId?: string, limit: number = 25): Promise<any[]> {
    if (!this.db) throw new Error('Database is not available.');
    const effectiveLimit = Math.max(1, Math.min(limit, 500));
    let sql = `
      SELECT 
        r.release_id as releaseId,
        r.definition_id as definitionId,
        r.project_id as projectId,
        p.name as projectName,
        r.name,
        r.status,
        r.reason,
        r.created_at as createdAt,
        r.modified_at as modifiedAt
      FROM releases r
      JOIN azure_projects p ON p.project_id = r.project_id
    `;
    const params: any[] = [];
    if (projectId && projectId.trim() !== '') {
      sql += ' WHERE r.project_id = ?';
      params.push(projectId.trim());
    }
    sql += ' ORDER BY r.created_at DESC LIMIT ?';
    params.push(effectiveLimit);

    return this.db.prepare(sql).all(...params);
  }

  public async getRecentPipelineRuns(projectId?: string, limit: number = 25): Promise<any[]> {
    if (!this.db) throw new Error('Database is not available.');
    const effectiveLimit = Math.max(1, Math.min(limit, 500));
    let sql = `
      SELECT 
        pr.run_id as runId,
        pr.pipeline_id as pipelineId,
        pr.project_id as projectId,
        COALESCE(p.name, 'Pipeline ' || pr.pipeline_id) as pipelineName,
        pr.name as runName,
        pr.state,
        pr.result,
        pr.created_at as createdAt,
        pr.finished_at as finishedAt
      FROM pipeline_runs pr
      LEFT JOIN pipelines p ON p.pipeline_id = pr.pipeline_id AND p.project_id = pr.project_id
    `;
    const params: any[] = [];
    if (projectId && projectId.trim() !== '') {
      sql += ' WHERE pr.project_id = ?';
      params.push(projectId.trim());
    }
    sql += ' ORDER BY pr.created_at DESC LIMIT ?';
    params.push(effectiveLimit);

    return this.db.prepare(sql).all(...params);
  }

  public async getDataFreshness(): Promise<any[]> {
    if (!this.db) throw new Error('Database is not available.');
    return this.db.prepare(`
      SELECT 
        project_name as projectName,
        datasets,
        last_updated as lastUpdated
      FROM v_data_freshness
      ORDER BY datasets DESC
    `).all();
  }

  public async getExportStatus(): Promise<any> {
    if (!this.db) throw new Error('Database is not available.');
    const row = this.db.prepare(`
      SELECT 
        run_id as runId,
        organization,
        mode,
        requested_projects as requestedProjects,
        status,
        started_at as startedAt,
        completed_at as completedAt,
        dataset_count as datasetCount,
        error_count as errorCount
      FROM v_export_status
      ORDER BY started_at DESC
      LIMIT 1
    `).get();
    return row || null;
  }

  public close(): void {
    if (this.db) {
      try {
        this.db.close();
      } catch {}
      this.db = null;
    }
  }
}

/**
 * Creates an Express Router providing the standard /api/azure-data/* REST endpoints.
 */
export function createAzureDataRouter(repo: IAzureDataRepository): Router {
  const router = Router();

  const checkAvailability = (_req: Request, res: Response, next: Function) => {
    if (!repo.isAvailable()) {
      return res.status(503).json({
        success: false,
        error: 'Azure data database is currently unavailable.',
      });
    }
    next();
  };

  router.use(checkAvailability);

  router.get('/overview', async (_req: Request, res: Response) => {
    try {
      const [projects, freshness, exportStatus] = await Promise.all([
        repo.getProjectOverview(),
        repo.getDataFreshness(),
        repo.getExportStatus(),
      ]);
      res.json({
        success: true,
        projects,
        freshness,
        exportStatus,
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.get('/builds/health', async (req: Request, res: Response) => {
    try {
      const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : undefined;
      const limit = req.query.limit !== undefined ? parseInt(req.query.limit as string, 10) : 20;
      if (isNaN(limit) || limit < 0) {
        return res.status(400).json({ success: false, error: 'Invalid limit parameter' });
      }
      const buildHealth = await repo.getBuildHealth(projectId, limit);
      res.json({ success: true, buildHealth });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.get('/pipelines/runs', async (req: Request, res: Response) => {
    try {
      const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : undefined;
      const limit = req.query.limit !== undefined ? parseInt(req.query.limit as string, 10) : 25;
      if (isNaN(limit) || limit < 0) {
        return res.status(400).json({ success: false, error: 'Invalid limit parameter' });
      }
      const pipelineRuns = await repo.getRecentPipelineRuns(projectId, limit);
      res.json({ success: true, pipelineRuns });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.get('/releases', async (req: Request, res: Response) => {
    try {
      const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : undefined;
      const limit = req.query.limit !== undefined ? parseInt(req.query.limit as string, 10) : 25;
      if (isNaN(limit) || limit < 0) {
        return res.status(400).json({ success: false, error: 'Invalid limit parameter' });
      }
      const releases = await repo.getRecentReleases(projectId, limit);
      res.json({ success: true, releases });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.get('/tests/health', async (_req: Request, res: Response) => {
    try {
      const testHealth = await repo.getTestHealth();
      res.json({ success: true, testHealth });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.get('/teams', async (req: Request, res: Response) => {
    try {
      const projectId = typeof req.query.projectId === 'string' ? req.query.projectId : undefined;
      const search = typeof req.query.search === 'string' ? req.query.search : undefined;
      const limit = req.query.limit !== undefined ? parseInt(req.query.limit as string, 10) : 50;
      if (isNaN(limit) || limit < 0) {
        return res.status(400).json({ success: false, error: 'Invalid limit parameter' });
      }
      const [teams, totalCount] = await Promise.all([
        repo.getTeams(projectId, search, limit),
        typeof repo.getTeamCount === 'function'
          ? repo.getTeamCount(projectId, search)
          : Promise.resolve((await repo.getTeams(projectId, search, 500)).length),
      ]);
      res.json({ success: true, teams, totalCount });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  return router;
}

export interface AzureDataTestHarnessInstance {
  repo: IAzureDataRepository;
  app: express.Application;
  server: http.Server;
  port: number;
  baseUrl: string;
  get(endpoint: string): Promise<{ status: number; body: any; headers: http.IncomingHttpHeaders }>;
  close(): Promise<void>;
}

export async function createAzureDataTestHarness(customDbPath?: string): Promise<AzureDataTestHarnessInstance> {
  const repo = new SqliteAzureDataRepository(customDbPath);
  const app = express();
  app.use(express.json());
  app.use('/api/azure-data', createAzureDataRouter(repo));

  const server = http.createServer(app);
  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const addr = server.address() as any;
  const port = addr.port;
  const baseUrl = `http://127.0.0.1:${port}`;

  const get = async (endpoint: string): Promise<{ status: number; body: any; headers: http.IncomingHttpHeaders }> => {
    const url = endpoint.startsWith('http') ? endpoint : `${baseUrl}${endpoint.startsWith('/') ? '' : '/'}${endpoint}`;
    const res = await fetch(url);
    const contentType = res.headers.get('content-type') || '';
    let body: any = null;
    if (contentType.includes('application/json')) {
      body = await res.json();
    } else {
      body = await res.text();
    }
    const headers: http.IncomingHttpHeaders = {};
    res.headers.forEach((val, key) => {
      headers[key] = val;
    });
    return { status: res.status, body, headers };
  };

  const close = async (): Promise<void> => {
    repo.close();
    await new Promise<void>((resolve, reject) => {
      server.close((err) => (err ? reject(err) : resolve()));
    });
  };

  return {
    repo,
    app,
    server,
    port,
    baseUrl,
    get,
    close,
  };
}
