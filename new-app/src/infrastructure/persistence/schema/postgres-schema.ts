import { sql } from 'drizzle-orm';
import {
  pgTable,
  varchar,
  text,
  integer,
  bigint,
  real,
  timestamp,
} from 'drizzle-orm/pg-core';

export const organizations = pgTable('organizations', {
  id: varchar('id', { length: 255 }).primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  slug: varchar('slug', { length: 255 }).notNull().unique(),
  createdAt: timestamp('created_at', { withTimezone: true })
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

export const teams = pgTable('teams', {
  id: varchar('id', { length: 255 }).primaryKey(),
  deptId: varchar('dept_id', { length: 255 })
    .notNull()
    .references(() => departments.id, { onDelete: 'cascade' }),
  name: varchar('name', { length: 255 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

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

export const workCalendars = pgTable('work_calendars', {
  id: varchar('id', { length: 255 }).primaryKey(),
  teamId: varchar('team_id', { length: 255 })
    .notNull()
    .references(() => teams.id, { onDelete: 'cascade' }),
  timezone: varchar('timezone', { length: 100 }).notNull().default('UTC'),
  cycleAnchorDay: integer('cycle_anchor_day').notNull().default(4),
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
  description: text('description'),
});

export const planTokens = pgTable('plan_tokens', {
  tokenHash: varchar('token_hash', { length: 255 }).primaryKey(),
  planToken: text('plan_token').notNull(),
  expiresAt: bigint('expires_at', { mode: 'number' }).notNull(),
  isExecuted: integer('is_executed').notNull().default(0),
  snapshotJson: text('snapshot_json').notNull(),
  operatorEmail: varchar('operator_email', { length: 255 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const journalEntries = pgTable('journal_entries', {
  id: varchar('id', { length: 255 }).primaryKey(),
  teamId: varchar('team_id', { length: 255 }),
  actionType: varchar('action_type', { length: 100 }).notNull(),
  operatorEmail: varchar('operator_email', { length: 255 }).notNull(),
  workItemId: integer('work_item_id'),
  detailsJson: text('details_json').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const autoClosureRules = pgTable('auto_closure_rules', {
  id: varchar('id', { length: 255 }).primaryKey(),
  teamId: varchar('team_id', { length: 255 })
    .notNull()
    .references(() => teams.id, { onDelete: 'cascade' }),
  cutoffTime: varchar('cutoff_time', { length: 20 }).notNull().default('18:00'),
  minHours: real('min_hours').notNull().default(8.0),
  requirePrEvidence: integer('require_pr_evidence').notNull().default(1),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .default(sql`CURRENT_TIMESTAMP`),
});

export const distributedLocks = pgTable('distributed_locks', {
  lockKey: varchar('lock_key', { length: 255 }).primaryKey(),
  ownerToken: varchar('owner_token', { length: 255 }).notNull(),
  expiresAt: bigint('expires_at', { mode: 'number' }).notNull(),
});

export const postgresSchema = {
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
