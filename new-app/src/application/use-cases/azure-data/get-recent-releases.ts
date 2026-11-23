/**
 * Get Recent Releases Use Case
 * 
 * Retrieves recent deployment releases with deployment statuses.
 */

import {
  IAzureDataRepository,
  ReleaseRecord,
} from '../../../domain/ports/azure-data-repository.js';

export interface GetRecentReleasesInput {
  projectId?: string;
  limit?: number;
}

export class GetRecentReleasesUseCase {
  constructor(private readonly repo: IAzureDataRepository) {}

  async execute(input?: GetRecentReleasesInput): Promise<ReleaseRecord[]> {
    if (!this.repo.isAvailable()) {
      throw new Error('Azure data database is currently unavailable.');
    }

    if (input?.limit !== undefined && (isNaN(input.limit) || input.limit < 0)) {
      throw new Error('Invalid limit parameter');
    }

    return this.repo.getRecentReleases(input?.projectId, input?.limit);
  }
}
