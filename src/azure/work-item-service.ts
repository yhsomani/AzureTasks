/**
 * Azure DevOps Work Item REST API service.
 * Supports batch retrieval, validation, Phase 1 work item creation, and Phase 2 relationship updates.
 */

import { logger } from '../utils/logger.js';
import { AzureDevOpsClient } from './client.js';
import {
  AzureProject,
  JsonPatchOperation,
  WorkItem,
  WorkItemBatchResponse,
  WorkItemTypeDefinition,
} from './types.js';

export class WorkItemService {
  constructor(private readonly client: AzureDevOpsClient) {}

  /**
   * Validates that the specified project exists and is accessible
   */
  public async validateProject(projectName: string): Promise<AzureProject> {
    try {
      return await this.client.get<AzureProject>(
        `_apis/projects/${encodeURIComponent(projectName)}`
      );
    } catch (err) {
      throw new Error(
        `Failed to access Azure DevOps project '${projectName}'. Please verify the project name and permissions. Details: ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }

  /**
   * Validates that the work item type exists in the project
   */
  public async validateWorkItemType(
    projectName: string,
    workItemType: string
  ): Promise<WorkItemTypeDefinition> {
    try {
      const response = await this.client.get<{ value: WorkItemTypeDefinition[] }>(
        `${encodeURIComponent(projectName)}/_apis/wit/workitemtypes`
      );
      const found = response.value?.find(
        (t) => t.name.toLowerCase() === workItemType.toLowerCase()
      );
      if (!found) {
        throw new Error(
          `Work Item Type '${workItemType}' not found in project '${projectName}'. Available types: ${
            response.value?.map((t) => t.name).join(', ')
          }`
        );
      }
      return found;
    } catch (err) {
      throw new Error(
        `Failed to validate Work Item Type '${workItemType}' in project '${projectName}': ${
          err instanceof Error ? err.message : String(err)
        }`
      );
    }
  }

  /**
   * Retrieves a single work item with fields and relationships
   */
  public async getWorkItem(id: number, expand: 'all' | 'relations' = 'all'): Promise<WorkItem> {
    return this.client.get<WorkItem>(`_apis/wit/workitems/${id}`, {
      $expand: expand,
    });
  }

  /**
   * Retrieves multiple work items in batches of up to 200
   */
  public async getWorkItemsBatch(
    ids: number[],
    expand: 'all' | 'relations' = 'all'
  ): Promise<WorkItem[]> {
    if (ids.length === 0) {
      return [];
    }

    const CHUNK_SIZE = 200;
    const results: WorkItem[] = [];

    for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
      const chunk = ids.slice(i, i + CHUNK_SIZE);
      const response = await this.client.post<WorkItemBatchResponse>(
        '_apis/wit/workitemsbatch',
        {
          ids: chunk,
          $expand: expand,
          errorPolicy: 'omit',
        }
      );

      if (response && response.value) {
        results.push(...response.value);
      }
    }

    return results;
  }

  /**
   * Phase 1: Creates a new work item with fields
   */
  public async createWorkItem(
    projectName: string,
    workItemType: string,
    patchOperations: JsonPatchOperation[]
  ): Promise<WorkItem> {
    const encodedType = encodeURIComponent(`$${workItemType}`);
    const path = `${encodeURIComponent(projectName)}/_apis/wit/workitems/${encodedType}`;

    return this.client.post<WorkItem>(
      path,
      patchOperations,
      undefined,
      'application/json-patch+json'
    );
  }

  /**
   * Phase 1: Creates a new work item with fields, wrapped in network reconciliation.
   * If a network failure occurs, queries Azure DevOps to verify if the work item was
   * actually created before blindly retrying, preventing accidental duplicates.
   */
  public async createWorkItemWithReconciliation(
    projectName: string,
    workItemType: string,
    patchOperations: JsonPatchOperation[],
    expectedIdentity: { title: string; assignedTo: string }
  ): Promise<WorkItem> {
    try {
      return await this.createWorkItem(projectName, workItemType, patchOperations);
    } catch (err: any) {
      const isNetworkIssue =
        err.message?.includes('fetch failed') ||
        err.message?.includes('timeout') ||
        err.message?.includes('ECONNRESET') ||
        err.message?.includes('ETIMEDOUT') ||
        err.message?.includes('socket');

      if (isNetworkIssue) {
        logger.warn(
          `Uncertain network outcome during work item creation for "${expectedIdentity.title}". Reconciling with Azure DevOps before retrying...`
        );
        try {
          const escapedTitle = expectedIdentity.title.replace(/'/g, "''");
          const wiql = `SELECT [System.Id], [System.Title], [System.AssignedTo] FROM WorkItems WHERE [System.TeamProject] = '${projectName.replace(/'/g, "''")}' AND [System.WorkItemType] = '${workItemType.replace(/'/g, "''")}' AND [System.Title] = '${escapedTitle}' AND [System.CreatedDate] >= @today ORDER BY [System.Id] DESC`;
          const queryResult = await this.client.post<{ workItems: Array<{ id: number }> }>(
            `${encodeURIComponent(projectName)}/_apis/wit/wiql`,
            { query: wiql }
          );

          if (queryResult?.workItems?.length === 1) {
            const recoveredId = queryResult.workItems[0].id;
            logger.success(
              `Reconciled uncertain outcome: Work item #${recoveredId} was successfully created in Azure DevOps!`
            );
            return await this.getWorkItem(recoveredId);
          } else if (queryResult?.workItems && queryResult.workItems.length > 1) {
            throw new Error(
              `UNKNOWN_CREATE_OUTCOME: Multiple matching work items found (${queryResult.workItems.map((w) => `#${w.id}`).join(', ')}). Aborting to prevent further duplicates.`
            );
          }
        } catch (reconcileErr: any) {
          if (reconcileErr.message?.includes('UNKNOWN_CREATE_OUTCOME')) {
            throw reconcileErr;
          }
        }
      }
      throw err;
    }
  }

  /**
   * Phase 2: Updates a work item to apply relationships or additional patches
   */
  public async updateWorkItem(
    id: number,
    patchOperations: JsonPatchOperation[]
  ): Promise<WorkItem> {
    return this.client.patch<WorkItem>(
      `_apis/wit/workitems/${id}`,
      patchOperations
    );
  }
}
