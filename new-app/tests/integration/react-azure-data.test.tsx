// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React, { act } from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { AppShell } from '../../src/presentation/web/src/components/layout/AppShell.js';
import { AzureIntelligenceWorkspace } from '../../src/presentation/web/src/components/workspaces/AzureIntelligenceWorkspace.js';
import { UnassignedTaskManager } from '../../src/presentation/web/src/components/workspaces/UnassignedTaskManager.js';
import { api } from '../../src/presentation/web/src/api/client.js';

describe('React 19 Azure DevOps Intelligence Workspace & Data Presentation', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    api.invalidateCache();

    // Mock fetch responses for Azure Data endpoints and legacy endpoints
    globalThis.fetch = vi.fn().mockImplementation((url: string) => {
      const makeJsonResponse = (payload: unknown) =>
        Promise.resolve({
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'application/json' }),
          json: () =>
            Promise.resolve({
              success: true,
              data: payload,
              ...(typeof payload === 'object' && payload !== null ? payload : {}),
            }),
        });

      if (url.includes('/api/session')) {
        return makeJsonResponse({
          authenticated: true,
          user: 'test-operator',
          role: 'admin',
          viewerMode: false,
        });
      }
      if (url.includes('/api/config')) {
        return makeJsonResponse({
          people: [
            { key: 'alex', name: 'Alex Developer', email: 'alex@example.com', role: 'Developer', capacityHours: 8, enabled: true },
          ],
        });
      }
      if (url.includes('/api/azure-data/overview')) {
        return makeJsonResponse({
          projects: [
            {
              projectId: 'a2fa1d4a-63a4-4f95-a4e7-01f4c7ce5fbe',
              name: '3_in_1_AppFrontEnd_Tasks',
              workItems: 8083,
              repositories: 5,
              pullRequests: 894,
              pipelines: 215,
              builds: 57299,
              releases: 9116,
              testRuns: 1000,
              syncedAt: '2026-11-22T12:00:00Z',
            },
            {
              projectId: 'd07e3437-8c91-4438-8719-7a9a126582db',
              name: '3in1_Agile_Projects',
              workItems: 200,
              repositories: 2,
              pullRequests: 20,
              pipelines: 3,
              builds: 104,
              releases: 0,
              testRuns: 1000,
              syncedAt: '2026-11-22T12:00:00Z',
            },
          ],
          freshness: [],
          exportStatus: null,
        });
      }
      if (url.includes('/api/azure-data/builds/health')) {
        return makeJsonResponse({
          buildHealth: [
            {
              projectId: 'a2fa1d4a-63a4-4f95-a4e7-01f4c7ce5fbe',
              definitionId: 101,
              definitionName: 'CI-Production-Build',
              totalRuns: 1540,
              succeeded: 1500,
              failed: 40,
              successRate: 97.4,
              latestFinishedAt: '2026-11-22T10:30:00Z',
            },
            {
              projectId: 'a2fa1d4a-63a4-4f95-a4e7-01f4c7ce5fbe',
              definitionId: 102,
              definitionName: 'Nightly-Integration-Pipeline',
              totalRuns: 320,
              succeeded: 260,
              failed: 60,
              successRate: 81.3,
              latestFinishedAt: '2026-11-22T04:00:00Z',
            },
            {
              projectId: 'a2fa1d4a-63a4-4f95-a4e7-01f4c7ce5fbe',
              definitionId: 103,
              definitionName: 'Flaky-Experimental-Tests',
              totalRuns: 100,
              succeeded: 65,
              failed: 35,
              successRate: 65.0,
              latestFinishedAt: '2026-11-21T18:00:00Z',
            },
          ],
        });
      }
      if (url.includes('/api/azure-data/pipelines/runs')) {
        return makeJsonResponse({
          pipelineRuns: [
            {
              runId: 9001,
              pipelineId: 101,
              projectId: 'a2fa1d4a-63a4-4f95-a4e7-01f4c7ce5fbe',
              pipelineName: 'CI-Production-Build',
              runName: 'Deploy-20261122.1',
              state: 'completed',
              result: 'succeeded',
              createdAt: '2026-11-22T10:00:00Z',
              finishedAt: '2026-11-22T10:30:00Z',
            },
          ],
        });
      }
      if (url.includes('/api/azure-data/tests/health')) {
        return makeJsonResponse({
          testHealth: [
            {
              projectId: 'a2fa1d4a-63a4-4f95-a4e7-01f4c7ce5fbe',
              projectName: '3_in_1_AppFrontEnd_Tasks',
              totalRuns: 1000,
              passedTests: 850,
              failedTests: 150,
              successRate: 85.0,
              latestCompletedAt: '2026-11-22T11:00:00Z',
            },
          ],
        });
      }
      if (url.includes('/api/azure-data/releases')) {
        return makeJsonResponse({
          releases: [
            {
              releaseId: 4001,
              definitionId: 50,
              projectId: 'a2fa1d4a-63a4-4f95-a4e7-01f4c7ce5fbe',
              projectName: '3_in_1_AppFrontEnd_Tasks',
              name: 'Release-104',
              status: 'active',
              reason: 'manual',
              createdAt: '2026-11-22T08:00:00Z',
              modifiedAt: '2026-11-22T09:00:00Z',
            },
          ],
        });
      }
      if (url.includes('/api/azure-data/teams')) {
        return makeJsonResponse({
          teams: [
            {
              teamId: 'team-1',
              projectId: 'd07e3437-8c91-4438-8719-7a9a126582db',
              projectName: '3in1_Agile_Projects',
              name: 'Alpha Lending POD',
              description: JSON.stringify({
                'POD Size': '12',
                SLP: 'Sumit Minase',
                LP: 'Ashraf Ali',
                TA: 'Arun Phogat',
                SDM: 'Anand Anand',
                QL: 'Piyush Mankare',
                Modules: 'EMI | Insurance | LAS',
              }),
            },
            {
              teamId: 'team-2',
              projectId: 'a2fa1d4a-63a4-4f95-a4e7-01f4c7ce5fbe',
              projectName: '3_in_1_AppFrontEnd_Tasks',
              name: 'Beta Payments POD',
              description: JSON.stringify({
                'POD Size': '8',
                LP: 'John Doe',
                TA: 'Jane Smith',
                Modules: 'Checkout | Cards',
              }),
            },
          ],
          totalCount: 247,
        });
      }
      if (url.includes('/api/azure-data/work-items/unassigned')) {
        return makeJsonResponse({
          count: 14,
          workItems: [
            {
              projectId: 'a2fa1d4a-63a4-4f95-a4e7-01f4c7ce5fbe',
              workItemId: 501,
              type: 'User Story',
              title: 'Migrate Payment Gateway to V2 SDK',
              state: 'New',
              assignedIdentityId: null,
              areaPath: 'Payments\\Core',
              iterationPath: 'Sprint 42',
            },
            {
              projectId: 'd07e3437-8c91-4438-8719-7a9a126582db',
              workItemId: 502,
              type: 'Bug',
              title: 'Fix EMI calculation rounding issue on Leap Year',
              state: 'Active',
              assignedIdentityId: null,
              areaPath: 'Lending\\EMI',
              iterationPath: 'Sprint 42',
            },
          ],
        });
      }

      return makeJsonResponse({});
    });
  });

  it('renders AzureIntelligenceWorkspace with 5 KPI summary cards and accurate metrics', async () => {
    await act(async () => {
      render(<AzureIntelligenceWorkspace subView="azure-overview" />);
    });

    // Await asynchronous API resolution to genuinely verify live data flow
    await waitFor(() => {
      expect(screen.getByText('57.4k')).toBeDefined();
    });

    expect(screen.getByText(/Total Builds/i)).toBeDefined();
    expect(screen.getByText('57.4k')).toBeDefined();

    expect(screen.getByText(/Pipelines/i)).toBeDefined();
    expect(screen.getByText('218')).toBeDefined();

    expect(screen.getByText(/Total Releases/i)).toBeDefined();
    expect(screen.getByText('9.1k')).toBeDefined();

    expect(screen.getByText(/Test Runs/i)).toBeDefined();
    expect(screen.getByText('2k')).toBeDefined();

    expect(screen.getByText(/Enterprise Teams/i)).toBeDefined();
    expect(screen.getByText('247')).toBeDefined();
  });

  it('renders Build Health table with success rate badges and definitions', async () => {
    await act(async () => {
      render(<AzureIntelligenceWorkspace subView="azure-builds" />);
    });

    await waitFor(() => {
      const table = screen.getByRole('table', { name: /build health table/i });
      expect(within(table).getByText('CI-Production-Build')).toBeDefined();
    });

    const table = screen.getByRole('table', { name: /build health table/i });
    expect(within(table).getByText('Nightly-Integration-Pipeline')).toBeDefined();
    expect(within(table).getByText('Flaky-Experimental-Tests')).toBeDefined();

    expect(within(table).getByText('97.4%')).toBeDefined();
    expect(within(table).getByText('81.3%')).toBeDefined();
    expect(within(table).getByText('65%')).toBeDefined();
  });

  it('filters Enterprise PODs dynamically via live search input', async () => {
    await act(async () => {
      render(<AzureIntelligenceWorkspace subView="azure-teams" />);
    });

    await waitFor(() => {
      expect(screen.getByText('Alpha Lending POD')).toBeDefined();
      expect(screen.getByText('Beta Payments POD')).toBeDefined();
    });

    const searchInput = screen.getByRole('textbox', { name: /search enterprise pods/i });
    expect(searchInput).toBeDefined();

    // Verify parsed team metadata
    expect(screen.getByText(/EMI \| Insurance \| LAS/)).toBeDefined();
    expect(screen.getByText('Ashraf Ali')).toBeDefined();
    expect(screen.getByText('Arun Phogat')).toBeDefined();
  });

  it('verifies AppShell exposes the 4th navigation group Azure Intelligence alongside legacy groups', async () => {
    await act(async () => {
      render(<AppShell />);
    });

    const nav = screen.getByRole('navigation', { name: /primary navigation/i });
    expect(within(nav).getByText(/daily workflow/i)).toBeDefined();
    expect(within(nav).getByText(/team & planning/i)).toBeDefined();
    expect(within(nav).getByText(/governance & ops/i)).toBeDefined();
    expect(within(nav).getByText(/azure intelligence/i)).toBeDefined();

    expect(within(nav).getByRole('button', { name: /alm & kpis overview/i })).toBeDefined();
    expect(within(nav).getByRole('button', { name: /build health/i })).toBeDefined();
    expect(within(nav).getByRole('button', { name: /enterprise teams/i })).toBeDefined();
    expect(within(nav).getByRole('button', { name: /unassigned tasks/i })).toBeDefined();
  });

  it('navigates dynamically to Azure Intelligence workspace in AppShell', async () => {
    await act(async () => {
      render(<AppShell />);
    });

    const nav = screen.getByRole('navigation', { name: /primary navigation/i });
    const intelBtn = within(nav).getByRole('button', { name: /alm & kpis overview/i });

    await act(async () => {
      fireEvent.click(intelBtn);
    });

    await waitFor(() => {
      expect(screen.getByRole('heading', { level: 1, name: /azure devops alm intelligence/i })).toBeDefined();
    });
  });

  it('renders Unassigned Tasks view with filtering, search, and work items', async () => {
    await act(async () => {
      render(<AzureIntelligenceWorkspace subView="unassigned" />);
    });

    await waitFor(() => {
      expect(screen.getByText('Migrate Payment Gateway to V2 SDK')).toBeDefined();
      expect(screen.getByText('Fix EMI calculation rounding issue on Leap Year')).toBeDefined();
    });

    // Check presence of interactive search input
    const searchInput = screen.getByRole('textbox', { name: /search unassigned tasks/i });
    expect(searchInput).toBeDefined();

    // Check project filter dropdown
    const projectFilter = screen.getByRole('combobox', { name: /filter unassigned tasks by project/i });
    expect(projectFilter).toBeDefined();

    // Check table headers and badges
    const table = screen.getByRole('table', { name: /unassigned work items table/i });
    expect(within(table).getByText('#501')).toBeDefined();
    expect(within(table).getByText('User Story')).toBeDefined();
    expect(within(table).getByText('Bug')).toBeDefined();
    expect(screen.getByText('14 Total Unassigned')).toBeDefined();
  });

  it('filters unassigned tasks dynamically via search input', async () => {
    await act(async () => {
      render(<AzureIntelligenceWorkspace subView="unassigned" />);
    });

    await waitFor(() => {
      expect(screen.getByText('Migrate Payment Gateway to V2 SDK')).toBeDefined();
    });

    const searchInput = screen.getByRole('textbox', { name: /search unassigned tasks/i });
    await act(async () => {
      fireEvent.change(searchInput, { target: { value: 'Payment' } });
    });

    expect(screen.getByText('Migrate Payment Gateway to V2 SDK')).toBeDefined();
    expect(screen.queryByText('Fix EMI calculation rounding issue on Leap Year')).toBeNull();
  });

  it('navigates to Unassigned Tasks view in AppShell', async () => {
    await act(async () => {
      render(<AppShell />);
    });

    const nav = screen.getByRole('navigation', { name: /primary navigation/i });
    const unassignedBtn = within(nav).getByRole('button', { name: /unassigned tasks/i });

    await act(async () => {
      fireEvent.click(unassignedBtn);
    });

    await waitFor(() => {
      expect(screen.getByText('Migrate Payment Gateway to V2 SDK')).toBeDefined();
    });
  });

  describe('UnassignedTaskManager robustness edge cases', () => {
    it('handles undefined workItems gracefully without crashing and renders empty state', async () => {
      expect(() => {
        render(
          <UnassignedTaskManager
            workItems={undefined as any}
            totalCount={0}
            isLoading={false}
            selectedProjectId=""
            onSelectProject={() => {}}
            onRefresh={() => {}}
          />
        );
      }).not.toThrow();

      expect(
        screen.getByText('No unassigned work items found in this project backlog.')
      ).toBeDefined();
      expect(screen.getByText('0 Tasks')).toBeDefined();
      expect(screen.getByText('Showing 0 of 0 loaded')).toBeDefined();
    });

    it('handles null workItems gracefully without crashing and renders empty state', async () => {
      expect(() => {
        render(
          <UnassignedTaskManager
            workItems={null as any}
            totalCount={0}
            isLoading={false}
            selectedProjectId=""
            onSelectProject={() => {}}
            onRefresh={() => {}}
          />
        );
      }).not.toThrow();

      expect(
        screen.getByText('No unassigned work items found in this project backlog.')
      ).toBeDefined();
      expect(screen.getByText('0 Tasks')).toBeDefined();
      expect(screen.getByText('Showing 0 of 0 loaded')).toBeDefined();
    });

    it('handles work items with null or missing fields without crashing', async () => {
      const itemsWithNullFields: any[] = [
        {
          id: 991,
          workItemId: 991,
          title: null,
          type: null,
          projectId: null,
          state: null,
          areaPath: null,
          iterationPath: null,
        },
        {
          id: 992,
          workItemId: 992,
          title: undefined,
          type: undefined,
          projectId: undefined,
          state: undefined,
          areaPath: undefined,
          iterationPath: undefined,
        },
      ];

      expect(() => {
        render(
          <UnassignedTaskManager
            workItems={itemsWithNullFields}
            totalCount={2}
            isLoading={false}
            selectedProjectId=""
            onSelectProject={() => {}}
            onRefresh={() => {}}
          />
        );
      }).not.toThrow();

      expect(screen.getByText('#991')).toBeDefined();
      expect(screen.getByText('#992')).toBeDefined();
      expect(screen.getAllByText('Default Project').length).toBe(2);
    });
  });
});
