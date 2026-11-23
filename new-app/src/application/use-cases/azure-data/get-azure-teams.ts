/**
 * Get Azure Teams Use Case
 * 
 * Retrieves enterprise teams and PODs with optional project and search filters.
 */

import {
  IAzureDataRepository,
  AzureTeamSummary,
} from '../../../domain/ports/azure-data-repository.js';

export interface GetAzureTeamsInput {
  projectId?: string;
  search?: string;
  limit?: number;
}

export class GetAzureTeamsUseCase {
  constructor(private readonly repo: IAzureDataRepository) {}

  async execute(input?: GetAzureTeamsInput): Promise<AzureTeamSummary[]> {
    if (!this.repo.isAvailable()) {
      throw new Error('Azure data database is currently unavailable.');
    }

    if (input?.limit !== undefined && (isNaN(input.limit) || input.limit < 0)) {
      throw new Error('Invalid limit parameter');
    }

    return this.repo.getTeams(input?.projectId, input?.search, input?.limit);
  }

  async count(input?: { projectId?: string; search?: string }): Promise<number> {
    if (!this.repo.isAvailable()) {
      throw new Error('Azure data database is currently unavailable.');
    }

    if (typeof this.repo.getTeamCount === 'function') {
      return this.repo.getTeamCount(input?.projectId, input?.search);
    }

    const all = await this.repo.getTeams(input?.projectId, input?.search, 500);
    return all.length;
  }
}
