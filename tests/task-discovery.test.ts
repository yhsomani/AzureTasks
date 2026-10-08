import { describe, it, expect, vi } from 'vitest';
import { AzureDevOpsClient } from '../src/azure/client.js';
import { WorkItem } from '../src/azure/types.js';
import { WiqlService } from '../src/azure/wiql-service.js';
import { WorkItemService } from '../src/azure/work-item-service.js';
import { PersonConfig } from '../src/config/config.js';
import { TaskDiscoveryService } from '../src/task/task-discovery.js';

describe('Task Discovery Service — Multi-Person', () => {
  const dummyClient = {
    get: vi.fn(),
    post: vi.fn(),
    patch: vi.fn(),
  } as unknown as AzureDevOpsClient;

  const people: PersonConfig[] = [
    { name: 'Rahul', assignedTo: 'rahul@company.com' },
    { name: 'Priya', assignedTo: 'priya@company.com' },
    { name: 'Amit', assignedTo: 'amit@company.com' },
  ];

  it('independently discovers latest source tasks for each person based on assignee', async () => {
    const wiqlService = new WiqlService(dummyClient);
    const workItemService = new WorkItemService(dummyClient);

    vi.spyOn(wiqlService, 'findCandidateSourceTasks').mockResolvedValue([1, 2, 3, 4]);

    const mockItems: WorkItem[] = [
      // Rahul's tasks: 7 Oct and 8 Oct -> latest 8 Oct (#2)
      {
        id: 1,
        rev: 1,
        fields: {
          'System.Title': '3in1_PWA_MyAccount | 7 Oct',
          'System.CreatedDate': '2026-10-07T05:00:00Z',
          'System.TeamProject': '3in1_Agile_Projects',
          'System.WorkItemType': '3in1 Task',
          'System.AssignedTo': 'rahul@company.com',
        },
        url: 'https://dev.azure.com/test/_apis/wit/workItems/1',
      },
      {
        id: 2,
        rev: 1,
        fields: {
          'System.Title': '3in1_PWA_MyAccount | 8 Oct',
          'System.CreatedDate': '2026-10-08T05:00:00Z',
          'System.TeamProject': '3in1_Agile_Projects',
          'System.WorkItemType': '3in1 Task',
          'System.AssignedTo': { displayName: 'Rahul Sharma', uniqueName: 'rahul@company.com' },
        },
        url: 'https://dev.azure.com/test/_apis/wit/workItems/2',
      },
      // Priya's tasks: 6 Oct and 7 Oct -> latest 7 Oct (#4)
      {
        id: 3,
        rev: 1,
        fields: {
          'System.Title': '3in1_PWA_MyAccount | 6 Oct',
          'System.CreatedDate': '2026-10-06T05:00:00Z',
          'System.TeamProject': '3in1_Agile_Projects',
          'System.WorkItemType': '3in1 Task',
          'System.AssignedTo': 'priya@company.com',
        },
        url: 'https://dev.azure.com/test/_apis/wit/workItems/3',
      },
      {
        id: 4,
        rev: 1,
        fields: {
          'System.Title': '3in1_PWA_MyAccount | 7 Oct',
          'System.CreatedDate': '2026-10-07T05:00:00Z',
          'System.TeamProject': '3in1_Agile_Projects',
          'System.WorkItemType': '3in1 Task',
          'System.AssignedTo': 'priya@company.com',
        },
        url: 'https://dev.azure.com/test/_apis/wit/workItems/4',
      },
      // Amit has NO tasks
    ];

    vi.spyOn(workItemService, 'getWorkItemsBatch').mockResolvedValue(mockItems);

    const discoveryService = new TaskDiscoveryService(wiqlService, workItemService);
    const result = await discoveryService.discoverForPeople(
      '3in1_Agile_Projects',
      '3in1 Task',
      '3in1_PWA_MyAccount |',
      people
    );

    // Rahul's discovery: source task is #2 (8 Oct)
    const rahulDisc = result.personDiscoveries.get('rahul@company.com');
    expect(rahulDisc?.status).toBe('FOUND');
    expect(rahulDisc?.sourceTask?.workItem.id).toBe(2);
    expect(rahulDisc?.sourceTask?.parsedDate.formattedTitleDate).toBe('8 Oct');

    // Priya's discovery: source task is #4 (7 Oct)
    const priyaDisc = result.personDiscoveries.get('priya@company.com');
    expect(priyaDisc?.status).toBe('FOUND');
    expect(priyaDisc?.sourceTask?.workItem.id).toBe(4);
    expect(priyaDisc?.sourceTask?.parsedDate.formattedTitleDate).toBe('7 Oct');

    // Amit's discovery: SOURCE_NOT_FOUND
    const amitDisc = result.personDiscoveries.get('amit@company.com');
    expect(amitDisc?.status).toBe('SOURCE_NOT_FOUND');
    expect(amitDisc?.sourceTask).toBeNull();
  });

  it('respects per-person source override when specified', async () => {
    const wiqlService = new WiqlService(dummyClient);
    const workItemService = new WorkItemService(dummyClient);

    const customPeople: PersonConfig[] = [
      { name: 'Amit', assignedTo: 'amit@company.com', sourceTaskId: 999 },
    ];

    vi.spyOn(wiqlService, 'findCandidateSourceTasks').mockResolvedValue([]);
    vi.spyOn(workItemService, 'getWorkItem').mockResolvedValue({
      id: 999,
      rev: 1,
      fields: {
        'System.Title': '3in1_PWA_MyAccount | 8 Oct',
        'System.CreatedDate': '2026-10-08T05:00:00Z',
        'System.TeamProject': '3in1_Agile_Projects',
        'System.WorkItemType': '3in1 Task',
      },
      url: 'https://dev.azure.com/test/_apis/wit/workItems/999',
    });

    const discoveryService = new TaskDiscoveryService(wiqlService, workItemService);
    const result = await discoveryService.discoverForPeople(
      '3in1_Agile_Projects',
      '3in1 Task',
      '3in1_PWA_MyAccount |',
      customPeople
    );

    const amitDisc = result.personDiscoveries.get('amit@company.com');
    expect(amitDisc?.status).toBe('FOUND');
    expect(amitDisc?.sourceTask?.workItem.id).toBe(999);
  });

  it('falls back to defaultSourceTaskId when person has no existing tasks', async () => {
    const wiqlService = new WiqlService(dummyClient);
    const workItemService = new WorkItemService(dummyClient);

    const newPeople: PersonConfig[] = [
      { name: 'New Joiner', assignedTo: 'newbie@company.com' },
    ];

    vi.spyOn(wiqlService, 'findCandidateSourceTasks').mockResolvedValue([]);
    vi.spyOn(workItemService, 'getWorkItem').mockResolvedValue({
      id: 555,
      rev: 1,
      fields: {
        'System.Title': '3in1_PWA_MyAccount | 8 Oct',
        'System.CreatedDate': '2026-10-08T05:00:00Z',
        'System.TeamProject': '3in1_Agile_Projects',
        'System.WorkItemType': '3in1 Task',
      },
      url: 'https://dev.azure.com/test/_apis/wit/workItems/555',
    });

    const discoveryService = new TaskDiscoveryService(wiqlService, workItemService);
    const result = await discoveryService.discoverForPeople(
      '3in1_Agile_Projects',
      '3in1 Task',
      '3in1_PWA_MyAccount |',
      newPeople,
      undefined,
      555 // defaultSourceTaskId
    );

    const newbieDisc = result.personDiscoveries.get('newbie@company.com');
    expect(newbieDisc?.status).toBe('FOUND');
    expect(newbieDisc?.sourceTask?.workItem.id).toBe(555);
  });
});
