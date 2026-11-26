// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { AppShell } from '../../src/presentation/web/src/components/layout/AppShell.js';
import { Button } from '../../src/presentation/web/src/components/common/Button.js';
import { Toast } from '../../src/presentation/web/src/components/common/Toast.js';
import { Modal, trapModalFocus } from '../../src/presentation/web/src/components/common/Modal.js';
import { DailyWorkflowWorkspace } from '../../src/presentation/web/src/components/workspaces/DailyWorkflowWorkspace.js';
import { TeamPlanningWorkspace } from '../../src/presentation/web/src/components/workspaces/TeamPlanningWorkspace.js';
import { GovernanceWorkspace } from '../../src/presentation/web/src/components/workspaces/GovernanceWorkspace.js';

describe('Modern React 19 UI Shell & Workspaces', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Mock fetch for API client
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      const makeJsonResponse = (payload: unknown) =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: () => Promise.resolve({ success: true, data: payload, ...((typeof payload === 'object' && payload !== null) ? payload : {}) }),
        });

      if (url.includes('/api/session')) {
        return makeJsonResponse({ authenticated: true, user: 'test-operator', role: 'admin', viewerMode: false });
      }
      if (url.includes('/api/config')) {
        return makeJsonResponse({
          people: [
            { key: 'alex', name: 'Alex Developer', email: 'alex@example.com', role: 'Developer', capacityHours: 8, enabled: true },
            { key: 'sam', name: 'Sam Leave', email: 'sam@example.com', role: 'Developer', capacityHours: 0, enabled: true },
          ],
        });
      }
      if (url.includes('/api/github/daily-prs')) {
        return makeJsonResponse({
          members: [
            {
              personKey: 'alex',
              personName: 'Alex Developer',
              githubUsername: 'alex-dev',
              openCount: 1,
              mergedCount: 1,
              totalCount: 2,
              pullRequests: [
                { id: 101, number: 42, title: 'Feature PR', htmlUrl: 'https://github.com/org/repo/pull/42', state: 'merged', repository: 'repo', author: 'alex-dev', createdAt: '2026-11-21' },
              ],
            },
          ],
        });
      }
      if (url.includes('/api/explorer')) {
        return makeJsonResponse({
          items: [
            { id: 901, title: 'Unit testing PR changes', state: 'Active', assignedTo: 'Alex Developer', remainingWork: 4 },
          ],
        });
      }
      if (url.includes('/api/journal')) {
        return makeJsonResponse({
          entries: [
            { id: 'j-1', action: 'TASK_CREATION', operator: 'test-operator', timestamp: '2026-11-21T10:00:00Z', status: 'SUCCESS', details: {} },
          ],
        });
      }
      if (url.includes('/api/scheduler')) {
        return makeJsonResponse({ running: true, jobs: [] });
      }
      if (url.includes('/api/health')) {
        return makeJsonResponse({ status: 'healthy', uptime: 3600 });
      }
      if (url.includes('/api/calendar')) {
        return makeJsonResponse({ workingDays: [1, 2, 3, 4, 5], holidays: [], exceptions: [] });
      }
      if (url.includes('/api/logs/recent')) {
        return makeJsonResponse({ data: [] });
      }
      return makeJsonResponse({ success: true });
    });
  });

  it('renders AppShell with accessible landmarks and 3 consolidated workspaces', async () => {
    render(<AppShell />);

    // Accessible skip link
    const skipLink = screen.getByRole('link', { name: /skip to content/i });
    expect(skipLink).toBeDefined();
    expect(skipLink.getAttribute('href')).toBe('#main');

    // Navigation Landmark
    const nav = screen.getByRole('navigation', { name: /primary navigation/i });
    expect(nav).toBeDefined();

    // 3 Consolidated Workspace navigation groups in nav
    expect(within(nav).getByText(/daily workflow/i)).toBeDefined();
    expect(within(nav).getByText(/team & planning/i)).toBeDefined();
    expect(within(nav).getByText(/governance & ops/i)).toBeDefined();

    // Main Content Landmark
    const main = document.getElementById('main');
    expect(main).toBeDefined();
    expect(main?.getAttribute('tabindex')).toBe('-1');

    // Quick Action button safely links to planning review
    const quickRunBtn = screen.getByRole('button', { name: /review plan/i });
    expect(quickRunBtn).toBeDefined();
    expect(quickRunBtn.id).toBe('quickRunBtn');
  });

  it('switches between the three core workspaces dynamically', async () => {
    render(<AppShell />);

    // Click Planning workspace
    const planBtn = screen.getByRole('button', { name: /plan & review/i });
    fireEvent.click(planBtn);

    await waitFor(() => {
      expect(screen.getByText(/sprint planning & immutable execution protocol/i)).toBeDefined();
    });

    // Click Governance workspace
    const govBtn = screen.getByRole('button', { name: /audit log/i });
    fireEvent.click(govBtn);

    await waitFor(() => {
      expect(screen.getByText(/audit log explorer & attribution/i)).toBeDefined();
    });
  });

  it('verifies WCAG 2.1 AA Button touch target and state across all size variants', () => {
    // sm button (verified >= 44x44px for WCAG 2.1 AA mobile touch target)
    const { rerender } = render(<Button size="sm">Small Touch Button</Button>);
    const smBtn = screen.getByRole('button', { name: /small touch button/i });
    expect(smBtn.classList.contains('min-h-[44px]')).toBe(true);
    expect(smBtn.classList.contains('min-w-[44px]')).toBe(true);

    // md button
    rerender(<Button size="md">Medium Touch Button</Button>);
    const mdBtn = screen.getByRole('button', { name: /medium touch button/i });
    expect(mdBtn.classList.contains('min-h-[44px]')).toBe(true);
    expect(mdBtn.classList.contains('min-w-[44px]')).toBe(true);

    // lg button
    rerender(<Button size="lg">Large Touch Button</Button>);
    const lgBtn = screen.getByRole('button', { name: /large touch button/i });
    expect(lgBtn.classList.contains('min-h-[48px]')).toBe(true);
    expect(lgBtn.classList.contains('min-w-[48px]')).toBe(true);
  });

  it('verifies Toast dismiss and DailyWorkflow SSE log control buttons meet 44x44px touch targets', async () => {
    const dismissSpy = vi.fn();
    const { unmount, container } = render(
      <Toast toasts={[{ id: 't1', type: 'info', message: 'Test Notification' }]} onDismiss={dismissSpy} />
    );
    const dismissBtn = screen.getByRole('button', { name: /dismiss notification/i });
    expect(dismissBtn.classList.contains('min-w-[44px]')).toBe(true);
    expect(dismissBtn.classList.contains('min-h-[44px]')).toBe(true);

    const toastStack = container.querySelector('#viewStatus');
    expect(toastStack).not.toBeNull();
    expect(toastStack?.classList.contains('items-end')).toBe(true);
    expect(toastStack?.classList.contains('w-full')).toBe(false);
    expect(toastStack?.classList.contains('max-w-[calc(100vw-40px)]')).toBe(true);

    unmount();

    render(<DailyWorkflowWorkspace subView="mywork" isViewer={false} onNotify={vi.fn()} />);
    await waitFor(() => {
      expect(screen.getByText(/live sse activity stream/i)).toBeDefined();
    });

    const pauseBtn = screen.getByRole('button', { name: /pause/i });
    const clearBtn = screen.getByRole('button', { name: /clear/i });
    expect(pauseBtn.classList.contains('min-h-[44px]')).toBe(true);
    expect(pauseBtn.classList.contains('min-w-[44px]')).toBe(true);
    expect(clearBtn.classList.contains('min-h-[44px]')).toBe(true);
    expect(clearBtn.classList.contains('min-w-[44px]')).toBe(true);
  });

  it('verifies Modal accessibility: dialog role, focus trapping, and escape key', () => {
    const handleClose = vi.fn();
    const { unmount } = render(
      <Modal isOpen={true} onClose={handleClose} title="Accessible Test Modal">
        <p>Modal Body Content</p>
        <button type="button">Inside Button</button>
      </Modal>
    );

    const dialog = screen.getByRole('dialog');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(dialog.getAttribute('aria-labelledby')).toBe('modal-title');
    expect(screen.getByText('Accessible Test Modal')).toBeDefined();

    // Test Escape key dismissal
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(handleClose).toHaveBeenCalled();

    unmount();
  });

  it('verifies focus trapping algorithm within modal dialog', () => {
    const container = document.createElement('div');
    const btn1 = document.createElement('button');
    const btn2 = document.createElement('button');
    container.appendChild(btn1);
    container.appendChild(btn2);
    document.body.appendChild(container);

    btn1.focus();
    expect(document.activeElement).toBe(btn1);

    // Shift+Tab from first element wraps to last
    const shiftTabEvent = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true });
    const preventDefaultSpy = vi.spyOn(shiftTabEvent, 'preventDefault');
    trapModalFocus(shiftTabEvent, container);
    expect(document.activeElement).toBe(btn2);
    expect(preventDefaultSpy).toHaveBeenCalled();

    // Tab from last element wraps to first
    btn2.focus();
    const tabEvent = new KeyboardEvent('keydown', { key: 'Tab', shiftKey: false });
    const preventDefaultSpy2 = vi.spyOn(tabEvent, 'preventDefault');
    trapModalFocus(tabEvent, container);
    expect(document.activeElement).toBe(btn1);
    expect(preventDefaultSpy2).toHaveBeenCalled();

    document.body.removeChild(container);
  });

  it('renders responsive mobile card accordion with expand/collapse controls in TeamPlanningWorkspace', async () => {
    const notifySpy = vi.fn();
    render(<TeamPlanningWorkspace subView="planner" isViewer={false} onNotify={notifySpy} />);

    await waitFor(() => {
      expect(screen.getAllByText('Alex Developer').length).toBeGreaterThan(0);
    });

    // Verify "ON LEAVE" badge for zero-capacity member
    expect(screen.getAllByText('ON LEAVE').length).toBeGreaterThan(0);

    // Verify accordion header has aria-expanded attribute
    const accordionHeader = screen.getByRole('button', { name: /alex developer/i });
    expect(accordionHeader.getAttribute('aria-expanded')).toBe('false');

    // Click to expand accordion item
    fireEvent.click(accordionHeader);
    expect(accordionHeader.getAttribute('aria-expanded')).toBe('true');

    // Click again to collapse accordion item
    fireEvent.click(accordionHeader);
    expect(accordionHeader.getAttribute('aria-expanded')).toBe('false');
  });

  it('verifies mobile accordion member checkbox toggle does not bubble to accordion toggle', async () => {
    const notifySpy = vi.fn();
    render(<TeamPlanningWorkspace subView="planner" isViewer={false} onNotify={notifySpy} />);

    await waitFor(() => {
      expect(screen.getAllByText('Alex Developer').length).toBeGreaterThan(0);
    });

    const accordionBtn = screen.getByRole('button', { name: /alex developer/i });
    expect(accordionBtn.getAttribute('aria-expanded')).toBe('false');

    // Get the mobile checkbox for Alex (index 0: desktop table, index 1: mobile card)
    const checkboxes = screen.getAllByRole('checkbox', { name: /select alex developer for planning/i });
    expect(checkboxes.length).toBe(2);
    const mobileCheckbox = checkboxes[1];

    // Verify touch target wrapper for mobile checkbox meets WCAG 2.1 AA >= 44x44px
    const checkboxWrapper = mobileCheckbox.closest('label');
    expect(checkboxWrapper).not.toBeNull();
    expect(checkboxWrapper?.className).toContain('min-w-[44px]');
    expect(checkboxWrapper?.className).toContain('min-h-[44px]');

    // Initial state: member is selected by default (selectAll = true)
    expect((mobileCheckbox as HTMLInputElement).checked).toBe(true);
    expect(accordionBtn.getAttribute('aria-expanded')).toBe('false');

    // Click checkbox to deselect member
    fireEvent.click(mobileCheckbox);

    // Accordion must REMAIN collapsed (aria-expanded is still 'false')
    expect(accordionBtn.getAttribute('aria-expanded')).toBe('false');
    expect((mobileCheckbox as HTMLInputElement).checked).toBe(false);

    // Now click accordion header button directly to expand
    fireEvent.click(accordionBtn);
    expect(accordionBtn.getAttribute('aria-expanded')).toBe('true');

    // Click checkbox again to re-select member
    fireEvent.click(mobileCheckbox);

    // Accordion must REMAIN expanded (aria-expanded is still 'true')
    expect(accordionBtn.getAttribute('aria-expanded')).toBe('true');
    expect((mobileCheckbox as HTMLInputElement).checked).toBe(true);

    // Verify Expand All and Collapse All buttons have min-w-[44px] min-h-[44px]
    const expandAllBtn = screen.getByRole('button', { name: /expand all/i });
    const collapseAllBtn = screen.getByRole('button', { name: /collapse all/i });
    expect(expandAllBtn.className).toContain('min-h-[44px]');
    expect(expandAllBtn.className).toContain('min-w-[44px]');
    expect(collapseAllBtn.className).toContain('min-h-[44px]');
    expect(collapseAllBtn.className).toContain('min-w-[44px]');
  });

  it('verifies viewer mode disables mutating action buttons in DailyWorkflowWorkspace', async () => {
    const notifySpy = vi.fn();
    render(<DailyWorkflowWorkspace subView="mywork" isViewer={true} onNotify={notifySpy} />);

    await waitFor(() => {
      expect(screen.getByText(/1-click action bar/i)).toBeDefined();
    });

    const activateBtn = screen.getByRole('button', { name: /morning activation/i });
    expect(activateBtn.hasAttribute('disabled')).toBe(true);

    const adhocBtn = screen.getByRole('button', { name: /\+ ad-hoc task/i });
    expect(adhocBtn.hasAttribute('disabled')).toBe(true);
  });

  it('keeps EOD execution disabled when preview has only required-evidence blockers', async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockImplementation((url: string, init?: RequestInit) => {
      if (url.includes('/api/tasks/close-today') && init?.method === 'POST') {
        return Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: async () => ({
            success: true,
            data: {
              totalClosed: 0,
              totalNeedsReview: 1,
              totalFailed: 0,
              results: [{ status: 'needs_review', error: 'REQUIRED_EVIDENCE_MISSING: Actual Start date' }],
            },
          }),
        });
      }
      return (originalFetch as typeof fetch)(url, init);
    }) as typeof fetch;

    render(<DailyWorkflowWorkspace subView="mywork" isViewer={false} onNotify={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: /eod closure review/i }));

    await waitFor(() => {
      expect(screen.getByText(/no closure-ready tasks/i)).toBeDefined();
    });
    expect(screen.getByRole('button', { name: /execute eod closure/i }).hasAttribute('disabled')).toBe(true);
  });

  it('verifies safe rendering of PR deliverable links with target="_blank"', async () => {
    const notifySpy = vi.fn();
    render(<DailyWorkflowWorkspace subView="mywork" isViewer={false} onNotify={notifySpy} />);

    await waitFor(() => {
      const prLink = screen.getByRole('link', { name: /feature pr/i });
      expect(prLink).toBeDefined();
      expect(prLink.getAttribute('target')).toBe('_blank');
      expect(prLink.getAttribute('rel')).toBe('noopener noreferrer');
      expect(prLink.getAttribute('href')).toBe('https://github.com/org/repo/pull/42');
    });
  });

  it('verifies GovernanceWorkspace scheduler daemon controls and journal filtering', async () => {
    const notifySpy = vi.fn();
    render(
      <GovernanceWorkspace
        subView="journal"
        session={{ authenticated: true, user: 'admin', role: 'admin', viewerMode: false }}
        isViewer={false}
        onNotify={notifySpy}
      />
    );

    await waitFor(() => {
      expect(screen.getByText(/scheduler daemon controls/i)).toBeDefined();
      expect(screen.getByText(/TASK_CREATION/i)).toBeDefined();
    });

    // Run Now button present
    const runNowBtn = screen.getByRole('button', { name: /run now/i });
    expect(runNowBtn.id).toBe('schedRunNowBtn');
  });
});
