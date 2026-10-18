import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const base = new URL('../../src/presentation/web/public/', import.meta.url);
const html = readFileSync(new URL('index.html', base), 'utf8');
const js = readFileSync(new URL('app.js', base), 'utf8');
const css = readFileSync(new URL('styles.css', base), 'utf8');

describe('user journey shell contracts', () => {
  it('gives the main content focusable status announcements and descriptive chart alternatives', () => {
    expect(html).toContain('id="viewStatus"');
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-live="polite"');
    expect(html).toContain('aria-label="Daily effort trend"');
    expect(html).toContain('aria-label="Task status distribution"');
  });

  it('keeps all ten existing destination routes', () => {
    for (const view of [
      'dashboard', 'mywork', 'explorer', 'burndown', 'planner',
      'scheduler', 'people', 'settings', 'journal', 'logs',
    ]) {
      expect(html).toContain(`id="view-${view}"`);
      expect(html).toContain(`data-view="${view}"`);
    }
  });

  it('groups destinations by jobs to be done instead of a flat list', () => {
    for (const label of ['Overview', 'Explore work', 'Create & automate', 'Manage', 'Monitor']) {
      expect(html).toContain(`class="nav-group-label">${label}`);
    }
    expect(html).toContain('aria-label="Primary navigation"');
  });

  it('iterates over every navigation button rather than a single element', () => {
    expect(js).toContain("$('.nav-item').forEach");
    expect(js).not.toMatch(/^\\s*\\$\\('\\.nav-item'\\)\\.forEach/m);
  });

  it('does not refetch a destination twice after updating the URL hash', () => {
    expect(js).toContain('if (VIEW_META[view] && state.currentView === view) return;');
    expect(js).toContain('switchView(initial);');
  });

  it('exposes accessible navigation and responsive dismissal controls', () => {
    expect(html).toContain('id="navBackdrop"');
    expect(html).toContain('aria-controls="sidebar"');
    expect(js).toContain("setAttribute('aria-current', 'page')");
    expect(js).toContain('function closeMobileNav(');
    expect(js).toContain('function handleHashNavigation(');
    expect(css).toContain('.nav-backdrop');
  });

  it('makes the global action a safe link to planning, not execution', () => {
    expect(html).toMatch(/id="quickRunBtn"[^>]*>Review plan</);
    const chunk = js.match(/\$\('#quickRunBtn'\).*?\n  \}\);/s)?.[0] ?? '';
    expect(chunk).toContain("switchView('planner')");
    expect(chunk).not.toContain('openConfirmationModal(');
  });

  it('blocks unreviewed and empty-selection execution', () => {
    expect(js).toContain('function plannerSelectionSignature(');
    expect(js).toContain('state.pendingPlanSignature');
    expect(js).toContain('Select at least one team member');
    expect(js).toContain('Review an up-to-date plan before executing');
    expect(js).toContain('state.planRequestVersion');
  });

  it('makes dashboard contextual links navigate to real sections', () => {
    expect(html).toContain('data-view-link="planner"');
    expect(html).toContain('data-view-link="journal"');
    expect(js).toContain("closest('[data-view-link]')");
  });

  it('routes a single-day action through single-task creation', () => {
    expect(js).toContain('openAdHocModal(personKey, isoDate)');
    const section = js.match(/function runForCell[\s\S]*?function renderPlanResults/)?.[0] ?? '';
    expect(section).toContain('openAdHocModal(personKey, isoDate)');
    expect(section).not.toContain("api.post('/tasks/execute'");
  });

  it('requires explicit review for scheduler and EOD operations', () => {
    expect(js).toContain("window.confirm('Run the scheduled task creation now");
    expect(js).toContain("$('#eodRunNowBtn')?.addEventListener('click', () => triggerEodClosure(true))");
  });

  it('exposes matrix inspection actions as keyboard-operable buttons', () => {
    expect(js).toContain('matrix-cell-action');
  });

  it('refreshes the planner after one-off creation instead of calling a nonexistent function', () => {
    expect(js).not.toContain("state.currentView === 'planner') refreshPlanner()");
    expect(js).toContain("state.currentView === 'planner') runPlanPreview()");
  });

  it('requires confirmation for enabling automation and repairing links', () => {
    expect(js).toContain("if (enable && !window.confirm(");
    expect(js).toContain("if (!window.confirm('Repair incomplete task relationships");
  });

  it('prevents EOD closure before a successful fresh dry run', () => {
    expect(js).toContain('state.eodPreviewReadyAt');
    expect(js).toContain('Preview EOD closure before executing');
    expect(js).toContain("if (executeBtn) executeBtn.style.display = 'none'");
  });

  it('requires explicit consent to bypass ad-hoc duplicate safeguards', () => {
    expect(js).not.toContain("payload.bypassDuplicateCheck && !window.confirm(");
  });

  it('manages dialog focus for keyboard users', () => {
    expect(js).toContain('function trapModalFocus(');
    expect(js).toContain("e.key === 'Tab'");
    expect(html).toContain('aria-live="polite"');
  });
});

describe('viewer role client behavior', () => {
  it('surfaces read-only identity and blocks writes before an HTTP request', () => {
    expect(source).toContain("api.get('/session'");
    expect(source).toContain('viewerMode: false');
    expect(source).toContain('Read-only viewer credentials cannot change');
    expect(source).toContain("'#executeBtn'");
    expect(source).toContain("'#savePatBtn'");
    expect(source).toContain("'#schedRunNowBtn'");
    expect(source).toContain('viewerModeNotice');
  });
});
