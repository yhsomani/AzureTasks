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
      fields: { 'System.Title': '3in1_PWA_MyAccount | Oct 1' },
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
});
