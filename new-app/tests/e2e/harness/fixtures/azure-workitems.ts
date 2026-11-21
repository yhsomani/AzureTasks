export interface MockWorkItem {
  id: number;
  rev: number;
  fields: {
    'System.Id'?: number;
    'System.Title'?: string;
    'System.State'?: string;
    'System.WorkItemType'?: string;
    'System.AssignedTo'?: string | { displayName?: string; uniqueName?: string };
    'System.AreaPath'?: string;
    'System.IterationPath'?: string;
    'System.Description'?: string;
    'Microsoft.VSTS.Common.Activity'?: string;
    'Microsoft.VSTS.Scheduling.OriginalEstimate'?: number;
    'Microsoft.VSTS.Scheduling.RemainingWork'?: number;
    'Microsoft.VSTS.Scheduling.CompletedWork'?: number;
    'Custom.ActualEndDate'?: string;
    'Custom.actualEndDate'?: string;
    'Custom.TargetDate'?: string;
    [key: string]: any;
  };
  relations?: Array<{
    rel: string;
    url: string;
    attributes?: {
      isLocked?: boolean;
      comment?: string;
      name?: string;
    };
  }>;
  url?: string;
}

export const SEED_WORK_ITEMS: MockWorkItem[] = [
  {
    id: 1001,
    rev: 1,
    fields: {
      'System.Id': 1001,
      'System.Title': 'US1001: Implement User Authentication Flow',
      'System.State': 'Active',
      'System.WorkItemType': 'User Story',
      'System.AssignedTo': 'Dev One <dev1@workops.test>',
      'System.AreaPath': 'WorkOps\\Core',
      'System.IterationPath': 'WorkOps\\Sprint 1',
    },
    relations: [],
  },
  {
    id: 1002,
    rev: 1,
    fields: {
      'System.Id': 1002,
      'System.Title': 'Task: Dev One | Sprint 1 | 2026-10-14',
      'System.State': 'Active',
      'System.WorkItemType': 'Task',
      'System.AssignedTo': 'Dev One <dev1@workops.test>',
      'System.AreaPath': 'WorkOps\\Core',
      'System.IterationPath': 'WorkOps\\Sprint 1',
      'Microsoft.VSTS.Common.Activity': 'Development',
      'Microsoft.VSTS.Scheduling.OriginalEstimate': 8,
      'Microsoft.VSTS.Scheduling.RemainingWork': 8,
      'Microsoft.VSTS.Scheduling.CompletedWork': 0,
      'Custom.ActualEndDate': '2026-10-14',
    },
    relations: [
      {
        rel: 'System.LinkTypes.Hierarchy-Reverse',
        url: 'https://dev.azure.com/test-org/_apis/wit/workItems/1001',
      },
    ],
  },
  {
    id: 1003,
    rev: 1,
    fields: {
      'System.Id': 1003,
      'System.Title': 'US1003: Database Relational Migration Support',
      'System.State': 'Active',
      'System.WorkItemType': 'User Story',
      'System.AssignedTo': 'Dev Two <dev2@workops.test>',
      'System.AreaPath': 'WorkOps\\Database',
      'System.IterationPath': 'WorkOps\\Sprint 1',
    },
    relations: [],
  },
  {
    id: 1004,
    rev: 1,
    fields: {
      'System.Id': 1004,
      'System.Title': 'Task: Dev Two | Sprint 1 | 2026-10-14',
      'System.State': 'New',
      'System.WorkItemType': 'Task',
      'System.AssignedTo': 'Dev Two <dev2@workops.test>',
      'System.AreaPath': 'WorkOps\\Database',
      'System.IterationPath': 'WorkOps\\Sprint 1',
      'Microsoft.VSTS.Common.Activity': 'Development',
      'Microsoft.VSTS.Scheduling.OriginalEstimate': 8,
      'Microsoft.VSTS.Scheduling.RemainingWork': 8,
      'Microsoft.VSTS.Scheduling.CompletedWork': 0,
    },
    relations: [
      {
        rel: 'System.LinkTypes.Hierarchy-Reverse',
        url: 'https://dev.azure.com/test-org/_apis/wit/workItems/1003',
      },
    ],
  },
  {
    id: 1005,
    rev: 1,
    fields: {
      'System.Id': 1005,
      'System.Title': 'Task: Dev One | Sprint 1 | 2026-10-15',
      'System.State': 'Closed',
      'System.WorkItemType': 'Task',
      'System.AssignedTo': 'Dev One <dev1@workops.test>',
      'System.AreaPath': 'WorkOps\\Core',
      'System.IterationPath': 'WorkOps\\Sprint 1',
      'Microsoft.VSTS.Common.Activity': 'Development',
      'Microsoft.VSTS.Scheduling.OriginalEstimate': 8,
      'Microsoft.VSTS.Scheduling.RemainingWork': 0,
      'Microsoft.VSTS.Scheduling.CompletedWork': 8,
      'Custom.ActualEndDate': '2026-10-15',
    },
    relations: [],
  },
];
