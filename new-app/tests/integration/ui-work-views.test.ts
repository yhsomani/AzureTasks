import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../../src/presentation/web/public/app.js', import.meta.url), 'utf8');

describe('My Work member and async state', () => {
  it('ignores a late old-member response after the selection changes', async () => {
    const ctx = {
      document: { querySelector: () => null, querySelectorAll: () => [], addEventListener: () => {} },
      location: { hash: '#mywork' }, window: {}, console, setTimeout,
    };
    runInNewContext(source, ctx);
    const names = await runInNewContext(`(async () => {
      const select = { value:'a', options:[{value:'a'},{value:'b'}], append(){} };
      const container = { innerHTML:'' };
      document.querySelector = selector => selector === '#myWorkPersonSelect' ? select : selector === '#myWorkContainer' ? container : null;
      ensureConfig = async () => ({people:[
        {key:'a', name:'A', enabled:true},
        {key:'b', name:'B', enabled:true},
      ]});
      const waiting = {};
      api.get = url => new Promise(resolve => waiting[url] = resolve);
      const rendered = [];
      renderMyWorkContent = (_, key) => rendered.push(key);
      const first = refreshMyWork();
      while (!waiting['/explorer?preset=current_month&users=a']) await Promise.resolve();
      select.value = 'b';
      const second = refreshMyWork();
      while (!waiting['/explorer?preset=current_month&users=b']) await Promise.resolve();
      waiting['/explorer?preset=current_month&users=b']({detailedTasks:[]});
      await second;
      waiting['/explorer?preset=current_month&users=a']({detailedTasks:[]});
      await first;
      return rendered;
    })()`, ctx);
    expect(Array.from(names)).toEqual(['b']);
  });
  it('provides keyboard focusable inspect controls in Daily Burndown', () => {
    const start = source.indexOf('function renderBurndownTable(data)');
    const end = source.indexOf('/* ----------------------------------------------------------------- my work */', start);
    const section = source.slice(start,end);
    expect(section).toContain("class: 'matrix-cell-action'");
    expect(section).toContain("type: 'button'");
  });
  it('does not render a broken placeholder link for missing Azure work-item URLs', () => {
    const start = source.indexOf('function renderMyWorkContent(');
    const end = source.indexOf('/* ------------------------------------------------------------ task explorer */', start);
    expect(source.slice(start,end)).toContain('getAdoWorkItemUrl(t.taskId)');
    expect(source.slice(start,end)).not.toContain("href: t.url || '#'");
  });
});

describe('work-hour accuracy in explorer presentation', () => {
  it('never fabricates missing work-hour values as zero in tables and charts', () => {
    expect(source).not.toContain('t.completedWork || 0');
    expect(source).not.toContain('t.remainingWork || 0');
    expect(source).toContain('Not recorded');
    expect(source).toContain('hasRecordedHours ? dailyWork : null');
  });
});
