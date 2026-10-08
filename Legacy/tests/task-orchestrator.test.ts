import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AzureDevOpsClient } from '../src/azure/client.js';
import { AzureProject, WorkItem } from '../src/azure/types.js';
import { AppConfig, DEFAULT_CONFIG } from '../src/config/config.js';
import { TaskOrchestrator } from '../src/task/task-orchestrator.js';

describe('Multi-Person Task Orchestrator Simulation', () => {
  let mockClient: AzureDevOpsClient;

  const config: AppConfig = {
    ...DEFAULT_CONFIG,
    organization: 'BFLDevOpsOrg',
    project: '3in1_Agile_Projects',
    workItemType: '3in1 Task',
    titlePrefix: '3in1_PWA_MyAccount |',
    people: [
      { name: 'Person A', assignedTo: 'personA@company.com' },
      { name: 'Person B', assignedTo: 'personB@company.com' },
      { name: 'Person C', assignedTo: 'personC@company.com' },
    ],
  };

  // Section 58 Scenario:
  // Today = Monday, 12 Oct 2026.
  // Person A latest = 9 Oct (#1001)
  // Person B latest = 8 Oct (#2001)
  // Person C latest = 12 Oct (#3001)
  const taskA_9Oct: WorkItem = {
    id: 1001,
    rev: 1,
    url: '',
    fields: {
      'System.Id': 1001,
      'System.Title': '3in1_PWA_MyAccount | 9 Oct',
      'System.CreatedDate': '2026-10-09T05:00:00Z',
      'System.AssignedTo': 'personA@company.com',
      'System.TeamProject': '3in1_Agile_Projects',
      'System.WorkItemType': '3in1 Task',
    },
  };

  const taskB_8Oct: WorkItem = {
    id: 2001,
    rev: 1,
    url: '',
    fields: {
      'System.Id': 2001,
      'System.Title': '3in1_PWA_MyAccount | 8 Oct',
      'System.CreatedDate': '2026-10-08T05:00:00Z',
      'System.AssignedTo': 'personB@company.com',
      'System.TeamProject': '3in1_Agile_Projects',
      'System.WorkItemType': '3in1 Task',
    },
  };

  const taskC_12Oct: WorkItem = {
    id: 3001,
    rev: 1,
    url: '',
    fields: {
      'System.Id': 3001,
      'System.Title': '3in1_PWA_MyAccount | 12 Oct',
      'System.CreatedDate': '2026-10-12T05:00:00Z',
      'System.AssignedTo': 'personC@company.com',
      'System.TeamProject': '3in1_Agile_Projects',
      'System.WorkItemType': '3in1 Task',
    },
  };

  beforeEach(() => {
    mockClient = {
      get: vi.fn(),
      post: vi.fn(),
      patch: vi.fn(),
    } as unknown as AzureDevOpsClient;

    vi.mocked(mockClient.get).mockImplementation(async (path: string) => {
      if (path.includes('_apis/projects/')) {
        return { id: 'p1', name: '3in1_Agile_Projects' } as AzureProject;
      }
      if (path.includes('workitemtypes')) {
        return { value: [{ name: '3in1 Task' }] };
      }
      return {};
    });
  });

  it('Section 58 Scenario: independent progression and duplicate check for Person A, B, and C', async () => {
    let createdCounter = 5000;
    const createdPayloads: any[] = [];

    vi.mocked(mockClient.post).mockImplementation(async (path: string, body: any) => {
      if (path.includes('wiql')) {
        return { workItems: [{ id: 1001 }, { id: 2001 }, { id: 3001 }] };
      }
      if (path.includes('workitemsbatch')) {
        return { value: [taskA_9Oct, taskB_8Oct, taskC_12Oct] };
      }
      if (path.includes('_apis/wit/workitems/')) {
        createdCounter++;
        createdPayloads.push(body);
        return { id: createdCounter, fields: {} };
      }
      return {};
    });

    const orchestrator = new TaskOrchestrator(mockClient, config, {
      all: true,
      dryRun: false,
      yes: true,
      verbose: false,
      todayOverride: '2026-10-12', // Monday 12 Oct
    });

    const aggregate = await orchestrator.run();

    // Person A: 12, 13, 14, 15 Oct -> 4 tasks created
    const resA = aggregate.personResults.find((r) => r.person.name === 'Person A')!;
    expect(resA.createdTasks).toHaveLength(4);
    expect(resA.createdTasks.map((t) => t.title)).toEqual([
      '3in1_PWA_MyAccount | 12 Oct',
      '3in1_PWA_MyAccount | 13 Oct',
      '3in1_PWA_MyAccount | 14 Oct',
      '3in1_PWA_MyAccount | 15 Oct',
    ]);

    // Person B: 12, 13, 14, 15 Oct -> 4 tasks created
    const resB = aggregate.personResults.find((r) => r.person.name === 'Person B')!;
    expect(resB.createdTasks).toHaveLength(4);

    // Person C: 12 Oct already exists! 13, 14, 15 Oct created -> 3 tasks created
    const resC = aggregate.personResults.find((r) => r.person.name === 'Person C')!;
    expect(resC.createdTasks).toHaveLength(3);
    expect(resC.duplicateSkips).toHaveLength(1);
    expect(resC.duplicateSkips[0].formattedTitleDate).toBe('12 Oct');

    // Total created = 4 + 4 + 3 = 11 tasks
    expect(aggregate.totalCreatedCount).toBe(11);

    // Verify System.AssignedTo was correctly set for each created task
    const assignedA = createdPayloads.filter((ops) =>
      ops.some((op: any) => op.path === '/fields/System.AssignedTo' && op.value === 'personA@company.com')
    );
    expect(assignedA).toHaveLength(4);

    const assignedC = createdPayloads.filter((ops) =>
      ops.some((op: any) => op.path === '/fields/System.AssignedTo' && op.value === 'personC@company.com')
    );
    expect(assignedC).toHaveLength(3);
  });

  it('Dry-run mode makes zero creation requests to Azure DevOps', async () => {
    vi.mocked(mockClient.post).mockImplementation(async (path: string) => {
      if (path.includes('wiql')) {
        return { workItems: [{ id: 1001 }] };
      }
      if (path.includes('workitemsbatch')) {
        return { value: [taskA_9Oct] };
      }
      return {};
    });

    const orchestrator = new TaskOrchestrator(mockClient, config, {
      all: true,
      dryRun: true,
      yes: true,
      verbose: false,
      todayOverride: '2026-10-12',
    });

    const aggregate = await orchestrator.run();

    expect(aggregate.totalCreatedCount).toBe(0);
    // Verify no creation POST calls were made
    const createCalls = vi
      .mocked(mockClient.post)
      .mock.calls.filter(([p]) => p.includes('_apis/wit/workitems/'));
    expect(createCalls).toHaveLength(0);
  });

  it('Isolates person failure: Person A failure does not affect Person B', async () => {
    // Only Person B has a source task; Person A has NONE
    vi.mocked(mockClient.post).mockImplementation(async (path: string) => {
      if (path.includes('wiql')) {
        return { workItems: [{ id: 2001 }] };
      }
      if (path.includes('workitemsbatch')) {
        return { value: [taskB_8Oct] };
      }
      if (path.includes('_apis/wit/workitems/')) {
        return { id: 9999, fields: {} };
      }
      return {};
    });

    const orchestrator = new TaskOrchestrator(mockClient, config, {
      all: true,
      dryRun: false,
      yes: true,
      verbose: false,
      todayOverride: '2026-10-12',
    });

    const aggregate = await orchestrator.run();

    const resA = aggregate.personResults.find((r) => r.person.name === 'Person A')!;
    expect(resA.status).toBe('SOURCE_FAILED');
    expect(resA.createdTasks).toHaveLength(0);

    const resB = aggregate.personResults.find((r) => r.person.name === 'Person B')!;
    expect(resB.status).toBe('SUCCESS');
    expect(resB.createdTasks).toHaveLength(4);
  });
});
