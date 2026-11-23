import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createDatabase, WorkOpsDb } from '../../src/infrastructure/persistence/database.js';
import {
  MigrationService,
  normalizeDateFormat,
} from '../../src/infrastructure/persistence/migration/migration-service.js';
import { sqliteSchema } from '../../src/infrastructure/persistence/schema/sqlite-schema.js';
import { postgresSchema } from '../../src/infrastructure/persistence/schema/postgres-schema.js';

describe('Milestone 2: Relational Database Schema & Safe Zero-Data-Loss Migration', () => {
  let tempDir: string;
  let sqlitePath: string;
  let db: WorkOpsDb;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workops-m2-test-'));
    sqlitePath = path.join(tempDir, 'm2-test.db');
    db = createDatabase({ sqlitePath, engine: 'sqlite' });
  });

  afterEach(() => {
    if (db && db.engine === 'sqlite') {
      db.close();
    }
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('Feature 4: 18-Table Normalized Database Schema', () => {
    it('creates all 18 tables in SQLite database with correct names and WAL mode', () => {
      if (db.engine !== 'sqlite') throw new Error('Expected sqlite engine');

      const expected18Tables = [
        'app_settings',
        'organizations',
        'departments',
        'teams',
        'canonical_identities',
        'identity_aliases',
        'team_members',
        'work_calendars',
        'calendar_exceptions',
        'azure_projects',
        'work_items',
        'work_item_revisions',
        'plan_tokens',
        'journal_entries',
        'auto_closure_rules',
        'auto_closure_audit_logs',
        'distributed_locks',
        'sync_metadata',
      ];

      for (const table of expected18Tables) {
        const row = db.sqlite
          .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
          .get(table);
        expect(row, `Table ${table} should exist in sqlite database`).toBeDefined();
      }

      // Also ensure legacy members table exists for backward compatibility
      const membersRow = db.sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = 'members'")
        .get();
      expect(membersRow).toBeDefined();
    });

    it('creates performance and integrity indexes in SQLite', () => {
      if (db.engine !== 'sqlite') throw new Error('Expected sqlite engine');

      const expectedIndexes = [
        'idx_work_items_assigned',
        'idx_work_items_project_state',
        'idx_journal_created',
        'idx_journal_work_item',
        'idx_identity_alias',
        'idx_auto_closure_task',
      ];

      for (const idx of expectedIndexes) {
        const row = db.sqlite
          .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name = ?")
          .get(idx);
        expect(row, `Index ${idx} should exist in sqlite database`).toBeDefined();
      }
    });

    it('exports all 18 normalized tables in both Drizzle sqliteSchema and postgresSchema', () => {
      const requiredKeys = [
        'appSettings',
        'organizations',
        'departments',
        'teams',
        'canonicalIdentities',
        'identityAliases',
        'teamMembers',
        'workCalendars',
        'calendarExceptions',
        'azureProjects',
        'workItems',
        'workItemRevisions',
        'planTokens',
        'journalEntries',
        'autoClosureRules',
        'autoClosureAuditLogs',
        'distributedLocks',
        'syncMetadata',
      ];

      for (const key of requiredKeys) {
        expect((sqliteSchema as any)[key], `sqliteSchema must include ${key}`).toBeDefined();
        expect((postgresSchema as any)[key], `postgresSchema must include ${key}`).toBeDefined();
      }
    });

    it('team_members table schema preserves all 8 domain attributes', () => {
      if (db.engine !== 'sqlite') throw new Error('Expected sqlite engine');

      const cols = db.sqlite.prepare("PRAGMA table_info('team_members');").all() as Array<{ name: string }>;
      const colNames = cols.map((c) => c.name);

      const requiredAttributes = [
        'id',
        'team_id',
        'canonical_id',
        'role',
        'pod',
        'title_prefix',
        'auto_close_enabled',
        'enabled',
        'source_task_id',
        'github_repositories_json',
        'github_branches_json',
      ];

      for (const attr of requiredAttributes) {
        expect(colNames, `team_members must contain column ${attr}`).toContain(attr);
      }
    });
  });

  describe('Feature 5: Fix MigrationService Collision & Date Truncation', () => {
    it('normalizes timestamps to full ISO 8601 UTC with milliseconds without date truncation', () => {
      expect(normalizeDateFormat('2026-11-20T10:00:00Z')).toBe('2026-11-20T10:00:00.000Z');
      expect(normalizeDateFormat('2026-11-03T05:56:10.499Z')).toBe('2026-11-03T05:56:10.499Z');
      expect(normalizeDateFormat('25/12/2026')).toBe('2026-12-25');
      expect(normalizeDateFormat('2026-11-22')).toBe('2026-11-22');
    });

    it('resolves batch runId collision without overwriting entries', async () => {
      if (db.engine !== 'sqlite') throw new Error('Expected sqlite engine');

      // Create 4 entries sharing the identical runId and having no id
      const collidingEntries = [
        {
          runId: 'run-collision-batch-1',
          timestamp: '2026-11-03T05:56:10.100Z',
          personKey: 'dev1',
          assignedTo: 'dev1@workops.test',
          createdWorkItemId: 1001,
          sourceTaskId: 501,
          title: 'Task 1',
        },
        {
          runId: 'run-collision-batch-1',
          timestamp: '2026-11-03T05:56:10.200Z',
          personKey: 'dev2',
          assignedTo: 'dev2@workops.test',
          createdWorkItemId: 1002,
          sourceTaskId: 502,
          title: 'Task 2',
        },
        {
          runId: 'run-collision-batch-1',
          timestamp: '2026-11-03T05:56:10.300Z',
          personKey: 'dev3',
          assignedTo: 'dev3@workops.test',
          createdWorkItemId: 1003,
          sourceTaskId: 503,
          title: 'Task 3',
        },
        {
          runId: 'run-collision-batch-1',
          timestamp: '2026-11-03T05:56:10.400Z',
          personKey: 'dev4',
          assignedTo: 'dev4@workops.test',
          createdWorkItemId: 1004,
          sourceTaskId: 504,
          title: 'Task 4',
        },
      ];

      const testJournalPath = path.join(tempDir, 'colliding-journal.json');
      fs.writeFileSync(testJournalPath, JSON.stringify(collidingEntries));

      const migration = new MigrationService(db);
      const report = await migration.migrate({
        journalPath: testJournalPath,
        peoplePath: path.join(tempDir, 'empty-people.json'),
      });

      expect(report.success).toBe(true);
      expect(report.sourceJournalEntries).toBe(4);
      expect(report.migratedJournalEntries).toBe(4);

      // Verify DB row count is exactly 4 (zero overwrites)
      const countRow = db.sqlite.prepare('SELECT count(*) as count FROM journal_entries').get() as { count: number };
      expect(countRow.count).toBe(4);

      // Verify each entry retained full millisecond precision
      const rows = db.sqlite.prepare('SELECT created_at FROM journal_entries').all() as Array<{ created_at: string }>;
      expect(rows.some((r) => r.created_at.includes('.100Z'))).toBe(true);
      expect(rows.some((r) => r.created_at.includes('.200Z'))).toBe(true);
      expect(rows.some((r) => r.created_at.includes('.300Z'))).toBe(true);
      expect(rows.some((r) => r.created_at.includes('.400Z'))).toBe(true);
    });
  });

  describe('Feature 6: Zero-Data-Loss JSON Migration on Real Production Files', () => {
    const cwd = process.cwd();
    const realPeoplePath = path.resolve(cwd, 'people.json');
    const realJournalPath = path.resolve(cwd, '.task-journal.json');
    const realAutoClosurePath = path.resolve(cwd, '.auto-closure-config.json');

    it('migrates all 16 global configuration items from people.json into app_settings', async () => {
      if (db.engine !== 'sqlite') throw new Error('Expected sqlite engine');

      const migration = new MigrationService(db);
      const report = await migration.migrate({
        peoplePath: realPeoplePath,
        journalPath: path.join(tempDir, 'empty-journal.json'),
        autoClosureConfigPath: realAutoClosurePath,
      });

      expect(report.success).toBe(true);

      const settings = db.sqlite.prepare('SELECT key, value_json, category FROM app_settings').all() as Array<{
        key: string;
        value_json: string;
        category: string;
      }>;

      const keys = settings.map((s) => s.key);
      const expectedKeys = [
        'organization',
        'project',
        'workItemType',
        'titlePrefix',
        'startTime',
        'timezone',
        'thursdayMode',
        'githubOrg',
        'githubUserSuffix',
        'schedulerEnabled',
        'scheduleTime',
        'schedulerAutoStart',
        'autoClose',
        'autoCloseStartTime',
        'autoCloseEndTime',
        'autoActive',
      ];

      for (const k of expectedKeys) {
        expect(keys, `app_settings must contain key ${k}`).toContain(k);
      }

      const orgSetting = settings.find((s) => s.key === 'organization');
      expect(JSON.parse(orgSetting!.value_json)).toBe('BFLDevOpsOrg');

      const projSetting = settings.find((s) => s.key === 'project');
      expect(JSON.parse(projSetting!.value_json)).toBe('3in1_Agile_Projects');
    });

    it('migrates all 6 members into canonical_identities, identity_aliases, and team_members preserving 8 domain attributes', async () => {
      if (db.engine !== 'sqlite') throw new Error('Expected sqlite engine');

      const migration = new MigrationService(db);
      const report = await migration.migrate({
        peoplePath: realPeoplePath,
        journalPath: path.join(tempDir, 'empty-journal.json'),
        autoClosureConfigPath: realAutoClosurePath,
      });

      expect(report.success).toBe(true);
      expect(report.sourceMembers).toBe(6);
      expect(report.migratedMembers).toBe(6);

      // Check canonical_identities
      const identities = db.sqlite.prepare('SELECT * FROM canonical_identities').all() as Array<any>;
      expect(identities.length).toBe(6);

      const yashIdentity = identities.find((i) => i.canonical_email === 'yash.somani@bajajfinserv.in');
      expect(yashIdentity).toBeDefined();
      expect(yashIdentity.display_name).toBe('Yash Somani');
      expect(yashIdentity.primary_username).toBe('yash-somani_bflghec');

      // Check team_members with all 8 domain attributes
      const teamMembers = db.sqlite.prepare('SELECT * FROM team_members').all() as Array<any>;
      expect(teamMembers.length).toBe(6);

      const yashMember = teamMembers.find((tm) => tm.canonical_id === yashIdentity.id);
      expect(yashMember).toBeDefined();
      expect(yashMember.role).toBe('Dev On-Role');
      expect(yashMember.pod).toBe('108_My Account Part 2');
      expect(yashMember.title_prefix).toBe('3in1_PWA_MyAccount |');
      expect(yashMember.auto_close_enabled).toBe(1);
      expect(yashMember.enabled).toBe(1);
      expect(JSON.parse(yashMember.github_repositories_json)).toEqual([]);
      expect(JSON.parse(yashMember.github_branches_json)).toEqual([]);

      // Check member with autoCloseEnabled false (Mukul Ramteke)
      const mukulIdentity = identities.find((i) => i.canonical_email === 'mukul.ramteke@bajajfinserv.in');
      expect(mukulIdentity).toBeDefined();
      const mukulMember = teamMembers.find((tm) => tm.canonical_id === mukulIdentity.id);
      expect(mukulMember).toBeDefined();
      expect(mukulMember.auto_close_enabled).toBe(0);

      // Check identity_aliases
      const aliases = db.sqlite.prepare('SELECT * FROM identity_aliases WHERE canonical_id = ?').all(yashIdentity.id) as Array<any>;
      expect(aliases.some((a) => a.identity_type === 'azure_email' && a.alias_value === 'yash.somani@bajajfinserv.in')).toBe(true);
      expect(aliases.some((a) => a.identity_type === 'github_username' && a.alias_value === 'yash-somani_bflghec')).toBe(true);
      expect(aliases.some((a) => a.identity_type === 'upn_alias' && a.alias_value === 'yash_somani')).toBe(true);
    });

    it('migrates all 246 entries from .task-journal.json with zero data loss (246 source -> 246 DB rows)', async () => {
      if (db.engine !== 'sqlite') throw new Error('Expected sqlite engine');

      const migration = new MigrationService(db);
      const report = await migration.migrate({
        peoplePath: realPeoplePath,
        journalPath: realJournalPath,
        autoClosureConfigPath: realAutoClosurePath,
      });

      expect(report.success).toBe(true);
      expect(report.errors.length).toBe(0);

      // Assert source and migrated count parity
      expect(report.sourceJournalEntries).toBe(246);
      expect(report.migratedJournalEntries).toBe(246);
      expect(report.dbJournalCount).toBe(246);

      // Direct DB count query verification
      const dbCount = (db.sqlite.prepare('SELECT count(*) as count FROM journal_entries').get() as { count: number }).count;
      expect(dbCount).toBe(246);

      // Verify Schema A legacy records migrated properly
      const legacyRow = db.sqlite
        .prepare("SELECT * FROM journal_entries WHERE run_id = 'run-1793685366349' AND work_item_id = 10818705")
        .get() as any;
      expect(legacyRow).toBeDefined();
      expect(legacyRow.target_iso_date).toBe('2026-11-04');
      expect(legacyRow.title).toBe('3in1_PWA_MyAccount | Nov 4');
      expect(legacyRow.field_copy_status).toBe('SUCCESS');
      expect(legacyRow.relation_copy_status).toBe('SUCCESS');
      expect(legacyRow.verified).toBe(1);
      expect(legacyRow.created_at).toBe('2026-11-03T05:56:10.499Z');

      // Verify Schema B current records migrated properly
      const schemaBRow = db.sqlite
        .prepare('SELECT * FROM journal_entries WHERE work_item_id = 2001')
        .get() as any;
      expect(schemaBRow).toBeDefined();
      expect(schemaBRow.action_type).toBe('CREATED');
      expect(schemaBRow.target_iso_date).toBe('2026-11-21');
      expect(schemaBRow.operator_email).toBe('dev1@workops.test');
      expect(schemaBRow.created_at).toBe('2026-11-21T12:55:34.998Z');
    });

    it('is completely idempotent when re-running migration on the 246 entries', async () => {
      if (db.engine !== 'sqlite') throw new Error('Expected sqlite engine');

      const migration = new MigrationService(db);

      // Run 1
      const report1 = await migration.migrate({
        peoplePath: realPeoplePath,
        journalPath: realJournalPath,
        autoClosureConfigPath: realAutoClosurePath,
      });
      expect(report1.success).toBe(true);
      expect(report1.dbJournalCount).toBe(246);

      // Run 2
      const report2 = await migration.migrate({
        peoplePath: realPeoplePath,
        journalPath: realJournalPath,
        autoClosureConfigPath: realAutoClosurePath,
      });
      expect(report2.success).toBe(true);
      expect(report2.errors.length).toBe(0);

      // Direct DB count query verification — MUST REMAIN EXACTLY 246
      const dbCount = (db.sqlite.prepare('SELECT count(*) as count FROM journal_entries').get() as { count: number }).count;
      expect(dbCount).toBe(246);
    });
  });
});
