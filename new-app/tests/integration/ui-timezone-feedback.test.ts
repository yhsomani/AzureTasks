import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../../src/presentation/web/public/app.js', import.meta.url), 'utf8');

function run(sourceCode: string) {
  const sandbox = {
    document: { querySelector: () => null, querySelectorAll: () => [], addEventListener: () => {} },
    window: {},
    location: { hash: '#planner' },
    console, Intl, Date, setTimeout,
  };
  runInNewContext(source, sandbox);
  return runInNewContext(sourceCode, sandbox);
}

describe('timezone-correct UI dates', () => {
  it('uses the configured business timezone instead of UTC calendar day', () => {
    const date = run("isoDateInTimeZone(new Date('2026-10-16T19:30:00.000Z'), 'Asia/Kolkata')");
    expect(date).toBe('2026-10-17');
  });

  it('sets the ad-hoc default date using the configured timezone', () => {
    const start = source.indexOf('async function openAdHocModal(');
    const end = source.indexOf('function closeAdHocModal()', start);
    expect(source.slice(start, end)).toContain('isoDateInTimeZone(new Date(), cfg.timezone)');
  });
});

describe('task creation feedback', () => {
  it('does not report an all-success toast when Azure task creation had partial failures', async () => {
    const feedback = await run(`(async () => {
      const notices = [];
      state.selectedKeys.add('sample');
      state.pendingPlan = { personPlans: [] };
      state.pendingPlanSignature = plannerSelectionSignature();
      hideModal = () => {};
      openConsoleDrawer = () => {};
      refreshDashboard = () => {};
      runPlanPreview = () => {};
      toast = (message, type) => notices.push({ message, type });
      api.post = async () => ({ totalCreatedCount: 1, totalDuplicateCount: 0, totalTaskFailureCount: 2, totalSourceFailureCount: 1 });
      await executeCreation();
      return notices;
    })()`);
    const finalToast = feedback.at(-1);
    expect(finalToast.type).toBe('warn');
    expect(finalToast.message).toContain('2 task failure');
  });

  it('retains success feedback for a fully successful task run', async () => {
    const feedback = await run(`(async () => {
      const notices = [];
      state.selectedKeys.add('sample');
      state.pendingPlan = { personPlans: [] };
      state.pendingPlanSignature = plannerSelectionSignature();
      hideModal = () => {};
      openConsoleDrawer = () => {};
      refreshDashboard = () => {};
      runPlanPreview = () => {};
      toast = (message, type) => notices.push({ message, type });
      api.post = async () => ({ totalCreatedCount: 1, totalDuplicateCount: 0, totalTaskFailureCount: 0, totalSourceFailureCount: 0 });
      await executeCreation();
      return notices;
    })()`);
    expect(feedback.at(-1).type).toBe('ok');
  });
});
