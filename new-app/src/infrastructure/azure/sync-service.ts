/**
 * Azure DevOps Synchronization Service
 * 
 * Encapsulates reliable external synchronization for both 3in1_Agile_Projects and
 * 3_in_1_AppFrontEnd_Tasks.
 * 
 * Supports:
 * - Multi-project synchronization
 * - WIQL pagination with continuation tokens
 * - Exponential backoff and retry for rate limits (429) and transient errors (503)
 * - Atomic database staging swap for zero-downtime consistency
 * - Sync metadata auditing and status reporting
 */

import { randomUUID } from 'node:crypto';
import type { Database as BetterSqliteDatabase } from 'better-sqlite3';
import { AzureDevOpsClient } from './client.js';
import { logger } from '../logging/logger.js';

export interface SyncOptions {
  projects?: string[];
  syncRunId?: string;
  pageSize?: number;
  maxPages?: number;
  dryRun?: boolean;
}

export interface ProjectSyncSummary {
  projectId: string;
  projectName: string;
  totalWorkItems: number;
  pageCount: number;
  status: 'COMPLETED' | 'FAILED' | 'SKIPPED';
  durationMs: number;
  error?: string;
}

export interface SyncResult {
  syncRunId: string;
  startedAt: string;
  completedAt: string;
  success: boolean;
  projects: ProjectSyncSummary[];
  totalRecords: number;
}

export interface WiqlPageResult {
  workItems: Array<{ id: number; url?: string }>;
  continuationToken?: string;
  hasMore: boolean;
}

export const TARGET_PROJECTS = [
  '3in1_Agile_Projects',
  '3_in_1_AppFrontEnd_Tasks',
] as const;

export class AzureSyncService {
  private readonly defaultProjects: string[] = [...TARGET_PROJECTS];
  private readonly maxRetries: number;
  private readonly initialRetryDelayMs: number;

  constructor(
    private readonly client?: AzureDevOpsClient,
    private readonly db?: BetterSqliteDatabase | any,
    options: { maxRetries?: number; initialRetryDelayMs?: number } = {}
  ) {
    this.maxRetries = options.maxRetries ?? 3;
    this.initialRetryDelayMs = options.initialRetryDelayMs ?? 1000;
  }

