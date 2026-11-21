import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { AppServer } from '../../src/presentation/api/server.js';
import { ApiDependencies } from '../../src/presentation/api/routes.js';
import {
  AutoClosureConfigRepository,
  AutoClosureAuditLogRepository,
  AutoClosureAuditFilter,
  AutoClosureConfig,
  AutoClosureAuditLog,
  AutoClosureValidationResult,
} from '../../src/domain/ports/repositories.js';

class FakeAutoClosureConfigRepo implements AutoClosureConfigRepository {
  public config: AutoClosureConfig = {
    enabled: true,
    version: 1,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    createdBy: 'admin',
    lastModifiedBy: 'admin',
    rules: [
      {
        ruleId: 'rule-1',
        type: 'inclusion',
        filterType: 'users',
        filters: [{ id: 'alex.dev@example.com', name: 'Alex Dev' }],
        description: 'Include Alex in auto-closure',
        createdAt: '2026-10-01T00:00:00.000Z',
        updatedAt: '2026-10-01T00:00:00.000Z',
        createdBy: 'admin',
      },
    ],
    retentionDays: 90,
  };

  async load(): Promise<AutoClosureConfig> {
    return { ...this.config };
  }

  async save(config: AutoClosureConfig): Promise<void> {
    this.config = { ...config };
  }

  async validate(config: AutoClosureConfig): Promise<AutoClosureValidationResult> {
    if (!config || !Array.isArray(config.rules)) {
      return { isValid: false, errors: ['rules must be an array'], warnings: [] };
    }
    if (config.enabled && config.rules.length === 0) {
      return { isValid: false, errors: ['Auto-closure is enabled but no rules are defined'], warnings: [] };
    }
    return { isValid: true, errors: [], warnings: [] };
  }

  async getVersion(): Promise<number> {
    return this.config.version;
  }
}

class FakeAutoClosureAuditRepo implements AutoClosureAuditLogRepository {
  public entries: AutoClosureAuditLog[] = [
    {
      id: 'audit-1',
      taskId: 1001,
      assignedUser: 'alex.dev@example.com',
      closedAt: '2026-10-14T18:15:00.000Z',
      status: 'success',
      triggerSource: 'scheduled',
      closureReason: 'All daily deliverables verified',
      automationDetails: {
        ruleId: 'rule-1',
        ruleName: 'Include Alex in auto-closure',
        matchedFilterType: 'users',
        matchedFilters: ['alex.dev@example.com'],
      },
      configurationVersion: 1,
      validationResults: {
        passed: true,
        reason: 'Verified',
        warnings: [],
      },
    },
  ];

  async record(entry: AutoClosureAuditLog): Promise<void> {
    this.entries.push(entry);
  }

  async getEntries(limit?: number, filters?: AutoClosureAuditFilter): Promise<AutoClosureAuditLog[]> {
    let result = [...this.entries];
    if (filters?.taskId) {
      result = result.filter(e => e.taskId === filters.taskId);
    }
    if (filters?.userId) {
      result = result.filter(e => e.assignedUser === filters.userId);
    }
    if (limit && limit > 0) {
      result = result.slice(0, limit);
    }
    return result;
  }

  async getEntriesByTask(taskId: number): Promise<AutoClosureAuditLog[]> {
    return this.entries.filter(e => e.taskId === taskId);
  }

  async getEntriesByUser(userId: string, limit?: number): Promise<AutoClosureAuditLog[]> {
    const list = this.entries.filter(e => e.assignedUser === userId);
    return limit && limit > 0 ? list.slice(0, limit) : list;
  }

  async exportCsv(): Promise<string> {
    return 'id,taskId,assignedUser,closedAt\naudit-1,1001,alex.dev@example.com,2026-10-14T18:15:00.000Z\n';
  }

  async exportJson(): Promise<string> {
    return JSON.stringify(this.entries);
  }

  async cleanup(beforeDate: string): Promise<number> {
    const initialCount = this.entries.length;
    this.entries = this.entries.filter(e => e.closedAt >= beforeDate);
    return initialCount - this.entries.length;
  }
}

