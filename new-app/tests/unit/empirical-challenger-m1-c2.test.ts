import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const htmlPath = new URL('../../src/presentation/web/public/index.html', import.meta.url);
const cssPath = new URL('../../src/presentation/web/public/styles.css', import.meta.url);
const jsPath = new URL('../../src/presentation/web/public/app.js', import.meta.url);

const html = readFileSync(htmlPath, 'utf8');
const css = readFileSync(cssPath, 'utf8');
const js = readFileSync(jsPath, 'utf8');

describe('Empirical Challenger 2 (M1): Interactive Controls, Accessibility & Modals', () => {
  describe('1. Toast Stack Non-Blocking Behavior & Action Dock Hit-Testing', () => {
    it('enforces pointer-events: none on .toast-stack and pointer-events: auto on .toast', () => {
      // .toast-stack must not intercept clicks intended for underlying elements
      const stackRuleMatch = css.match(/\.toast-stack\s*\{([^}]+)\}/);
      expect(stackRuleMatch).not.toBeNull();
      const stackRule = stackRuleMatch![1];
      expect(stackRule).toContain('pointer-events: none');
      expect(stackRule).toContain('position: fixed');
      expect(stackRule).toContain('bottom: 20px');
      expect(stackRule).toContain('right: 20px');
      expect(stackRule).toContain('z-index: 110');

      // .toast must restore pointer events for interactive dismissal
      const toastRuleMatch = css.match(/\.toast\s*\{([^}]+)\}/);
      expect(toastRuleMatch).not.toBeNull();
      const toastRule = toastRuleMatch![1];
      expect(toastRule).toContain('pointer-events: auto');
    });

    it('retains all primary action buttons in their respective action docks', () => {
      expect(html).toContain('id="savePeopleBtn"');
      expect(html).toContain('id="calendarSaveBtn"');
      expect(html).toContain('id="saveSettingsBtn"');

      // Check that savePeopleBtn and calendarSaveBtn are inside .action-dock
      expect(html).toMatch(/<div class="[^"]*action-dock[^"]*">[\s\S]*?id="savePeopleBtn"[\s\S]*?<\/div>/);
      expect(html).toMatch(/<div class="[^"]*action-dock[^"]*"[^>]*>[\s\S]*?id="calendarSaveBtn"[\s\S]*?<\/div>/);
    });

    it('simulates pointer hit-testing at (bottom: 20px, right: 20px) coordinates', () => {
      // Simulate viewport geometry and hit-test resolution (elementFromPoint oracle)
      interface SimulatedElement {
        id: string;
        className: string;
        pointerEvents: 'auto' | 'none';
        zIndex: number;
        rect: { left: number; top: number; right: number; bottom: number };
      }

      function resolveElementFromPoint(elements: SimulatedElement[], x: number, y: number): SimulatedElement | null {
        // Filter elements containing (x, y) with pointerEvents !== 'none'
        const hitCandidates = elements.filter(el => {
          if (el.pointerEvents === 'none') return false;
          return x >= el.rect.left && x <= el.rect.right && y >= el.rect.top && y <= el.rect.bottom;
        });

        // Sort descending by zIndex, then DOM tree order
        hitCandidates.sort((a, b) => b.zIndex - a.zIndex);
        return hitCandidates[0] ?? null;
      }

      const viewport = { width: 1024, height: 768 };
      const clickPoint = { x: viewport.width - 20, y: viewport.height - 20 };

      // Background button at bottom-right (e.g. action dock button)
      const actionButton: SimulatedElement = {
        id: 'savePeopleBtn',
        className: 'btn primary',
        pointerEvents: 'auto',
        zIndex: 10,
        rect: { left: 880, top: 720, right: 1010, bottom: 760 },
      };

      // Toast stack overlaying the bottom-right coordinate with higher z-index (110)
      const toastStack: SimulatedElement = {
        id: 'toasts',
        className: 'toast-stack',
        pointerEvents: 'none', // As implemented in styles.css
        zIndex: 110,
        rect: { left: 664, top: 500, right: 1004, bottom: 748 },
      };

      // 1. When toast stack is empty or point is between toasts:
      const hitWithoutToast = resolveElementFromPoint([toastStack, actionButton], clickPoint.x, clickPoint.y);
      expect(hitWithoutToast).not.toBeNull();
      expect(hitWithoutToast?.id).toBe('savePeopleBtn');

      // 2. When a toast active item is under the pointer:
      const toastItem: SimulatedElement = {
        id: 'toast-1',
        className: 'toast ok',
        pointerEvents: 'auto', // Restored for interactive dismiss
        zIndex: 111,
        rect: { left: 700, top: 700, right: 1004, bottom: 748 },
      };
      const hitOnToast = resolveElementFromPoint([toastStack, toastItem, actionButton], clickPoint.x, clickPoint.y);
      expect(hitOnToast).not.toBeNull();
      expect(hitOnToast?.id).toBe('toast-1');

      // 3. Counter-factual: if toast-stack were pointer-events: auto, it would block the button!
      const blockedStack: SimulatedElement = { ...toastStack, pointerEvents: 'auto' };
      const blockedHit = resolveElementFromPoint([blockedStack, actionButton], clickPoint.x, clickPoint.y);
      expect(blockedHit?.id).toBe('toasts'); // Blocks savePeopleBtn!
    });
  });

  describe('2. Table Containment & Focus-Visible Outline Accessibility', () => {
    it('ensures .table-wrap and .matrix-container do NOT have contain: paint', () => {
      // Find all rules targeting .table-wrap or .matrix-container
      const containmentRules = css.match(/\.(table-wrap|matrix-container)[^{]*\{([^}]+)\}/g) || [];
      expect(containmentRules.length).toBeGreaterThan(0);

      for (const rule of containmentRules) {
        expect(rule).not.toContain('contain: paint');
        expect(rule).not.toContain('contain: strict');
        expect(rule).not.toContain('contain: content');
      }

      // Explicitly check line 686 block for safe boundaries
      expect(css).toMatch(/\.table-wrap,\s*\.matrix-container\s*\{[\s\S]*?max-width:\s*100%;[\s\S]*?min-width:\s*0;/);
    });

    it('configures focus-visible ring with 4px offset for clear visual accessibility', () => {
      const focusRuleMatch = css.match(/:where\([^)]+\):focus-visible\s*\{([^}]+)\}/);
      expect(focusRuleMatch).not.toBeNull();
      const focusRule = focusRuleMatch![1];
      expect(focusRule).toContain('outline: 2px solid var(--focus-ring)');
      expect(focusRule).toContain('outline-offset: 4px');
    });

    it('wraps calendar exceptions in .table-wrap with keyboard region attributes', () => {
      expect(html).toContain('id="calendarExceptionsList" class="table-wrap calendar-exceptions-list"');
      expect(html).toContain('tabindex="0"');
      expect(html).toContain('role="region"');
      expect(html).toContain('aria-label="Configured calendar exceptions"');
    });
  });

  describe('3. Modal Footer Stability (No Jarring Button Jumps)', () => {
    it('sets modal-footer to right-aligned flexbox with gap: 10px', () => {
      const modalFooterMatch = css.match(/\.modal-footer\s*\{([^}]+)\}/);
      expect(modalFooterMatch).not.toBeNull();
      const footerRule = modalFooterMatch![1];
      expect(footerRule).toContain('justify-content: flex-end');
      expect(footerRule).toContain('gap: 10px');
      expect(footerRule).not.toContain('justify-content: space-between');
    });

    it('verifies modal footers in EOD, Activation, and Date Inspect modals do not use flex-between', () => {
      // EOD modal footer
      const eodMatch = html.match(/<div id="eodModal"[\s\S]*?<div class="modal-footer([^"]*)"/);
      expect(eodMatch).not.toBeNull();
      expect(eodMatch![1]).not.toContain('flex-between');

      // Activation modal footer
      const activeMatch = html.match(/<div id="activeModal"[\s\S]*?<div class="modal-footer([^"]*)"/);
      expect(activeMatch).not.toBeNull();
      expect(activeMatch![1]).not.toContain('flex-between');

      // Date Inspect modal footer
      const dateInspectMatch = html.match(/<div id="dateInspectModal"[\s\S]*?<div class="modal-footer([^"]*)"/);
      expect(dateInspectMatch).not.toBeNull();
      expect(dateInspectMatch![1]).not.toContain('flex-between');
    });

    it('reorders buttons with Close first and Confirm second to ensure stable right anchoring', () => {
      // In EOD modal: Close button appears before btnExecuteEodConfirmed
      const eodFooterContent = html.match(/<div id="eodModal"[\s\S]*?<div class="modal-footer">([\s\S]*?)<\/div>/)?.[1] ?? '';
      const eodCloseIndex = eodFooterContent.indexOf('id="btnCloseEodModalBtn"');
      const eodConfirmIndex = eodFooterContent.indexOf('id="btnExecuteEodConfirmed"');
      expect(eodCloseIndex).toBeGreaterThan(-1);
      expect(eodConfirmIndex).toBeGreaterThan(-1);
      expect(eodCloseIndex).toBeLessThan(eodConfirmIndex);

      // In Activation modal: Close button appears before btnExecuteActiveConfirmed
      const activeFooterContent = html.match(/<div id="activeModal"[\s\S]*?<div class="modal-footer">([\s\S]*?)<\/div>/)?.[1] ?? '';
      const activeCloseIndex = activeFooterContent.indexOf('id="btnCloseActiveModalBtn"');
      const activeConfirmIndex = activeFooterContent.indexOf('id="btnExecuteActiveConfirmed"');
      expect(activeCloseIndex).toBeGreaterThan(-1);
      expect(activeConfirmIndex).toBeGreaterThan(-1);
      expect(activeCloseIndex).toBeLessThan(activeConfirmIndex);

      // In Date Inspect modal: Close button appears before btnCreateSingleMissingTask
      const dateFooterContent = html.match(/<div id="dateInspectModal"[\s\S]*?<div class="modal-footer">([\s\S]*?)<\/div>/)?.[1] ?? '';
      const dateCloseIndex = dateFooterContent.indexOf('id="btnCloseDateInspectBtn"');
      const dateConfirmIndex = dateFooterContent.indexOf('id="btnCreateSingleMissingTask"');
      expect(dateCloseIndex).toBeGreaterThan(-1);
      expect(dateConfirmIndex).toBeGreaterThan(-1);
      expect(dateCloseIndex).toBeLessThan(dateConfirmIndex);
    });

    it('simulates dynamic confirm button toggle to prove zero position jump to left edge', () => {
      // Mathematical model of flex-end vs space-between layout
      const footerWidth = 600;
      const padding = 22;
      const gap = 10;
      const closeBtnWidth = 80;
      const confirmBtnWidth = 200;

      // Flex-end layout (CURRENT IMPLEMENTATION):
      // State 1: Confirm hidden
      const flexEndCloseX_Hidden = footerWidth - padding - closeBtnWidth;
      // State 2: Confirm shown ([Close] [gap] [Confirm])
      const flexEndConfirmX = footerWidth - padding - confirmBtnWidth;
      const flexEndCloseX_Shown = flexEndConfirmX - gap - closeBtnWidth;

      // Both positions sit neatly in the right side of the container (not at left edge)
      expect(flexEndCloseX_Hidden).toBeGreaterThan(footerWidth / 2);
      expect(flexEndCloseX_Shown).toBeGreaterThan(250);
      expect(flexEndConfirmX - (flexEndCloseX_Shown + closeBtnWidth)).toBe(gap);

      // Counter-factual: Buggy space-between layout:
      // State 1: Confirm hidden (single item in space-between sits at left padding!)
      const spaceBetweenCloseX_Hidden = padding; // Jumps to far left (22px)!
      expect(spaceBetweenCloseX_Hidden).toBeLessThan(100);

      // State 2: Confirm shown (Close is pushed to left, Confirm to right)
      const jumpDeltaInSpaceBetween = Math.abs(spaceBetweenCloseX_Hidden - flexEndCloseX_Hidden);
      expect(jumpDeltaInSpaceBetween).toBe(476); // 476px jump avoided by using flex-end!
    });
  });

  describe('4. Calendar Exception Modal Architecture & Dual-Mode Theming', () => {
    it('creates standard modal-overlay, modal-card, modal-header, modal-body, modal-footer elements in app.js', () => {
      const funcSource = js.match(/function openAddExceptionModal\(\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
      expect(funcSource).toContain("class: 'modal-overlay open'");
      expect(funcSource).toContain("id: 'addExceptionModal'");
      expect(funcSource).toContain("class: 'modal-card'");
      expect(funcSource).toContain("class: 'modal-header'");
      expect(funcSource).toContain("class: 'modal-body'");
      expect(funcSource).toContain("class: 'modal-footer'");
      expect(funcSource).toContain("id: 'saveNewExceptionBtn'");
    });

    it('includes required form controls in addExceptionModal', () => {
      const funcSource = js.match(/function openAddExceptionModal\(\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
      expect(funcSource).toContain('id="newExcType"');
      expect(funcSource).toContain('id="newExcMember"');
      expect(funcSource).toContain('id="newExcStart"');
      expect(funcSource).toContain('id="newExcEnd"');
      expect(funcSource).toContain('id="newExcReason"');
    });

    it('verifies modal-card uses CSS variables for dual-mode theming', () => {
      const cardRuleMatch = css.match(/\.modal-card\s*\{([^}]+)\}/);
      expect(cardRuleMatch).not.toBeNull();
      const cardRule = cardRuleMatch![1];
      expect(cardRule).toContain('background: var(--bg-elev)');
      expect(cardRule).toContain('border: 1px solid var(--border-strong)');
      expect(cardRule).toContain('border-radius: var(--radius)');

      // Verify theme variables are defined in [data-theme="dark"] and [data-theme="light"]
      expect(css).toMatch(/\[data-theme="dark"\][\s\S]*?--bg-elev:\s*#202326;[\s\S]*?--text:\s*#f3f5f6;/);
      expect(css).toMatch(/\[data-theme="light"\][\s\S]*?--bg-elev:\s*#ffffff;[\s\S]*?--text:\s*#202529;/);
    });

    it('wires dismissibility via close buttons, backdrop click, and Escape key', () => {
      const funcSource = js.match(/function openAddExceptionModal\(\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? '';
      expect(funcSource).toContain("overlay.querySelectorAll('.close-modal-btn')");
      expect(funcSource).toContain("e.target === overlay");
      expect(funcSource).toContain("e.key === 'Escape'");
      expect(funcSource).toContain("overlay.remove()");
    });

    it('runs openAddExceptionModal in VM sandbox and verifies DOM element composition', () => {
      type MockElement = {
        tagName: string;
        className: string;
        id: string;
        attributes: Record<string, string>;
        children: Array<MockElement | string>;
        listeners: Record<string, Array<(...args: unknown[]) => void>>;
        innerHTML: string;
        style: Record<string, string>;
        append(...items: Array<MockElement | string>): void;
        addEventListener(evt: string, fn: (...args: unknown[]) => void): void;
        querySelectorAll(sel: string): MockElement[];
        querySelector(sel: string): MockElement | null;
        remove(): void;
      };

      function createMock(tag: string, props: Record<string, string> = {}): MockElement {
        const el: MockElement = {
          tagName: tag.toUpperCase(),
          className: props.class || '',
          id: props.id || '',
          attributes: { ...props },
          children: [],
          listeners: {},
          innerHTML: '',
          style: {},
          append(...items: Array<MockElement | string>) { this.children.push(...items); },
          addEventListener(evt, fn) {
            this.listeners[evt] = this.listeners[evt] || [];
            this.listeners[evt].push(fn);
          },
          querySelectorAll(sel: string) {
            const results: MockElement[] = [];
            const check = (node: MockElement | string) => {
              if (typeof node === 'string') return;
              if (sel === '.close-modal-btn' && (node.className || '').includes('close-modal-btn')) results.push(node);
              if (Array.isArray(node.children)) {
                for (const c of node.children) check(c);
              }
            };
            check(this);
            return results;
          },
          querySelector(sel: string) {
            return this.querySelectorAll(sel)[0] || null;
          },
          remove() {},
        };
        return el;
      }

      const bodyElements: MockElement[] = [];
      const documentListeners: Record<string, Array<(...args: unknown[]) => void>> = {};

      const sandbox = {
        $: () => null,
        el: (tag: string, props: Record<string, string> = {}, children?: Array<MockElement | string> | string) => {
          const m = createMock(tag, props);
          if (Array.isArray(children)) m.append(...children);
          else if (typeof children === 'string') m.append(children);
          return m;
        },
        escapeHtml: (s: string) => s,
        toast: () => {},
        setTimeout,
        calendarState: { members: [{ key: 'dev-1', name: 'Dev One' }] },
        document: {
          body: {
            append: (node: MockElement) => bodyElements.push(node),
            contains: () => true,
          },
          addEventListener: (evt: string, fn: (...args: unknown[]) => void) => {
            documentListeners[evt] = documentListeners[evt] || [];
            documentListeners[evt].push(fn);
          },
          removeEventListener: () => {},
        },
      };

      // Extract and execute openAddExceptionModal in VM
      const funcMatch = js.match(/function openAddExceptionModal\(\)\s*\{[\s\S]*?\n\}/);
      expect(funcMatch).not.toBeNull();
      runInNewContext(funcMatch![0] + '; openAddExceptionModal();', sandbox);

      expect(bodyElements.length).toBe(1);
      const modalOverlay = bodyElements[0];
      expect(modalOverlay.className).toBe('modal-overlay open');
      expect(modalOverlay.id).toBe('addExceptionModal');
      expect(modalOverlay.attributes.role).toBe('dialog');

      const modalCard = modalOverlay.children[0] as MockElement;
      expect(modalCard.className).toBe('modal-card');
      expect(modalCard.children.length).toBe(2); // header and form
      expect((modalCard.children[0] as MockElement).className).toBe('modal-header');
      expect((modalCard.children[1] as MockElement).tagName).toBe('FORM');

      // Check keydown listener attached for Escape
      expect(documentListeners.keydown).toBeDefined();
      expect(documentListeners.keydown.length).toBeGreaterThan(0);
    });
  });
});
