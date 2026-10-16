import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../../src/presentation/web/public/app.js', import.meta.url), 'utf8');

function contextWithNodes() {
  const nodes: Record<string, { innerHTML: string; textContent: string; value?: string }> = {
    '#insightsContainer': { innerHTML: '', textContent: '' },
    '#explorerMatrixWrap': { innerHTML: '', textContent: '' },
  };
  const context = {
    document: { querySelector: (selector: string) => nodes[selector] || null, querySelectorAll: () => [], addEventListener: () => {} },
    window: {}, location: { hash: '#explorer' }, setTimeout, console,
  };
  runInNewContext(source, context);
  return { nodes, context };
}

describe('Explorer selection and data integrity', () => {
  it('does not query all users when no Explorer members are selected', async () => {
    const { context } = contextWithNodes();
    const requests = await runInNewContext(String.raw`(async () => {
      let count = 0;
      ensureConfig = async () => ({ people: [{ key: 'alice', name: 'Alice', enabled: true }] });
      renderExplorerUserPills = () => {};
      api.get = async () => { count++; throw new Error('Unexpected all-user fetch'); };
      state.selectedExplorerKeys.clear();
      await refreshExplorer();
      return count;
    })()`, context);
    expect(requests).toBe(0);
  });

  it('makes every Explorer filter pill a keyboard-operable pressed button', () => {
    const start = source.indexOf('function renderExplorerUserPills(');
    const end = source.indexOf('function renderExplorerKpis(', start);
    const picker = source.slice(start, end);
    expect(picker).toContain("el('button', {");
    expect(picker).toContain("'aria-pressed': String(on)");
  });

  it('never claims all tasks are up to date when the API returned no member rows', () => {
    const { nodes, context } = contextWithNodes();
    runInNewContext('generateInsights({matrix:[]})', context);
    expect(nodes['#insightsContainer'].innerHTML).toMatch(/No task data/);
    expect(nodes['#insightsContainer'].innerHTML).not.toMatch(/completely up to date/);
  });
});
