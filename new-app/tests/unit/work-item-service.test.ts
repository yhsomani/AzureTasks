import { describe, it, expect } from 'vitest';
import { AzureWorkItemService } from '../../src/infrastructure/azure/work-item-service';
import { addDays, formatTitleDate } from '../../src/domain/value-objects/date-window';

/** Minimal Azure client fake: echoes the batch items regardless of the query. */
class FakeClient {
  public wiql = '';
  constructor(private readonly items: Array<{ id: number; title: string }>) {}

  async post<T>(_url: string, body: { query: string }): Promise<T> {
    this.wiql = body.query;
    return { workItems: this.items.map(i => ({ id: i.id })) } as T;
  }

  async get<T>(_url: string): Promise<T> {
    return {
      value: this.items.map(i => ({ id: i.id, rev: 1, fields: { 'System.Title': i.title, 'System.AssignedTo': 'a@b.com' } })),
      count: this.items.length,
    } as T;
  }
}

describe('AzureWorkItemService.getExistingTasksForPerson', () => {
  const prefix = '3in1_PWA_MyAccount |';
  const year = new Date().getFullYear();
  const date = `${year}-06-10`;
  const title = `${prefix} ${formatTitleDate(date)}`;

  it('counts multiple tasks sharing the same title date', async () => {
    const client = new FakeClient([
      { id: 1, title },
      { id: 2, title },
    ]);
    const svc = new AzureWorkItemService(client as any);
    const map = await svc.getExistingTasksForPerson('P', 'Task', prefix, 'a@b.com', date, date);

    expect(map.get(date)?.count).toBe(2);
    expect(map.get(date)?.id).toBe(1);
  });

  it('scopes the query to the team project and work item type', async () => {
    const client = new FakeClient([]);
    const svc = new AzureWorkItemService(client as any);
    const end = addDays(date, 3);
    await svc.getExistingTasksForPerson('P', 'Task', prefix, 'a@b.com', date, end);

    expect(client.wiql).toContain("[System.TeamProject] = 'P'");
    expect(client.wiql).toContain("[System.WorkItemType] = 'Task'");
  });
});

describe('AzureWorkItemService.createWorkItemWithReconciliation', () => {
  it('passes application/json-patch+json content type to client.post', async () => {
    let capturedOptions: any = null;
    let capturedPath = '';
    const fakeClient = {
      baseUrl: 'https://dev.azure.com',
      organization: 'test-org',
      async post<T>(path: string, _body: any, options?: any): Promise<T> {
        capturedPath = path;
        capturedOptions = options;
        return {
          id: 1234,
          fields: {
            'System.Title': 'Task Title',
            'Microsoft.VSTS.Scheduling.StartDate': '2026-10-19T00:00:00Z',
          },
        } as T;
      },
    };

    const svc = new AzureWorkItemService(fakeClient as any);
    const result = await svc.createWorkItemWithReconciliation(
      'TestProject',
      'Task',
      [{ op: 'add', path: '/fields/System.Title', value: 'Task Title' }],
      { title: 'Task Title', assignedTo: 'user@test.com' }
    );

    expect(result.id).toBe(1234);
    expect(capturedPath).toContain('/TestProject/_apis/wit/workitems/$Task');
    expect(capturedOptions?.headers?.['Content-Type']).toBe('application/json-patch+json');
  });
});

describe('AzureWorkItemService.copyRelations', () => {
  it('passes application/json-patch+json content type to client.patch', async () => {
    let capturedOptions: any = null;
    let capturedPath = '';
    const fakeClient = {
      baseUrl: 'https://dev.azure.com',
      organization: 'test-org',
      async patch<T>(path: string, _body: any, options?: any): Promise<T> {
        capturedPath = path;
        capturedOptions = options;
        return { id: 5678 } as T;
      },
    };

    const svc = new AzureWorkItemService(fakeClient as any);
    const sourceWorkItem = {
      id: 111,
      rev: 1,
      fields: {},
      relations: [
        {
          rel: 'System.LinkTypes.Hierarchy-Reverse',
          url: 'https://dev.azure.com/test-org/TestProject/_apis/wit/workitems/99',
          attributes: { isLocked: false },
        },
      ],
    };

    const result = await svc.copyRelations(
      sourceWorkItem,
      5678,
      ['System.LinkTypes.Hierarchy-Reverse']
    );

    expect(result.copiedCount).toBe(1);
    expect(capturedPath).toContain('/_apis/wit/workitems/5678');
    expect(capturedOptions?.headers?.['Content-Type']).toBe('application/json-patch+json');
  });
});

describe('AzureWorkItemService.findCandidateTasks', () => {
  it('loads all available Azure fields without requesting tenant-specific Custom.* names', async () => {
    const calls: string[] = [];
    const client = {
      async post<T>(_url: string, _body: any): Promise<T> {
        return { workItems: [{ id: 7 }] } as T;
      },
      async get<T>(url: string): Promise<T> {
        calls.push(url);
        return { value: [{ id: 7, fields: {
          'System.Title': '3in1_PWA_MyAccount | 17 Oct',
          'System.AssignedTo': 'a@b.com',
          'Custom.PlannedStartdate': '2026-10-17T09:30:00',
        } }] } as T;
      },
    };
    const svc = new AzureWorkItemService(client as any);
    const data = await svc.findCandidateTasks('P', 'Task', '3in1_PWA_MyAccount |', '2026-10-17', '2026-10-17', ['a@b.com']);
    expect(data[0].fields['Custom.PlannedStartdate']).toBeDefined();
    expect(calls[0]).not.toContain('&fields=');
  });

  it('reports Azure read failures instead of silently returning an empty task list', async () => {
    const client = {
      async post<T>(): Promise<T> { throw new Error('HTTP 403: forbidden'); },
    };
    const svc = new AzureWorkItemService(client as any);
    await expect(svc.findCandidateTasks('P', 'Task', 'series')).rejects.toThrow(
      /Azure DevOps task discovery failed.*403/
    );
  });

  it('rejects incomplete coverage instead of silently discarding rows after a fixed slice', async () => {
    const client = {
      async post<T>(): Promise<T> {
        return { workItems: Array.from({ length: 5001 }, (_, i) => ({ id: i + 1 })) } as T;
      },
    };
    const svc = new AzureWorkItemService(client as any);
    await expect(svc.findCandidateTasks('P', 'Task', 'series')).rejects.toThrow(/Too many matching/);
  });
});

describe('AzureWorkItemService duplicate detection with missing assignee', () => {
  it('does not count unassigned tasks as belonging to a requested person', async () => {
    const date = new Date().getFullYear() + '-06-10';
    const prefix = '3in1_PWA_MyAccount |';
    const client = {
      async post<T>(): Promise<T> { return { workItems: [{ id: 11 }] } as T; },
      async get<T>(): Promise<T> {
        return { value: [{ id: 11, fields: { 'System.Title': prefix + ' ' + formatTitleDate(date) } }] } as T;
      },
    };
    const svc = new AzureWorkItemService(client as any);
    expect((await svc.getExistingTasksForPerson('P', 'Task', prefix, 'a@b.com', date, date)).size).toBe(0);
  });
});
