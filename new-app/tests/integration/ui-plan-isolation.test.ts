import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../../src/presentation/web/public/app.js', import.meta.url), 'utf8');

describe('planner scope and keyboard journeys', () => {
  it('does not overwrite the selected-member plan with a late Dashboard preview', async () => {
    const document = {
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener: () => undefined,
    };
    const context = { document, window: {}, location: { hash: '#dashboard' }, console, setTimeout };
    runInNewContext(source, context);
    const result = await runInNewContext(`(async () => {
      const original = { personPlans: [], selectedMember: 'developer-a' };
      state.pendingPlan = original;
      state.pendingPlanSignature = 'selected-member-signature';
      api.get = async () => { throw new Error('Offline in test'); };
      api.post = async () => ({ personPlans: [], selectedMember: 'all-team-preview' });
      refreshDashboard();
      await new Promise(resolve => setTimeout(resolve, 10));
      return {
        plannerScope: state.pendingPlan?.selectedMember,
        signature: state.pendingPlanSignature,
      };
    })()`, context);
    expect(result.plannerScope).toBe('developer-a');
    expect(result.signature).toBe('selected-member-signature');
  });

  it('offers the planner member picker as keyboard-operable pressed buttons', () => {
    const start = source.indexOf('async function renderPlannerPeople()');
    const end = source.indexOf('function updatePlannerMemberPill(', start);
    const picker = source.slice(start, end);
    expect(picker).toContain("el('button', {");
    expect(picker).toContain("type: 'button'");
    expect(picker).toContain("'aria-pressed': String(on)");
  });

  it('fetches planner data per member one by one with progressive merge and concurrency limits', async () => {
    const nodes: Record<string, { innerHTML: string; textContent: string; prepend: (el?: unknown) => void; append: (el?: unknown) => void; replaceChildren: () => void }> = {
      '#planMatrixWrap': { innerHTML: '', textContent: '', prepend: () => {}, append: () => {}, replaceChildren: () => {} },
      '#planResults': { innerHTML: '', textContent: '', prepend: () => {}, append: () => {}, replaceChildren: () => {} },
      '#plannerAutoRefreshStatus': { innerHTML: '', textContent: '', prepend: () => {}, append: () => {}, replaceChildren: () => {} },
      '#kpiPlanMembers': { innerHTML: '', textContent: '', prepend: () => {}, append: () => {}, replaceChildren: () => {} },
      '#kpiPlanToCreate': { innerHTML: '', textContent: '', prepend: () => {}, append: () => {}, replaceChildren: () => {} },
      '#kpiPlanExisting': { innerHTML: '', textContent: '', prepend: () => {}, append: () => {}, replaceChildren: () => {} },
      '#kpiPlanWindow': { innerHTML: '', textContent: '', prepend: () => {}, append: () => {}, replaceChildren: () => {} },
      '#executeBtn': { innerHTML: '', textContent: '', prepend: () => {}, append: () => {}, replaceChildren: () => {} },
    };
    const document = {
      querySelector: (sel: string) => nodes[sel] || null,
      querySelectorAll: () => [],
      addEventListener: () => undefined,
      createElement: () => ({
        setAttribute: () => {},
        addEventListener: () => {},
        prepend: () => {},
        append: () => {},
        className: '',
        textContent: '',
        innerHTML: '',
      }),
      createTextNode: (t: string) => t,
    };
    const context = { document, window: {}, location: { hash: '#planner' }, console, setTimeout };
    runInNewContext(source, context);

    const result = await runInNewContext(`(async () => {
      const calls = [];
      let inFlight = 0;
      let maxInFlight = 0;

      api.post = async (url, body) => {
        if (url === '/tasks/plan') {
          inFlight++;
          if (inFlight > maxInFlight) maxInFlight = inFlight;
          calls.push({ ...body });
          await new Promise(r => setTimeout(r, 10));
          inFlight--;
          return {
            todayIso: '2026-11-04',
            nextThursdayIso: '2026-11-05',
            personPlans: [{
              person: { key: body.personKeys[0], name: 'Member ' + body.personKeys[0] },
              plannedDates: [{ isoDate: '2026-11-04', formattedTitleDate: 'Nov 4', status: 'PLANNED' }]
            }]
          };
        }
        return {};
      };

      state.selectedKeys = new Set(['user1', 'user2', 'user3', 'user4']);
      await runPlanPreview();

      return {
        calls,
        maxInFlight,
        pendingCount: state.pendingPlan?.personPlans?.length,
        todayIso: state.pendingPlan?.todayIso,
      };
    })()`, context);

    expect(result.calls.length).toBe(4);
    // Every call queried one member at a time
    expect(result.calls.every((c: { personKeys: string[] }) => c.personKeys.length === 1)).toBe(true);
    // Max concurrency bounded by Math.min(3, keys.length)
    expect(result.maxInFlight).toBeLessThanOrEqual(3);
    // All 4 member plans merged into state.pendingPlan
    expect(result.pendingCount).toBe(4);
    expect(result.todayIso).toBe('2026-11-04');
  });
});
