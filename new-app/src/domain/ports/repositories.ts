/**
 * Repository Ports (Interfaces)
 * Define contracts for data access - implementations live in infrastructure layer
 */

import { WorkItem, DiscoveredTask, CreatedTask } from '../entities/task.js';
import { Person, PersonConfig } from '../entities/person.js';
import {
  FilterType,
  RuleType,
  UserFilter,
  TeamFilter,
  RoleFilter,
  AutoClosureRule,
  AutoClosureConfig,
  AutoClosureAuditLog,
  AutoClosureValidationResult,
} from '../entities/auto-closure-config.js';

export type {
  PersonConfig,
  Person,
  FilterType,
  RuleType,
  UserFilter,
  TeamFilter,
  RoleFilter,
  AutoClosureRule,
  AutoClosureConfig,
  AutoClosureAuditLog,
  AutoClosureValidationResult,
};

/**
 * Azure DevOps Work Item Repository
 * Abstracts all Azure DevOps API interactions
 */
export interface WorkItemRepository {
  /**
   * Validate that a project exists and is accessible
   */
  validateProject(project: string): Promise<void>;

  /**
   * Validate that a work item type exists in the project
   */
  validateWorkItemType(project: string, workItemType: string): Promise<void>;

  /**
   * Find the latest 3in1 task for a person by querying WIQL
   * Returns the most recent task matching the title prefix
   */
  findLatestTaskForPerson(
    project: string,
    workItemType: string,
    titlePrefix: string,
    personIdentity: string,
    sourceTaskIdOverride?: number
  ): Promise<DiscoveredTask | null>;

  /**
   * Discover latest tasks for multiple people in a single query
   */
  discoverLatestTasksForPeople(
    project: string,
    workItemType: string,
    titlePrefix: string,
    people: Person[],
    sourceTaskIdOverride?: number,
    defaultSourceTaskId?: number
  ): Promise<Map<string, DiscoveredTask>>;

  /**
   * Get existing tasks for a person within a date range (for duplicate detection)
   */
  getExistingTasksForPerson(
    project: string,
    workItemType: string,
    titlePrefix: string,
    personIdentity: string,
    startDate: string,
    endDate: string
  ): Promise<Map<string, { id: number; title: string; isoDate: string; count?: number }>>;

  /**
   * Find candidate work items for explorer / burndown by date range or title prefix
   */
  findCandidateTasks(
    project: string,
    workItemType: string,
    titlePrefix: string,
    startDate?: string,
    endDate?: string,
    personIdentities?: string[]
  ): Promise<WorkItem[]>;

  /**
   * Get a work item by ID
   */
  getWorkItem(id: number): Promise<WorkItem>;

  /**
   * Create work item with reconciliation (handles duplicate detection)
   */
  createWorkItemWithReconciliation(
    project: string,
    workItemType: string,
    fieldOps: any[],
    reconciliationData: { title: string; assignedTo: string }
  ): Promise<CreatedTask>;

  /**
   * Copy relations from source to target work item
   */
  copyRelations(
    sourceWorkItem: WorkItem,
    targetId: number,
    copyableTypes: string[]
  ): Promise<{ copiedCount: number; failedCount: number; totalRelations: number }>;

  /**
   * Update fields of an existing work item via JSON Patch
   */
  patchWorkItem(
    id: number,
    fieldOps: any[],
    options?: { bypassRules?: boolean }
  ): Promise<WorkItem>;
}

/**
 * Configuration Repository
 * Abstracts configuration loading/saving
 */
export interface ConfigRepository {
  load(): Promise<AppConfig>;
  save(config: AppConfig): Promise<void>;
  savePeople(people: PersonConfig[]): Promise<void>;
  saveSettings(settings: Partial<AppConfig>): Promise<void>;
  savePat(pat: string): Promise<void>;
}

export interface AppConfig {
  organization: string;
  project: string;
  baseUrl: string;
  workItemType: string;
  taskSeries: string;
  titlePrefix: string;
  startTime: string;
  timezone: string;
  skipWeekends: boolean;
  stopDay: string;
  stopDayOfWeek: number;
  thursdayMode: 'CURRENT' | 'FOLLOWING';
  defaultState: string;
  autoClose: boolean;
  autoCloseStartTime?: string;
  autoCloseEndTime?: string;
  lastAutoClose?: string;
  autoActive?: boolean;
  autoActiveTime?: string;
  lastAutoActive?: string;
  copyEstimates: boolean;
  resetActualWork: boolean;
  maxRetries: number;
  initialRetryDelayMs: number;
  defaultSourceTaskId?: number;
  schedulerEnabled?: boolean;
  schedulerAutoStart?: boolean;
  scheduleTime?: string;
  githubToken?: string;
  githubOrg?: string;
  githubUserSuffix?: string;
  githubApiUrl?: string;
  people: PersonConfig[];
}

