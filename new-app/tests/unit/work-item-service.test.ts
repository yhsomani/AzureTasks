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
