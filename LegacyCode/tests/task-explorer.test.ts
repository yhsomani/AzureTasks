import { describe, expect, it, vi } from 'vitest';
import { AzureDevOpsClient } from '../src/azure/client.js';
import { AppConfig, PersonConfig } from '../src/config/config.js';
import { TaskExplorerService } from '../src/task/task-explorer.js';

describe('Intelligent Date-Range Task Explorer & Multi-User Tracking Suite', () => {
  const mockConfig: AppConfig = {
    organization: 'TestOrg',
    project: 'TestProject',
    baseUrl: 'https://dev.azure.com',
    workItemType: '3in1 Task',
    titlePrefix: '3in1_PWA_MyAccount |',
    timezone: 'Asia/Kolkata',
    thursdayMode: 'CURRENT',
    startTime: '09:30',
    maxRetries: 1,
    retryDelayMs: 10,
    people: [
      {
        name: 'Rahul Sharma',
        assignedTo: 'rahul.sharma@company.com',
        key: 'rahul',
        enabled: true,
      },
      {
        name: 'Priya Patel',
        assignedTo: 'priya.patel@company.com',
        key: 'priya',
        enabled: true,
      },
      {
        name: 'Amit Verma',
        assignedTo: 'amit.verma@company.com',
        key: 'amit',
        enabled: true,
      },
    ],
  };

  const mockClient = {
    post: vi.fn(),
    get: vi.fn(),
  } as unknown as AzureDevOpsClient;

  describe('Date Preset Generation', () => {
    it('generates accurate preset date ranges', () => {
      const refDate = '2026-10-12'; // Monday

      const todayRange = TaskExplorerService.getPresetDateRange('today', 'Asia/Kolkata', refDate);
      expect(todayRange.startDate).toBe('2026-10-12');
      expect(todayRange.endDate).toBe('2026-10-12');

      const yestRange = TaskExplorerService.getPresetDateRange('yesterday', 'Asia/Kolkata', refDate);
      expect(yestRange.startDate).toBe('2026-10-11');
      expect(yestRange.endDate).toBe('2026-10-11');

      const weekRange = TaskExplorerService.getPresetDateRange('this_week', 'Asia/Kolkata', refDate);
      expect(weekRange.startDate).toBe('2026-10-12');
      expect(weekRange.endDate).toBe('2026-10-16');

      const lastWeekRange = TaskExplorerService.getPresetDateRange('last_week', 'Asia/Kolkata', refDate);
      expect(lastWeekRange.startDate).toBe('2026-10-05');
      expect(lastWeekRange.endDate).toBe('2026-10-09');

      const last7Range = TaskExplorerService.getPresetDateRange('last_7_days', 'Asia/Kolkata', refDate);
      expect(last7Range.startDate).toBe('2026-10-06');
      expect(last7Range.endDate).toBe('2026-10-12');

      const last30Range = TaskExplorerService.getPresetDateRange('last_30_days', 'Asia/Kolkata', refDate);
      expect(last30Range.startDate).toBe('2026-09-13');
      expect(last30Range.endDate).toBe('2026-10-12');

      const rollingWindow = TaskExplorerService.getPresetDateRange('today_to_next_thursday', 'Asia/Kolkata', refDate);
      expect(rollingWindow.startDate).toBe('2026-10-12');
      expect(rollingWindow.endDate).toBe('2026-10-15'); // Thursday of this week
    });
  });

  describe('Validation & Boundary Checks', () => {
    it('rejects invalid date formats', async () => {
      const explorer = new TaskExplorerService(mockClient, mockConfig);
      await expect(
        explorer.exploreDateRange({ startDate: 'invalid', endDate: '2026-10-15' })
      ).rejects.toThrow('Invalid date format');
    });

    it('rejects startDate after endDate', async () => {
      const explorer = new TaskExplorerService(mockClient, mockConfig);
      await expect(
        explorer.exploreDateRange({ startDate: '2026-10-16', endDate: '2026-10-12' })
      ).rejects.toThrow('Start date (2026-10-16) cannot be after end date (2026-10-12)');
    });

    it('rejects date ranges exceeding maximum duration', async () => {
      const explorer = new TaskExplorerService(mockClient, mockConfig);
      await expect(
        explorer.exploreDateRange({ startDate: '2026-01-01', endDate: '2026-10-01' })
      ).rejects.toThrow('exceeds maximum allowed limit');
    });
  });

  describe('Strict Team Management Filtering & Coverage Calculation', () => {
    it('strictly filters out tasks of people NOT in Team Management and correctly computes coverage', async () => {
      const mockItems = [
        // Task for configured Rahul on 12 Oct (Active)
        {
          id: 101,
          fields: {
            'System.Id': 101,
            'System.TeamProject': 'TestProject',
            'System.WorkItemType': '3in1 Task',
            'System.Title': '3in1_PWA_MyAccount | 12 Oct',
            'System.CreatedDate': '2026-10-10T10:00:00Z',
            'System.State': 'Active',
            'System.AssignedTo': {
              displayName: 'Rahul Sharma',
              uniqueName: 'rahul.sharma@company.com',
            },
          },
        },
        // Task for configured Priya on 12 Oct (Closed)
        {
          id: 102,
          fields: {
            'System.Id': 102,
            'System.TeamProject': 'TestProject',
            'System.WorkItemType': '3in1 Task',
            'System.Title': '3in1_PWA_MyAccount | 12 Oct',
            'System.CreatedDate': '2026-10-10T10:00:00Z',
            'System.State': 'Closed',
            'System.AssignedTo': {
              displayName: 'Priya Patel',
              uniqueName: 'priya.patel@company.com',
            },
          },
        },
        // Duplicate second task for configured Priya on 12 Oct (New)
        {
          id: 103,
          fields: {
            'System.Id': 103,
            'System.TeamProject': 'TestProject',
            'System.WorkItemType': '3in1 Task',
            'System.Title': '3in1_PWA_MyAccount | 12 Oct',
            'System.CreatedDate': '2026-10-11T10:00:00Z',
            'System.State': 'New',
            'System.AssignedTo': {
              displayName: 'Priya Patel',
              uniqueName: 'priya.patel@company.com',
            },
          },
        },
        // Task for UNCONFIGURED user (External person not in people.json)
        {
          id: 999,
          fields: {
            'System.Id': 999,
            'System.TeamProject': 'TestProject',
            'System.WorkItemType': '3in1 Task',
            'System.Title': '3in1_PWA_MyAccount | 12 Oct',
            'System.CreatedDate': '2026-10-10T10:00:00Z',
            'System.State': 'New',
            'System.AssignedTo': {
              displayName: 'Stranger User',
              uniqueName: 'stranger@external.com',
            },
          },
        },
      ];

      const clientMock = {
        post: vi.fn().mockImplementation(async (path: string) => {
          if (path.includes('wiql')) {
            return {
              workItems: [{ id: 101 }, { id: 102 }, { id: 103 }, { id: 999 }],
            };
          }
          if (path.includes('workitemsbatch')) {
            return {
              value: mockItems,
            };
          }
          return {};
        }),
        get: vi.fn().mockResolvedValue({}),
      } as unknown as AzureDevOpsClient;

      const explorer = new TaskExplorerService(clientMock, mockConfig);

      // Explore 12 Oct to 13 Oct (Monday to Tuesday)
      const result = await explorer.exploreDateRange({
        startDate: '2026-10-12',
        endDate: '2026-10-13',
        asOf: '2026-10-12',
      });

      // 1. Strict Team Management verification
      expect(result.users).toHaveLength(3); // Rahul, Priya, Amit
      expect(result.users.map((u) => u.name)).toEqual(['Rahul Sharma', 'Priya Patel', 'Amit Verma']);

      // Unconfigured user's task #999 must NOT appear anywhere in matrix or detailed tasks
      const allTaskIds = result.detailedTasks.map((t) => t.taskId).filter(Boolean);
      expect(allTaskIds).not.toContain(999);
      expect(result.detailedTasks.some((t) => t.person.assignedTo === 'stranger@external.com')).toBe(false);

      // 2. Summary stats verification
      // 3 users * 2 working days = 6 expected combinations
      expect(result.summary.totalSelectedUsers).toBe(3);
      expect(result.summary.totalWorkingDates).toBe(2);
      expect(result.summary.expectedCombinations).toBe(6);

      // 12 Oct: Rahul has 1 task (Active), Priya has 2 duplicate tasks (Closed + New), Amit has 0 (Missing)
      // 13 Oct: All 3 users have 0 tasks (Missing)
      // Existing combinations: Rahul on 12th + Priya on 12th = 2 combinations
      // Missing combinations: Amit on 12th + Rahul on 13th + Priya on 13th + Amit on 13th = 4 combinations
      // Duplicate combinations: Priya on 12th = 1 combination
      expect(result.summary.existingCombinations).toBe(2);
      expect(result.summary.missingCombinations).toBe(4);
      expect(result.summary.duplicateCombinations).toBe(1);
      expect(result.summary.overallCoveragePercent).toBe(Math.round((2 / 6) * 100)); // 33%

      // ADO States: 1 Active, 1 Closed, 1 New
      expect(result.summary.stateCounts.Active).toBe(1);
      expect(result.summary.stateCounts.Closed).toBe(1);
      expect(result.summary.stateCounts.New).toBe(1);

      // 3. Matrix verification
      const rahulRow = result.matrix.find((r) => r.person.name === 'Rahul Sharma')!;
      expect(rahulRow.cells['2026-10-12'].status).toBe('CREATED');
      expect(rahulRow.cells['2026-10-12'].primaryTask?.id).toBe(101);
      expect(rahulRow.cells['2026-10-12'].primaryTask?.state).toBe('Active');
      expect(rahulRow.cells['2026-10-13'].status).toBe('MISSING');
      expect(rahulRow.cells['2026-10-13'].isEligibleForCreation).toBe(true); // Within rolling window

      const priyaRow = result.matrix.find((r) => r.person.name === 'Priya Patel')!;
      expect(priyaRow.cells['2026-10-12'].status).toBe('DUPLICATE');
      expect(priyaRow.cells['2026-10-12'].tasks).toHaveLength(2);

      const amitRow = result.matrix.find((r) => r.person.name === 'Amit Verma')!;
      expect(amitRow.cells['2026-10-12'].status).toBe('MISSING');
      expect(amitRow.cells['2026-10-13'].status).toBe('MISSING');

      // 4. Date Summary verification
      const oct12Summary = result.dateSummaries['2026-10-12'];
      expect(oct12Summary.expectedUsers).toBe(3);
      expect(oct12Summary.createdUsers).toBe(2); // Rahul and Priya
      expect(oct12Summary.missingUsers).toBe(1); // Amit
      expect(oct12Summary.coveragePercent).toBe(Math.round((2 / 3) * 100));
    });

    it('marks weekends as NOT_APPLICABLE and historical missing tasks as non-eligible for creation', async () => {
      const clientMock = {
        post: vi.fn().mockResolvedValue({ workItems: [] }),
        get: vi.fn().mockResolvedValue({ value: [] }),
      } as unknown as AzureDevOpsClient;

      const explorer = new TaskExplorerService(clientMock, mockConfig);

      // Date range from Friday (2026-10-09) to Monday (2026-10-12), with asOf = 2026-10-12
      // Friday 9 Oct is historical (past)
      // Sat 10 Oct & Sun 11 Oct are weekends
      // Mon 12 Oct is today (eligible)
      const result = await explorer.exploreDateRange({
        startDate: '2026-10-09',
        endDate: '2026-10-12',
        asOf: '2026-10-12',
      });

      const rahulRow = result.matrix.find((r) => r.person.name === 'Rahul Sharma')!;

      // 9 Oct (Friday - past working day)
      expect(rahulRow.cells['2026-10-09'].status).toBe('MISSING');
      expect(rahulRow.cells['2026-10-09'].isEligibleForCreation).toBe(false); // Historical date cannot be auto-created!

      // 10 Oct (Saturday - weekend)
      expect(rahulRow.cells['2026-10-10'].status).toBe('NOT_APPLICABLE');
      expect(rahulRow.cells['2026-10-10'].isWeekend).toBe(true);

      // 11 Oct (Sunday - weekend)
      expect(rahulRow.cells['2026-10-11'].status).toBe('NOT_APPLICABLE');
      expect(rahulRow.cells['2026-10-11'].isWeekend).toBe(true);

      // 12 Oct (Monday - today)
      expect(rahulRow.cells['2026-10-12'].status).toBe('MISSING');
      expect(rahulRow.cells['2026-10-12'].isEligibleForCreation).toBe(true); // Eligible!
    });

    it('supports user subset filtering', async () => {
      const clientMock = {
        post: vi.fn().mockResolvedValue({ workItems: [] }),
        get: vi.fn().mockResolvedValue({ value: [] }),
      } as unknown as AzureDevOpsClient;

      const explorer = new TaskExplorerService(clientMock, mockConfig);

      const result = await explorer.exploreDateRange({
        startDate: '2026-10-12',
        endDate: '2026-10-12',
        selectedUsers: ['rahul.sharma@company.com'],
      });

      expect(result.users).toHaveLength(1);
      expect(result.users[0].name).toBe('Rahul Sharma');
      expect(result.matrix).toHaveLength(1);
      expect(result.summary.totalSelectedUsers).toBe(1);
    });
  });
});
