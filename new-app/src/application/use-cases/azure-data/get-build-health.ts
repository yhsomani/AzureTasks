/**
 * Get Build Health Use Case
 * 
 * Retrieves build definition health metrics, total runs, succeeded/failed counts,
 * and percentage success rates.
 */

import {
  IAzureDataRepository,
  BuildHealthRecord,
} from '../../../domain/ports/azure-data-repository.js';

export interface GetBuildHealthInput {
  projectId?: string;
  limit?: number;
}

export class GetBuildHealthUseCase {
  constructor(private readonly repo: IAzureDataRepository) {}

  async execute(input?: GetBuildHealthInput): Promise<BuildHealthRecord[]> {
    if (!this.repo.isAvailable()) {
      throw new Error('Azure data database is currently unavailable.');
    }

    if (input?.limit !== undefined && (isNaN(input.limit) || input.limit < 0)) {
      throw new Error('Invalid limit parameter');
    }

    return this.repo.getBuildHealth(input?.projectId, input?.limit);
  }
}
