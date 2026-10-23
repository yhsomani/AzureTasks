import { describe, it, expect } from 'vitest';
import { AzureWorkItemService } from '../../src/infrastructure/azure/work-item-service';
import { addDays, formatTitleDate } from '../../src/domain/value-objects/date-window';

/** Minimal Azure client fake: echoes the batch items regardless of the query. */
class FakeClient {
  public wiql = '';
  constructor(private readonly items: Array<{ id: number; title: string; fields?: Record<string, any> }>) {}

  async post<T>(_url: string, body: { query: string }): Promise<T> {
    this.wiql = body.query;
    return { workItems: this.items.map(i => ({ id: i.id })) } as T;
  }

  async get<T>(_url: string): Promise<T> {
    return {
      value: this.items.map(i => ({
        id: i.id,
        rev: 1,
        fields: {
          'System.Title': i.title,
          'System.AssignedTo': 'a@b.com',
          ...(i.fields ?? {}),
        },
      })),
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

  it('matches and indexes existing tasks by Custom.PlannedStartdate even with non-pipe titles', async () => {
    const client = new FakeClient([
      {
        id: 101,
        title: 'My Account Task - 21 Oct',
        fields: {
          'System.Title': 'My Account Task - 21 Oct',
          'System.AssignedTo': 'a@b.com',
          'Custom.PlannedStartdate': '2026-10-21T03:30:00.000Z',
        },
      },
      {
        id: 102,
        title: '22 Oct 26 - Task',
        fields: {
          'System.Title': '22 Oct 26 - Task',
          'System.AssignedTo': 'a@b.com',
          'Custom.PlannedStartdate': '2026-10-22T03:30:00.000Z',
        },
      },
    ]);
    const svc = new AzureWorkItemService(client as any, () => 'Asia/Kolkata');
    const map = await svc.getExistingTasksForPerson('P', 'Task', prefix, 'a@b.com', '2026-10-20', '2026-10-25');

    expect(map.has('2026-10-21')).toBe(true);
    expect(map.get('2026-10-21')?.id).toBe(101);
    expect(map.has('2026-10-22')).toBe(true);
    expect(map.get('2026-10-22')?.id).toBe(102);
  });
});

describe('AzureWorkItemService duplicate detection fail-closed', () => {
  it('rejects a malformed WIQL response rather than claiming no duplicates', async () => {
    const client = { async post<T>(): Promise<T> { return { unexpected: true } as T; } };
    const service = new AzureWorkItemService(client as any);
    await expect(service.getExistingTasksForPerson(
      'P', 'Task', '3in1_PWA_MyAccount |', 'a@b.com', '2026-10-15', '2026-10-15'
    )).rejects.toThrow(/invalid duplicate-detection WIQL/);
  });

  it('rejects candidate sets too large to check exhaustively', async () => {
    const client = { async post<T>(): Promise<T> {
      return { workItems: Array.from({ length: 5001 }, (_, i) => ({ id: i + 1 })) } as T;
    }};
    const service = new AzureWorkItemService(client as any);
    await expect(service.getExistingTasksForPerson(
      'P', 'Task', '3in1_PWA_MyAccount |', 'a@b.com', '2026-10-15', '2026-10-15'
    )).rejects.toThrow(/Too many duplicate-detection/);
  });

  it('rejects missing batch rows instead of silently omitting duplicates', async () => {
    const client = {
      async post<T>(): Promise<T> { return { workItems: [{ id: 1 }, { id: 2 }] } as T; },
      async get<T>(): Promise<T> { return { value: [{ id: 1, fields: { 'System.Title': 'x' } }] } as T; },
    };
    const service = new AzureWorkItemService(client as any);
    await expect(service.getExistingTasksForPerson(
      'P', 'Task', '3in1_PWA_MyAccount |', 'a@b.com', '2026-10-15', '2026-10-15'
    )).rejects.toThrow(/incomplete or mismatched duplicate-detection/);
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
    let capturedBody: any = null;
    const fakeClient = {
      baseUrl: 'https://dev.azure.com',
      organization: 'test-org',
      async patch<T>(path: string, _body: any, options?: any): Promise<T> {
        capturedPath = path;
        capturedBody = _body;
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
    expect(capturedBody[0].value.attributes).toBeUndefined(); // read-only metadata omitted
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

describe('Azure duplicate detection on ambiguous existing work items', () => {
  it('gracefully resolves to recorded Azure date rather than throwing when matching-series title conflicts with scheduling', async () => {
    const client = {
      async post<T>(): Promise<T> { return { workItems: [{ id: 144 }] } as T; },
      async get<T>(): Promise<T> {
        return { value: [{ id: 144, rev: 1, fields: {
          'System.Title': '3in1_PWA_MyAccount | Oct 16',
          'System.AssignedTo': 'a@b.com',
          'Custom.PlannedStartdate': '2026-10-15T04:00:00.000Z',
        } }] } as T;
      },
    };
    const map = await new AzureWorkItemService(client as any, () => 'Asia/Kolkata')
      .getExistingTasksForPerson('P', 'Task', '3in1_PWA_MyAccount |',
        'a@b.com', '2026-10-15', '2026-10-15');
    expect(map.has('2026-10-15')).toBe(true);
    expect(map.get('2026-10-15')?.id).toBe(144);
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

  it('excludes User Stories from existing tasks during duplicate detection', async () => {
    const date = '2026-10-15';
    const prefix = '3in1_PWA_MyAccount |';
    const client = {
      async post<T>(): Promise<T> { return { workItems: [{ id: 99 }] } as T; },
      async get<T>(): Promise<T> {
        return { value: [{
          id: 99,
          fields: {
            'System.WorkItemType': 'User Story',
            'System.Title': `${prefix} Oct 15`,
            'System.AssignedTo': 'a@b.com',
          },
        }] } as T;
      },
    };
    const svc = new AzureWorkItemService(client as any);
    const existing = await svc.getExistingTasksForPerson('P', 'Task', prefix, 'a@b.com', date, date);
    expect(existing.size).toBe(0);
    expect(existing.has(date)).toBe(false);
  });
});

describe('AzureWorkItemService source discovery completeness', () => {
  const prefix = '3in1_PWA_MyAccount |';

  function candidateClient(count: number) {
    const items = Array.from({ length: count }, (_, i) => ({
      id: i + 1,
      fields: {
        'System.Title': i === count - 1
          ? `${prefix} 16 Oct`
          : `${prefix} 10 Oct`,
        'System.AssignedTo': 'a@b.com',
      },
    }));
    return {
      async post<T>(): Promise<T> {
        return { workItems: items.map(x => ({ id: x.id })) } as T;
      },
      async get<T>(url: string): Promise<T> {
        const ids = new URL('https://test.invalid' + url).searchParams.get('ids')?.split(',').map(Number) || [];
        return { value: items.filter(item => ids.includes(item.id)) } as T;
      },
    };
  }

  it('finds the latest title date even when it is beyond the first 100 IDs', async () => {
    const service = new AzureWorkItemService(candidateClient(121) as any);
    const source = await service.findLatestTaskForPerson('P', 'Task', prefix, 'a@b.com');
    expect(source?.parsedDate.isoDate).toBe('2026-10-16');
  });

  it('finds a per-person source beyond the first 200 IDs during team discovery', async () => {
    const service = new AzureWorkItemService(candidateClient(211) as any);
    const sources = await service.discoverLatestTasksForPeople('P', 'Task', prefix, [
      { key: 'p1', name: 'A', assignedTo: 'a@b.com', enabled: true } as any,
    ]);
    expect(sources.get('p1')?.parsedDate.isoDate).toBe('2026-10-16');
  });
});

describe('AzureWorkItemService candidate batch integrity', () => {
  it('rejects missing details even when the result is a valid array', async () => {
    const client = {
      async post<T>(): Promise<T> { return { workItems: [{ id: 11 }, { id: 12 }] } as T; },
      async get<T>(): Promise<T> {
        return { value: [{ id: 11, fields: { 'System.Title': 'test' } }] } as T;
      },
    };
    await expect(new AzureWorkItemService(client as any)
      .findCandidateTasks('P', 'Task', 'Series |', undefined, undefined, ['a@b.com']))
      .rejects.toThrow(/incomplete or mismatched candidate work-item batch/i);
  });

  it('rejects a batch containing a different requested ID', async () => {
    const client = {
      async post<T>(): Promise<T> { return { workItems: [{ id: 11 }] } as T; },
      async get<T>(): Promise<T> {
        return { value: [{ id: 99, fields: { 'System.Title': 'test' } }] } as T;
      },
    };
    await expect(new AzureWorkItemService(client as any)
      .findCandidateTasks('P', 'Task', 'Series |', undefined, undefined, ['a@b.com']))
      .rejects.toThrow(/incomplete or mismatched candidate work-item batch/i);
  });
});
