import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { AppServer } from '../../../src/presentation/api/server.js';
import { ApiDependencies } from '../../../src/presentation/api/routes.js';
import { IAzureDataRepository } from '../../../src/domain/ports/azure-data-repository.js';

function createMockAzureRepo(): IAzureDataRepository {
  return {
    isAvailable: vi.fn(() => true),
    getProjectOverview: vi.fn(async () => [
      {
        projectId: 'mounted-p1',
        name: 'Mounted Project',
        workItems: 12,
        repositories: 3,
        pullRequests: 4,
        pipelines: 15,
        builds: 60,
        releases: 10,
        testRuns: 25,
        syncedAt: '2026-11-22T00:00:00Z',
      },
    ]),
    getBuildHealth: vi.fn(async () => []),
    getTestHealth: vi.fn(async () => []),
    getTeams: vi.fn(async () => []),
    getRecentReleases: vi.fn(async () => []),
    getRecentPipelineRuns: vi.fn(async () => []),
    getDataFreshness: vi.fn(async () => []),
    getExportStatus: vi.fn(async () => null),
  };
}

function makeMockDeps(): ApiDependencies {
  return {
    getStatus: { execute: vi.fn(async () => ({ connected: true, organization: 'Org', project: 'Proj' })) } as any,
    planTasks: { execute: vi.fn(async () => ({ todayIso: '2026-10-14', nextThursdayIso: '2026-10-15', personPlans: [] })) } as any,
    exploreTasks: { execute: vi.fn(async () => ({ users: [], dates: [], matrix: [], detailedTasks: [] })) } as any,
    createTasks: { execute: vi.fn(), executeAdHocTask: vi.fn() } as any,
    config: { getConfig: vi.fn(async () => ({ organization: 'Org', project: 'Proj' })), savePeople: vi.fn(), saveSettings: vi.fn(), savePat: vi.fn() } as any,
    journal: { record: vi.fn(), getEntries: vi.fn(async () => []), getUnfinishedRelations: vi.fn(async () => []), markRepaired: vi.fn(async () => true), exportCsv: vi.fn(async () => ''), exportJson: vi.fn(async () => '[]') } as any,
    scheduler: { getStatus: vi.fn(() => ({ running: false })), start: vi.fn(), stop: vi.fn(), setSchedule: vi.fn(), configure: vi.fn(), triggerRunNow: vi.fn(), triggerAutoCloseNow: vi.fn() } as any,
  };
}

describe('AppServer Azure Data Route Mounting Unit Tests', () => {
  let server: AppServer;
  let baseUrl: string;
  let mockRepo: IAzureDataRepository;

  beforeAll(async () => {
    mockRepo = createMockAzureRepo();
    server = new AppServer(makeMockDeps(), 0, { azureDataRepo: mockRepo });
    const port = await server.start();
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await server.stop();
  });

  it('exposes /api/azure-data/overview on the live AppServer instance', async () => {
    const res = await fetch(`${baseUrl}/api/azure-data/overview`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.success).toBe(true);
    expect(body.projects).toHaveLength(1);
    expect(body.projects[0].name).toBe('Mounted Project');
  });

  it('returns 404 for unknown /api/unknown-endpoint with JSON error instead of HTML SPA', async () => {
    const res = await fetch(`${baseUrl}/api/non-existent-route`);
    expect(res.status).toBe(404);
    const body = (await res.json()) as any;
    expect(body.success).toBe(false);
    expect(body.error).toContain('not found');
  });

  it('provides getApp() method exposing the Express application', () => {
    const app = server.getApp();
    expect(app).toBeDefined();
    expect(typeof app.use).toBe('function');
  });
});
