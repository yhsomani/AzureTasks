/**
 * Get Azure Overview Use Case
 * 
 * Aggregates high-level project summaries, data freshness timestamps,
 * and latest export execution status.
 */

import {
  IAzureDataRepository,
  ProjectOverview,
  SyncFreshness,
  ExportStatus,
} from '../../../domain/ports/azure-data-repository.js';

export interface GetAzureOverviewOutput {
  projects: ProjectOverview[];
  freshness: SyncFreshness[];
  exportStatus: ExportStatus | null;
}

export class GetAzureOverviewUseCase {
  constructor(private readonly repo: IAzureDataRepository) {}

  async execute(): Promise<GetAzureOverviewOutput> {
    if (!this.repo.isAvailable()) {
      throw new Error('Azure data database is currently unavailable.');
    }

    const [projects, freshness, exportStatus] = await Promise.all([
      this.repo.getProjectOverview(),
      this.repo.getDataFreshness(),
      this.repo.getExportStatus(),
    ]);

    return {
      projects,
      freshness,
      exportStatus,
    };
  }
}
