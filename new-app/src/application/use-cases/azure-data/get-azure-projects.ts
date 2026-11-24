/**
 * Get Azure Projects Use Case
 * 
 * Retrieves active projects (such as 3in1_Agile_Projects and 3_in_1_AppFrontEnd_Tasks)
 * from the repository or project overview.
 */

import {
  IAzureDataRepository,
  ProjectOverview,
} from '../../../domain/ports/azure-data-repository.js';

export interface AzureProjectInfo {
  id: string;
  projectId: string;
  name: string;
  workItems?: number;
  repositories?: number;
  pipelines?: number;
  builds?: number;
  releases?: number;
  testRuns?: number;
  syncedAt?: string;
}

export class GetAzureProjectsUseCase {
  constructor(private readonly repo: IAzureDataRepository) {}

  async execute(): Promise<Array<ProjectOverview | AzureProjectInfo>> {
    const defaultProjects: AzureProjectInfo[] = [
      {
        id: 'd07e3437-8c91-4438-8719-7a9a126582db',
        projectId: 'd07e3437-8c91-4438-8719-7a9a126582db',
        name: '3in1_Agile_Projects',
      },
      {
        id: 'a2fa1d4a-63a4-4f95-a4e7-01f4c7ce5fbe',
        projectId: 'a2fa1d4a-63a4-4f95-a4e7-01f4c7ce5fbe',
        name: '3_in_1_AppFrontEnd_Tasks',
      },
    ];

    if (!this.repo.isAvailable()) {
      return defaultProjects;
    }

    try {
      const overview = await this.repo.getProjectOverview();
      if (overview && overview.length > 0) {
        return overview;
      }
    } catch {
      // Fallback to default active projects
    }

    return defaultProjects;
  }
}
