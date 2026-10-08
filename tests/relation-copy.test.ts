import { describe, it, expect, vi } from 'vitest';
import { AzureDevOpsClient } from '../src/azure/client.js';
import { WorkItem, WorkItemRelation } from '../src/azure/types.js';
import { WorkItemService } from '../src/azure/work-item-service.js';
import {
  buildRelationPatchOperations,
  copyTaskRelations,
  filterCopyableRelations,
} from '../src/task/relation-copy.js';

describe('Relation Copy Service', () => {
  const dummyClient = {} as AzureDevOpsClient;

  it('filters out binary attachments and self-references while keeping supported links', () => {
    const mockRelations: WorkItemRelation[] = [
      // Parent User Story link -> MUST be kept
      {
        rel: 'System.LinkTypes.Hierarchy-Reverse',
        url: 'https://dev.azure.com/BFLDevOpsOrg/_apis/wit/workItems/10001',
        attributes: { name: 'Parent', comment: 'Parent User Story' },
      },
      // Related work item link -> MUST be kept
      {
        rel: 'System.LinkTypes.Related',
        url: 'https://dev.azure.com/BFLDevOpsOrg/_apis/wit/workItems/10002',
        attributes: { name: 'Related' },
      },
      // External Hyperlink -> MUST be kept
      {
        rel: 'Hyperlink',
        url: 'https://wiki.company.com/test-spec',
        attributes: { comment: 'Test spec doc' },
      },
      // Binary Attachment -> MUST be excluded per Section 18
      {
        rel: 'AttachedFile',
        url: 'https://dev.azure.com/BFLDevOpsOrg/_apis/wit/attachments/abc-123',
        attributes: { name: 'screenshot.png' },
      },
      // Self-reference to newly created task #20000 -> MUST be excluded
      {
        rel: 'System.LinkTypes.Related',
        url: 'https://dev.azure.com/BFLDevOpsOrg/_apis/wit/workItems/20000',
      },
      // Duplicate of parent link -> MUST be deduplicated
      {
        rel: 'System.LinkTypes.Hierarchy-Reverse',
        url: 'https://dev.azure.com/BFLDevOpsOrg/_apis/wit/workItems/10001',
      },
    ];

    const copyable = filterCopyableRelations(mockRelations, 20000);

    expect(copyable).toHaveLength(3);
    expect(copyable[0].rel).toBe('System.LinkTypes.Hierarchy-Reverse');
    expect(copyable[1].rel).toBe('System.LinkTypes.Related');
    expect(copyable[2].rel).toBe('Hyperlink');

    // Build patch ops
    const patchOps = buildRelationPatchOperations(copyable);
    expect(patchOps).toHaveLength(3);
    expect(patchOps[0].op).toBe('add');
    expect(patchOps[0].path).toBe('/relations/-');
  });

  it('handles batch relationship copy failure by falling back to individual items', async () => {
    const workItemService = new WorkItemService(dummyClient);

    const mockSourceTask: WorkItem = {
      id: 45231,
      rev: 1,
      url: 'https://dev.azure.com/test/_apis/wit/workItems/45231',
      fields: {},
      relations: [
        {
          rel: 'System.LinkTypes.Hierarchy-Reverse',
          url: 'https://dev.azure.com/test/_apis/wit/workItems/111',
        },
        {
          rel: 'System.LinkTypes.Related',
          url: 'https://dev.azure.com/test/_apis/wit/workItems/222', // will fail
        },
      ],
    };

    // First call (batch) fails
    // Second call (single 111) succeeds
    // Third call (single 222) fails
    let callCount = 0;
    vi.spyOn(workItemService, 'updateWorkItem').mockImplementation(async (_id, ops) => {
      callCount++;
      if (callCount === 1) {
        throw new Error('Batch relation error: one relation is invalid');
      }
      if (ops[0]?.value?.url.includes('222')) {
        throw new Error('Target work item 222 not found');
      }
      return {} as WorkItem;
    });

    const result = await copyTaskRelations(workItemService, mockSourceTask, 50000);

    expect(result.totalRelations).toBe(2);
    expect(result.copiedCount).toBe(1);
    expect(result.failedCount).toBe(1);
    expect(result.failedDetails).toHaveLength(1);
    expect(result.failedDetails[0]).toContain('222');
  });

  it('Section 16: strictly excludes child relations (Hierarchy-Forward) from copying to prevent illegal reparenting', () => {
    const relationsWithChild: WorkItemRelation[] = [
      {
        rel: 'System.LinkTypes.Hierarchy-Forward',
        url: 'https://dev.azure.com/BFLDevOpsOrg/_apis/wit/workItems/99999',
        attributes: { name: 'Child' },
      },
      {
        rel: 'System.LinkTypes.Hierarchy-Reverse',
        url: 'https://dev.azure.com/BFLDevOpsOrg/_apis/wit/workItems/88888',
        attributes: { name: 'Parent' },
      },
    ];

    const copyable = filterCopyableRelations(relationsWithChild, 1000);

    // Only parent should be copied, child MUST be excluded!
    expect(copyable).toHaveLength(1);
    expect(copyable[0].rel).toBe('System.LinkTypes.Hierarchy-Reverse');
    expect(copyable[0].url).toContain('88888');
  });
});
