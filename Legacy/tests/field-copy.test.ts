import { describe, it, expect } from 'vitest';
import { WorkItem } from '../src/azure/types.js';
import { buildFieldPatchOperations, formatStartDateTime } from '../src/task/field-copy.js';

describe('Field Copy Service', () => {
  it('formats start date/time with 9:30 AM in configured timezone', () => {
    const formatted = formatStartDateTime('2026-10-12', '09:30', 'Asia/Kolkata');
    expect(formatted).toBe('2026-10-12T09:30:00+05:30');
  });

  it('excludes system and generated fields while copying business fields and applying overrides', () => {
    const mockSourceWorkItem: WorkItem = {
      id: 45231,
      rev: 5,
      url: 'https://dev.azure.com/BFLDevOpsOrg/_apis/wit/workItems/45231',
      fields: {
        // System / read-only fields to exclude
        'System.Id': 45231,
        'System.Rev': 5,
        'System.CreatedDate': '2026-10-07T04:00:00Z',
        'System.CreatedBy': { displayName: 'John Doe' },
        'System.ChangedDate': '2026-10-08T04:00:00Z',
        'System.ChangedBy': { displayName: 'Jane Doe' },
        'System.Watermark': 12345,
        'System.TeamProject': '3in1_Agile_Projects',
        'System.WorkItemType': '3in1 Task',
        'System.BoardColumn': 'Doing',
        'System.BoardColumnDone': false,
        'Microsoft.VSTS.Common.ActivatedDate': '2026-10-07T05:00:00Z',
        'Microsoft.VSTS.Common.ClosedDate': '2026-10-07T12:00:00Z',

        // Fields that should be overridden
        'System.Title': '3in1_PWA_MyAccount | 7 Oct',
        'System.State': 'Closed', // Even if Closed, new task MUST be New!

        // Business fields to copy
        'System.Description': '<p>Daily regression suite execution for MyAccount</p>',
        'Microsoft.VSTS.Common.AcceptanceCriteria': '<p>All P0 tests must pass</p>',
        'Microsoft.VSTS.Common.Priority': 2,
        'System.Tags': 'MyAccount; Automation; PWA',
        'System.AreaPath': '3in1_Agile_Projects\\MyAccount',
        'System.IterationPath': '3in1_Agile_Projects\\Sprint 12',
        'Microsoft.VSTS.Scheduling.OriginalEstimate': 4.0,
        'Microsoft.VSTS.Scheduling.RemainingWork': 4.0,
        'Custom.AutomationSuite': 'PWA_Sanity',
      },
    };

    const patchOps = buildFieldPatchOperations({
      sourceWorkItem: mockSourceWorkItem,
      newTitle: '3in1_PWA_MyAccount | 8 Oct',
      targetIsoDate: '2026-10-08',
      assignedTo: 'john.doe@company.com',
      startTime: '09:30',
      timezone: 'Asia/Kolkata',
    });

    const patchMap = new Map(patchOps.map((op) => [op.path, op.value]));

    // Check system fields are NOT present
    expect(patchMap.has('/fields/System.Id')).toBe(false);
    expect(patchMap.has('/fields/System.Rev')).toBe(false);
    expect(patchMap.has('/fields/System.CreatedDate')).toBe(false);
    expect(patchMap.has('/fields/System.CreatedBy')).toBe(false);
    expect(patchMap.has('/fields/System.ChangedDate')).toBe(false);
    expect(patchMap.has('/fields/System.BoardColumn')).toBe(false);
    expect(patchMap.has('/fields/Microsoft.VSTS.Common.ClosedDate')).toBe(false);

    // Check mandatory overrides
    expect(patchMap.get('/fields/System.Title')).toBe('3in1_PWA_MyAccount | 8 Oct');
    expect(patchMap.get('/fields/System.AssignedTo')).toBe('john.doe@company.com');
    expect(patchMap.get('/fields/System.State')).toBe('New'); // ALWAYS New!
    expect(patchMap.get('/fields/Microsoft.VSTS.Scheduling.StartDate')).toBe('2026-10-08T09:30:00+05:30');

    // Check business fields are preserved
    expect(patchMap.get('/fields/System.Description')).toBe('<p>Daily regression suite execution for MyAccount</p>');
    expect(patchMap.get('/fields/Microsoft.VSTS.Common.Priority')).toBe(2);
    expect(patchMap.get('/fields/System.Tags')).toBe('MyAccount; Automation; PWA');
    expect(patchMap.get('/fields/System.AreaPath')).toBe('3in1_Agile_Projects\\MyAccount');
    expect(patchMap.get('/fields/System.IterationPath')).toBe('3in1_Agile_Projects\\Sprint 12');
    expect(patchMap.get('/fields/Microsoft.VSTS.Scheduling.OriginalEstimate')).toBe(4.0);
    expect(patchMap.get('/fields/Custom.AutomationSuite')).toBe('PWA_Sanity');
  });
});