function makeDeps(overrides?: Partial<ApiDependencies>): ApiDependencies {
  return {
    getStatus: { execute: vi.fn(async () => ({ connected: true, organization: 'Org', project: 'Proj' })) } as any,
    planTasks: { execute: vi.fn(async () => ({ todayIso: '2026-10-14', nextThursdayIso: '2026-10-15', personPlans: [] })) } as any,
    exploreTasks: { execute: vi.fn(async () => ({ users: [], dates: [], matrix: [], detailedTasks: [] })) } as any,
    createTasks: { execute: vi.fn(), executeAdHocTask: vi.fn() } as any,
    config: { getConfig: vi.fn(async () => ({ organization: 'Org', project: 'Proj' })), savePeople: vi.fn(), saveSettings: vi.fn(), savePat: vi.fn() } as any,
    journal: { record: vi.fn(), getEntries: vi.fn(async () => []), getUnfinishedRelations: vi.fn(async () => []), markRepaired: vi.fn(async () => true), exportCsv: vi.fn(async () => ''), exportJson: vi.fn(async () => '[]') } as any,
    scheduler: { getStatus: vi.fn(() => ({ running: false })), start: vi.fn(), stop: vi.fn(), setSchedule: vi.fn(), configure: vi.fn(), triggerRunNow: vi.fn(), triggerAutoCloseNow: vi.fn() } as any,
    autoClosureConfigRepo: new FakeAutoClosureConfigRepo(),
    autoClosureAuditRepo: new FakeAutoClosureAuditRepo(),
    adminUsers: ['admin', 'lead@example.com'],
    ...overrides,
  };
}

