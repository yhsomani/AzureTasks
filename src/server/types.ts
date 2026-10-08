import { AppConfig, PersonConfig } from '../config/config.js';
import { DateWindowPlan } from '../date/types.js';

export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
}

export interface SystemStatusData {
  organization: string;
  project: string;
  baseUrl: string;
  connected: boolean;
  patConfigured: boolean;
  patMasked: string;
  projectValid: boolean;
  workItemTypeValid: boolean;
  timezone: string;
  thursdayMode: 'CURRENT' | 'FOLLOWING';
  errorMessage?: string;
}

export interface LivePersonTaskSummary {
  person: PersonConfig;
  sourceTask: {
    id: number;
    title: string;
    dateIso?: string;
    dateFormatted?: string;
    state?: string;
  } | null;
  existingTasks: Array<{
    id: number;
    title: string;
    dateIso: string;
    state: string;
  }>;
}

export interface TaskPlanRequest {
  personKeys?: string[];
  asOf?: string;
  thursdayMode?: 'CURRENT' | 'FOLLOWING';
}

export interface TaskExecuteRequest {
  personKeys?: string[];
  asOf?: string;
  thursdayMode?: 'CURRENT' | 'FOLLOWING';
  dryRun?: boolean;
}

export interface StreamEvent {
  type: 'log' | 'progress' | 'task_created' | 'task_skipped' | 'done' | 'error';
  message: string;
  data?: any;
  timestamp: string;
}
