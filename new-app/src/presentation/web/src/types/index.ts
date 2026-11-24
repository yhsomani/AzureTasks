/**
 * Modern WorkOps Web Presentation Layer Types
 */

export type WorkspaceId = 'daily' | 'planning' | 'governance' | 'intelligence';

export type SubViewId =
  | 'mywork'
  | 'planner'
  | 'journal'
  | 'dashboard'
  | 'explorer'
  | 'burndown'
  | 'lifecycle'
  | 'people'
  | 'calendar'
  | 'scheduler'
  | 'logs'
  | 'settings'
  | 'azure-overview'
  | 'azure-builds'
  | 'azure-teams'
  | 'unassigned'
  | 'sprint-progress';

export interface UserSession {
  authenticated: boolean;
  user: string;
  role: 'admin' | 'lead' | 'developer' | 'auditor';
  viewerMode: boolean;
}

export interface TeamMember {
  key: string;
  name: string;
  email: string;
  assignedTo?: string;
  role: string;
  capacityHours: number;
  aliases?: string[];
  canonicalId?: string;
  githubUsername?: string;
  enabled: boolean;
  avatarUrl?: string;
}

export interface WorkCalendarConfig {
  workingDays: number[]; // 1 = Mon, 5 = Fri
  holidays: string[]; // ISO date strings
  exceptions: Array<{
    date: string;
    personKey?: string;
    isWorking: boolean;
    reason: string;
  }>;
}

export interface DailyPrDeliverable {
  id: number;
  number: number;
  title: string;
  htmlUrl: string;
  state: 'open' | 'closed' | 'merged';
  createdAt: string;
  closedAt?: string;
  mergedAt?: string;
  repository: string;
  author: string;
}

export interface PersonPrSummary {
  personKey: string;
  personName: string;
  key?: string;
  name?: string;
  prCount?: number;
  githubUsername: string;
  pullRequests: DailyPrDeliverable[];
  openCount: number;
  mergedCount: number;
  totalCount: number;
}

export interface WorkItemTask {
  id: number;
  title: string;
  state: string;
  assignedTo: string;
  activity?: string;
  remainingWork?: number;
  completedWork?: number;
  originalEstimate?: number;
  targetDate?: string;
  url?: string;
  parentWorkItemId?: number;
  prDeliverables?: DailyPrDeliverable[];
}

export interface PersonDailyPlan {
  personKey: string;
  personName: string;
  candidateDates: string[];
  plannedTasks: Array<{
    date: string;
    title: string;
    estimatedHours: number;
    activity: string;
  }>;
  skippedDates: Array<{
    date: string;
    reason: string;
  }>;
}

export interface PlanTasksResult {
  planToken: string;
  expiresAt: number;
  planHash: string;
  summary: {
    totalPlanned: number;
    personCount: number;
  };
  plannedDates?: string[];
  personPlans?: PersonDailyPlan[];
  items?: WorkItemTask[];
}

export interface JournalEntry {
  id: string;
  timestamp: string;
  action: string;
  operator: string;
  details: Record<string, unknown>;
  status: 'SUCCESS' | 'FAILED' | 'ROLLEDBACK';
}

export interface SchedulerJobStatus {
  name: string;
  enabled: boolean;
  cron: string;
  lastRun?: string;
  nextRun?: string;
  status: 'idle' | 'running' | 'failed';
}

export interface SystemHealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  uptime: number;
  memoryUsageMb: number;
  dbLatencyMs?: number;
  azureDevOpsConnected: boolean;
  githubConnected: boolean;
  workerRunning: boolean;
}

export interface MatrixCellData {
  date: string;
  personKey: string;
  tasks: WorkItemTask[];
  isHoliday: boolean;
  isWeekend: boolean;
  isLeave: boolean;
  capacityHours: number;
  allocatedHours: number;
}

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

export interface AzureOverviewResponse {
  success: boolean;
  projects: ProjectOverview[];
  freshness: SyncFreshness[];
  exportStatus: ExportStatus | null;
}

export interface AzureBuildHealthResponse {
  success: boolean;
  buildHealth: BuildHealthRecord[];
}

export interface AzurePipelineRunsResponse {
  success: boolean;
  pipelineRuns: PipelineRunRecord[];
}

export interface AzureReleasesResponse {
  success: boolean;
  releases: ReleaseRecord[];
}

export interface AzureTestHealthResponse {
  success: boolean;
  testHealth: TestHealthRecord[];
}

export interface AzureTeamsResponse {
  success: boolean;
  teams: AzureTeamSummary[];
  totalCount: number;
}

export interface WorkItemSummary {
  projectId: string;
  workItemId: number;
  type: string;
  title: string;
  state: string;
  assignedIdentityId?: string | null;
  areaPath?: string;
  iterationPath?: string;
  createdDate?: string;
  changedDate?: string;
  id?: number;
}

export interface AzureUnassignedResponse {
  success: boolean;
  count: number;
  workItems: WorkItemSummary[];
}

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

export interface AzureProjectsResponse {
  success: boolean;
  projects: Array<ProjectOverview | AzureProjectInfo>;
}

export interface GitHubPersonPrSummary {
  personKey: string;
  personName: string;
  key?: string;
  name?: string;
  prCount?: number;
  status?: 'OK' | 'UNRESOLVED_IDENTITY' | 'UPSTREAM_ERROR';
  error?: string;
}


