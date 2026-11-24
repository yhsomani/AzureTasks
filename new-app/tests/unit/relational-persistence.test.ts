import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { createDatabase, WorkOpsDb } from '../../src/infrastructure/persistence/database.js';
import { RelationalJournalRepository } from '../../src/infrastructure/persistence/relational-journal-repo.js';
import { RelationalPlanTokenRepository } from '../../src/infrastructure/persistence/relational-plan-token-repo.js';

describe('Milestone 3 — Feature 16 & 17: Pluggable Relational Persistence & Schema', () => {
  let tempDir: string;
  let sqlitePath: string;
  let db: WorkOpsDb;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workops-rel-test-'));
    sqlitePath = path.join(tempDir, 'test-workops.db');
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

  it('initializes SQLite with WAL mode, foreign keys ON, and creates all 10 tables', () => {
    if (db.engine !== 'sqlite') throw new Error('Expected sqlite engine');

    // Verify pragmas
    const journalMode = db.sqlite.pragma('journal_mode', { simple: true });
    expect(journalMode).toBe('wal');

    const foreignKeys = db.sqlite.pragma('foreign_keys', { simple: true });
    expect(foreignKeys).toBe(1);

    // Verify all 10 required tables exist
    const tables = [
      'organizations',
      'departments',
      'teams',
      'members',
      'work_calendars',
      'calendar_exceptions',
      'plan_tokens',
      'journal_entries',
      'auto_closure_rules',
      'distributed_locks',
    ];

    for (const table of tables) {
      const row = db.sqlite
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
        .get(table);
      expect(row).toBeDefined();
    }
  });

  it('enforces relational constraints and cascading deletes (ON DELETE CASCADE)', () => {
    if (db.engine !== 'sqlite') throw new Error('Expected sqlite engine');
    const sqlite = (db as Extract<typeof db, { engine: 'sqlite' }>).sqlite;

    const orgId = 'org-test-1';
    const deptId = 'dept-test-1';
    const teamId = 'team-test-1';
    const memberId = 'member-test-1';
    const calId = 'cal-test-1';
    const excId = 'exc-test-1';
    const ruleId = 'rule-test-1';

    // Insert hierarchy
    sqlite
      .prepare('INSERT INTO organizations (id, name, slug) VALUES (?, ?, ?)')
      .run(orgId, 'Test Org', 'test-org');

    sqlite
      .prepare('INSERT INTO departments (id, org_id, name) VALUES (?, ?, ?)')
      .run(deptId, orgId, 'Engineering');

    sqlite
      .prepare('INSERT INTO teams (id, dept_id, name) VALUES (?, ?, ?)')
      .run(teamId, deptId, 'Core Team');

    sqlite
      .prepare('INSERT INTO members (id, team_id, email, display_name, role) VALUES (?, ?, ?, ?, ?)')
      .run(memberId, teamId, 'dev@workops.test', 'Dev One', 'Developer');

    sqlite
      .prepare('INSERT INTO work_calendars (id, team_id, timezone, cycle_anchor_day) VALUES (?, ?, ?, ?)')
      .run(calId, teamId, 'UTC', 4);

    sqlite
      .prepare('INSERT INTO calendar_exceptions (id, calendar_id, date, is_working_day, description) VALUES (?, ?, ?, ?, ?)')
      .run(excId, calId, '2026-11-26', 0, 'Holiday');

    sqlite
      .prepare('INSERT INTO auto_closure_rules (id, team_id, cutoff_time, min_hours, require_pr_evidence) VALUES (?, ?, ?, ?, ?)')
      .run(ruleId, teamId, '18:00', 8.0, 1);

    // Verify insertion
    expect(sqlite.prepare('SELECT count(*) as c FROM members WHERE id = ?').get(memberId)).toEqual({ c: 1 });
    expect(sqlite.prepare('SELECT count(*) as c FROM calendar_exceptions WHERE id = ?').get(excId)).toEqual({ c: 1 });
    expect(sqlite.prepare('SELECT count(*) as c FROM auto_closure_rules WHERE id = ?').get(ruleId)).toEqual({ c: 1 });

    // Foreign key violation check: inserting member with invalid team_id must fail
    expect(() => {
      sqlite
        .prepare('INSERT INTO members (id, team_id, email, display_name) VALUES (?, ?, ?, ?)')
        .run('bad-member', 'non-existent-team', 'bad@test.com', 'Bad Member');
    }).toThrow();

    // Cascading delete: deleting organization must cascade all the way down
    sqlite.prepare('DELETE FROM organizations WHERE id = ?').run(orgId);

    expect(sqlite.prepare('SELECT count(*) as c FROM departments WHERE id = ?').get(deptId)).toEqual({ c: 0 });
    expect(sqlite.prepare('SELECT count(*) as c FROM teams WHERE id = ?').get(teamId)).toEqual({ c: 0 });
    expect(db.sqlite.prepare('SELECT count(*) as c FROM members WHERE id = ?').get(memberId)).toEqual({ c: 0 });
    expect(db.sqlite.prepare('SELECT count(*) as c FROM work_calendars WHERE id = ?').get(calId)).toEqual({ c: 0 });
    expect(db.sqlite.prepare('SELECT count(*) as c FROM calendar_exceptions WHERE id = ?').get(excId)).toEqual({ c: 0 });
    expect(db.sqlite.prepare('SELECT count(*) as c FROM auto_closure_rules WHERE id = ?').get(ruleId)).toEqual({ c: 0 });
  });

  it('RelationalJournalRepository records, queries, and exports journal entries', async () => {
    const journalRepo = new RelationalJournalRepository(db);

    const entry = {
      runId: 'run-123',
      timestamp: new Date().toISOString(),
      personKey: 'dev1',
      personName: 'Dev One',
      assignedTo: 'dev1@workops.test',
      targetIsoDate: '2026-11-23',
      title: 'Task: Dev One | Sprint 1 | 2026-11-23',
      sourceTaskId: 5001,
      createdWorkItemId: 7001,
      fieldCopyStatus: 'SUCCESS' as const,
      relationCopyStatus: 'SUCCESS' as const,
      verified: true,
      action: 'CREATED',
    };

    await journalRepo.record(entry);

    const entries = await journalRepo.getEntries();
    expect(entries.length).toBe(1);
    expect(entries[0].createdWorkItemId).toBe(7001);
    expect(entries[0].personKey).toBe('dev1');

    // Test markRepaired
    const partialEntry = {
      ...entry,
      runId: 'run-124',
      createdWorkItemId: 7002,
      relationCopyStatus: 'PARTIAL' as const,
    };
    await journalRepo.record(partialEntry);

    const unfinished = await journalRepo.getUnfinishedRelations();
    expect(unfinished.some((e) => e.createdWorkItemId === 7002)).toBe(true);

    const repaired = await journalRepo.markRepaired(partialEntry, 'SUCCESS', 'Repaired manually', true);
    expect(repaired).toBe(true);

    // Test exportCsv and exportJson
    const csv = await journalRepo.exportCsv();
    expect(csv).toContain('Timestamp,RunId,Action');
    expect(csv).toContain('Dev One');

    const jsonStr = await journalRepo.exportJson();
    const parsed = JSON.parse(jsonStr);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBe(2);
  });

  it('RelationalPlanTokenRepository saves, retrieves, and marks tokens executed', async () => {
    const tokenRepo = new RelationalPlanTokenRepository(db);

    const tokenHash = crypto.createHash('sha256').update('test-token-1').digest('hex');
    const record = {
      tokenHash,
      planToken: 'pln_test_1',
      expiresAt: Date.now() + 600000,
      isExecuted: false,
      snapshotJson: JSON.stringify({ totalPlanned: 3 }),
      operatorEmail: 'lead@workops.test',
    };

    await tokenRepo.saveToken(record);

    const fetched = await tokenRepo.getTokenByHash(tokenHash);
    expect(fetched).not.toBeNull();
    expect(fetched?.tokenHash).toBe(tokenHash);
    expect(fetched?.isExecuted).toBe(false);
    expect(fetched?.operatorEmail).toBe('lead@workops.test');

    const marked = await tokenRepo.markExecuted(tokenHash);
    expect(marked).toBe(true);

    const updated = await tokenRepo.getTokenByHash(tokenHash);
    expect(updated?.isExecuted).toBe(true);
  });

  it('round-trips canonical identity aliases into runtime person configuration', async () => {
    const { RelationalConfigRepository } = await import('../../src/infrastructure/config/relational-config-repo.js');
    const repo = new RelationalConfigRepository(db);
    await repo.savePeople([{
      key: 'alias-user', name: 'Alias User', assignedTo: 'current@example.com',
      aliases: ['old@example.com', 'aad.subject', '11111111-1111-1111-1111-111111111111'],
      enabled: true,
    }]);
    const config = await repo.load();
    expect(config.people[0].canonicalId).toBe('usr_alias-user');
    expect(config.people[0].aliases).toEqual(expect.arrayContaining([
      'old@example.com', 'aad.subject', '11111111-1111-1111-1111-111111111111',
    ]));
  });
});