/**
 * Execution Journal Repository
 * Persists audit trail of task creation operations
 */
export interface JournalRepository {
  record(entry: JournalEntry): Promise<void>;
  getEntries(limit?: number): Promise<JournalEntry[]>;
  getUnfinishedRelations(): Promise<JournalEntry[]>;
  /**
   * Amend a previously recorded entry after a repair attempt.
   * Returns true when the entry was found and updated.
   */
  markRepaired(
    entry: JournalEntry,
    status: JournalEntry['relationCopyStatus'],
    note: string,
    verified?: boolean
  ): Promise<boolean>;
  exportCsv(): Promise<string>;
  exportJson(): Promise<string>;
}

export interface JournalEntry {
  runId: string;
  timestamp: string;
  personKey: string;
  personName: string;
  assignedTo: string;
  targetIsoDate: string;
  title: string;
  sourceTaskId: number;
  createdWorkItemId?: number;
  fieldCopyStatus: 'SUCCESS' | 'FAILED';
  relationCopyStatus: 'SUCCESS' | 'PARTIAL' | 'FAILED';
  verified: boolean;
  error?: string;
}

/**
 * Scheduler Repository
 * Manages background scheduler state
 */
export interface SchedulerRepository {
  getStatus(): SchedulerStatus;
  start(persist?: boolean): void | Promise<void>;
  stop(persist?: boolean): void | Promise<void>;
  setSchedule(cron: string, timezone: string): void;
  configure?(options: {
    startTime?: string;
    timezone?: string;
    autoStart?: boolean;
    autoClose?: boolean;
    autoCloseStartTime?: string;
    autoCloseEndTime?: string;
    autoActive?: boolean;
    autoActiveTime?: string;
  }): Promise<void>;
  triggerRunNow?(): Promise<{ success: boolean; message: string }>;
  setAutoCloseFunction?(fn: () => Promise<any>): void;
  triggerAutoCloseNow?(): Promise<{ success: boolean; message: string }>;
  setAutoActiveFunction?(fn: () => Promise<any>): void;
  triggerAutoActiveNow?(): Promise<{ success: boolean; message: string }>;
}

export interface SchedulerStatus {
  running: boolean;
  nextRun?: string;
  timezone: string;
  startTime?: string;
  autoStart?: boolean;
  lastRun?: string;
  lastRunResult?: 'success' | 'failure' | 'partial';
  autoCloseEnabled?: boolean;
  autoCloseStartTime?: string;
  autoCloseEndTime?: string;
  nextAutoClose?: string;
  lastAutoClose?: string;
  lastAutoCloseResult?: 'success' | 'failure' | 'partial' | 'empty';
  autoActiveEnabled?: boolean;
  autoActiveTime?: string;
  nextAutoActive?: string;
  lastAutoActive?: string;
  lastAutoActiveResult?: 'success' | 'failure' | 'partial' | 'empty';
}

/**
 * Lock Repository
 * Prevents concurrent execution
 */
export interface LockRepository {
  acquire(): boolean;
  release(): void;
  isLocked(): boolean;
  getLockInfo(): LockInfo | null;
}

export interface LockInfo {
  pid: number;
  acquiredAt: string;
  stale: boolean;
}
/**
 * Auto-Closure Configuration Repository
 * Manages auto-closure rules and configuration
 */
export interface AutoClosureConfigRepository {
  load(): Promise<AutoClosureConfig>;
  save(config: AutoClosureConfig): Promise<void>;
  validate(config: AutoClosureConfig): Promise<AutoClosureValidationResult>;
  getVersion(): Promise<number>;
}

/**
 * Auto-Closure Audit Log Repository
 * Records all auto-closure decisions
 */
export interface AutoClosureAuditLogRepository {
  record(entry: AutoClosureAuditLog): Promise<void>;
  getEntries(limit?: number, filters?: AutoClosureAuditFilter): Promise<AutoClosureAuditLog[]>;
  getEntriesByTask(taskId: number): Promise<AutoClosureAuditLog[]>;
  getEntriesByUser(userId: string, limit?: number): Promise<AutoClosureAuditLog[]>;
  exportCsv(): Promise<string>;
  exportJson(): Promise<string>;
  cleanup(beforeDate: string): Promise<number>;  // Remove old entries, returns count deleted
}

export interface AutoClosureAuditFilter {
  taskId?: number;
  userId?: string;
  status?: 'success' | 'failed' | 'rejected';
  triggerSource?: 'scheduled' | 'manual' | 'api';
  startDate?: string;
  endDate?: string;
}

