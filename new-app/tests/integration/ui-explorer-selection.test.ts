import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../../src/presentation/web/public/app.js', import.meta.url), 'utf8');

function contextWithNodes() {
  const nodes: Record<string, { innerHTML: string; textContent: string; value?: string; prepend: () => void }> = {
    '#insightsContainer': { innerHTML: '', textContent: '', prepend: () => {} },
    '#explorerMatrixWrap': { innerHTML: '', textContent: '', prepend: () => {} },
  };
  const context = {
    document: { 
      querySelector: (selector: string) => nodes[selector] || null, 
      querySelectorAll: () => [], 
      addEventListener: () => {},
      createElement: () => ({ setAttribute: () => {}, prepend: () => {}, append: () => {}, className: '', textContent: '' }),
      createTextNode: (text: string) => text,
    },
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

  it('keeps Deselect All explicit across Explorer filter re-renders', () => {
    const start = source.indexOf("$('#explorerDeselectAllBtn')");
    const fragment = source.slice(start, start + 450);
    expect(fragment).toContain('state.deselectedExplorerKeys = new Set(');
  });

  it('never claims all tasks are up to date when the API returned no member rows', () => {
    const { nodes, context } = contextWithNodes();
    runInNewContext('generateInsights({matrix:[]})', context);
    const text = nodes['#insightsContainer'].textContent || nodes['#insightsContainer'].innerHTML;
    expect(text).toMatch(/No task data/);
    expect(text).not.toMatch(/completely up to date/);
  });
  it('progressively requests individual members with bounded concurrency', async () => {
    const { context } = contextWithNodes();
    const result = await runInNewContext(String.raw`(async () => {
      state.selectedExplorerKeys = new Set(['alice', 'bob']);
      ensureConfig = async () => ({ people: [
        { key: 'alice', name: 'Alice', enabled: true },
        { key: 'bob', name: 'Bob', enabled: true },
      ] });
      renderExplorerUserPills = () => {};
      const urls = [];
      api.get = async (url) => { urls.push(url); throw new Error('service unavailable'); };
      await refreshExplorer();
      return urls;
    })()`, context);
    expect(result).toHaveLength(2);
    expect(result.some((url: string) => url.includes('users=alice'))).toBe(true);
    expect(result.some((url: string) => url.includes('users=bob'))).toBe(true);
    expect(result.every((url: string) => !url.includes('alice%2Cbob'))).toBe(true);
  });

});
