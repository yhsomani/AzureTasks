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
 * Parse date from task title (format: "Prefix | MMM DD" or "Prefix | MMM DD | Details")
 */
export function parseTitleDate(
  title: string,
  titlePrefix?: string,
  allowAnyPrefix = false
): ParsedTaskDate {
  if (!title) {
    return { isoDate: '', formattedTitleDate: '', year: 0, isValid: false };
  }

  let monthStr = '';
  let dayStr = '';

  // Mode 1: If titlePrefix is provided and we are not forcing allowAnyPrefix
  if (titlePrefix && !allowAnyPrefix) {
    const rawPrefix = titlePrefix.trim().replace(/\s*\|+\s*$/, '');
    const prefixPattern = rawPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // Escape regex
    const regex = new RegExp(
      `^${prefixPattern}\\s*\\|\\s*(?:([A-Za-z]{3,9})\\s+(\\d{1,2})|(\\d{1,2})\\s+([A-Za-z]{3,9}))(?:\\s*\\|.*)?$`,
      'i'
    );
    const match = title.match(regex);
    if (match) {
      monthStr = match[1] || match[4];
      dayStr = match[2] || match[3];
    }
  }

  // Mode 2: If no prefix, or allowAnyPrefix, or prefix wasn't matched, check segments and delimiters
  if (!monthStr && (!titlePrefix || allowAnyPrefix)) {
    // 2a. Check segments split by pipe or colon
    const segments = title.split(/[|:]/).map(s => s.trim());
    for (const seg of segments) {
      const match = seg.match(/^(?:([A-Za-z]{3,9})[ -]+(\d{1,2})|(\d{1,2})[ -]+([A-Za-z]{3,9}))$/i);
      if (match) {
        const m = match[1] || match[4];
        if (monthStrToNumber(m) >= 0) {
          monthStr = m;
          dayStr = match[2] || match[3];
          break;
        }
      }
    }

    // 2b. Start of title with date (e.g. "12 October : ...", "12 Oct - ...", "October 12 : ...")
    if (!monthStr) {
      const startMatch = title.match(/^\s*(?:([A-Za-z]{3,9})[ -]+(\d{1,2})|(\d{1,2})[ -]+([A-Za-z]{3,9}))(?:\s*[:\-|]|\s+|$)/i);
      if (startMatch) {
        const m = startMatch[1] || startMatch[4];
        if (monthStrToNumber(m) >= 0) {
          monthStr = m;
          dayStr = startMatch[2] || startMatch[3];
        }
      }
    }

    // 2c. Anywhere in title: word boundary month + day or day + month
    if (!monthStr) {
      const anyMatch = title.match(/\b(?:([A-Za-z]{3,9})[ -]+(\d{1,2})|(\d{1,2})[ -]+([A-Za-z]{3,9}))\b/i);
      if (anyMatch) {
        const m = anyMatch[1] || anyMatch[4];
        if (monthStrToNumber(m) >= 0) {
          monthStr = m;
          dayStr = anyMatch[2] || anyMatch[3];
        }
      }
    }
  }

  if (!monthStr || !dayStr) {
    return { isoDate: '', formattedTitleDate: '', year: 0, isValid: false };
  }

  const month = monthStrToNumber(monthStr);
  const day = parseInt(dayStr, 10);
  const currentYear = new Date().getFullYear();

  // Reject unknown month abbreviations (e.g. "Foo 8") rather than silently
  // treating them as January.
  if (month < 0 || day < 1 || day > 31) {
    return { isoDate: '', formattedTitleDate: '', year: 0, isValid: false };
  }

  // Try current year first, then previous, then next
  let isoDate = '';
  let isValid = false;

  for (const year of [currentYear, currentYear - 1, currentYear + 1]) {
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

/**
 * Extracts the title prefix from a work item title (e.g. "Your_Relation | OCT 12" -> "Your_Relation |")
 */
/**
 * Restrict automatic task discovery and EOD operations to the configured task
 * series. parseTitleDate(..., true) parses legacy date formats regardless of
 * series, and must not be used alone as an authorization/ownership signal.
 * Compare the full segment before the first "|" (case/spacing insensitive).
 */
export function matchesTaskSeries(title: string, configuredPrefix: string): boolean {
  if (!title || !configuredPrefix || !title.includes('|')) return false;
  const normalized = (value: string) => value.split('|', 1)[0].trim().toLowerCase();
  const expected = normalized(configuredPrefix);
  return expected.length > 0 && normalized(title) === expected;
}

/**
 * Explicit source IDs are not permission to copy another person's work item,
 * or to cross project, work-item type or task series boundaries. Validate
 * the original Azure record before cloning fields and relations.
 */
export function validateSourceTaskOwnership(
  workItem: WorkItem,
  project: string,
  workItemType: string,
  titlePrefix: string,
  assignedTo: string,
): ParsedTaskDate {
  const fields = workItem.fields;
  const same = (a: unknown, b: string) =>
    typeof a === 'string' && a.trim().toLowerCase() === b.trim().toLowerCase();
  if (!same(fields['System.TeamProject'], project) ||
      !same(fields['System.WorkItemType'], workItemType)) {
    throw new Error(`Source work item #${workItem.id} does not belong to the configured project and task type.`);
  }
  const title = String(fields['System.Title'] || '');
  if (!matchesTaskSeries(title, titlePrefix)) {
    throw new Error(`Source work item #${workItem.id} belongs to a different task series.`);
  }

  // Azure's uniqueName is preferred to display-name substring heuristics.
  const raw = fields['System.AssignedTo'];
  let actualIdentity: string | undefined;
  if (typeof raw === 'string') {
    actualIdentity = raw.match(/<([^>]+)>/)?.[1] || raw.trim();
  } else if (raw && typeof raw === 'object') {
    actualIdentity = String((raw as any).uniqueName || (raw as any).displayName || '').trim();
  }
  if (!actualIdentity || !same(actualIdentity, assignedTo)) {
    throw new Error(`Source work item #${workItem.id} is not assigned to the selected team member.`);
  }
  const parsed = parseTitleDate(title, titlePrefix, true);
  if (!parsed.isValid) {
    throw new Error(`Source work item #${workItem.id} has no unambiguous dated task title.`);
  }
  return parsed;
}

export function extractTitlePrefix(title: string): string {
  if (!title) return '';
  const parts = title.split('|');
  if (parts.length > 1 && parts[0].trim().length > 0) {
    return parts[0].trim() + ' |';
  }
  return '';
}

function monthStrToNumber(month: string): number {
  const norm = month.toLowerCase().slice(0, 3);
  const months: Record<string, number> = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
  };
  return months[norm] ?? -1;
}