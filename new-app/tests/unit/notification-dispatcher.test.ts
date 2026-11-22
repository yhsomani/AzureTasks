import { describe, it, expect, vi, beforeEach } from 'vitest';
import { TeamsNotificationDispatcher } from '../../src/infrastructure/notifications/teams-dispatcher.js';
import { SlackNotificationDispatcher } from '../../src/infrastructure/notifications/slack-dispatcher.js';
import { CompositeNotificationDispatcher } from '../../src/infrastructure/notifications/composite-dispatcher.js';

describe('Feature #38: Automated Chat Platform Notification Dispatchers', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('builds Microsoft Teams Adaptive Card 1.4 specification with facts and action button', () => {
    const dispatcher = new TeamsNotificationDispatcher({ webhookUrl: 'https://example.com/teams' });
    const payload = dispatcher.buildPlanningDigestPayload({
      sprint: 'Sprint 48',
      date: '2026-11-22',
      plannedCount: 5,
      leaveCount: 1,
      operatorEmail: 'lead@workops.test',
    });

    expect(payload.type).toBe('message');
    expect(payload.attachments[0].contentType).toBe('application/vnd.microsoft.card.adaptive');
    expect(payload.attachments[0].content.type).toBe('AdaptiveCard');
    expect(payload.attachments[0].content.version).toBe('1.4');
    expect(payload.attachments[0].content.actions[0].type).toBe('Action.OpenUrl');
    expect(payload.attachments[0].content.actions[0].url).toContain('/daily');
  });

  it('builds Slack Block Kit payload with Markdown escaping', () => {
    const dispatcher = new SlackNotificationDispatcher({ webhookUrl: 'https://example.com/slack' });
    const payload = dispatcher.buildPlanningDigestPayload({
      title: 'Planning: <Sprint 48> & "Review"',
      sprint: 'Sprint 48',
      date: '2026-11-22',
      plannedCount: 4,
      leaveCount: 0,
      operatorEmail: 'lead@workops.test',
    });

    expect(payload.blocks[0].type).toBe('header');
    expect(payload.blocks[0].text.text).toBe('Planning: &lt;Sprint 48&gt; &amp; "Review"');
    expect(payload.blocks[1].type).toBe('section');
    expect(payload.blocks[2].type).toBe('actions');
  });

  it('handles webhook HTTP 500 error gracefully without throwing exception', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Internal Server Error',
    });
    vi.stubGlobal('fetch', mockFetch);

    const dispatcher = new TeamsNotificationDispatcher({
      webhookUrl: 'https://webhook.test/teams',
      maxRetries: 1,
    });

    const result = await dispatcher.sendPlanningDigest({
      sprint: 'Sprint 48',
      date: '2026-11-22',
      plannedCount: 2,
      leaveCount: 0,
    });

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(500);
    // 500 triggers retry: attempt 0 + 1 retry = 2 calls
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('fails fast on HTTP 400 client errors without retrying', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      statusText: 'Bad Request',
    });
    vi.stubGlobal('fetch', mockFetch);

    const teamsDispatcher = new TeamsNotificationDispatcher({
      webhookUrl: 'https://webhook.test/teams',
      maxRetries: 2,
    });

    const result = await teamsDispatcher.sendPlanningDigest({
      sprint: 'Sprint 48',
      date: '2026-11-22',
      plannedCount: 2,
      leaveCount: 0,
    });

    expect(result.success).toBe(false);
    expect(result.statusCode).toBe(400);
    expect(result.error).toContain('HTTP 400: Bad Request');
    // Fails fast: only 1 attempt despite maxRetries: 2
    expect(mockFetch).toHaveBeenCalledTimes(1);

    mockFetch.mockClear();

    const slackDispatcher = new SlackNotificationDispatcher({
      webhookUrl: 'https://webhook.test/slack',
      maxRetries: 2,
    });

    const slackResult = await slackDispatcher.sendPlanningDigest({
      sprint: 'Sprint 48',
      date: '2026-11-22',
      plannedCount: 2,
      leaveCount: 0,
    });

    expect(slackResult.success).toBe(false);
    expect(slackResult.statusCode).toBe(400);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('validates webhook URL and rejects malformed URL with FAILED_DELIVERY', async () => {
    const dispatcher = new TeamsNotificationDispatcher({
      webhookUrl: 'not-a-valid-http-url',
    });

    const result = await dispatcher.sendPlanningDigest({
      sprint: 'Sprint 48',
      date: '2026-11-22',
      plannedCount: 2,
      leaveCount: 0,
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('Malformed webhook URL');
  });

  it('skips network call when notification is disabled', async () => {
    const mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);

    const dispatcher = new SlackNotificationDispatcher({
      webhookUrl: 'https://webhook.test/slack',
      enabled: false,
    });

    const result = await dispatcher.sendPlanningDigest({
      sprint: 'Sprint 48',
      date: '2026-11-22',
      plannedCount: 2,
      leaveCount: 0,
    });

    expect(result.success).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('dispatches across multiple platforms via CompositeNotificationDispatcher', async () => {
    const mockTeams = {
      sendPlanningDigest: vi.fn().mockResolvedValue({ success: true, platform: 'teams' }),
      sendAutoClosureSummary: vi.fn().mockResolvedValue({ success: true, platform: 'teams' }),
    };
    const mockSlack = {
      sendPlanningDigest: vi.fn().mockResolvedValue({ success: true, platform: 'slack' }),
      sendAutoClosureSummary: vi.fn().mockResolvedValue({ success: true, platform: 'slack' }),
    };

    const composite = new CompositeNotificationDispatcher([mockTeams as any, mockSlack as any]);

    const result = await composite.sendPlanningDigest({
      sprint: 'Sprint 48',
      date: '2026-11-22',
      plannedCount: 3,
      leaveCount: 1,
    });

    expect(result.success).toBe(true);
    expect(mockTeams.sendPlanningDigest).toHaveBeenCalled();
    expect(mockSlack.sendPlanningDigest).toHaveBeenCalled();
  });
});
