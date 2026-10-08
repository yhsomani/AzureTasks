/**
 * Azure DevOps Work Item field definitions, excluded system fields,
 * and supported relation types.
 */

export const SYSTEM_EXCLUDED_FIELDS = new Set<string>([
  'System.Id',
  'System.Rev',
  'System.CreatedDate',
  'System.CreatedBy',
  'System.ChangedDate',
  'System.ChangedBy',
  'System.Watermark',
  'System.TeamProject',
  'System.WorkItemType',
  'System.NodeName',
  'System.AreaId',
  'System.IterationId',
  'System.AuthorizedDate',
  'System.RevisedDate',
  'System.AuthorizedAs',
  'System.PersonId',
  'System.BoardColumn',
  'System.BoardColumnDone',
  'System.BoardLane',
  'System.Reason',
  'System.CommentCount',
  'System.AttachedFileCount',
  'System.HyperLinkCount',
  'System.ExternalLinkCount',
  'System.RelatedLinkCount',
  // Historical / lifecycle tracking fields that should not carry over
  'Microsoft.VSTS.Common.ActivatedDate',
  'Microsoft.VSTS.Common.ActivatedBy',
  'Microsoft.VSTS.Common.ResolvedDate',
  'Microsoft.VSTS.Common.ResolvedBy',
  'Microsoft.VSTS.Common.ClosedDate',
  'Microsoft.VSTS.Common.ClosedBy',
  'Microsoft.VSTS.Common.StateChangeDate',
  'Microsoft.VSTS.Scheduling.TargetDate',
  'Microsoft.VSTS.Scheduling.FinishDate',
  'Microsoft.VSTS.Scheduling.CompletedWork',
]);

/**
 * Fields that must be explicitly overridden for newly created tasks
 */
export const OVERRIDDEN_FIELDS = new Set<string>([
  'System.Title',
  'System.State',
  'Microsoft.VSTS.Scheduling.StartDate',
  'System.AssignedTo',
]);

/**
 * Supported relation types that can be replicated to new tasks.
 * NOTE: Child links (Hierarchy-Forward) are strictly excluded from automated cloning
 * because a child work item can only have one parent; re-linking would implicitly
 * steal the child from the source work item.
 */
export const SUPPORTED_RELATION_TYPES = new Set<string>([
  'System.LinkTypes.Hierarchy-Reverse',     // Parent (safe: links new task to same parent)
  'System.LinkTypes.Related',               // Related
  'System.LinkTypes.Dependency-Predecessor', // Predecessor
  'System.LinkTypes.Dependency-Successor',   // Successor
  'System.LinkTypes.Duplicate-Reverse',     // Duplicate of
  'System.LinkTypes.Duplicate-Forward',     // Duplicate
  'Hyperlink',                              // Hyperlink
  'ArtifactLink',                           // External artifact (git, commit, PR, build)
]);

/**
 * Relation types to exclude (e.g. binary attachments and reparenting)
 */
export const EXCLUDED_RELATION_TYPES = new Set<string>([
  'System.LinkTypes.Hierarchy-Forward', // Child (reparenting prohibited)
  'AttachedFile', // Work item file attachments are excluded by default
]);

export const RELATION_SKIP_REASONS: Record<string, string> = {
  'System.LinkTypes.Hierarchy-Forward':
    'Child link skipped: child work items cannot be reparented automatically without altering source hierarchy.',
  'AttachedFile':
    'Attachment reference skipped: binary files are not re-uploaded by default to prevent storage bloat.',
};
