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
});
