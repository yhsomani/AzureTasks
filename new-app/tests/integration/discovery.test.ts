import { describe, it, expect } from 'vitest';
import { AzureWorkItemService } from '../../src/infrastructure/azure/work-item-service';
import { AzureDevOpsClient } from '../../src/infrastructure/azure/client';
import { Person } from '../../src/domain/entities/person';

/**
 * Regression: discovery must key results by the *person key* (as the use cases
 * look them up), not by the raw Azure identity string.
 */
describe('AzureWorkItemService.discoverLatestTasksForPeople', () => {
  const people = [
    new Person({ key: 'alice_key', name: 'Alice Able', assignedTo: 'alice@b.com' }),
    new Person({ key: 'bob_key', name: 'Bob Baker', assignedTo: 'bob@b.com' }),
  ];

  function fakeClient(items: any[]): AzureDevOpsClient {
    return {
      async post(path: string) {
        if (path.includes('/wiql')) return { workItems: items.map(i => ({ id: i.id })) };
        throw new Error(`unexpected POST ${path}`);
      },
      async get(path: string) {
        if (path.includes('/workitems?ids=')) return { value: items, count: items.length };
        throw new Error(`unexpected GET ${path}`);
      },
    } as unknown as AzureDevOpsClient;
  }

  it('maps Azure identities back to configured person keys', async () => {
    const items = [
      {
        id: 1,
        fields: {
          'System.AssignedTo': { uniqueName: 'alice@b.com', displayName: 'Alice Able' },
          'System.Title': '3in1_PWA_MyAccount | Oct 6',
          'Microsoft.VSTS.Scheduling.StartDate': '2026-10-06T04:00:00Z',
        },
      },
      {
        id: 2,
        fields: {
          'System.AssignedTo': { uniqueName: 'bob@b.com', displayName: 'Bob Baker' },
          'System.Title': '3in1_PWA_MyAccount | Oct 5',
          'Microsoft.VSTS.Scheduling.StartDate': '2026-10-05T04:00:00Z',
        },
      },
    ];

    const svc = new AzureWorkItemService(fakeClient(items));
    const result = await svc.discoverLatestTasksForPeople('Proj', '3in1 Task', '3in1_PWA_MyAccount |', people);

    expect([...result.keys()].sort()).toEqual(['alice_key', 'bob_key']);
    expect(result.get('alice_key')!.workItem.id).toBe(1);
    expect(result.get('bob_key')!.workItem.id).toBe(2);
    expect(result.get('alice_key')!.parsedDate.isoDate).toMatch(/-10-06$/);
  });

  it('honors a per-person sourceTaskId override over discovery', async () => {
    const peopleWithOverride = [
      new Person({ key: 'alice_key', name: 'Alice Able', assignedTo: 'alice@b.com', sourceTaskId: 77 }),
      new Person({ key: 'bob_key', name: 'Bob Baker', assignedTo: 'bob@b.com' }),
    ];
    const items = [
      {
        id: 1,
        fields: {
          'System.AssignedTo': { uniqueName: 'alice@b.com' },
          'System.Title': '3in1_PWA_MyAccount | Oct 6',
        },
      },
      {
        id: 2,
        fields: {
          'System.AssignedTo': { uniqueName: 'bob@b.com' },
          'System.Title': '3in1_PWA_MyAccount | Oct 5',
        },
      },
    ];
    const overrideItem = { id: 77, fields: {
      'System.Title': '3in1_PWA_MyAccount | Sep 30',
      'System.TeamProject': 'Proj',
      'System.WorkItemType': '3in1 Task',
      'System.AssignedTo': { displayName: 'Alice Able', uniqueName: 'alice@b.com' },
    } };

    const client = {
      async post(path: string) {
        if (path.includes('/wiql')) return { workItems: items.map(i => ({ id: i.id })) };
        throw new Error(`unexpected POST ${path}`);
      },
      async get(path: string) {
        if (path.includes('/workitems/77')) return overrideItem;
        if (path.includes('/workitems?ids=')) return { value: items, count: items.length };
        throw new Error(`unexpected GET ${path}`);
      },
    } as unknown as AzureDevOpsClient;

    const svc = new AzureWorkItemService(client);
    const result = await svc.discoverLatestTasksForPeople(
      'Proj', '3in1 Task', '3in1_PWA_MyAccount |', peopleWithOverride
    );

    expect(result.get('alice_key')!.workItem.id).toBe(77);
    expect(result.get('bob_key')!.workItem.id).toBe(2);
  });

  it('falls back to the default source task when a person has no match', async () => {
    const items = [
      {
        id: 1,
        fields: {
          'System.AssignedTo': { uniqueName: 'alice@b.com' },
          'System.Title': '3in1_PWA_MyAccount | Oct 6',
        },
      },
    ];
    const defaultItem = {
      id: 99,
      fields: {
        'System.Title': '3in1_PWA_MyAccount | Oct 1',
        'System.TeamProject': 'Proj',
        'System.WorkItemType': '3in1 Task',
        'System.AssignedTo': { uniqueName: 'bob@b.com', displayName: 'Bob Baker' },
      },
    };

    const client = {
      async post(path: string) {
        if (path.includes('/wiql')) return { workItems: items.map(i => ({ id: i.id })) };
        throw new Error(`unexpected POST ${path}`);
      },
      async get(path: string) {
        if (path.includes('/workitems/99')) return defaultItem;
        if (path.includes('/workitems?ids=')) return { value: items, count: items.length };
        throw new Error(`unexpected GET ${path}`);
      },
    } as unknown as AzureDevOpsClient;

    const svc = new AzureWorkItemService(client);
    const result = await svc.discoverLatestTasksForPeople(
      'Proj', '3in1 Task', '3in1_PWA_MyAccount |', people, undefined, 99
    );

    expect(result.get('alice_key')!.workItem.id).toBe(1);
    expect(result.get('bob_key')!.workItem.id).toBe(99);
  });

  it('never uses a different member\'s task as the default source', async () => {
    const aliceOnly = [{
      id: 10,
      fields: {
        'System.AssignedTo': { uniqueName: 'alice@b.com', displayName: 'Alice Able' },
        'System.Title': '3in1_PWA_MyAccount | Oct 6',
      },
    }];
    const client = {
      async post<T>(): Promise<T> { return { workItems: aliceOnly.map(x => ({ id: x.id })) } as T; },
      async get<T>(url: string): Promise<T> {
        if (url.includes('/workitems/99')) return {
          id: 99,
          fields: {
            'System.Title': '3in1_PWA_MyAccount | Oct 1',
            'System.TeamProject': 'Proj',
            'System.WorkItemType': '3in1 Task',
            'System.AssignedTo': { uniqueName: 'alice@b.com', displayName: 'Alice Able' },
          },
        } as T;
        return { value: aliceOnly, count: 1 } as T;
      },
    } as unknown as AzureDevOpsClient;
    const sources = await new AzureWorkItemService(client).discoverLatestTasksForPeople(
      'Proj', '3in1 Task', '3in1_PWA_MyAccount |', people, undefined, 99
    );
    expect(sources.has('bob_key')).toBe(false);
  });
});
