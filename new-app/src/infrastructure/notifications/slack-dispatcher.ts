import {
  INotificationDispatcher,
  PlanningDigestEvent,
  AutoClosureSummaryEvent,
  DispatchResult,
} from '../../domain/ports/notification-dispatcher.js';

export interface SlackDispatcherOptions {
  webhookUrl?: string;
  enabled?: boolean;
  timeoutMs?: number;
  maxRetries?: number;
}

export class SlackNotificationDispatcher implements INotificationDispatcher {
  private webhookUrl: string;
  private enabled: boolean;
  private timeoutMs: number;
  private maxRetries: number;

  constructor(options: SlackDispatcherOptions = {}) {
    this.webhookUrl = options.webhookUrl ?? process.env.SLACK_WEBHOOK_URL ?? '';
    this.enabled = options.enabled ?? (Boolean(this.webhookUrl) && process.env.SLACK_NOTIFICATIONS_ENABLED !== 'false');
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

  static escapeSlackMarkdown(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  buildPlanningDigestPayload(event: PlanningDigestEvent): any {
    const rawTitle = event.title || 'Morning Planning Digest';
    const escapedTitle = SlackNotificationDispatcher.escapeSlackMarkdown(rawTitle);
    const deepLinkUrl = event.detailsUrl || 'https://workops.company.com/daily';

    return {
      blocks: [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: escapedTitle,
          },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Sprint:* ${event.sprint} | *Date:* ${event.date}\n*Tasks Planned:* ${event.plannedCount} | *On Leave:* ${event.leaveCount}${
              event.operatorEmail ? `\n*Operator:* ${SlackNotificationDispatcher.escapeSlackMarkdown(event.operatorEmail)}` : ''
            }`,
          },
        },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: {
                type: 'plain_text',
                text: 'Open in WorkOps',
              },
              url: deepLinkUrl,
            },
          ],
        },
      ],
    };
  }

  buildAutoClosureSummaryPayload(event: AutoClosureSummaryEvent): any {
    const rawTitle = event.title || 'EOD Auto-Closure Digest';
    const escapedTitle = SlackNotificationDispatcher.escapeSlackMarkdown(rawTitle);
    const deepLinkUrl = event.detailsUrl || 'https://workops.company.com/daily';

    return {
      blocks: [
        {
          type: 'header',
          text: {
            type: 'plain_text',
            text: escapedTitle,
          },
        },
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: `*Date:* ${event.date}\n*Tasks Closed:* ${event.closedCount} | *Needs Review:* ${event.needsReviewCount}${
              event.operatorEmail ? `\n*Operator:* ${SlackNotificationDispatcher.escapeSlackMarkdown(event.operatorEmail)}` : ''
            }`,
          },
        },
        {
          type: 'actions',
          elements: [
            {
              type: 'button',
              text: {
                type: 'plain_text',
                text: 'Open in WorkOps',
              },
              url: deepLinkUrl,
            },
          ],
        },
      ],
    };
  }

  private async dispatchWithRetry(payload: any): Promise<DispatchResult> {
    if (!this.enabled || !this.webhookUrl) {
      return { success: true, platform: 'slack', statusCode: 200 };
    }

    if (!this.validateUrl(this.webhookUrl)) {
      return {
        success: false,
        platform: 'slack',
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
          return { success: true, platform: 'slack', statusCode: response.status, retries: attempt };
        }

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
      platform: 'slack',
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
