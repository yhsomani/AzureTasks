import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const base = new URL('../../src/presentation/web/public/', import.meta.url);
const html = readFileSync(new URL('index.html', base), 'utf8');
const js = readFileSync(new URL('app.js', base), 'utf8');
const css = readFileSync(new URL('styles.css', base), 'utf8');

describe('Empirical Responsive Layout & Collision Contracts (Milestone M1)', () => {
  describe('C1: Sticky Column Width Constraints & Ellipsis', () => {
    it('constrains matrix-table sticky columns to max-width 220px with hidden overflow', () => {
      expect(css).toMatch(/\.matrix-table\s+th\.sticky-col,\s*\n\s*\.matrix-table\s+td\.sticky-col\s*\{[^}]*max-width:\s*220px/);
      expect(css).toMatch(/\.matrix-table\s+th\.sticky-col,\s*\n\s*\.matrix-table\s+td\.sticky-col\s*\{[^}]*overflow:\s*hidden/);
      expect(css).toMatch(/\.matrix-person-cell\s*\{[^}]*max-width:\s*220px/);
    });

    it('enforces text-overflow ellipsis on all direct divs and actions within matrix person cells', () => {
      expect(css).toMatch(/\.matrix-person-cell\s+div\s*\{[^}]*text-overflow:\s*ellipsis/);
      expect(css).toMatch(/\.matrix-person-cell\s+div\s*\{[^}]*white-space:\s*nowrap/);
      expect(css).toMatch(/\.matrix-person-cell\s+\.btn-action-person\s*\{[^}]*text-overflow:\s*ellipsis/);
    });

    it('renders person name and assignedTo with title attributes for accessible full-text display', () => {
      expect(js).toContain("title: planItem.person.name");
      expect(js).toContain("title: planItem.person.assignedTo");
    });
  });

  describe('C2: Team Management .person-row Multi-Row Architecture', () => {
    it('structures person-row into 3 logical rows in app.js', () => {
      expect(js).toContain("el('div', { class: 'person-row-identity' })");
      expect(js).toContain("el('div', { class: 'person-row-integrations' })");
      expect(js).toContain("el('div', { class: 'person-row-actions' })");
    });

    it('places exactly 5 identity fields, 4 integration fields, and 2 action controls', () => {
      const renderPeopleFunc = js.slice(
        js.indexOf('function renderPeople()'),
        js.indexOf('/* ---------------------------------------------------------------- settings */')
      );
      expect(renderPeopleFunc).toContain("r1.append(field('Key'");
      expect(renderPeopleFunc).toContain("r1.append(field('Name'");
      expect(renderPeopleFunc).toContain("r1.append(field('Assigned to (Email / UPN)'");
      expect(renderPeopleFunc).toContain("r1.append(field('Role / POD'");
      expect(renderPeopleFunc).toContain("r1.append(field('Title Prefix'");

      expect(renderPeopleFunc).toContain("r2.append(field('GitHub Handle'");
      expect(renderPeopleFunc).toContain("r2.append(field('GitHub Repositories");
      expect(renderPeopleFunc).toContain("r2.append(srcField);");

      expect(renderPeopleFunc).toContain("actions.append(acLabel, del);");
      expect(renderPeopleFunc).toContain("row.append(r1, r2, actions);");
    });

    it('anchors Auto-close toggle to the left and Remove button to the right via flex-between', () => {
      expect(css).toMatch(/\.person-row-actions\s*\{[^}]*justify-content:\s*space-between/);
      expect(css).toMatch(/\.person-row-actions\s*\{[^}]*align-items:\s*center/);
    });

    it('provides responsive breakpoints for .person-row-identity and .person-row-integrations at 1200px, 860px, and 360px', () => {
      expect(css).toMatch(/@media\s*\(max-width:\s*1200px\)[\s\S]*?\.person-row-identity/);
      expect(css).toMatch(/@media\s*\(max-width:\s*860px\)[\s\S]*?\.person-row-identity/);
      expect(css).toMatch(/@media\s*\(max-width:\s*360px\)[\s\S]*?\.person-row-identity/);
    });
  });

  describe('C3: Topbar Actions Breakpoints & Reconciled Rules', () => {
    it('applies flex-wrap to topbar at <=1200px and hides redundant project tag', () => {
      const media1200 = css.slice(css.indexOf('@media (max-width: 1200px)'), css.indexOf('@media (max-width: 1000px)'));
      expect(media1200).toContain('.topbar { flex-wrap: wrap; }');
      expect(media1200).toContain('.topbar-actions #orgProjectTag { display: none !important; }');
    });

    it('formats topbar-actions as a 2-column grid at <=600px with quickRunBtn spanning full width', () => {
      const media600 = css.slice(css.indexOf('@media (max-width: 600px)'), css.indexOf('@media (max-width: 480px)'));
      expect(media600).toContain('display: grid;');
      expect(media600).toContain('grid-template-columns: repeat(2, minmax(0, 1fr));');
      expect(media600).toContain('.topbar-actions #quickRunBtn {\n    grid-column: 1 / -1;\n  }');
    });

    it('does not contain conflicting duplicate @media (max-width: 600px) override at stylesheet end', () => {
      const lastMediaIndex = css.lastIndexOf('@media (max-width: 600px)');
      const firstMediaIndex = css.indexOf('@media (max-width: 600px)');
      expect(lastMediaIndex).toBe(firstMediaIndex);
    });
  });

  describe('C4: Planner Sidebar Button Wrapping (275px containment)', () => {
    it('applies wrap class and flex-wrap style to button row in workspace controls', () => {
      expect(html).toContain('class="row wrap gap m-0" style="gap: 8px;"');
      expect(css).toContain('.workspace-controls .card-head .row { flex-wrap: wrap; gap: 8px; }');
      expect(css).toContain('.workspace-controls .card-head .row .btn { flex: 1 1 auto; }');
    });

    it('contains all five planner action buttons inside header row', () => {
      expect(html).toContain('id="openAdHocModalBtn"');
      expect(html).toContain('id="plannerActivateTodayBtn"');
      expect(html).toContain('id="plannerCloseTodayBtn"');
      expect(html).toContain('id="btnSimulateWindow"');
      expect(html).toContain('id="btnResetPlannerWindow"');
    });
  });

  describe('C5: Scheduler Automation Grid & Panels', () => {
    it('uses responsive auto-fit grid with minmax 160px for automation configs', () => {
      expect(css).toContain('.automation-config-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 14px; align-items: flex-end; }');
    });

    it('applies automation-config-grid to Panel 1 and Panel 3', () => {
      expect(html).toMatch(/class="automation-config-grid"[\s\S]*?id="schedTimeInput"/);
      expect(html).toMatch(/class="automation-config-grid"[\s\S]*?id="eodStartTimeInput"/);
    });

    it('uses balanced cols-2 layout in Panel 2 to eliminate 3rd-column empty gap', () => {
      expect(html).toMatch(/<div class="grid cols-2 mt-lg" style="align-items:flex-end;">[\s\S]*?id="activeTimeInput"/);
    });
  });

  describe('C6: Calendar View Wrap & Modal Architecture', () => {
    it('wraps calendarExceptionsList in table-wrap region', () => {
      expect(html).toContain('id="calendarExceptionsList" class="table-wrap calendar-exceptions-list"');
    });

    it('builds standard themed modal elements in openAddExceptionModal', () => {
      expect(js).toContain("el('div', { class: 'modal-overlay open', id: 'addExceptionModal'");
      expect(js).toContain("el('div', { class: 'modal-card', style: 'max-width: 520px;' })");
      expect(js).toContain("el('div', { class: 'modal-header' }");
      expect(js).toContain("el('div', { class: 'modal-body'");
      expect(js).toContain("el('div', { class: 'modal-footer' }");
    });
  });

  describe('C7: Ad-Hoc Modal Grid Layout & Error Containment', () => {
    it('nests field-error elements inside their respective parent label.field containers', () => {
      expect(html).toMatch(/<label class="field">\s*<span class="required">Assignee<\/span>[\s\S]*?<small class="field-error" id="adHocPersonSelectError"[\s\S]*?<\/label>/);
      expect(html).toMatch(/<label class="field">\s*<span class="required">Target Date<\/span>[\s\S]*?<small class="field-error" id="adHocTargetDateError"[\s\S]*?<\/label>/);
    });

    it('keeps exactly 2 field containers as direct children of grid cols-2', () => {
      const match = html.match(/<form id="adHocForm">[\s\S]*?<div class="grid cols-2">([\s\S]*?)<\/div>/);
      expect(match).not.toBeNull();
      const inner = match![1];
      const fieldCount = (inner.match(/<label class="field">/g) || []).length;
      expect(fieldCount).toBe(2);
    });
  });

  describe('C8: Modal Footers, Toast Stack & Containment', () => {
    it('sets modal-footer to right-align buttons with gap: 10px', () => {
      expect(css).toMatch(/\.modal-footer\s*\{[^}]*justify-content:\s*flex-end/);
      expect(css).toMatch(/\.modal-footer\s*\{[^}]*gap:\s*10px/);
    });

    it('sets pointer-events none on toast-stack and auto on individual toast', () => {
      expect(css).toMatch(/\.toast-stack\s*\{[^}]*pointer-events:\s*none/);
      expect(css).toMatch(/\.toast\s*\{[^}]*pointer-events:\s*auto/);
    });

    it('removes contain: paint from table-wrap and matrix-container to prevent focus outline clipping', () => {
      const block = css.slice(css.indexOf('.table-wrap, .matrix-container'));
      const endOfBlock = block.slice(0, block.indexOf('}') + 1);
      expect(endOfBlock).not.toContain('contain: paint');
    });
  });
});
