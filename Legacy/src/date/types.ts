export interface ParsedDateInfo {
  day: number;
  month: number; // 1-12
  monthName: string; // e.g. "Oct"
  year: number;
  isoDate: string; // "YYYY-MM-DD"
  formattedTitleDate: string; // "D MMM", e.g. "3 Oct"
  fullTitle: string; // "3in1_PWA_MyAccount | 3 Oct"
  dateObj: Date;
}

export type TaskExecutionStatus =
  | 'PLANNED'
  | 'DUPLICATE'
  | 'DUPLICATE_ALREADY_EXISTS'
  | 'MULTIPLE_EXISTING_TASKS'
  | 'SOURCE_NOT_FOUND'
  | 'SOURCE_AMBIGUOUS'
  | 'DATE_YEAR_AMBIGUOUS'
  | 'UNKNOWN_CREATE_OUTCOME'
  | 'CREATED'
  | 'CREATED_VERIFIED'
  | 'CREATED_FIELDS_PARTIAL'
  | 'CREATED_RELATIONS_PARTIAL'
  | 'CREATED_UNVERIFIED'
  | 'WEEKEND_SKIP'
  | 'FAILED';

export interface PlannedTaskDate {
  isoDate: string; // "YYYY-MM-DD"
  formattedTitleDate: string; // "D MMM"
  fullTitle: string;
  dayOfWeek: number; // 0 = Sunday, 1 = Monday, ..., 6 = Saturday
  dayName: string;
  status: TaskExecutionStatus;
  existingWorkItemIds?: number[];
  createdWorkItemId?: number;
  relationCopyStatus?: 'SUCCESS' | 'PARTIAL' | 'FAILED' | 'NONE';
  failedRelationsCount?: number;
  totalRelationsCount?: number;
  skipReason?: string;
  errorMessage?: string;
}

export interface DateWindowPlan {
  today: string; // "YYYY-MM-DD"
  nextThursday: string; // "YYYY-MM-DD"
  effectiveStartDate: string; // "YYYY-MM-DD"
  latestExistingTaskDate?: string;
  latestExistingTaskId?: number;
  plannedDates: PlannedTaskDate[];
  warningMessage?: string;
}
