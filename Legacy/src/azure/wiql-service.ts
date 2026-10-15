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
   * Discovers candidate 3in1 tasks matching team member identities or title prefix
   */
  public async findCandidateSourceTasks(
    project: string,
    workItemType: string,
    titlePrefix: string,
    personIdentities?: string[]
  ): Promise<number[]> {
    const escapedProject = escapeWiqlString(project);
    const escapedType = escapeWiqlString(workItemType);
    const escapedPrefix = escapeWiqlString(titlePrefix);

    if (personIdentities && personIdentities.length > 0) {
      const assignedList = personIdentities.map(p => `'${escapeWiqlString(p)}'`).join(', ');
      const query = `
        SELECT [System.Id], [System.Title], [System.CreatedDate]
        FROM WorkItems
        WHERE [System.TeamProject] = '${escapedProject}'
          AND [System.WorkItemType] = '${escapedType}'
          AND [System.State] <> 'Removed'
          AND [System.AssignedTo] IN (${assignedList})
        ORDER BY [System.CreatedDate] DESC
      `;
      const ids = await this.query(project, query);
      if (ids && ids.length > 0) {
        return ids;
      }
    }

    const fallbackQuery = `
      SELECT [System.Id], [System.Title], [System.CreatedDate]
      FROM WorkItems
      WHERE [System.TeamProject] = '${escapedProject}'
        AND [System.WorkItemType] = '${escapedType}'
        AND [System.Title] CONTAINS '${escapedPrefix}'
        AND [System.State] <> 'Removed'
      ORDER BY [System.CreatedDate] DESC
    `;

    return this.query(project, fallbackQuery);
  }
}
