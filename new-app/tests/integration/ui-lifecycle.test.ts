import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../../src/presentation/web/public/app.js', import.meta.url), 'utf8');
const page = readFileSync(new URL('../../src/presentation/web/public/index.html', import.meta.url), 'utf8');
function harness() {
  const context = {
    document: { querySelector: () => null, querySelectorAll: () => [], addEventListener: () => undefined },
    window: {}, location: { hash: '#lifecycle' }, console, setTimeout,
  };
  runInNewContext(source, context);
  return context;
}

describe('scoped lifecycle experience', () => {
  it('provides a navigable page with real preview commands', () => {
    expect(page).toContain('data-view="lifecycle"');
    expect(page).toContain('id="view-lifecycle"');
    expect(page).toContain('id="lifecycleActivatePreview"');
    expect(page).toContain('id="lifecycleClosePreview"');
  });

  it('rejects empty scope and enumerates selected members in canonical order', () => {
    const context = harness();
    runInNewContext('state.currentView = "lifecycle"', context);
    expect(() => runInNewContext('lifecycleSelection()', context)).toThrow('Select at least one');
    runInNewContext('state.lifecycleKeys = new Set(["bob", "alice"])', context);
    expect(runInNewContext('lifecycleSelection()', context)).toEqual({ personKeys: ['alice', 'bob'] });
  });

  it('does not send a write when selected members changed after preview', async () => {
    const context = harness();
    const calls = await runInNewContext(`(async () => {
      state.currentView = 'lifecycle';
      state.lifecycleKeys = new Set(['bob']);
      state.activePreviewScope = JSON.stringify({ personKeys: ['alice'] });
      state.activePreviewReadyAt = Date.now();
      let requests = 0;
      api.post = async () => { requests++; };
      await triggerActivation(false);
      return requests;
    })()`, context);
    expect(calls).toBe(0);
  });
});