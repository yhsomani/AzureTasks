import { sql } from 'drizzle-orm';
import {
  pgTable,
  varchar,
  text,
  integer,
  bigint,
  real,
  timestamp,
  primaryKey,
  foreignKey,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// 1. System & Operational Configuration
export const appSettings = pgTable('app_settings', {
  key: varchar('key', { length: 255 }).primaryKey(),
  valueJson: text('value_json').notNull(),
  category: varchar('category', { length: 100 }).notNull().default('general'),
  description: text('description'),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

// 2. Multi-Tenant Organization & Team Hierarchy
export const organizations = pgTable('organizations', {
  id: varchar('id', { length: 255 }).primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  slug: varchar('slug', { length: 255 }).notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const departments = pgTable('departments', {
  id: varchar('id', { length: 255 }).primaryKey(),
  orgId: varchar('org_id', { length: 255 })
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

// 3. Azure DevOps Projects
export const azureProjects = pgTable('azure_projects', {
  projectId: varchar('project_id', { length: 255 }).primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  state: varchar('state', { length: 100 }),
  visibility: varchar('visibility', { length: 100 }),
  revision: integer('revision'),
  isAuthoritativeForTasks: integer('is_authoritative_for_tasks').notNull().default(0),
  isAuthoritativeForCicd: integer('is_authoritative_for_cicd').notNull().default(0),
  lastUpdateTime: text('last_update_time'),
  syncRunId: varchar('sync_run_id', { length: 255 }),
  syncedAt: timestamp('synced_at', { withTimezone: true })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

// 4. Canonical Identity Resolution System
export const canonicalIdentities = pgTable('canonical_identities', {
  id: varchar('id', { length: 255 }).primaryKey(),
  canonicalEmail: varchar('canonical_email', { length: 255 }).notNull().unique(),
  displayName: varchar('display_name', { length: 255 }).notNull(),
  primaryUsername: varchar('primary_username', { length: 255 }),
  avatarUrl: text('avatar_url'),
  isActive: integer('is_active').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const teams = pgTable('teams', {
  id: varchar('id', { length: 255 }).primaryKey(),
  deptId: varchar('dept_id', { length: 255 })
    .notNull()
    .references(() => departments.id, { onDelete: 'cascade' }),
  projectId: varchar('project_id', { length: 255 })
    .references(() => azureProjects.projectId, { onDelete: 'set null' }),
  azureTeamId: varchar('azure_team_id', { length: 255 }),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  isActive: integer('is_active').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

// Legacy members table preserved for backward compatibility
export const members = pgTable('members', {
  id: varchar('id', { length: 255 }).primaryKey(),
  teamId: varchar('team_id', { length: 255 })
    .notNull()
    .references(() => teams.id, { onDelete: 'cascade' }),
  email: varchar('email', { length: 255 }).notNull().unique(),
  displayName: varchar('display_name', { length: 255 }).notNull(),
  role: varchar('role', { length: 100 }).notNull().default('Developer'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const identityAliases = pgTable(
  'identity_aliases',
  {
    id: varchar('id', { length: 255 }).primaryKey(),
    canonicalId: varchar('canonical_id', { length: 255 })
      .notNull()
      .references(() => canonicalIdentities.id, { onDelete: 'cascade' }),
    identityType: varchar('identity_type', { length: 100 }).notNull(),
    aliasValue: varchar('alias_value', { length: 255 }).notNull(),
    isVerified: integer('is_verified').notNull().default(1),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    unqTypeAlias: uniqueIndex('idx_pg_identity_aliases_unique').on(table.identityType, table.aliasValue),
    idxIdentityAlias: index('idx_pg_identity_alias').on(table.identityType, table.aliasValue),
  })
);

export const teamMembers = pgTable(
  'team_members',
  {
    id: varchar('id', { length: 255 }).primaryKey(),
    teamId: varchar('team_id', { length: 255 })
      .notNull()
      .references(() => teams.id, { onDelete: 'cascade' }),
    canonicalId: varchar('canonical_id', { length: 255 })
      .notNull()
      .references(() => canonicalIdentities.id, { onDelete: 'cascade' }),
    role: varchar('role', { length: 100 }).notNull().default('Developer'),
    pod: varchar('pod', { length: 255 }),
    titlePrefix: varchar('title_prefix', { length: 255 }),
    autoCloseEnabled: integer('auto_close_enabled').notNull().default(1),
    enabled: integer('enabled').notNull().default(1),
    sourceTaskId: integer('source_task_id'),
    githubRepositoriesJson: text('github_repositories_json'),
    githubBranchesJson: text('github_branches_json'),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    unqTeamMember: uniqueIndex('idx_pg_team_members_unique').on(table.teamId, table.canonicalId),
  })
);

// 5. Work Calendar & Scheduling
export const workCalendars = pgTable('work_calendars', {
  id: varchar('id', { length: 255 }).primaryKey(),
  teamId: varchar('team_id', { length: 255 })
    .notNull()
    .references(() => teams.id, { onDelete: 'cascade' }),
  timezone: varchar('timezone', { length: 100 }).notNull().default('Asia/Kolkata'),
  cycleAnchorDay: integer('cycle_anchor_day').notNull().default(4),
  defaultHours: real('default_hours').notNull().default(8.0),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const calendarExceptions = pgTable('calendar_exceptions', {
  id: varchar('id', { length: 255 }).primaryKey(),
  calendarId: varchar('calendar_id', { length: 255 })
    .notNull()
    .references(() => workCalendars.id, { onDelete: 'cascade' }),
  date: varchar('date', { length: 20 }).notNull(),
  isWorkingDay: integer('is_working_day').notNull().default(0),
  availableHours: real('available_hours').notNull().default(0.0),
  canonicalId: varchar('canonical_id', { length: 255 })
    .references(() => canonicalIdentities.id, { onDelete: 'set null' }),
  description: text('description'),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

// 6. Azure DevOps Work Items & Revisions
export const workItems = pgTable(
  'work_items',
  {
    projectId: varchar('project_id', { length: 255 })
      .notNull()
      .references(() => azureProjects.projectId, { onDelete: 'cascade' }),
    workItemId: integer('work_item_id').notNull(),
    type: varchar('type', { length: 100 }).notNull(),
    title: text('title').notNull(),
    state: varchar('state', { length: 100 }).notNull(),
    assignedIdentityId: varchar('assigned_identity_id', { length: 255 })
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
    syncRunId: varchar('sync_run_id', { length: 255 }),
    syncedAt: timestamp('synced_at', { withTimezone: true })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.projectId, table.workItemId] }),
    idxAssigned: index('idx_pg_work_items_assigned').on(table.assignedIdentityId, table.state),
    idxProjectState: index('idx_pg_work_items_project_state').on(table.projectId, table.state),
  })
);

export const workItemRevisions = pgTable(
  'work_item_revisions',
  {
    projectId: varchar('project_id', { length: 255 }).notNull(),
    workItemId: integer('work_item_id').notNull(),
    revision: integer('revision').notNull(),
    state: varchar('state', { length: 100 }),
    changedByIdentityId: varchar('changed_by_identity_id', { length: 255 })
      .references(() => canonicalIdentities.id, { onDelete: 'set null' }),
    changedAt: text('changed_at').notNull(),
    fieldsJson: text('fields_json').notNull(),
    syncRunId: varchar('sync_run_id', { length: 255 }),
    syncedAt: timestamp('synced_at', { withTimezone: true })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
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
export const planTokens = pgTable('plan_tokens', {
  tokenHash: varchar('token_hash', { length: 255 }).primaryKey(),
  planToken: text('plan_token').notNull(),
  operatorId: varchar('operator_id', { length: 255 })
    .references(() => canonicalIdentities.id, { onDelete: 'set null' }),
  operatorEmail: varchar('operator_email', { length: 255 }),
  expiresAt: bigint('expires_at', { mode: 'number' }).notNull(),
  isExecuted: integer('is_executed').notNull().default(0),
  executedAt: text('executed_at'),
  snapshotJson: text('snapshot_json').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const journalEntries = pgTable(
  'journal_entries',
  {
    id: varchar('id', { length: 255 }).primaryKey(),
    runId: varchar('run_id', { length: 255 }),
    teamId: varchar('team_id', { length: 255 })
      .references(() => teams.id, { onDelete: 'set null' }),
    operatorId: varchar('operator_id', { length: 255 })
      .references(() => canonicalIdentities.id, { onDelete: 'set null' }),
    operatorEmail: varchar('operator_email', { length: 255 }),
    actionType: varchar('action_type', { length: 100 }).notNull(),
    workItemId: integer('work_item_id'),
    projectId: varchar('project_id', { length: 255 })
      .references(() => azureProjects.projectId, { onDelete: 'set null' }),
    targetIsoDate: varchar('target_iso_date', { length: 20 }),
    title: text('title'),
    fieldCopyStatus: varchar('field_copy_status', { length: 50 }),
    relationCopyStatus: varchar('relation_copy_status', { length: 50 }),
    verified: integer('verified').notNull().default(1),
    detailsJson: text('details_json').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    idxCreated: index('idx_pg_journal_created').on(table.createdAt),
    idxWorkItem: index('idx_pg_journal_work_item').on(table.workItemId),
  })
);

// 8. Automated Closure Governance
export const autoClosureRules = pgTable('auto_closure_rules', {
  id: varchar('id', { length: 255 }).primaryKey(),
  teamId: varchar('team_id', { length: 255 })
    .notNull()
    .references(() => teams.id, { onDelete: 'cascade' }),
  ruleName: varchar('rule_name', { length: 255 }).notNull().default('Default Rule'),
  cutoffTime: varchar('cutoff_time', { length: 20 }).notNull().default('18:00'),
  minHours: real('min_hours').notNull().default(8.0),
  requirePrEvidence: integer('require_pr_evidence').notNull().default(1),
  requireGitCommits: integer('require_git_commits').notNull().default(0),
  isActive: integer('is_active').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const autoClosureAuditLogs = pgTable(
  'auto_closure_audit_logs',
  {
    id: varchar('id', { length: 255 }).primaryKey(),
    ruleId: varchar('rule_id', { length: 255 })
      .references(() => autoClosureRules.id, { onDelete: 'set null' }),
    taskId: integer('task_id').notNull(),
    projectId: varchar('project_id', { length: 255 })
      .references(() => azureProjects.projectId, { onDelete: 'set null' }),
    canonicalId: varchar('canonical_id', { length: 255 })
      .references(() => canonicalIdentities.id, { onDelete: 'set null' }),
    evaluationStatus: varchar('evaluation_status', { length: 50 }).notNull(),
    prEvidenceJson: text('pr_evidence_json'),
    decisionReason: text('decision_reason').notNull(),
    operatorOverrideId: varchar('operator_override_id', { length: 255 })
      .references(() => canonicalIdentities.id, { onDelete: 'set null' }),
    evaluatedAt: timestamp('evaluated_at', { withTimezone: true })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    idxTaskEval: index('idx_pg_auto_closure_task').on(table.taskId, table.evaluatedAt),
  })
);

// 9. Distributed Locks & Synchronization Metadata
export const distributedLocks = pgTable('distributed_locks', {
  lockKey: varchar('lock_key', { length: 255 }).primaryKey(),
  ownerToken: varchar('owner_token', { length: 255 }).notNull(),
  pid: integer('pid').notNull().default(0),
  hostname: varchar('hostname', { length: 255 }).notNull().default(''),
  acquiredAt: timestamp('acquired_at', { withTimezone: true })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
  expiresAt: bigint('expires_at', { mode: 'number' }).notNull(),
});

export const syncMetadata = pgTable(
  'sync_metadata',
  {
    id: varchar('id', { length: 255 }).primaryKey(),
    projectId: varchar('project_id', { length: 255 })
      .notNull()
      .references(() => azureProjects.projectId, { onDelete: 'cascade' }),
    resourceType: varchar('resource_type', { length: 100 }).notNull(),
    lastSyncRunId: varchar('last_sync_run_id', { length: 255 }).notNull(),
    continuationToken: text('continuation_token'),
    watermarkTimestamp: text('watermark_timestamp'),
    recordCount: integer('record_count').notNull().default(0),
    syncStatus: varchar('sync_status', { length: 50 }).notNull(),
    errorDetails: text('error_details'),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    unqSyncMetadata: uniqueIndex('idx_pg_sync_metadata_unique').on(table.projectId, table.resourceType),
  })
);

export const postgresSchema = {
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
