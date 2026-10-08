/**
 * Relationship and link copying logic for Azure DevOps work items.
 * Phase 2 applies relationships to newly created work items while filtering out
 * unsupported types (e.g. binary attachments) and circular self-references.
 */

import { JsonPatchOperation, WorkItem, WorkItemRelation } from '../azure/types.js';
import { WorkItemService } from '../azure/work-item-service.js';
import { EXCLUDED_RELATION_TYPES, SUPPORTED_RELATION_TYPES } from '../config/constants.js';
import { logger } from '../utils/logger.js';

export interface RelationCopyResult {
  totalRelations: number;
  copiedCount: number;
  failedCount: number;
  skippedCount: number;
  failedDetails: string[];
}

/**
 * Filters source relationships to identify supported, copyable relations
 */
export function filterCopyableRelations(
  relations: WorkItemRelation[] | undefined,
  createdTaskId: number
): WorkItemRelation[] {
  if (!relations || relations.length === 0) {
    return [];
  }

  const copyable: WorkItemRelation[] = [];
  const seenUrls = new Set<string>();

  for (const rel of relations) {
    if (!rel.rel || !rel.url) {
      continue;
    }

    // Filter out binary attachments by default (Section 18)
    if (EXCLUDED_RELATION_TYPES.has(rel.rel)) {
      continue;
    }

    // Check if relation type is supported
    if (!SUPPORTED_RELATION_TYPES.has(rel.rel)) {
      continue;
    }

    // Prevent self-references
    if (rel.url.includes(`/_apis/wit/workItems/${createdTaskId}`)) {
      continue;
    }

    // Deduplicate identical relations (same rel + url)
    const key = `${rel.rel}:::${rel.url}`;
    if (seenUrls.has(key)) {
      continue;
    }
    seenUrls.add(key);

    copyable.push(rel);
  }

  return copyable;
}

/**
 * Builds JSON Patch operations for adding relations to a work item
 */
export function buildRelationPatchOperations(relations: WorkItemRelation[]): JsonPatchOperation[] {
  return relations.map((rel) => ({
    op: 'add',
    path: '/relations/-',
    value: {
      rel: rel.rel,
      url: rel.url,
      attributes: rel.attributes ? { ...rel.attributes } : undefined,
    },
  }));
}

/**
 * Copies relations from source task to the newly created task (Phase 2).
 * Handles partial failures gracefully without deleting the created task.
 */
export async function copyTaskRelations(
  workItemService: WorkItemService,
  sourceTask: WorkItem,
  createdTaskId: number
): Promise<RelationCopyResult> {
  const sourceRelations = sourceTask.relations || [];
  const eligibleRelations = filterCopyableRelations(sourceRelations, createdTaskId);
  const skippedCount = sourceRelations.length - eligibleRelations.length;

  if (eligibleRelations.length === 0) {
    return {
      totalRelations: sourceRelations.length,
      copiedCount: 0,
      failedCount: 0,
      skippedCount,
      failedDetails: [],
    };
  }

  logger.debug(
    `Applying ${eligibleRelations.length} relations to work item #${createdTaskId}...`
  );

  // Apply relations in a single patch operation if possible, falling back to individual if batch fails
  const patchOps = buildRelationPatchOperations(eligibleRelations);

  try {
    await workItemService.updateWorkItem(createdTaskId, patchOps);
    return {
      totalRelations: sourceRelations.length,
      copiedCount: eligibleRelations.length,
      failedCount: 0,
      skippedCount,
      failedDetails: [],
    };
  } catch (batchError) {
    logger.warn(
      `Batch relation update failed for #${createdTaskId}. Attempting individual relation copy... Details: ${
        batchError instanceof Error ? batchError.message : String(batchError)
      }`
    );

    // Fall back to applying relations individually to isolate failures
    let copiedCount = 0;
    let failedCount = 0;
    const failedDetails: string[] = [];

    for (const rel of eligibleRelations) {
      try {
        const singlePatch = buildRelationPatchOperations([rel]);
        await workItemService.updateWorkItem(createdTaskId, singlePatch);
        copiedCount++;
      } catch (singleErr) {
        failedCount++;
        const errMsg = singleErr instanceof Error ? singleErr.message : String(singleErr);
        const detail = `${rel.rel} -> ${rel.url}: ${errMsg}`;
        failedDetails.push(detail);
        logger.warn(`Failed to copy relation ${rel.rel} to #${createdTaskId}: ${errMsg}`);
      }
    }

    return {
      totalRelations: sourceRelations.length,
      copiedCount,
      failedCount,
      skippedCount,
      failedDetails,
    };
  }
}
