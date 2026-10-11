/**
 * Repository Ports (Interfaces)
 * Define contracts for data access - implementations live in infrastructure layer
 */

import { WorkItem, DiscoveredTask, CreatedTask } from '../entities/task.js';
import { Person, PersonConfig } from '../entities/person.js';

export type { PersonConfig, Person };

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
  copyEstimates: boolean;
  resetActualWork: boolean;
  maxRetries: number;
  initialRetryDelayMs: number;
  defaultSourceTaskId?: number;
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
    note: string
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
  start(): void;
  stop(): void;
  setSchedule(cron: string, timezone: string): void;
}

export interface SchedulerStatus {
  running: boolean;
  nextRun?: string;
  timezone: string;
  lastRun?: string;
  lastRunResult?: 'success' | 'failure' | 'partial';
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