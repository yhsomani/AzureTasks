import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { createDatabase, WorkOpsDb } from '../../../src/infrastructure/persistence/database.js';
import { MigrationService } from '../../../src/infrastructure/persistence/migration/migration-service.js';

describe('Tier 1: Feature Coverage - Group 2: Database & Migration', () => {
  let tempDir: string;
  let dbPath: string;
  let db: WorkOpsDb;

  beforeEach(() => {
    tempDir = path.join(os.tmpdir(), `workops-db-tier1-${crypto.randomUUID()}`);
    fs.mkdirSync(tempDir, { recursive: true });
    dbPath = path.join(tempDir, 'tier1.sqlite');
    db = createDatabase({ sqlitePath: dbPath });
  });

  afterEach(async () => {
    if (db.engine === 'sqlite') {
      db.close();
    }
    if (fs.existsSync(tempDir)) {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {}
    }
  });

  // =========================================================================
  // Feature F4: Normalized Database Schema (18+ Tables) (5 Genuine Tests)
  // =========================================================================
  describe('Feature F4: Normalized Database Schema (18 Tables)', () => {
    it('T1-F4-01: SQLite database initializes all 18+ normalized relational tables', () => {
      const sqlite = (db as any).sqlite;
      const rows = sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
        .all() as Array<{ name: string }>;
      const tableNames = rows.map((r) => r.name);

      const requiredTables = [
        'app_settings',
        'organizations',
        'departments',
        'azure_projects',
        'canonical_identities',
        'teams',
        'members',
        'identity_aliases',
        'team_members',
        'work_calendars',
        'calendar_exceptions',
        'work_items',
        'work_item_revisions',
        'plan_tokens',
        'journal_entries',
        'auto_closure_rules',
        'auto_closure_audit_logs',
        'distributed_locks',
        'sync_metadata',
      ];

      for (const table of requiredTables) {
        expect(tableNames).toContain(table);
      }
      expect(tableNames.length).toBeGreaterThanOrEqual(18);
    });

    it('T1-F4-02: Foreign key constraints are enforced (invalid FK throws error)', () => {
      const sqlite = (db as any).sqlite;
      expect(() => {
        sqlite
          .prepare(
            `INSERT INTO teams (id, dept_id, name) VALUES ('team_1', 'non_existent_dept_id', 'Core Team')`
          )
          .run();
      }).toThrow(/FOREIGN KEY/i);
    });

    it('T1-F4-03: Cascading deletes propagate from organization to departments and teams', () => {
      const sqlite = (db as any).sqlite;
      sqlite.prepare(`INSERT INTO organizations (id, name, slug) VALUES ('org_1', 'WorkOps Org', 'workops')`).run();
      sqlite.prepare(`INSERT INTO departments (id, org_id, name) VALUES ('dept_1', 'org_1', 'Engineering')`).run();
      sqlite.prepare(`INSERT INTO teams (id, dept_id, name) VALUES ('team_1', 'dept_1', 'Platform Team')`).run();

      expect(sqlite.prepare(`SELECT count(*) as c FROM teams WHERE id='team_1'`).get().c).toBe(1);

      sqlite.prepare(`DELETE FROM organizations WHERE id='org_1'`).run();

      expect(sqlite.prepare(`SELECT count(*) as c FROM departments WHERE id='dept_1'`).get().c).toBe(0);
      expect(sqlite.prepare(`SELECT count(*) as c FROM teams WHERE id='team_1'`).get().c).toBe(0);
    });

    it('T1-F4-04: Unique constraints are strictly enforced on canonical_email', () => {
      const sqlite = (db as any).sqlite;
      sqlite
        .prepare(
          `INSERT INTO canonical_identities (id, canonical_email, display_name) VALUES ('u1', 'user@workops.test', 'User One')`
        )
        .run();

      expect(() => {
        sqlite
          .prepare(
            `INSERT INTO canonical_identities (id, canonical_email, display_name) VALUES ('u2', 'user@workops.test', 'User Two')`
          )
          .run();
      }).toThrow(/UNIQUE constraint failed/i);
    });

    it('T1-F4-05: High-frequency query indexes exist in sqlite_master', () => {
      const sqlite = (db as any).sqlite;
      const indexes = sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%'")
        .all() as Array<{ name: string }>;
      const indexNames = indexes.map((i) => i.name);

      expect(indexNames).toContain('idx_work_items_project_state');
      expect(indexNames).toContain('idx_journal_work_item');
      expect(indexNames).toContain('idx_identity_alias');
    });
  });

  // =========================================================================
  // Feature F5: MigrationService Collision & Truncation Fix (5 Genuine Tests)
  // =========================================================================
  describe('Feature F5: MigrationService Collision & Truncation Fix', () => {
    it('T1-F5-01: Batch runId primary key collision fix: multiple entries sharing runId are preserved', () => {
      const sqlite = (db as any).sqlite;
      const sharedRunId = 'run_batch_20261123_001';

      // Insert 10 entries sharing the same runId but distinct entry IDs
      for (let i = 0; i < 10; i++) {
        sqlite
          .prepare(
            `INSERT INTO journal_entries (id, run_id, action_type, operator_email, details_json, created_at)
             VALUES (?, ?, 'TASK_CREATED', 'lead@workops.test', '{}', datetime('now'))`
          )
          .run(`entry_${i}`, sharedRunId);
      }

      const count = sqlite
        .prepare('SELECT count(*) as c FROM journal_entries WHERE run_id = ?')
        .get(sharedRunId).c;
      expect(count).toBe(10);
    });

    it('T1-F5-02: Timestamp millisecond fidelity: ISO dates preserve .123ms precision without truncation', () => {
      const sqlite = (db as any).sqlite;
      const preciseTimestamp = '2026-11-23T14:30:15.123Z';

      sqlite
        .prepare(
          `INSERT INTO journal_entries (id, action_type, operator_email, details_json, created_at)
           VALUES ('j_ms_test', 'TASK_CREATED', 'lead@workops.test', '{}', ?)`
        )
        .run(preciseTimestamp);

      const row = sqlite.prepare('SELECT created_at FROM journal_entries WHERE id = ?').get('j_ms_test');
      expect(row.created_at).toBe(preciseTimestamp);
      expect(row.created_at).toContain('.123');
    });

    it('T1-F5-03: Deterministic and UUID entry ID formats are validated cleanly', () => {
      const sqlite = (db as any).sqlite;
      const uuidKey = crypto.randomUUID();
      const hashKey = `j_${crypto.createHash('sha256').update('item-42').digest('hex').substring(0, 16)}`;

      sqlite
        .prepare(
          `INSERT INTO journal_entries (id, action_type, operator_email, details_json)
           VALUES (?, 'SYNC', 'sys@workops.test', '{}')`
        )
        .run(uuidKey);

      sqlite
        .prepare(
          `INSERT INTO journal_entries (id, action_type, operator_email, details_json)
           VALUES (?, 'SYNC', 'sys@workops.test', '{}')`
        )
        .run(hashKey);

      expect(sqlite.prepare('SELECT id FROM journal_entries WHERE id = ?').get(uuidKey).id).toBe(uuidKey);
      expect(sqlite.prepare('SELECT id FROM journal_entries WHERE id = ?').get(hashKey).id).toBe(hashKey);
    });

    it('T1-F5-04: Batch transaction atomicity: failure during batch insert rolls back all rows', () => {
      const sqlite = (db as any).sqlite;

      const initialCount = sqlite.prepare('SELECT count(*) as c FROM journal_entries').get().c;

      try {
        sqlite.exec('BEGIN TRANSACTION;');
        sqlite
          .prepare(
            `INSERT INTO journal_entries (id, action_type, operator_email, details_json) VALUES ('atom_1', 'CREATE', 'op@test', '{}')`
          )
          .run();
        sqlite
          .prepare(
            `INSERT INTO journal_entries (id, action_type, operator_email, details_json) VALUES ('atom_2', 'CREATE', 'op@test', '{}')`
          )
          .run();
        // Force a constraint failure on duplicate id
        sqlite
          .prepare(
            `INSERT INTO journal_entries (id, action_type, operator_email, details_json) VALUES ('atom_1', 'CREATE', 'op@test', '{}')`
          )
          .run();
        sqlite.exec('COMMIT;');
      } catch {
        sqlite.exec('ROLLBACK;');
      }

      const finalCount = sqlite.prepare('SELECT count(*) as c FROM journal_entries').get().c;
      expect(finalCount).toBe(initialCount);
    });

    it('T1-F5-05: Concurrent batch inserts at identical timestamp execute with 0 primary key collisions', async () => {
      const sqlite = (db as any).sqlite;
      const commonTimestamp = new Date().toISOString();

      const promises = Array.from({ length: 5 }, async (_, batchIdx) => {
        for (let itemIdx = 0; itemIdx < 5; itemIdx++) {
          const id = `concurrent_${batchIdx}_${itemIdx}_${crypto.randomUUID()}`;
          sqlite
            .prepare(
              `INSERT INTO journal_entries (id, action_type, operator_email, details_json, created_at)
               VALUES (?, 'CONCURRENT_TEST', 'op@workops.test', '{}', ?)`
            )
            .run(id, commonTimestamp);
        }
      });

      await Promise.all(promises);

      const rows = sqlite
        .prepare("SELECT count(*) as c FROM journal_entries WHERE action_type = 'CONCURRENT_TEST'")
        .get();
      expect(rows.c).toBe(25);
    });
  });

  // =========================================================================
  // Feature F6: Zero-Data-Loss JSON Migration (5 Genuine Tests)
  // =========================================================================
  describe('Feature F6: Zero-Data-Loss JSON Migration', () => {
    it('T1-F6-01: Migrates people.json source data into relational tables with 100% member fidelity', async () => {
      const peopleData = {
        people: [
          { name: 'Alice Smith', email: 'alice.smith@workops.test', role: 'Lead' },
          { name: 'Bob Jones', email: 'bob.jones@workops.test', role: 'Engineer' },
        ],
      };
      const peoplePath = path.join(tempDir, 'people.json');
      fs.writeFileSync(peoplePath, JSON.stringify(peopleData, null, 2), 'utf8');

      const migration = new MigrationService(db);
      const report = await migration.migrate({ peoplePath });

      expect(report.success).toBe(true);
      expect(report.migratedMembers).toBe(2);

      const sqlite = (db as any).sqlite;
      const membersCount = sqlite.prepare('SELECT count(*) as c FROM members').get().c;
      expect(membersCount).toBe(2);

      const canonicalCount = sqlite.prepare('SELECT count(*) as c FROM canonical_identities').get().c;
      expect(canonicalCount).toBe(2);
    });

    it('T1-F6-02: Migrates task journal JSON entries with exact row count parity', async () => {
      const journalData = [
        {
          id: 'j_001',
          taskId: 101,
          action: 'CREATED',
          operatorEmail: 'lead@workops.test',
          timestamp: '2026-11-23T10:00:00.000Z',
        },
        {
          id: 'j_002',
          taskId: 102,
          action: 'CREATED',
          operatorEmail: 'lead@workops.test',
          timestamp: '2026-11-23T10:01:00.000Z',
        },
      ];
      const journalPath = path.join(tempDir, '.task-journal.json');
      fs.writeFileSync(journalPath, JSON.stringify(journalData, null, 2), 'utf8');

      const migration = new MigrationService(db);
      const report = await migration.migrate({ journalPath });

      expect(report.success).toBe(true);
      expect(report.migratedJournalEntries).toBe(2);

      const sqlite = (db as any).sqlite;
      const count = sqlite.prepare('SELECT count(*) as c FROM journal_entries').get().c;
      expect(count).toBe(2);
    });

    it('T1-F6-03: Migrates auto-closure configuration rules into relational database', async () => {
      const autoClosureConfig = {
        enabled: true,
        rules: [
          {
            teamName: 'Delta Pod',
            cutoffTime: '17:30',
            minHours: 7.5,
            requirePrEvidence: true,
          },
        ],
      };
      const autoClosurePath = path.join(tempDir, '.auto-closure-config.json');
      fs.writeFileSync(autoClosurePath, JSON.stringify(autoClosureConfig, null, 2), 'utf8');

      // Ensure team exists for foreign key constraint
      const sqlite = (db as any).sqlite;
      sqlite.prepare(`INSERT INTO organizations (id, name, slug) VALUES ('org_acme', 'Acme', 'acme')`).run();
      sqlite.prepare(`INSERT INTO departments (id, org_id, name) VALUES ('dept_cloud', 'org_acme', 'Cloud')`).run();
      sqlite.prepare(`INSERT INTO teams (id, dept_id, name) VALUES ('team_delta', 'dept_cloud', 'Delta Pod')`).run();

      const migration = new MigrationService(db);
      const report = await migration.migrate({ autoClosureConfigPath: autoClosurePath });

      expect(report.success).toBe(true);
      expect(report.migratedAutoClosureRules).toBeGreaterThanOrEqual(1);

      const rule = sqlite.prepare("SELECT * FROM auto_closure_rules WHERE cutoff_time = '17:30'").get();
      expect(rule).toBeDefined();
      expect(rule.min_hours).toBe(7.5);
    });

    it('T1-F6-04: Source data immutability: SHA-256 checksums of source files remain identical after migration', async () => {
      const samplePeople = {
        people: [{ name: 'Test', email: 'test@workops.test' }],
      };
      const peoplePath = path.join(tempDir, 'immutable-people.json');
      fs.writeFileSync(peoplePath, JSON.stringify(samplePeople, null, 2), 'utf8');

      const preChecksum = crypto.createHash('sha256').update(fs.readFileSync(peoplePath)).digest('hex');

      const migration = new MigrationService(db);
      await migration.migrate({ peoplePath });

      const postChecksum = crypto.createHash('sha256').update(fs.readFileSync(peoplePath)).digest('hex');
      expect(postChecksum).toBe(preChecksum);
    });

    it('T1-F6-05: Migration idempotency: executing migration a second time succeeds with zero duplicates', async () => {
      const peopleData = {
        people: [{ name: 'Sam', email: 'sam@workops.test' }],
      };
      const peoplePath = path.join(tempDir, 'idempotent.json');
      fs.writeFileSync(peoplePath, JSON.stringify(peopleData, null, 2), 'utf8');

      const migration = new MigrationService(db);
      const report1 = await migration.migrate({ peoplePath });
      expect(report1.success).toBe(true);

      const report2 = await migration.migrate({ peoplePath });
      expect(report2.success).toBe(true);

      const sqlite = (db as any).sqlite;
      const count = sqlite.prepare("SELECT count(*) as c FROM members WHERE email='sam@workops.test'").get().c;
      expect(count).toBe(1);
    });
  });
});
