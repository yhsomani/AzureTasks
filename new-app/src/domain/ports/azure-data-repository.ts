/**
 * Domain Port and Entity Definitions for Azure DevOps ALM Intelligence.
 * 
 * Provides domain-level abstractions for querying normalized Azure DevOps data
 * stored in the read-only SQLite repository.
 */

export interface ProjectOverview {
  projectId: string;
  name: string;
  workItems: number;
  repositories: number;
  pullRequests: number;
  pipelines: number;
  builds: number;
  releases: number;
  testRuns: number;
  syncedAt: string;
}

export interface BuildHealthRecord {
  projectId: string;
  definitionId: number;
  definitionName: string;
  totalRuns: number;
  succeeded: number;
  failed: number;
  successRate: number;
  latestFinishedAt: string | null;
}

export interface PipelineRunRecord {
  runId: number;
  pipelineId: number;
  projectId: string;
  pipelineName: string;
  runName: string;
  state: string;
  result: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface ReleaseRecord {
  releaseId: number;
  definitionId: number;
  projectId: string;
  projectName: string;
  name: string;
  status: string;
  reason: string | null;
  createdAt: string;
  modifiedAt: string | null;
}

export interface TestHealthRecord {
  projectId: string;
  projectName: string;
  totalRuns: number;
  passedTests: number;
  failedTests: number;
  successRate: number;
  latestCompletedAt: string | null;
}

export interface AzureTeamSummary {
  teamId: string;
  projectId: string;
  projectName: string;
  name: string;
  description: string | null;
}

export interface SyncFreshness {
  projectName: string;
  datasets: number;
  lastUpdated: string;
}

export interface ExportStatus {
  runId: string;
  organization: string;
  mode: string;
  requestedProjects: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  datasetCount: number;
  errorCount: number;
}

export interface IAzureDataRepository {
  /**
   * Checks whether the underlying database is available and accessible.
   */
  isAvailable(): boolean;

  /**
   * Retrieves high-level project summary metrics across all tracked projects.
   */
  getProjectOverview(): Promise<ProjectOverview[]>;

  /**
   * Retrieves build health and success rates aggregated by build definition.
   */
  getBuildHealth(projectId?: string, limit?: number): Promise<BuildHealthRecord[]>;

  /**
   * Retrieves test execution health and pass/fail metrics by project.
   */
  getTestHealth(): Promise<TestHealthRecord[]>;

  /**
   * Queries enterprise teams and PODs with optional project and text search filters.
   */
  getTeams(projectId?: string, search?: string, limit?: number): Promise<AzureTeamSummary[]>;

  /**
   * Retrieves total count of enterprise teams matching optional project and text search filters.
   */
  getTeamCount?(projectId?: string, search?: string): Promise<number>;

  /**
   * Retrieves recent release deployment executions.
   */
  getRecentReleases(projectId?: string, limit?: number): Promise<ReleaseRecord[]>;

  /**
   * Retrieves recent CI/CD pipeline runs with state and result classifications.
   */
  getRecentPipelineRuns(projectId?: string, limit?: number): Promise<PipelineRunRecord[]>;

  /**
   * Retrieves synchronization dataset count and last updated timestamp per scope.
   */
  getDataFreshness(): Promise<SyncFreshness[]>;

  /**
   * Retrieves the latest export execution status and metadata.
   */
  getExportStatus(): Promise<ExportStatus | null>;

  /**
   * Retrieves classified export errors if any.
   */
  getExportErrors?(): Promise<any[]>;

  /**
   * Gracefully closes the underlying database connection.
   */
  close?(): void;
}
