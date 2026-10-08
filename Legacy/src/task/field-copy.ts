/**
 * Field copying and overriding logic for Azure DevOps work items.
 * Extracts user-editable fields, filters out system-managed/read-only fields,
 * and sets mandated overrides (Title, AssignedTo, State='New', StartDate='09:30 AM').
 */

import { JsonPatchOperation, WorkItem } from '../azure/types.js';
import { OVERRIDDEN_FIELDS, SYSTEM_EXCLUDED_FIELDS } from '../config/constants.js';

export interface BuildWorkItemFieldsOptions {
  sourceWorkItem: WorkItem;
  newTitle: string;
  targetIsoDate: string; // YYYY-MM-DD
  assignedTo: string; // Target assignee identity
  startTime?: string; // e.g. "09:30"
  timezone?: string; // e.g. "Asia/Kolkata"
}

/**
 * Converts a date and time string in a specific timezone into ISO string with offset
 */
export function formatStartDateTime(isoDate: string, time = '09:30', timezone = 'Asia/Kolkata'): string {
  if (timezone === 'Asia/Kolkata' || timezone === 'IST') {
    return `${isoDate}T${time}:00+05:30`;
  }

  try {
    const dummyDate = new Date(`${isoDate}T${time}:00Z`);
    const tzString = dummyDate.toLocaleString('en-US', { timeZone: timezone, timeZoneName: 'shortOffset' });
    const match = tzString.match(/GMT([+-]\d{1,2}(?::\d{2})?)/);
    if (match) {
      let offset = match[1];
      if (!offset.includes(':')) {
        offset = `${offset}:00`;
      }
      return `${isoDate}T${time}:00${offset}`;
    }
  } catch {
    // ignore
  }

  return `${isoDate}T${time}:00+05:30`;
}

/**
 * Builds the Phase 1 JSON Patch document to create the new work item
 */
export function buildFieldPatchOperations(options: BuildWorkItemFieldsOptions): JsonPatchOperation[] {
  const {
    sourceWorkItem,
    newTitle,
    targetIsoDate,
    assignedTo,
    startTime = '09:30',
    timezone = 'Asia/Kolkata',
  } = options;

  const patchOps: JsonPatchOperation[] = [];
  const sourceFields = sourceWorkItem.fields;

  // 1. Copy all non-system, non-overridden user fields
  for (const [fieldName, value] of Object.entries(sourceFields)) {
    if (SYSTEM_EXCLUDED_FIELDS.has(fieldName)) {
      continue;
    }
    if (OVERRIDDEN_FIELDS.has(fieldName)) {
      continue;
    }
    if (value === null || value === undefined || value === '') {
      continue;
    }

    patchOps.push({
      op: 'add',
      path: `/fields/${fieldName}`,
      value,
    });
  }

  // 2. Set Mandatory Overrides:
  // Title (Section 20)
  patchOps.push({
    op: 'add',
    path: '/fields/System.Title',
    value: newTitle,
  });

  // Assigned To (Section 21)
  patchOps.push({
    op: 'add',
    path: '/fields/System.AssignedTo',
    value: assignedTo,
  });

  // State: ALWAYS 'New' (Section 22)
  patchOps.push({
    op: 'add',
    path: '/fields/System.State',
    value: 'New',
  });

  // Start Date / Time: 9:30 AM on assigned date (Section 23)
  const startDateTime = formatStartDateTime(targetIsoDate, startTime, timezone);
  patchOps.push({
    op: 'add',
    path: '/fields/Microsoft.VSTS.Scheduling.StartDate',
    value: startDateTime,
  });

  return patchOps;
}
