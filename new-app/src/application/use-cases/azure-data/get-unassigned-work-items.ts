/**
 * Get Unassigned Work Items Use Case
 * 
 * Retrieves unassigned backlog items across projects or filtered by a specific project,
 * along with the total count of unassigned items.
 */

import {
  IAzureDataRepository,
  WorkItemSummary,
} from '../../../domain/ports/azure-data-repository.js';

export interface GetUnassignedWorkItemsInput {
  projectId?: string;
  limit?: number;
}

export interface GetUnassignedWorkItemsOutput {
  count: number;
  workItems: WorkItemSummary[];
}

export class GetUnassignedWorkItemsUseCase {
  constructor(private readonly repo: IAzureDataRepository) {}

  async execute(input: GetUnassignedWorkItemsInput = {}): Promise<GetUnassignedWorkItemsOutput> {
    if (!this.repo.isAvailable()) {
      return { count: 0, workItems: [] };
    }

    const limit = input.limit !== undefined && input.limit > 0 ? input.limit : 50;

    const [workItems, count] = await Promise.all([
      typeof this.repo.getUnassignedWorkItems === 'function'
        ? this.repo.getUnassignedWorkItems(input.projectId, limit)
        : Promise.resolve([]),
      typeof this.repo.countUnassignedWorkItems === 'function'
        ? this.repo.countUnassignedWorkItems(input.projectId)
        : Promise.resolve(0),
    ]);

    return {
      count,
      workItems: workItems || [],
    };
  }
}
