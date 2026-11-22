import {
  INotificationDispatcher,
  PlanningDigestEvent,
  AutoClosureSummaryEvent,
  DispatchResult,
} from '../../domain/ports/notification-dispatcher.js';

export interface TeamsDispatcherOptions {
  webhookUrl?: string;
  enabled?: boolean;
  timeoutMs?: number;
  maxRetries?: number;
}

export class TeamsNotificationDispatcher implements INotificationDispatcher {
  private webhookUrl: string;
  private enabled: boolean;
  private timeoutMs: number;
  private maxRetries: number;

  constructor(options: TeamsDispatcherOptions = {}) {
    this.webhookUrl = options.webhookUrl ?? process.env.TEAMS_WEBHOOK_URL ?? '';
    this.enabled = options.enabled ?? (Boolean(this.webhookUrl) && process.env.TEAMS_NOTIFICATIONS_ENABLED !== 'false');
    this.timeoutMs = options.timeoutMs ?? 5000;
    this.maxRetries = options.maxRetries ?? 2;
  }

  private validateUrl(url: string): boolean {
    try {
      const parsed = new URL(url);
      return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch {
      return false;
    }
  }

  buildPlanningDigestPayload(event: PlanningDigestEvent): any {
    const title = event.title || 'Morning Planning Digest';
    const deepLinkUrl = event.detailsUrl || 'https://workops.company.com/daily';

    return {
      type: 'message',
      attachments: [
        {
          contentType: 'application/vnd.microsoft.card.adaptive',
          content: {
            type: 'AdaptiveCard',
            version: '1.4',
            body: [
              {
                type: 'TextBlock',
                size: 'Medium',
                weight: 'Bolder',
                text: title,
              },
              {
                type: 'FactSet',
                facts: [
                  { title: 'Sprint', value: event.sprint },
                  { title: 'Date', value: event.date },
                  { title: 'Tasks Planned', value: String(event.plannedCount) },
                  { title: 'On Leave', value: String(event.leaveCount) },
                  ...(event.operatorEmail ? [{ title: 'Operator', value: event.operatorEmail }] : []),
                ],
              },
            ],
            actions: [
              {
                type: 'Action.OpenUrl',
                title: 'Open in WorkOps',
                url: deepLinkUrl,
              },
            ],
          },
        },
      ],
    };
  }

  buildAutoClosureSummaryPayload(event: AutoClosureSummaryEvent): any {
    const title = event.title || 'EOD Auto-Closure Digest';
    const deepLinkUrl = event.detailsUrl || 'https://workops.company.com/daily';

    return {
      type: 'message',
      attachments: [
        {
          contentType: 'application/vnd.microsoft.card.adaptive',
          content: {
            type: 'AdaptiveCard',
            version: '1.4',
            body: [
              {
                type: 'TextBlock',
                size: 'Medium',
                weight: 'Bolder',
                text: title,
              },
              {
                type: 'FactSet',
                facts: [
                  { title: 'Date', value: event.date },
                  { title: 'Closed Tasks', value: String(event.closedCount) },
                  { title: 'Needs Review', value: String(event.needsReviewCount) },
                  ...(event.operatorEmail ? [{ title: 'Operator', value: event.operatorEmail }] : []),
                ],
              },
            ],
            actions: [
              {
                type: 'Action.OpenUrl',
                title: 'Open in WorkOps',
                url: deepLinkUrl,
              },
            ],
          },
        },
      ],
    };
  }

  private async dispatchWithRetry(payload: any): Promise<DispatchResult> {
    if (!this.enabled || !this.webhookUrl) {
      return { success: true, platform: 'teams', statusCode: 200 };
    }

    if (!this.validateUrl(this.webhookUrl)) {
      return {
        success: false,
        platform: 'teams',
        error: 'Malformed webhook URL configuration',
      };
    }

    let lastError: string | undefined;
    let statusCode: number | undefined;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

      try {
        const response = await fetch(this.webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);
        statusCode = response.status;

        if (response.ok) {
          return { success: true, platform: 'teams', statusCode: response.status, retries: attempt };
        }

        // Retry on 5xx server error
        if (response.status >= 500 && attempt < this.maxRetries) {
          const delay = 500 * Math.pow(2, attempt);
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }

        lastError = `HTTP ${response.status}: ${response.statusText}`;
        break; // Fail fast on 4xx client errors, do not retry
      } catch (err: any) {
        clearTimeout(timeoutId);
        if (err.name === 'AbortError') {
          lastError = 'TIMEOUT_ABORTED';
        } else {
          lastError = err.message || 'Network error';
        }

        if (attempt < this.maxRetries) {
          const delay = 500 * Math.pow(2, attempt);
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
      }
    }

    return {
      success: false,
      platform: 'teams',
      statusCode,
      error: lastError,
    };
  }

  async sendPlanningDigest(event: PlanningDigestEvent): Promise<DispatchResult> {
    const payload = this.buildPlanningDigestPayload(event);
    return this.dispatchWithRetry(payload);
  }

  async sendAutoClosureSummary(event: AutoClosureSummaryEvent): Promise<DispatchResult> {
    const payload = this.buildAutoClosureSummaryPayload(event);
    return this.dispatchWithRetry(payload);
  }
}
