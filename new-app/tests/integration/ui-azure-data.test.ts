import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const base = new URL('../../src/presentation/web/public/', import.meta.url);
const html = readFileSync(new URL('index.html', base), 'utf8');
const js = readFileSync(new URL('app.js', base), 'utf8');
const css = readFileSync(new URL('styles.css', base), 'utf8');

describe('vanilla ui azure data integration contracts', () => {
  it('exposes azure devops intelligence kpi cards and previews in dashboard view', () => {
    expect(html).toContain('id="dashboardAzureDataCard"');
    expect(html).toContain('id="kpiAdoBuilds"');
    expect(html).toContain('id="kpiAdoPipelines"');
    expect(html).toContain('id="kpiAdoReleases"');
    expect(html).toContain('id="kpiAdoTestRuns"');
    expect(html).toContain('id="kpiAdoTeams"');
    expect(html).toContain('id="refreshAzureDataBtn"');
    expect(html).toContain('id="dashboardBuildHealthSummary"');
    expect(html).toContain('id="dashboardTeamsSummary"');
  });

  it('preserves strict DOM layout ordering within view-dashboard', () => {
    const dashboardMatch = html.match(/<section\b[^>]*id="view-dashboard"[^>]*>([\s\S]*?)<\/section>/);
    expect(dashboardMatch).not.toBeNull();
    const dashboardHtml = dashboardMatch![1];

    const elements = [
      'kpiConn',
      'insightsContainer',
      'dashboardPlan',
      'effortTrendChart',
      'dashboardPrTrackingCard',
      'dashboardAzureDataCard',
    ];

    const positions = elements.map((id) => dashboardHtml.indexOf(`id="${id}"`));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it('exposes dedicated navigation items and views for builds and teams', () => {
    expect(html).toContain('data-view="builds"');
    expect(html).toContain('id="view-builds"');
    expect(html).toContain('id="buildProjectFilter"');
    expect(html).toContain('id="buildLimitFilter"');
    expect(html).toContain('id="buildHealthTableContainer"');
    expect(html).toContain('id="pipelineRunsContainer"');
    expect(html).toContain('id="testHealthContainer"');

    expect(html).toContain('data-view="teams"');
    expect(html).toContain('id="view-teams"');
    expect(html).toContain('id="teamSearchInput"');
    expect(html).toContain('id="teamProjectFilter"');
    expect(html).toContain('id="teamCountBadge"');
    expect(html).toContain('id="teamsGridContainer"');
  });

  it('registers builds and teams in VIEW_META and VIEW_GROUPS', () => {
    expect(js).toContain("builds: ['Build & Pipeline Health'");
    expect(js).toContain("teams: ['Enterprise POD Explorer'");
    expect(js).toContain("builds: 'Explore work'");
    expect(js).toContain("teams: 'Manage'");
  });

  it('handles responseData unwrapping in api.get for top-level envelopes', () => {
    expect(js).toContain('const responseData = json.data !== undefined ? json.data : json;');
  });

  it('defines style rules for team-card, team-leads-grid, and team-modules', () => {
    expect(css).toContain('.team-card');
    expect(css).toContain('.team-leads-grid');
    expect(css).toContain('.team-modules');
  });

  it('gracefully executes azure controllers in node:vm sandbox', async () => {
    const context: Record<string, unknown> = {
      window: {
        addEventListener: () => {},
        confirm: () => true,
      },
      document: {
        querySelector: () => ({
          textContent: '',
          innerHTML: '',
          classList: { add: () => {}, remove: () => {}, toggle: () => false },
          setAttribute: () => {},
          addEventListener: () => {},
        }),
        querySelectorAll: () => [],
        createElement: (tag: string) => ({
          tagName: tag.toUpperCase(),
          style: {},
          classList: { add: () => {}, remove: () => {} },
          setAttribute: () => {},
          append: () => {},
          addEventListener: () => {},
        }),
        createTextNode: (t: string) => ({ nodeValue: t }),
        addEventListener: () => {},
      },
      location: { hash: '#dashboard' },
      localStorage: { getItem: () => null, setItem: () => {} },
      fetch: async () => ({
        ok: true,
        json: async () => ({
          success: true,
          projects: [
            {
              projectId: 'p1',
              name: 'Project 1',
              builds: 57000,
              pipelines: 215,
              releases: 9000,
              testRuns: 2000,
            },
          ],
        }),
      }),
      console: { log: () => {}, warn: () => {}, error: () => {} },
      setTimeout: (fn: () => void) => setTimeout(fn, 0),
      clearTimeout: (id: NodeJS.Timeout) => clearTimeout(id),
      setInterval: () => {},
      clearInterval: () => {},
      AbortController: globalThis.AbortController,
      DOMException: globalThis.DOMException,
      URLSearchParams: globalThis.URLSearchParams,
    };

    expect(() => {
      runInNewContext(
        `
        ${js}
        if (typeof refreshAzureDashboard === 'function') {
          refreshAzureDashboard();
        }
      `,
        context
      );
    }).not.toThrow();
  });
});
