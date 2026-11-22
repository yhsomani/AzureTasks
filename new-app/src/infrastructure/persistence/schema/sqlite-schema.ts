import { sql } from 'drizzle-orm';
import {
  sqliteTable,
  text,
  integer,
  real,
} from 'drizzle-orm/sqlite-core';

export const organizations = sqliteTable('organizations', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});

export const departments = sqliteTable('departments', {
  id: text('id').primaryKey(),
  orgId: text('org_id')
    .notNull()
    .references(() => organizations.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});

export const teams = sqliteTable('teams', {
  id: text('id').primaryKey(),
  deptId: text('dept_id')
    .notNull()
    .references(() => departments.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});

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

export const workCalendars = sqliteTable('work_calendars', {
  id: text('id').primaryKey(),
  teamId: text('team_id')
    .notNull()
    .references(() => teams.id, { onDelete: 'cascade' }),
  timezone: text('timezone').notNull().default('UTC'),
  cycleAnchorDay: integer('cycle_anchor_day').notNull().default(4),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});

export const calendarExceptions = sqliteTable('calendar_exceptions', {
  id: text('id').primaryKey(),
  calendarId: text('calendar_id')
    .notNull()
    .references(() => workCalendars.id, { onDelete: 'cascade' }),
  date: text('date').notNull(),
  isWorkingDay: integer('is_working_day').notNull().default(0),
  description: text('description'),
});

export const planTokens = sqliteTable('plan_tokens', {
  tokenHash: text('token_hash').primaryKey(),
  planToken: text('plan_token').notNull(),
  expiresAt: integer('expires_at').notNull(),
  isExecuted: integer('is_executed').notNull().default(0),
  snapshotJson: text('snapshot_json').notNull(),
  operatorEmail: text('operator_email').notNull(),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});

export const journalEntries = sqliteTable('journal_entries', {
  id: text('id').primaryKey(),
  teamId: text('team_id'),
  actionType: text('action_type').notNull(),
  operatorEmail: text('operator_email').notNull(),
  workItemId: integer('work_item_id'),
  detailsJson: text('details_json').notNull(),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});

export const autoClosureRules = sqliteTable('auto_closure_rules', {
  id: text('id').primaryKey(),
  teamId: text('team_id')
    .notNull()
    .references(() => teams.id, { onDelete: 'cascade' }),
  cutoffTime: text('cutoff_time').notNull().default('18:00'),
  minHours: real('min_hours').notNull().default(8.0),
  requirePrEvidence: integer('require_pr_evidence').notNull().default(1),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});

export const distributedLocks = sqliteTable('distributed_locks', {
  lockKey: text('lock_key').primaryKey(),
  ownerToken: text('owner_token').notNull(),
  expiresAt: integer('expires_at').notNull(),
});

export const sqliteSchema = {
  organizations,
  departments,
  teams,
  members,
  workCalendars,
  calendarExceptions,
  planTokens,
  journalEntries,
  autoClosureRules,
  distributedLocks,
};
