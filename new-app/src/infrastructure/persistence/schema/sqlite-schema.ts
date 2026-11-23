import { sql } from 'drizzle-orm';
import {
  sqliteTable,
  text,
  integer,
  real,
  primaryKey,
  foreignKey,
  index,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

// 1. System & Operational Configuration
export const appSettings = sqliteTable('app_settings', {
  key: text('key').primaryKey(),
  valueJson: text('value_json').notNull(),
  category: text('category').notNull().default('general'),
  description: text('description'),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
});

// 2. Multi-Tenant Organization & Team Hierarchy
export const organizations = sqliteTable('organizations', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
});

export const departments = sqliteTable('departments', {
  id: text('id').primaryKey(),
  orgId: text('org_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});

// 3. Azure DevOps Projects
export const azureProjects = sqliteTable('azure_projects', {
  projectId: text('project_id').primaryKey(),
  name: text('name').notNull(),
  state: text('state'),
  visibility: text('visibility'),
  revision: integer('revision'),
  isAuthoritativeForTasks: integer('is_authoritative_for_tasks').notNull().default(0),
  isAuthoritativeForCicd: integer('is_authoritative_for_cicd').notNull().default(0),
  lastUpdateTime: text('last_update_time'),
  syncRunId: text('sync_run_id'),
  syncedAt: text('synced_at').notNull().default(sql`(datetime('now'))`),
});

// 4. Canonical Identity Resolution System
export const canonicalIdentities = sqliteTable('canonical_identities', {
  id: text('id').primaryKey(),
  canonicalEmail: text('canonical_email').notNull().unique(),
  displayName: text('display_name').notNull(),
  primaryUsername: text('primary_username'),
  avatarUrl: text('avatar_url'),
  isActive: integer('is_active').notNull().default(1),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
});

export const teams = sqliteTable('teams', {
  id: text('id').primaryKey(),
  deptId: text('dept_id')
    .notNull()
    .references(() => departments.id, { onDelete: 'cascade' }),
  projectId: text('project_id')
    .references(() => azureProjects.projectId, { onDelete: 'set null' }),
  azureTeamId: text('azure_team_id'),
  name: text('name').notNull(),
  description: text('description'),
  isActive: integer('is_active').notNull().default(1),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
});

// Legacy members table preserved for backward compatibility
export const members = sqliteTable('members', {
  id: text('id').primaryKey(),
  teamId: text('team_id')
    .notNull()
    .references(() => teams.id, { onDelete: 'cascade' }),
  email: text('email').notNull().unique(),
  displayName: text('display_name').notNull(),
  role: text('role').notNull().default('Developer'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});

export const identityAliases = sqliteTable(
  'identity_aliases',
  {
    id: text('id').primaryKey(),
    canonicalId: text('canonical_id')
      .notNull()
      .references(() => canonicalIdentities.id, { onDelete: 'cascade' }),
    identityType: text('identity_type').notNull(),
    aliasValue: text('alias_value').notNull(),
    isVerified: integer('is_verified').notNull().default(1),
    createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  },
  (table) => ({
    unqTypeAlias: uniqueIndex('idx_identity_aliases_unique').on(table.identityType, table.aliasValue),
    idxIdentityAlias: index('idx_identity_alias').on(table.identityType, table.aliasValue),
  })
);

export const teamMembers = sqliteTable(
  'team_members',
  {
    id: text('id').primaryKey(),
    teamId: text('team_id')
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    canonicalId: text('canonical_id')
      .notNull()
      .references(() => canonicalIdentities.id, { onDelete: 'cascade' }),
    role: text('role').notNull().default('Developer'),
    pod: text('pod'),
    titlePrefix: text('title_prefix'),
    autoCloseEnabled: integer('auto_close_enabled').notNull().default(1),
    enabled: integer('enabled').notNull().default(1),
    sourceTaskId: integer('source_task_id'),
    githubRepositoriesJson: text('github_repositories_json'),
    githubBranchesJson: text('github_branches_json'),
    createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
    updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
  },
  (table) => ({
    unqTeamMember: uniqueIndex('idx_team_members_unique').on(table.teamId, table.canonicalId),
  })
);

// 5. Work Calendar & Scheduling
export const workCalendars = sqliteTable('work_calendars', {
  id: text('id').primaryKey(),
  teamId: text('team_id')
    .notNull()
    .references(() => teams.id, { onDelete: 'cascade' }),
  timezone: text('timezone').notNull().default('Asia/Kolkata'),
  cycleAnchorDay: integer('cycle_anchor_day').notNull().default(4),
  defaultHours: real('default_hours').notNull().default(8.0),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});

export const calendarExceptions = sqliteTable('calendar_exceptions', {
  id: text('id').primaryKey(),
  calendarId: text('calendar_id')
    .notNull()
    .references(() => workCalendars.id, { onDelete: 'cascade' }),
  date: text('date').notNull(),
  isWorkingDay: integer('is_working_day').notNull().default(0),
  availableHours: real('available_hours').notNull().default(0.0),
  canonicalId: text('canonical_id')
    .references(() => canonicalIdentities.id, { onDelete: 'set null' }),
  description: text('description'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});

// 6. Azure DevOps Work Items & Revisions
export const workItems = sqliteTable(
  'work_items',
  {
    projectId: text('project_id')
      .notNull()
      .references(() => azureProjects.projectId, { onDelete: 'cascade' }),
    workItemId: integer('work_item_id').notNull(),
    type: text('type').notNull(),
    title: text('title').notNull(),
    state: text('state').notNull(),
    assignedIdentityId: text('assigned_identity_id')
      .references(() => canonicalIdentities.id, { onDelete: 'set null' }),
    rawAssignedToJson: text('raw_assigned_to_json'),
    areaPath: text('area_path').notNull(),
    iterationPath: text('iteration_path').notNull(),
    createdDate: text('created_date').notNull(),
    changedDate: text('changed_date').notNull(),
    closedDate: text('closed_date'),
    parentId: integer('parent_id'),
    tags: text('tags'),
    originalEstimate: real('original_estimate'),
    remainingWork: real('remaining_work'),
    completedWork: real('completed_work'),
    payloadJson: text('payload_json').notNull(),
    syncRunId: text('sync_run_id'),
    syncedAt: text('synced_at').notNull().default(sql`(datetime('now'))`),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.projectId, table.workItemId] }),
    idxAssigned: index('idx_work_items_assigned').on(table.assignedIdentityId, table.state),
    idxProjectState: index('idx_work_items_project_state').on(table.projectId, table.state),
  })
);

export const workItemRevisions = sqliteTable(
  'work_item_revisions',
  {
    projectId: text('project_id').notNull(),
    workItemId: integer('work_item_id').notNull(),
    revision: integer('revision').notNull(),
    state: text('state'),
    changedByIdentityId: text('changed_by_identity_id')
      .references(() => canonicalIdentities.id, { onDelete: 'set null' }),
    changedAt: text('changed_at').notNull(),
    fieldsJson: text('fields_json').notNull(),
    syncRunId: text('sync_run_id'),
    syncedAt: text('synced_at').notNull().default(sql`(datetime('now'))`),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.projectId, table.workItemId, table.revision] }),
    fkWorkItem: foreignKey({
      columns: [table.projectId, table.workItemId],
      foreignColumns: [workItems.projectId, workItems.workItemId],
    }).onDelete('cascade'),
  })
);

