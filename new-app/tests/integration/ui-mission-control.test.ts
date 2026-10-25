import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../../src/presentation/web/public/app.js', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../../src/presentation/web/public/styles.css', import.meta.url), 'utf8');
const page = readFileSync(new URL('../../src/presentation/web/public/index.html', import.meta.url), 'utf8');

interface ChartConfiguration {
  type: 'bar' | 'doughnut';
  data: {
    datasets: Array<{
      backgroundColor: string | string[];
      data: Array<number | null>;
    }>;
  };
  options: {
    animation: false | { duration: number };
    plugins: {
      legend: { labels?: { color: string } };
      tooltip: { backgroundColor: string; bodyColor: string };
    };
    scales?: { y: { grid: { color: string } } };
  };
}

function chartHarness(reducedMotion = false) {
  let theme = 'dark';
  let destroyed = 0;
  const handlers: Record<string, () => void> = {};
  const attributes: Record<string, string> = {};
  const configurations: ChartConfiguration[] = [];
  const tokens: Record<string, string> = {
    '--accent': 'cyan', '--warn': 'orange', '--ok': 'green', '--info': 'blue',
    '--muted': 'silver', '--text': 'white', '--border': 'gray', '--surface': 'black',
  };
  const root = {
    getAttribute: () => theme,
    setAttribute: (_: string, value: string) => { theme = value; },
  };
  const nodes: Record<string, unknown> = {
    '#themeToggle': {
      addEventListener: (event: string, handler: () => void) => { handlers[event] = handler; },
      setAttribute: (name: string, value: string) => { attributes[name] = value; },
    },
    '#statusDistributionChart': {},
    '#effortTrendChart': {},
  };
  const context = {
    document: {
      documentElement: root,
      querySelector: (selector: string) => nodes[selector] ?? null,
      querySelectorAll: () => [],
      addEventListener: () => {},
    },
    window: { addEventListener: () => {}, matchMedia: () => ({ matches: reducedMotion }) },
    location: { hash: '#dashboard' },
    localStorage: { setItem: () => {} },
    getComputedStyle: () => ({
      color: theme === 'dark' ? 'white' : 'black',
      getPropertyValue: (name: string) => name === '--accent' && theme === 'light' ? 'teal' : tokens[name] ?? '',
    }),
    Chart: class {
      constructor(_: unknown, config: ChartConfiguration) { configurations.push(config); }
      destroy() { destroyed++; }
    },
    setTimeout,
    console,
  };
  runInNewContext(source, context);
  return { context, configurations, handlers, attributes, destroyed: () => destroyed };
}

const chartData = `({
  summary: {stateCounts: {New: 1, Active: 2, Closed: 3, Resolved: 4}},
  dates: [{dateIso: '2026-10-16', formattedDate: '16 Oct', isWeekend: false}],
  matrix: [{cells: {'2026-10-16': {tasks: [{completedWork: null}]}}}]
})`;

