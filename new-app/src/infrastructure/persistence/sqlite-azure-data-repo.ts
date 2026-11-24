/**
 * SQLite implementation of IAzureDataRepository.
 * 
 * Provides read-only access to azure-data.db utilizing WAL mode, prepared statements,
 * and indexed queries.
 */

import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { Database as BetterSqliteDatabase } from 'better-sqlite3';
import {
  IAzureDataRepository,
  ProjectOverview,
  BuildHealthRecord,
  TestHealthRecord,
  AzureTeamSummary,
  ReleaseRecord,
  PipelineRunRecord,
  SyncFreshness,
  ExportStatus,
  WorkItemSummary,
  SprintIteration,
} from '../../domain/ports/azure-data-repository.js';

export class SqliteAzureDataRepository implements IAzureDataRepository {
  private db: BetterSqliteDatabase | null = null;
  public readonly dbPath: string;

  constructor(customPathOrDb?: string | BetterSqliteDatabase) {
    if (typeof customPathOrDb === 'object' && customPathOrDb !== null) {
      this.db = customPathOrDb;
      this.dbPath = ':memory:';
    } else {
      this.dbPath = (customPathOrDb as string) || process.env.AZURE_DATA_DB || path.resolve(process.cwd(), 'azure-data.db');
      this.init();
    }
  }

  private init(): void {
    if (fs.existsSync(this.dbPath)) {
      try {
        this.db = new Database(this.dbPath, { readonly: true, fileMustExist: false });
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

  public getRawDatabase(): BetterSqliteDatabase {
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

  public async getTeamCount(projectId?: string, search?: string): Promise<number> {
    if (!this.db) throw new Error('Database is not available.');
    let sql = `
      SELECT COUNT(*) as count
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

    const row = this.db.prepare(sql).get(...params) as { count: number } | undefined;
    return row ? row.count : 0;
  }

  public async getRecentReleases(projectId?: string, limit: number = 25): Promise<ReleaseRecord[]> {
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

    return this.db.prepare(sql).all(...params) as ReleaseRecord[];
  }

  public async getRecentPipelineRuns(projectId?: string, limit: number = 25): Promise<PipelineRunRecord[]> {
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

    return this.db.prepare(sql).all(...params) as PipelineRunRecord[];
  }

  public async getDataFreshness(): Promise<SyncFreshness[]> {
    if (!this.db) throw new Error('Database is not available.');
    return this.db.prepare(`
      SELECT 
        project_name as projectName,
        datasets,
        last_updated as lastUpdated
      FROM v_data_freshness
      ORDER BY datasets DESC
    `).all() as SyncFreshness[];
  }

  public async getExportStatus(): Promise<ExportStatus | null> {
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
    `).get() as ExportStatus | undefined;
    return row || null;
  }

  public async getExportErrors(): Promise<any[]> {
    if (!this.db) throw new Error('Database is not available.');
    return this.db.prepare(`
      SELECT 
        id,
        run_id as runId,
        scope,
        status as statusCode,
        category,
        message as errorMessage,
        url
      FROM export_errors
      ORDER BY id DESC
      LIMIT 50
    `).all();
  }

  public async getUnassignedWorkItems(projectId?: string, limit = 50): Promise<WorkItemSummary[]> {
    if (!this.db) throw new Error('Database is not available.');
    let createdCol = 'created_at';
    let changedCol = 'changed_at';
    try {
      const columns = (this.db.pragma('table_info(work_items)') as any[]).map(c => c.name);
      if (columns.includes('created_date')) createdCol = 'created_date';
      if (columns.includes('changed_date')) changedCol = 'changed_date';
    } catch {}

    let sql = `
      SELECT project_id as projectId, work_item_id as workItemId, type, title, state,
             assigned_identity_id as assignedIdentityId, area_path as areaPath,
             iteration_path as iterationPath, ${createdCol} as createdDate, ${changedCol} as changedDate
      FROM work_items
      WHERE (assigned_identity_id IS NULL OR trim(assigned_identity_id) = '')
    `;
    const params: any[] = [];
    if (projectId && projectId.trim() !== '') {
      sql += ' AND project_id = ?';
      params.push(projectId.trim());
    }
    sql += ` ORDER BY ${changedCol} DESC LIMIT ?`;
    params.push(Math.max(1, Math.min(limit, 500)));
    return this.db.prepare(sql).all(...params) as WorkItemSummary[];
  }

  public async countUnassignedWorkItems(projectId?: string): Promise<number> {
    if (!this.db) throw new Error('Database is not available.');
    let sql = `SELECT count(*) as count FROM work_items WHERE (assigned_identity_id IS NULL OR trim(assigned_identity_id) = '')`;
    const params: any[] = [];
    if (projectId && projectId.trim() !== '') {
      sql += ' AND project_id = ?';
      params.push(projectId.trim());
    }
    const row: any = this.db.prepare(sql).get(...params);
    return row?.count || 0;
  }

  public async getActiveSprintIterations(projectId?: string): Promise<SprintIteration[]> {
    if (!this.db) throw new Error('Database is not available.');
    let sql = `
      SELECT DISTINCT iteration_path as path
      FROM work_items
      WHERE iteration_path LIKE '%Sprint%'
    `;
    const params: any[] = [];
    if (projectId && projectId.trim() !== '') {
      sql += ' AND project_id = ?';
      params.push(projectId.trim());
    }
    sql += ' ORDER BY iteration_path ASC';
    const rows = this.db.prepare(sql).all(...params) as Array<{ path: string }>;
    return rows.map(r => {
      const parts = r.path.split('\\');
      const name = parts[parts.length - 1] || r.path;
      return {
        name,
        path: r.path,
        timeframe: 'current',
      };
    });
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
