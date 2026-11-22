/**
 * Notification Dispatcher Port
 * Domain contracts for chat platform notification dispatchers
 */

export interface PlanningDigestEvent {
  title?: string;
  sprint: string;
  date: string;
  plannedCount: number;
  leaveCount: number;
  operatorEmail?: string;
  detailsUrl?: string;
}

export interface AutoClosureSummaryEvent {
  title?: string;
  date: string;
  closedCount: number;
  needsReviewCount: number;
  operatorEmail?: string;
  detailsUrl?: string;
}

export interface DispatchResult {
  success: boolean;
  platform: 'teams' | 'slack' | 'composite';
  statusCode?: number;
  error?: string;
  retries?: number;
}

export interface INotificationDispatcher {
  sendPlanningDigest(event: PlanningDigestEvent): Promise<DispatchResult>;
  sendAutoClosureSummary(event: AutoClosureSummaryEvent): Promise<DispatchResult>;
}
