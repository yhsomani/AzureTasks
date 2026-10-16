import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const script = readFileSync(new URL('../../src/presentation/web/public/app.js', import.meta.url), 'utf8');
const routes = ['dashboard', 'mywork', 'explorer', 'burndown', 'planner', 'scheduler', 'people', 'settings', 'journal', 'logs'];

function mockElement(id = '', dataset: Record<string, string> = {}) {
  const classes = new Set<string>();
  const attributes = new Map<string, string>();
  return {
    id,
    dataset,
    textContent: '',
    classList: {
      toggle(name: string, enabled = false) { if (enabled) classes.add(name); else classes.delete(name); },
      remove(name: string) { classes.delete(name); },
      add(name: string) { classes.add(name); },
      contains(name: string) { return classes.has(name); },
    },
    setAttribute(key: string, value: string) { attributes.set(key, value); },
    removeAttribute(key: string) { attributes.delete(key); },
    getAttribute(key: string) { return attributes.get(key) ?? null; },
    focus() {},
  };
}

function shell(source = script) {
  const buttons = routes.map(view => mockElement('', { view }));
  const panels = routes.map(view => mockElement(`view-${view}`));
  const title = mockElement(), breadcrumb = mockElement();
  const nodes: Record<string, ReturnType<typeof mockElement>> = {
    '#sidebar': mockElement(),
    '#navBackdrop': mockElement(),
    '#menuBtn': mockElement(),
    '#viewTitle': title,
    '#viewBreadcrumb': breadcrumb,
    '#viewSubtitle': mockElement(),
  };
  const location = {
    _hash: '#dashboard',
    get hash() { return this._hash; },
    set hash(value: string) { this._hash = value.startsWith('#') ? value : `#${value}`; },
  };
  const document = {
    querySelector: (selector: string) => nodes[selector] ?? null,
    querySelectorAll: (selector: string) => selector === '.nav-item' ? buttons : selector === '.view' ? panels : [],
    addEventListener: () => {},
  };
  const context = { document, location, window: {}, setTimeout, console };
  runInNewContext(source, context);
  return { context, buttons, panels, title, breadcrumb, location };
}

describe('navigation runtime (dependency-free DOM harness)', () => {
  it('updates visible view, current page and URL without requiring Azure credentials', () => {
    const ui = shell();
    expect(() => runInNewContext("switchView('logs')", ui.context)).not.toThrow();
    expect(ui.location.hash).toBe('#logs');
    expect(ui.title.textContent).toBe('Live Logs');
    expect(ui.breadcrumb.textContent).toContain('Monitor');
    const selected = ui.buttons.find(button => button.dataset.view === 'logs');
    expect(selected?.getAttribute('aria-current')).toBe('page');
    expect(selected?.classList.contains('active')).toBe(true);
    expect(ui.panels.find(panel => panel.id === 'view-logs')?.classList.contains('active')).toBe(true);
    expect(ui.buttons.filter(button => button.getAttribute('aria-current') === 'page')).toHaveLength(1);
  });

  it('would catch regression to querySelector rather than querySelectorAll', () => {
    const broken = script.replaceAll("$$('.nav-item').forEach", () => "$('.nav-item').forEach");
    const ui = shell(broken);
    expect(() => runInNewContext("switchView('logs')", ui.context)).toThrow();
  });
});
