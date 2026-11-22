import {
  INotificationDispatcher,
  PlanningDigestEvent,
  AutoClosureSummaryEvent,
  DispatchResult,
} from '../../domain/ports/notification-dispatcher.js';

export class CompositeNotificationDispatcher implements INotificationDispatcher {
  constructor(private readonly dispatchers: INotificationDispatcher[]) {}

  async sendPlanningDigest(event: PlanningDigestEvent): Promise<DispatchResult> {
    const results = await Promise.all(this.dispatchers.map((d) => d.sendPlanningDigest(event)));
    const allSuccessful = results.every((r) => r.success);
    const errors = results.filter((r) => !r.success).map((r) => r.error).filter(Boolean);

    return {
      success: allSuccessful,
      platform: 'composite',
      error: errors.length > 0 ? errors.join('; ') : undefined,
    };
  }

  async sendAutoClosureSummary(event: AutoClosureSummaryEvent): Promise<DispatchResult> {
    const results = await Promise.all(this.dispatchers.map((d) => d.sendAutoClosureSummary(event)));
    const allSuccessful = results.every((r) => r.success);
    const errors = results.filter((r) => !r.success).map((r) => r.error).filter(Boolean);

    return {
      success: allSuccessful,
      platform: 'composite',
      error: errors.length > 0 ? errors.join('; ') : undefined,
    };
  }
}
