/**
 * Modern WorkOps Web Presentation Layer Types
 */

export type WorkspaceId = 'daily' | 'planning' | 'governance';

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
  | 'settings';

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
  role: string;
  capacityHours: number;
  githubUsername?: string;
  azureIdentityId?: string;
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