// 7. Operational Task Execution & Cryptographic Auditing
export const planTokens = sqliteTable('plan_tokens', {
  tokenHash: text('token_hash').primaryKey(),
  planToken: text('plan_token').notNull(),
  operatorId: text('operator_id')
    .references(() => canonicalIdentities.id, { onDelete: 'set null' }),
  operatorEmail: text('operator_email'),
  expiresAt: integer('expires_at').notNull(),
  isExecuted: integer('is_executed').notNull().default(0),
  executedAt: text('executed_at'),
  snapshotJson: text('snapshot_json').notNull(),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});

export const journalEntries = sqliteTable(
  'journal_entries',
  {
    id: text('id').primaryKey(),
    runId: text('run_id'),
    teamId: text('team_id')
      .references(() => teams.id, { onDelete: 'set null' }),
    operatorId: text('operator_id')
      .references(() => canonicalIdentities.id, { onDelete: 'set null' }),
    operatorEmail: text('operator_email'),
    actionType: text('action_type').notNull(),
    workItemId: integer('work_item_id'),
    projectId: text('project_id')
      .references(() => azureProjects.projectId, { onDelete: 'set null' }),
    targetIsoDate: text('target_iso_date'),
    title: text('title'),
    fieldCopyStatus: text('field_copy_status'),
    relationCopyStatus: text('relation_copy_status'),
    verified: integer('verified').notNull().default(1),
    detailsJson: text('details_json').notNull(),
    createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  },
  (table) => ({
    idxCreated: index('idx_journal_created').on(table.createdAt),
    idxWorkItem: index('idx_journal_work_item').on(table.workItemId),
  })
);