  /**
   * Calculate exponential backoff delay with random jitter.
   */
  private calculateBackoff(attempt: number): number {
    const base = this.initialRetryDelayMs * Math.pow(2, attempt);
    const jitter = Math.random() * 200;
    return Math.min(base + jitter, 30000);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Execute atomic staging swap between staging and active tables.
   * Guarantees zero read disruption and automatic rollback on failure.
   */
  public executeAtomicStagingSwap(
    stagingTable: string,
    activeTable: string,
    targetDb?: BetterSqliteDatabase | any
  ): void {
    const sqlite = targetDb || this.db;
    if (!sqlite) {
      throw new Error('Database connection required for staging swap.');
    }

    // Atomic transaction execution matching T1-F8-04 contract
    const swapTx = sqlite.transaction
      ? sqlite.transaction(() => {
          sqlite.exec(`DELETE FROM ${activeTable};`);
          sqlite.exec(`INSERT INTO ${activeTable} SELECT * FROM ${stagingTable};`);
          sqlite.exec(`DELETE FROM ${stagingTable};`);
        })
      : null;

    if (swapTx) {
      swapTx();
    } else {
      sqlite.exec('BEGIN TRANSACTION;');
      try {
        sqlite.exec(`DELETE FROM ${activeTable};`);
        sqlite.exec(`INSERT INTO ${activeTable} SELECT * FROM ${stagingTable};`);
        sqlite.exec(`DELETE FROM ${stagingTable};`);
        sqlite.exec('COMMIT;');
      } catch (err) {
        try { sqlite.exec('ROLLBACK;'); } catch {}
        throw err;
      }
    }
  }

  /**
   * Query work items using WIQL pagination with continuation token handling.
   */
  public async queryWiqlWithPagination(
    projectName: string,
    query: string = 'SELECT [System.Id] FROM WorkItems ORDER BY [System.ChangedDate] DESC',
    pageSize: number = 100,
    maxPages: number = 50
  ): Promise<{ workItemIds: number[]; pageCount: number }> {
    const allIds: number[] = [];
    let continuationToken: string | undefined = undefined;
    let page = 0;

    while (page < maxPages) {
      page++;
      let attempt = 0;
      let pageData: any = null;

      while (attempt <= this.maxRetries) {
        try {
          const path = `/${encodeURIComponent(projectName)}/_apis/wit/wiql?api-version=7.1${
            continuationToken ? `&continuationToken=${encodeURIComponent(continuationToken)}` : ''
          }`;

          if (this.client) {
            pageData = await this.client.request<any>(path, {
              method: 'POST',
              body: { query },
            });
          } else {
            // Standalone fallback using fetch if client was not injected
            const pat = process.env.AZURE_DEVOPS_PAT?.trim() || '';
            const org = process.env.AZURE_DEVOPS_ORG || 'BFLDevOpsOrg';
            const baseUrl = process.env.AZURE_DEVOPS_BASE_URL || 'https://dev.azure.com';
            const url = `${baseUrl}/${org}${path}`;

            const res = await fetch(url, {
              method: 'POST',
              headers: {
                'Authorization': `Basic ${Buffer.from(`:${pat}`).toString('base64')}`,
                'Content-Type': 'application/json',
                'Accept': 'application/json',
              },
              body: JSON.stringify({ query }),
            });

            if (res.status === 429 || (res.status >= 500 && res.status < 600)) {
              const retryAfter = res.headers.get('Retry-After');
              const delay = retryAfter ? parseInt(retryAfter, 10) * 1000 : this.calculateBackoff(attempt);
              await this.sleep(delay);
              attempt++;
              continue;
            }

            if (!res.ok) {
              throw new Error(`WIQL query failed with HTTP ${res.status}: ${res.statusText}`);
            }

            pageData = await res.json();
            const tokenHeader = res.headers.get('x-ms-continuationtoken');
            if (tokenHeader) {
              pageData.continuationToken = tokenHeader;
            }
          }
          break; // Succeeded
        } catch (err: any) {
          attempt++;
          if (attempt > this.maxRetries) {
            throw new Error(`WIQL query pagination failed after ${this.maxRetries} retries: ${err.message}`);
          }
          await this.sleep(this.calculateBackoff(attempt));
        }
      }

      if (!pageData?.workItems || !Array.isArray(pageData.workItems)) {
        break;
      }

      for (const item of pageData.workItems) {
        if (typeof item.id === 'number') {
          allIds.push(item.id);
        }
      }

      continuationToken = pageData.continuationToken;
      if (!continuationToken || pageData.workItems.length === 0) {
        break;
      }
    }

    return { workItemIds: allIds, pageCount: page };
  }

  /**
   * Synchronize target projects with retry backoff and metadata persistence.
   */
  public async syncProjects(options: SyncOptions = {}): Promise<SyncResult> {
    const startedAt = new Date().toISOString();
    const syncRunId = options.syncRunId || `sync_${Date.now()}_${randomUUID().slice(0, 8)}`;
    const projectsToSync = options.projects && options.projects.length > 0
      ? options.projects
      : this.defaultProjects;

    const projectSummaries: ProjectSyncSummary[] = [];
    let totalRecords = 0;
    let allSucceeded = true;

    for (const projName of projectsToSync) {
      const projStart = Date.now();
      try {
        logger.info(`AzureSyncService: Starting synchronization for project '${projName}' (runId: ${syncRunId})...`);

        const { workItemIds, pageCount } = await this.queryWiqlWithPagination(
          projName,
          'SELECT [System.Id] FROM WorkItems ORDER BY [System.ChangedDate] DESC',
          options.pageSize ?? 100,
          options.maxPages ?? 50
        );

        totalRecords += workItemIds.length;
        const durationMs = Date.now() - projStart;

        // Record sync metadata if database is attached
        if (this.db) {
          try {
            this.recordSyncMetadata(
              projName,
              'work_items',
              syncRunId,
              workItemIds.length,
              'COMPLETED'
            );
          } catch (dbErr: any) {
            logger.warn(`AzureSyncService: Failed to record sync metadata for '${projName}': ${dbErr.message}`);
          }
        }

        projectSummaries.push({
          projectId: projName,
          projectName: projName,
          totalWorkItems: workItemIds.length,
          pageCount,
          status: 'COMPLETED',
          durationMs,
        });

        logger.info(`AzureSyncService: Synchronized ${workItemIds.length} items across ${pageCount} page(s) for '${projName}' in ${durationMs}ms.`);
      } catch (err: any) {
        allSucceeded = false;
        const durationMs = Date.now() - projStart;
        const errorMsg = err instanceof Error ? err.message : String(err);

        if (this.db) {
          try {
            this.recordSyncMetadata(
              projName,
              'work_items',
              syncRunId,
              0,
              'FAILED'
            );
          } catch {}
        }

        projectSummaries.push({
          projectId: projName,
          projectName: projName,
          totalWorkItems: 0,
          pageCount: 0,
          status: 'FAILED',
          durationMs,
          error: errorMsg,
        });

        logger.error(`AzureSyncService: Synchronization failed for project '${projName}': ${errorMsg}`);
      }
    }

    const completedAt = new Date().toISOString();
    return {
      syncRunId,
      startedAt,
      completedAt,
      success: allSucceeded,
      projects: projectSummaries,
      totalRecords,
    };
  }

  /**
   * Persist sync execution records into the sync_metadata table.
   */
  public recordSyncMetadata(
    projectId: string,
    resourceType: string,
    syncRunId: string,
    recordCount: number,
    status: 'COMPLETED' | 'FAILED' | 'IN_PROGRESS'
  ): void {
    if (!this.db) return;
    const id = `sm_${Date.now()}_${randomUUID().slice(0, 6)}`;
    const sqlite = this.db.sqlite || this.db;
    try {
      sqlite
        .prepare(
          `INSERT OR REPLACE INTO sync_metadata (id, project_id, resource_type, last_sync_run_id, record_count, sync_status)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(id, projectId, resourceType, syncRunId, recordCount, status);
    } catch (err: any) {
      logger.warn(`Failed to insert into sync_metadata: ${err.message}`);
    }
  }
}
