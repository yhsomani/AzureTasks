/**
 * Task Entity and related domain types
 * Core business entities for Azure DevOps work items
 */

export interface WorkItemFields {
  'System.Id'?: number;
  'System.Title'?: string;
  'System.State'?: string;
  'System.WorkItemType'?: string;
  'System.AssignedTo'?: { displayName: string; uniqueName: string };
  'System.CreatedDate'?: string;
  'System.ChangedDate'?: string;
  'System.AreaPath'?: string;
  'System.IterationPath'?: string;
  'Microsoft.VSTS.Scheduling.StartDate'?: string;
  'Microsoft.VSTS.Scheduling.OriginalEstimate'?: number;
  'Microsoft.VSTS.Scheduling.RemainingWork'?: number;
  'Microsoft.VSTS.Scheduling.CompletedWork'?: number;
  [key: string]: any;
}

export interface WorkItem {
  id: number;
  rev: number;
  fields: WorkItemFields;
  relations?: WorkItemRelation[];
  url?: string;
}

export interface WorkItemRelation {
  rel: string;
  url: string;
  attributes?: {
    name?: string;
    comment?: string;
    isLocked?: boolean;
  };
}

export interface ParsedTaskDate {
  isoDate: string;
  formattedTitleDate: string;
  year: number;
  isValid: boolean;
}

export interface DiscoveredTask {
  workItem: WorkItem;
  parsedDate: ParsedTaskDate;
  key: string; // Person key this task belongs to
}

export interface CreatedTask {
  id: number;
  title: string;
  isoDate: string;
  url: string;
}

export interface TaskCreationResult {
  success: boolean;
  task?: CreatedTask;
  error?: string;
  fieldCopyStatus: 'SUCCESS' | 'FAILED';
  relationCopyStatus: 'SUCCESS' | 'PARTIAL' | 'FAILED';
  relationsProcessed: number;
  relationsFailed: number;
  verified: boolean;
}

/**
 * Relation types that are safe to copy (whitelist).
 * Mirrors the verified legacy rule: Parent/Hierarchy-Reverse is safe,
 * Dependency/Duplicate both directions, Hyperlink and ArtifactLink.
 */
export const COPYABLE_RELATION_TYPES = [
  'System.LinkTypes.Hierarchy-Reverse',
  'System.LinkTypes.Related',
  'System.LinkTypes.Dependency-Forward',
  'System.LinkTypes.Dependency-Reverse',
  'System.LinkTypes.Dependency-Predecessor',
  'System.LinkTypes.Dependency-Successor',
  'System.LinkTypes.Duplicate-Forward',
  'System.LinkTypes.Duplicate-Reverse',
  'Hyperlink',
  'ArtifactLink',
] as const;

export type CopyableRelationType = typeof COPYABLE_RELATION_TYPES[number];

/**
 * Relation types that must NOT be copied.
 * - Hierarchy-Forward (Child): would reparent the source's children.
 * - AttachedFile: binary attachments are not re-uploaded.
 */
export const EXCLUDED_RELATION_TYPES = [
  'System.LinkTypes.Hierarchy-Forward',
  'AttachedFile',
] as const;

/**
 * Check if a relation type is safe to copy
 */
export function isRelationCopyable(relType: string): boolean {
  return COPYABLE_RELATION_TYPES.includes(relType as CopyableRelationType);
}

/**
 * Check if a relation type is excluded (prevents reparenting)
 */
export function isRelationExcluded(relType: string): boolean {
  return EXCLUDED_RELATION_TYPES.includes(relType as any);
}

/**
 * Filter relations to only copyable ones
 */
export function filterCopyableRelations(relations: WorkItemRelation[]): WorkItemRelation[] {
  const seen = new Set<string>();
  const out: WorkItemRelation[] = [];
  for (const r of relations) {
    if (!r.rel || !r.url) continue;
    if (!isRelationCopyable(r.rel) || isRelationExcluded(r.rel)) continue;
    const key = `${r.rel}:::${r.url}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(r);
  }
  return out;
}

/**
 * Parse date from task title (format: "Prefix | MMM DD")
 */
export function parseTitleDate(title: string, titlePrefix: string): ParsedTaskDate {
  // Prefix may or may not include the trailing "|" separator; normalize it away.
  const rawPrefix = titlePrefix.trim().replace(/\s*\|+\s*$/, '');
  const prefixPattern = rawPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // Escape regex
  const regex = new RegExp(`^${prefixPattern}\\s*\\|\\s*([A-Za-z]{3})\\s+(\\d{1,2})$`);
  
  const match = title.match(regex);
  if (!match) {
    return { isoDate: '', formattedTitleDate: '', year: 0, isValid: false };
  }
  
  const [, monthStr, dayStr] = match;
  const month = monthStrToNumber(monthStr);
  const day = parseInt(dayStr, 10);
  const currentYear = new Date().getFullYear();

  // Reject unknown month abbreviations (e.g. "Foo 8") rather than silently
  // treating them as January.
  if (month < 0) {
    return { isoDate: '', formattedTitleDate: '', year: 0, isValid: false };
  }
  
  // Try current year first, then previous
  let isoDate = '';
  let isValid = false;
  
  for (const year of [currentYear, currentYear - 1]) {
    const testDate = new Date(Date.UTC(year, month, day));
    if (testDate.getUTCMonth() === month && testDate.getUTCDate() === day) {
      isoDate = testDate.toISOString().split('T')[0];
      isValid = true;
      break;
    }
  }
  
  const formatted = `${monthStr} ${day}`;
  
  return { isoDate, formattedTitleDate: formatted, year: currentYear, isValid };
}

function monthStrToNumber(month: string): number {
  const months: Record<string, number> = {
    Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
    Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
  };
  return months[month] ?? -1;
}