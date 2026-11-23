/**
 * Get Pipeline Runs Use Case
 * 
 * Retrieves recent CI/CD pipeline runs with state and result statuses.
 */

import {
  IAzureDataRepository,
  PipelineRunRecord,
} from '../../../domain/ports/azure-data-repository.js';

export interface GetPipelineRunsInput {
  projectId?: string;
  limit?: number;
}

export class GetPipelineRunsUseCase {
  constructor(private readonly repo: IAzureDataRepository) {}

  async execute(input?: GetPipelineRunsInput): Promise<PipelineRunRecord[]> {
    if (!this.repo.isAvailable()) {
      throw new Error('Azure data database is currently unavailable.');
    }

    if (input?.limit !== undefined && (isNaN(input.limit) || input.limit < 0)) {
      throw new Error('Invalid limit parameter');
    }

    return this.repo.getRecentPipelineRuns(input?.projectId, input?.limit);
  }
}
