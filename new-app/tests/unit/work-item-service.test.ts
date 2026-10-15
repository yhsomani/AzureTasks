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
      value: this.items.map(i => ({ id: i.id, rev: 1, fields: { 'System.Title': i.title } })),
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
