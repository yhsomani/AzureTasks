/**
 * WIQL (Work Item Query Language) service for querying Azure DevOps work items.
 */

import { AzureDevOpsClient } from './client.js';
import { WiqlQueryResult } from './types.js';

export function escapeWiqlString(val: string): string {
  // WIQL string literals escape single quotes by doubling them
  return val.replace(/'/g, "''");
}

export class WiqlService {
  constructor(private readonly client: AzureDevOpsClient) {}

  /**
   * Executes a raw WIQL query within a project
   */
  public async query(project: string, wiql: string): Promise<number[]> {
    const response = await this.client.post<WiqlQueryResult>(
      `${encodeURIComponent(project)}/_apis/wit/wiql`,
      { query: wiql }
    );

    if (!response || !response.workItems) {
      return [];
    }

    return response.workItems.map((item) => item.id);
  }

  /**
   * Discovers candidate 3in1 tasks matching title prefix
   */
  public async findCandidateSourceTasks(
    project: string,
    workItemType: string,
    titlePrefix: string
  ): Promise<number[]> {
    const escapedProject = escapeWiqlString(project);
    const escapedType = escapeWiqlString(workItemType);
    const escapedPrefix = escapeWiqlString(titlePrefix);

    const query = `
      SELECT [System.Id], [System.Title], [System.CreatedDate]
      FROM WorkItems
      WHERE [System.TeamProject] = '${escapedProject}'
        AND [System.WorkItemType] = '${escapedType}'
        AND [System.Title] CONTAINS '${escapedPrefix}'
      ORDER BY [System.CreatedDate] DESC
    `;

    return this.query(project, query);
  }
}
