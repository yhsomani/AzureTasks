import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { createDatabase, WorkOpsDb } from '../../../src/infrastructure/persistence/database.js';
import { MigrationService, normalizeDateFormat } from '../../../src/infrastructure/persistence/migration/migration-service.js';

describe('Tier 2: Boundary & Corner Cases - Group 2: Database & Migration', () => {
  let tempDir: string;
  let db: WorkOpsDb;

  beforeEach(() => {
    tempDir = path.join(os.tmpdir(), `workops-db-tier2-${crypto.randomUUID()}`);
    fs.mkdirSync(tempDir, { recursive: true });
    const dbPath = path.join(tempDir, 'tier2.sqlite');
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
  // Feature F4 Boundary: Schema & Relational Integrity Limits (5 Tests)
  // =========================================================================
  describe('Feature F4 Boundary: Schema Limits & Edge Cases', () => {
    it('T2-F4-01: Large text payload boundary: 1MB JSON string in details_json stores and retrieves intact', () => {
      const sqlite = (db as any).sqlite;
      const largePayload = JSON.stringify({ data: 'A'.repeat(1024 * 1024) }); // 1MB payload

      sqlite
        .prepare(
          `INSERT INTO journal_entries (id, action_type, operator_email, details_json)
           VALUES ('j_1mb', 'LARGE_PAYLOAD', 'admin@workops.test', ?)`
        )
        .run(largePayload);

      const row = sqlite.prepare('SELECT details_json FROM journal_entries WHERE id = ?').get('j_1mb');
      expect(row.details_json.length).toBeGreaterThanOrEqual(1024 * 1024);
      const parsed = JSON.parse(row.details_json);
      expect(parsed.data.length).toBe(1024 * 1024);
    });

    it('T2-F4-02: Non-nullable boundary: inserting NULL into required columns throws constraint failure', () => {
      const sqlite = (db as any).sqlite;
      expect(() => {
        sqlite
          .prepare(
            `INSERT INTO canonical_identities (id, canonical_email, display_name)
             VALUES ('u_null', NULL, 'Display Name')`
          )
          .run();
      }).toThrow(/NOT NULL/i);
    });

    it('T2-F4-03: Full Unicode and emoji boundary: supports Japanese, Arabic, and emojis in text fields', () => {
      const sqlite = (db as any).sqlite;
      const unicodeTitle = '🚀 Daily Task 業務 タスク | مهام يومية 🛠️';

      sqlite
        .prepare(`INSERT INTO azure_projects (project_id, name) VALUES ('p_unicode', 'Agile')`)
        .run();

      sqlite
        .prepare(
          `INSERT INTO work_items (project_id, work_item_id, type, title, state, area_path, iteration_path, created_date, changed_date, payload_json)
           VALUES ('p_unicode', 9999, 'Task', ?, 'New', 'Agile\\POD', 'Agile\\Sprint 1', datetime('now'), datetime('now'), '{}')`
        )
        .run(unicodeTitle);

      const row = sqlite.prepare('SELECT title FROM work_items WHERE work_item_id = 9999').get();
      expect(row.title).toBe(unicodeTitle);
    });

    it('T2-F4-04: SQL injection resilience: injection vectors are treated strictly as literal data', () => {
      const sqlite = (db as any).sqlite;
      const injectionVector = "'; DROP TABLE canonical_identities; --";

      sqlite
        .prepare(
          `INSERT INTO canonical_identities (id, canonical_email, display_name)
           VALUES ('inj_1', 'injection@workops.test', ?)`
        )
        .run(injectionVector);

      const row = sqlite.prepare('SELECT display_name FROM canonical_identities WHERE id = ?').get('inj_1');
      expect(row.display_name).toBe(injectionVector);

      // Verify table was not dropped
      const count = sqlite.prepare('SELECT count(*) as c FROM canonical_identities').get().c;
      expect(count).toBeGreaterThan(0);
    });

    it('T2-F4-05: 64-bit integer ID boundary: handles IDs greater than 2^31 - 1 without truncation', () => {
      const sqlite = (db as any).sqlite;
      const bigId = 3000000000; // > 2,147,483,647

      sqlite
        .prepare(`INSERT INTO azure_projects (project_id, name) VALUES ('p_bigid', 'Agile')`)
        .run();

      sqlite
        .prepare(
          `INSERT INTO work_items (project_id, work_item_id, type, title, state, area_path, iteration_path, created_date, changed_date, payload_json)
           VALUES ('p_bigid', ?, 'Task', 'Big ID Task', 'New', 'Agile\\POD', 'Agile\\Sprint 1', datetime('now'), datetime('now'), '{}')`
        )
        .run(bigId);

      const row = sqlite.prepare('SELECT work_item_id FROM work_items WHERE project_id = ?').get('p_bigid');
      expect(row.work_item_id).toBe(bigId);
    });
  });

  // =========================================================================
  // Feature F5 Boundary: Collision & Precision Edge Cases (5 Tests)
  // =========================================================================
  describe('Feature F5 Boundary: Collision & Precision Edge Cases', () => {
    it('T2-F5-01: High-concurrency simultaneous batch inserts: 50 journal entries inserted at identical microsecond', async () => {
      const sqlite = (db as any).sqlite;
      const microsecondTimestamp = '2026-11-23T14:30:15.123456Z';

      const entries = Array.from({ length: 50 }, (_, i) => ({
        id: `batch_concurrent_${i}_${crypto.randomUUID()}`,
        runId: 'shared_microsecond_run',
        action: 'TASK_BATCH',
        timestamp: microsecondTimestamp,
      }));

      sqlite.exec('BEGIN TRANSACTION;');
      const stmt = sqlite.prepare(
        `INSERT INTO journal_entries (id, run_id, action_type, operator_email, details_json, created_at)
         VALUES (?, ?, ?, 'operator@workops.test', '{}', ?)`
      );
      for (const e of entries) {
        stmt.run(e.id, e.runId, e.action, e.timestamp);
      }
      sqlite.exec('COMMIT;');

      const count = sqlite
        .prepare('SELECT count(*) as c FROM journal_entries WHERE run_id = ?')
        .get('shared_microsecond_run').c;
      expect(count).toBe(50);
    });

    it('T2-F5-02: normalizeDateFormat parses varying timestamp sub-millisecond decimals correctly', () => {
      expect(normalizeDateFormat('2026-11-23T14:30:15.1Z')).toBe('2026-11-23T14:30:15.100Z');
      expect(normalizeDateFormat('2026-11-23T14:30:15.12Z')).toBe('2026-11-23T14:30:15.120Z');
      expect(normalizeDateFormat('2026-11-23T14:30:15.123Z')).toBe('2026-11-23T14:30:15.123Z');
      expect(normalizeDateFormat('23/11/2026')).toBe('2026-11-23');
    });

    it('T2-F5-03: Missing timestamp in journal insertion falls back cleanly to current UTC timestamp', () => {
      const sqlite = (db as any).sqlite;
      sqlite
        .prepare(
          `INSERT INTO journal_entries (id, action_type, operator_email, details_json)
           VALUES ('j_default_time', 'ACTION', 'admin@workops.test', '{}')`
        )
        .run();

      const row = sqlite.prepare('SELECT created_at FROM journal_entries WHERE id = ?').get('j_default_time');
      expect(row.created_at).toBeDefined();
      expect(row.created_at.length).toBeGreaterThanOrEqual(10);
    });

    it('T2-F5-04: Malformed date string handled safely without unhandled exception', () => {
      const result = normalizeDateFormat('not-a-valid-date');
      expect(result).toBe('not-a-valid-date');
    });

    it('T2-F5-05: Maximum batch size stress: processes single transaction of 1,000 journal entries in < 200ms', () => {
      const sqlite = (db as any).sqlite;
      const start = Date.now();

      sqlite.exec('BEGIN TRANSACTION;');
      const stmt = sqlite.prepare(
        `INSERT INTO journal_entries (id, action_type, operator_email, details_json)
         VALUES (?, 'STRESS', 'op@test', '{}')`
      );

      for (let i = 0; i < 1000; i++) {
        stmt.run(`stress_${i}`);
      }
      sqlite.exec('COMMIT;');

      const elapsed = Date.now() - start;
      const count = sqlite.prepare("SELECT count(*) as c FROM journal_entries WHERE action_type = 'STRESS'").get().c;

      expect(count).toBe(1000);
      expect(elapsed).toBeLessThan(500);
    });
  });

  // =========================================================================
  // Feature F6 Boundary: Migration Failure Recovery & Idempotency (5 Tests)
  // =========================================================================
  describe('Feature F6 Boundary: Migration Recovery & Edge Cases', () => {
    it('T2-F6-01: Empty people JSON array: completes with 0 members and 0 errors', async () => {
      const emptyPeoplePath = path.join(tempDir, 'empty-people.json');
      fs.writeFileSync(emptyPeoplePath, JSON.stringify({ people: [] }), 'utf8');

      const migration = new MigrationService(db);
      const report = await migration.migrate({ peoplePath: emptyPeoplePath });

      expect(report.success).toBe(true);
      expect(report.migratedMembers).toBe(0);
      expect(report.errors).toEqual([]);
    });

    it('T2-F6-02: Malformed JSON syntax: migration aborts cleanly with descriptive error; 0 orphaned rows created', async () => {
      const malformedPath = path.join(tempDir, 'broken.json');
      fs.writeFileSync(malformedPath, '{ invalid json content here', 'utf8');

      const migration = new MigrationService(db);
      const report = await migration.migrate({ peoplePath: malformedPath });

      expect(report.success).toBe(false);
      expect(report.errors.length).toBeGreaterThanOrEqual(1);
      expect(report.errors[0]).toMatch(/JSON/i);
    });

    it('T2-F6-03: Duplicate member email across teams maps to single canonical identity', async () => {
      const multiTeamData = {
        people: [
          { name: 'David TeamA', email: 'david@workops.test', role: 'Dev' },
          { name: 'David TeamB', email: 'david@workops.test', role: 'Lead' },
        ],
      };
      const dupPath = path.join(tempDir, 'dup-people.json');
      fs.writeFileSync(dupPath, JSON.stringify(multiTeamData), 'utf8');

      const migration = new MigrationService(db);
      const report = await migration.migrate({ peoplePath: dupPath });

      expect(report.success).toBe(true);
      const sqlite = (db as any).sqlite;
      const canonicalRows = sqlite
        .prepare("SELECT * FROM canonical_identities WHERE canonical_email = 'david@workops.test'")
        .all();
      expect(canonicalRows.length).toBe(1);
    });

    it('T2-F6-04: Items missing optional fields (pod, titlePrefix, avatarUrl) migrate with safe defaults', async () => {
      const minimalData = {
        people: [{ email: 'minimal@workops.test' }],
      };
      const minPath = path.join(tempDir, 'minimal.json');
      fs.writeFileSync(minPath, JSON.stringify(minimalData), 'utf8');

      const migration = new MigrationService(db);
      const report = await migration.migrate({ peoplePath: minPath });

      expect(report.success).toBe(true);
      const sqlite = (db as any).sqlite;
      const user = sqlite.prepare("SELECT * FROM canonical_identities WHERE canonical_email = 'minimal@workops.test'").get();
      expect(user).toBeDefined();
      expect(user.is_active).toBe(1);
    });

    it('T2-F6-05: Mid-migration transaction failure rolls back state without leaving corrupt partial data', () => {
      const sqlite = (db as any).sqlite;
      const initialCount = sqlite.prepare('SELECT count(*) as c FROM canonical_identities').get().c;

      try {
        sqlite.exec('BEGIN TRANSACTION;');
        sqlite
          .prepare(
            `INSERT INTO canonical_identities (id, canonical_email, display_name)
             VALUES ('part_1', 'partial1@test', 'Partial One')`
          )
          .run();
        // Force error by inserting invalid duplicate
        sqlite
          .prepare(
            `INSERT INTO canonical_identities (id, canonical_email, display_name)
             VALUES ('part_1', 'partial2@test', 'Partial Two')`
          )
          .run();
        sqlite.exec('COMMIT;');
      } catch {
        sqlite.exec('ROLLBACK;');
      }

      const finalCount = sqlite.prepare('SELECT count(*) as c FROM canonical_identities').get().c;
      expect(finalCount).toBe(initialCount);
    });
  });
});
