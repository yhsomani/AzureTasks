import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const base = new URL('../../src/presentation/web/public/', import.meta.url);
const html = readFileSync(new URL('index.html', base), 'utf8');
const js = readFileSync(new URL('app.js', base), 'utf8');
const css = readFileSync(new URL('styles.css', base), 'utf8');

describe('user journey shell contracts', () => {
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
    const section = js.match(/function runForCell[\\s\\S]*?function renderPlanResults/)?.[0] ?? '';
    expect(section).not.toContain("api.post('/tasks/execute'");
  });

  it('requires explicit review for scheduler and EOD operations', () => {
    expect(js).toContain("window.confirm('Run the scheduled task creation now");
    expect(js).toContain("$('#eodRunNowBtn')?.addEventListener('click', () => triggerEodClosure(true))");
  });

  it('exposes matrix inspection actions as keyboard-operable buttons', () => {
    expect(js).toContain('matrix-cell-action');
  });

  it('manages dialog focus for keyboard users', () => {
    expect(js).toContain('function trapModalFocus(');
    expect(js).toContain("e.key === 'Tab'");
    expect(html).toContain('aria-live="polite"');
  });
});