// 8. Automated Closure Governance
export const autoClosureRules = sqliteTable('auto_closure_rules', {
  id: text('id').primaryKey(),
  teamId: text('team_id')
    .notNull()
    .references(() => teams.id, { onDelete: 'cascade' }),
  ruleName: text('rule_name').notNull().default('Default Rule'),
  cutoffTime: text('cutoff_time').notNull().default('18:00'),
  minHours: real('min_hours').notNull().default(8.0),
  requirePrEvidence: integer('require_pr_evidence').notNull().default(1),
  requireGitCommits: integer('require_git_commits').notNull().default(0),
  isActive: integer('is_active').notNull().default(1),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
});

export const autoClosureAuditLogs = sqliteTable(
  'auto_closure_audit_logs',
  {
    id: text('id').primaryKey(),
    ruleId: text('rule_id')
      .references(() => autoClosureRules.id, { onDelete: 'set null' }),
    taskId: integer('task_id').notNull(),
    projectId: text('project_id')
      .references(() => azureProjects.projectId, { onDelete: 'set null' }),
    canonicalId: text('canonical_id')
      .references(() => canonicalIdentities.id, { onDelete: 'set null' }),
    evaluationStatus: text('evaluation_status').notNull(),
    prEvidenceJson: text('pr_evidence_json'),
    decisionReason: text('decision_reason').notNull(),
    operatorOverrideId: text('operator_override_id')
      .references(() => canonicalIdentities.id, { onDelete: 'set null' }),
    evaluatedAt: text('evaluated_at').notNull().default(sql`(datetime('now'))`),
  },
  (table) => ({
    idxTaskEval: index('idx_auto_closure_task').on(table.taskId, table.evaluatedAt),
  })
);

// 9. Distributed Locks & Synchronization Metadata
export const distributedLocks = sqliteTable('distributed_locks', {
  lockKey: text('lock_key').primaryKey(),
  ownerToken: text('owner_token').notNull(),
  pid: integer('pid').notNull().default(0),
  hostname: text('hostname').notNull().default(''),
  acquiredAt: text('acquired_at').notNull().default(sql`(datetime('now'))`),
  expiresAt: integer('expires_at').notNull(),
});

export const syncMetadata = sqliteTable(
  'sync_metadata',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => azureProjects.projectId, { onDelete: 'cascade' }),
    resourceType: text('resource_type').notNull(),
    lastSyncRunId: text('last_sync_run_id').notNull(),
    continuationToken: text('continuation_token'),
    watermarkTimestamp: text('watermark_timestamp'),
    recordCount: integer('record_count').notNull().default(0),
    syncStatus: text('sync_status').notNull(),
    errorDetails: text('error_details'),
    updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
  },
  (table) => ({
    unqSyncMetadata: uniqueIndex('idx_sync_metadata_unique').on(table.projectId, table.resourceType),
  })
);

export const sqliteSchema = {
  appSettings,
  organizations,
  departments,
  azureProjects,
  canonicalIdentities,
  teams,
  members,
  identityAliases,
  teamMembers,
  workCalendars,
  calendarExceptions,
  workItems,
  workItemRevisions,
  planTokens,
  journalEntries,
  autoClosureRules,
  autoClosureAuditLogs,
  distributedLocks,
  syncMetadata,
};