describe('mission-control dynamic presentation', () => {
  it('uses resolved theme tokens for canvas data, text, grid and tooltip colors', () => {
    const ui = chartHarness();
    runInNewContext(`renderOverviewCharts(${chartData})`, ui.context);
    const [status, effort] = ui.configurations;
    expect(Array.from(status.data.datasets[0].backgroundColor)).toEqual(['cyan', 'orange', 'green', 'blue', 'silver']);
    expect(status.options.plugins.legend.labels?.color).toBe('silver');
    expect(effort.options.scales?.y.grid.color).toBe('gray');
    expect(effort.options.plugins.tooltip.backgroundColor).toBe('black');
    expect(effort.options.plugins.tooltip.bodyColor).toBe('white');
    expect(effort.data.datasets[0].data[0]).toBeNull();
  });

  describe('mission-control semantic palette', () => {
    it('defines separate readable semantic tokens for both themes and chart aliases', () => {
      for (const theme of ['dark', 'light']) {
        const block = styles.match(new RegExp(`\\[data-theme="${theme}"\\]\\s*\\{([^}]+)\\}`))?.[1] ?? '';
        for (const token of ['surface', 'text', 'text-muted', 'border', 'accent', 'ok', 'warn', 'danger', 'chart-blue']) {
          expect(block, `${theme} theme: ${token}`).toMatch(new RegExp(`--${token}:\\s*#[\\da-f]+`, 'i'));
        }
      }
      expect(styles).toMatch(/--info:\s*var\(--chart-blue\)/);
      expect(styles).toMatch(/--muted:\s*var\(--text-muted\)/);
    });

    it('styles dynamic status classes with semantic tokens rather than inline color literals', () => {
      expect(styles).toMatch(/\.pill\.merged\s*\{[^}]*var\(--violet\)/);
      expect(styles).toMatch(/\.insight-label\.warn\s*\{[^}]*var\(--warn\)/);
      expect(styles).toMatch(/\.insight-label\.info\s*\{[^}]*var\(--accent\)/);
      expect(styles).toMatch(/\.insight-label\.bad[^}]*var\(--danger\)/);
      expect(source).not.toMatch(/backgroundColor:\s*['"]#|rgba\(138,43,226/);
    });
  });

  describe('mission-control responsive accessibility', () => {
    it('visually hides the live announcer without removing it from assistive technology', () => {
      expect(page).toMatch(/<p\b(?=[^>]*id="viewStatus")(?=[^>]*class="[^"]*\bsr-only\b)(?=[^>]*role="status")(?=[^>]*aria-live="polite")[^>]*>/);
      const hidden = styles.match(/\.sr-only\s*\{([^}]+)\}/)?.[1] ?? '';
      for (const declaration of [
        /position:\s*absolute/, /width:\s*1px/, /height:\s*1px/,
        /overflow:\s*hidden/, /clip-path:\s*inset\(50%\)/,
      ]) expect(hidden).toMatch(declaration);
      expect(hidden).not.toMatch(/display:\s*none|visibility:\s*hidden/);
    });

    it('hides the menu trigger on desktop with sufficient specificity and exposes it on mobile', () => {
      const desktop = styles.split('@media')[0];
      expect(desktop).toMatch(/\.icon-btn\.menu-btn\s*\{[^}]*display:\s*none/);
      const mobile = styles.match(/@media\s*\(max-width:\s*860px\)([\s\S]*?)(?=@media|$)/)?.[1] ?? '';
      expect(mobile).toMatch(/\.icon-btn\.menu-btn\s*\{[^}]*display:\s*inline-flex/);
    });
  });

  const workspaces = [
    ['dashboard', ['mission-briefing', 'mission-metrics', 'dashboard-layout'], ['kpiConn', 'insightsContainer', 'dashboardPlan']],
    ['mywork', ['workspace-layout', 'workspace-controls', 'workspace-content'], ['myWorkPersonSelect', 'myWorkContainer']],
    ['explorer', ['workspace-layout', 'workspace-controls', 'workspace-content'], ['explorerUserPills', 'explorerMatrixWrap']],
    ['burndown', ['workspace-intro', 'operation-panel', 'matrix-container'], ['burndownMonthSelector', 'burndownMatrixContainer']],
    ['planner', ['workspace-layout', 'workspace-controls', 'workspace-content'], ['personPicker', 'planMatrixWrap', 'executeBtn']],
    ['scheduler', ['workspace-intro', 'automation-grid', 'operation-panel'], ['schedulerSafetyNotice', 'eodSafetyNotice', 'schedToggle']],
    ['people', ['workspace-layout', 'workspace-controls', 'workspace-content'], ['peopleList', 'savePeopleBtn']],
    ['settings', ['workspace-layout', 'workspace-controls', 'workspace-content'], ['settingsSetupGuide', 'settingsSecurityNotice', 'setOrg']],
    ['journal', ['workspace-intro', 'table-wrap', 'action-dock'], ['journalStats', 'journalTable', 'journalRepairBtn']],
    ['logs', ['workspace-intro', 'operation-panel', 'logs-toolbar'], ['logStatus', 'logStream', 'logSearchInput']],
  ] as const;

  function viewMarkup(view: string) {
    return page.match(new RegExp(`<section\\b[^>]*id="view-${view}"[^>]*>([\\s\\S]*?)<\\/section>`))?.[1] ?? '';
  }

  function initialText(id: string) {
    return page.match(new RegExp(`<[^>]+\\bid="${id}"[^>]*>([^<]*)<\\/`))?.[1].trim();
  }

  describe('mission-control workspace structure', () => {
    it.each(workspaces)('renders the %s workspace around its actual controls and data targets', (view, classes, ids) => {
      const section = viewMarkup(view);
      expect(section).not.toBe('');
      expect(section).toMatch(/<h2\b/);
      for (const name of classes) {
        expect(section).toMatch(new RegExp(`class="[^"]*\\b${name}\\b[^"]*"`));
      }
      for (const id of ids) expect(section).toContain(`id="${id}"`);
    });

    it('gives every destination a decorative SVG line icon alongside its text label', () => {
      for (const [view] of workspaces) {
        const button = page.match(new RegExp(`<button\\b[^>]*data-view="${view}"[^>]*>([\\s\\S]*?)<\\/button>`))?.[1] ?? '';
        expect(button).toMatch(/<span[^>]*class="ico"[^>]*aria-hidden="true"[^>]*>\s*<svg\b[^>]*fill="none"[^>]*stroke="currentColor"/);
        expect(button).toMatch(/<\/svg>\s*<\/span>\s*<span>[^<]+<\/span>/);
      }
    });

    it('starts connection, metrics and event streams as unknown rather than fabricated healthy telemetry', () => {
      expect(initialText('connText')).toBe('Checking…');
      expect(initialText('logStatus')).toBe('Connecting…');
      expect(initialText('drawerStatusPill')).toBe('Operational events');
      expect(initialText('insightsCountBadge')).toBe('Coverage signals');
      for (const id of ['kpiConn', 'kpiPeople', 'kpiPrsToday']) expect(initialText(id)).toBe('—');
      expect(page).not.toMatch(/all systems operational|system nominal|99\.9%\s*uptime/i);
    });

    it('prioritizes connection, exceptions and reviewed action ahead of supporting charts', () => {
      const dashboard = viewMarkup('dashboard');
      const positions = ['kpiConn', 'insightsContainer', 'dashboardPlan', 'effortTrendChart']
        .map(id => dashboard.indexOf(`id="${id}"`));
      expect(positions.every(position => position >= 0)).toBe(true);
      expect(positions).toEqual([...positions].sort((a, b) => a - b));
      expect(dashboard).toContain('data-view-link="planner"');
      expect(dashboard).toContain('Preview first. Creation requires your confirmation.');
    });
  });

  it('repaints existing charts on theme changes without fetching data', () => {
    const ui = chartHarness();
    runInNewContext(`renderOverviewCharts(${chartData}); wire();`, ui.context);
    ui.handlers.click();
    expect(ui.configurations).toHaveLength(4);
    expect(ui.destroyed()).toBe(2);
    expect(ui.configurations[3].data.datasets[0].backgroundColor).toBe('teal');
    expect(ui.attributes['aria-label']).toBe('Switch to dark theme');
    expect(ui.attributes['aria-pressed']).toBe('false');
  });

  it('respects reduced motion in both charts', () => {
    const ui = chartHarness(true);
    runInNewContext(`renderOverviewCharts(${chartData})`, ui.context);
    expect(ui.configurations.map(config => config.options.animation)).toEqual([false, false]);
  });

  it('returns focus to the originating control after closing the console drawer', () => {
    const ui = chartHarness();
    const result = runInNewContext(`(() => {
      const classes = new Set();
      const focused = [];
      const trigger = {isConnected: true, focus() { focused.push('trigger'); }};
      const close = {focus() { focused.push('close'); }};
      const drawer = {classList: {
        contains: name => classes.has(name), add: name => classes.add(name),
        remove: name => classes.delete(name),
      }};
      document.activeElement = trigger;
      document.querySelector = selector => selector === '#executionDrawer' ? drawer
        : selector === '#btnCloseDrawer' ? close : null;
      openConsoleDrawer();
      closeConsoleDrawer();
      return {focused, open: classes.has('open')};
    })()`, ui.context);
    expect(Array.from(result.focused)).toEqual(['close', 'trigger']);
    expect(result.open).toBe(false);
  });
});