describe('Auto-Closure API Routes Integration Tests', () => {
  let server: AppServer;
  let baseUrl: string;
  let configRepo: FakeAutoClosureConfigRepo;
  let auditRepo: FakeAutoClosureAuditRepo;

  beforeAll(async () => {
    configRepo = new FakeAutoClosureConfigRepo();
    auditRepo = new FakeAutoClosureAuditRepo();
    const deps = makeDeps({
      autoClosureConfigRepo: configRepo,
      autoClosureAuditRepo: auditRepo,
      adminUsers: ['admin', 'lead@example.com'],
    });

    server = new AppServer(deps, 0);
    const port = await server.start();
    baseUrl = `http://127.0.0.1:${port}`;
  });

  afterAll(async () => {
    await server.stop();
  });

  it('GET /api/auto-closure/config returns current configuration', async () => {
    const res = await fetch(`${baseUrl}/api/auto-closure/config`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.success).toBe(true);
    expect(body.data.enabled).toBe(true);
    expect(body.data.rules).toHaveLength(1);
    expect(body.data.rules[0].ruleId).toBe('rule-1');
  });

  it('PUT /api/auto-closure/config successfully updates configuration', async () => {
    const newConfig: AutoClosureConfig = {
      enabled: false,
      version: 2,
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-14T00:00:00.000Z',
      createdBy: 'admin',
      lastModifiedBy: 'admin',
      rules: [],
      retentionDays: 60,
    };

    const res = await fetch(`${baseUrl}/api/auto-closure/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newConfig),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.success).toBe(true);
    expect(body.data.enabled).toBe(false);
    expect(body.data.retentionDays).toBe(60);
    expect(configRepo.config.enabled).toBe(false);
  });

  it('PUT /api/auto-closure/config rejects empty object {} with 400', async () => {
    const res = await fetch(`${baseUrl}/api/auto-closure/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.success).toBe(false);
    expect(body.error).toBe('Configuration must be a valid object with rules array');
  });

  it('PUT /api/auto-closure/config rejects non-array or array bodies with 400', async () => {
    // Array body
    const resArr = await fetch(`${baseUrl}/api/auto-closure/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify([]),
    });
    expect(resArr.status).toBe(400);
    const bodyArr = (await resArr.json()) as any;
    expect(bodyArr.success).toBe(false);
    expect(bodyArr.error).toBe('Configuration must be a valid object with rules array');

    // Object with missing rules
    const resNoRules = await fetch(`${baseUrl}/api/auto-closure/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ invalid: 'data' }),
    });
    expect(resNoRules.status).toBe(400);
    const bodyNoRules = (await resNoRules.json()) as any;
    expect(bodyNoRules.success).toBe(false);
    expect(bodyNoRules.error).toBe('Configuration must be a valid object with rules array');

    // Object with non-array rules
    const resRulesStr = await fetch(`${baseUrl}/api/auto-closure/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rules: 'not-an-array' }),
    });
    expect(resRulesStr.status).toBe(400);
    const bodyRulesStr = (await resRulesStr.json()) as any;
    expect(bodyRulesStr.success).toBe(false);
    expect(bodyRulesStr.error).toBe('Configuration must be a valid object with rules array');
  });

  it('PUT /api/auto-closure/config rejects invalid config logic when rules array fails validation', async () => {
    const res = await fetch(`${baseUrl}/api/auto-closure/config`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true, rules: [] }),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.success).toBe(false);
    expect(body.error).toContain('Configuration validation failed');
  });

  it('GET /api/auto-closure/audit returns audit records and count', async () => {
    const res = await fetch(`${baseUrl}/api/auto-closure/audit`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.success).toBe(true);
    expect(body.count).toBe(1);
    expect(body.data[0].taskId).toBe(1001);
    expect(body.data[0].assignedUser).toBe('alex.dev@example.com');
  });

  it('GET /api/auto-closure/audit supports filtering by taskId', async () => {
    const res = await fetch(`${baseUrl}/api/auto-closure/audit?taskId=1001`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.success).toBe(true);
    expect(body.count).toBe(1);

    const emptyRes = await fetch(`${baseUrl}/api/auto-closure/audit?taskId=9999`);
    const emptyBody = (await emptyRes.json()) as any;
    expect(emptyBody.count).toBe(0);
  });

  it('GET /api/auto-closure/audit/export/csv exports CSV format', async () => {
    const res = await fetch(`${baseUrl}/api/auto-closure/audit/export/csv`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/csv');
    const text = await res.text();
    expect(text).toContain('id,taskId,assignedUser,closedAt');
    expect(text).toContain('audit-1,1001,alex.dev@example.com');
  });

  it('GET /api/auto-closure/audit/export/json exports JSON format', async () => {
    const res = await fetch(`${baseUrl}/api/auto-closure/audit/export/json`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    const data = (await res.json()) as any;
    expect(Array.isArray(data)).toBe(true);
    expect(data[0].id).toBe('audit-1');
  });

  it('DELETE /api/auto-closure/audit requires beforeDate parameter', async () => {
    const res = await fetch(`${baseUrl}/api/auto-closure/audit`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.success).toBe(false);
    expect(body.error).toContain('beforeDate must be provided');
  });

  it('DELETE /api/auto-closure/audit cleans up records older than beforeDate', async () => {
    const res = await fetch(`${baseUrl}/api/auto-closure/audit`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ beforeDate: '2026-10-15T00:00:00.000Z' }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.success).toBe(true);
    expect(body.data.deleted).toBe(1);
  });

  it('serves local Chart.js vendor asset', async () => {
    const res = await fetch(`${baseUrl}/vendor/chart.umd.js`);
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).toContain('Chart');
  });

  it('returns 503 when repositories are not provided', async () => {
    const emptyDeps = makeDeps({
      autoClosureConfigRepo: undefined,
      autoClosureAuditRepo: undefined,
    });
    const srv = new AppServer(emptyDeps, 0);
    const port = await srv.start();
    try {
      const configRes = await fetch(`http://127.0.0.1:${port}/api/auto-closure/config`);
      expect(configRes.status).toBe(503);
      const configBody = (await configRes.json()) as any;
      expect(configBody.error).toContain('not available');

      const auditRes = await fetch(`http://127.0.0.1:${port}/api/auto-closure/audit`);
      expect(auditRes.status).toBe(503);
      const auditBody = (await auditRes.json()) as any;
      expect(auditBody.error).toContain('not available');
    } finally {
      await srv.stop();
    }
  });
});
