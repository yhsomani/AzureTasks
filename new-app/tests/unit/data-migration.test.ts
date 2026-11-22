import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createDatabase, WorkOpsDb } from '../../src/infrastructure/persistence/database.js';
import {
  MigrationService,
  normalizeDateFormat,
} from '../../src/infrastructure/persistence/migration/migration-service.js';

describe('Milestone 3 — Feature 18: Zero-Data-Loss Data Migration', () => {
  let tempDir: string;
  let sqlitePath: string;
  let db: WorkOpsDb;

  let peoplePath: string;
  let journalPath: string;
  let autoClosurePath: string;
  let calendarPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workops-migration-test-'));
    sqlitePath = path.join(tempDir, 'migration-test.db');
    db = createDatabase({ sqlitePath, engine: 'sqlite' });

    peoplePath = path.join(tempDir, 'people.json');
    journalPath = path.join(tempDir, '.task-journal.json');
    autoClosurePath = path.join(tempDir, '.auto-closure-config.json');
    calendarPath = path.join(tempDir, '.work-calendar.json');

    // Create realistic mock files
    const people = [
      {
        key: 'dev1',
        name: 'Alice Developer',
        assignedTo: 'alice@workops.test',
        email: 'alice@workops.test',
        role: 'Developer',
        enabled: true,
      },
      {
        key: 'dev2',
        name: 'Bob Lead',
        assignedTo: 'bob@workops.test',
        email: 'bob@workops.test',
        role: 'Lead',
        enabled: true,
      },
    ];
    fs.writeFileSync(peoplePath, JSON.stringify(people, null, 2));

    const journal = [
      {
        id: 'j-1',
        runId: 'run-001',
        timestamp: '2026-11-20T10:00:00Z',
        action: 'CREATED',
        personKey: 'dev1',
        personName: 'Alice Developer',
        assignedTo: 'alice@workops.test',
        targetIsoDate: '2026-11-20',
        title: 'Task: Alice | Sprint 1 | 2026-11-20',
        sourceTaskId: 100,
        createdWorkItemId: 1001,
        fieldCopyStatus: 'SUCCESS',
        relationCopyStatus: 'SUCCESS',
        verified: true,
        operator_email: 'lead@workops.test',
      },
      {
        id: 'j-2',
        runId: 'run-001',
        timestamp: '2026-11-20T10:01:00Z',
        action: 'CREATED',
        personKey: 'dev2',
        personName: 'Bob Lead',
        assignedTo: 'bob@workops.test',
        targetIsoDate: '2026-11-20',
        title: 'Task: Bob | Sprint 1 | 2026-11-20',
        sourceTaskId: 100,
        createdWorkItemId: 1002,
        fieldCopyStatus: 'SUCCESS',
        relationCopyStatus: 'SUCCESS',
        verified: true,
        operator_email: 'lead@workops.test',
      },
    ];
    fs.writeFileSync(journalPath, JSON.stringify(journal, null, 2));

    const autoClosure = {
      rules: [
        {
          id: 'rule-eod',
          cutoffTime: '18:00',
          minHours: 8.0,
          requirePrEvidence: true,
        },
      ],
    };
    fs.writeFileSync(autoClosurePath, JSON.stringify(autoClosure, null, 2));

    const calendar = {
      timezone: 'America/New_York',
      cycleAnchorDay: 4,
      exceptions: [
        {
          date: '25/12/2026', // Test DD/MM/YYYY normalization
          isWorkingDay: false,
          description: 'Christmas',
        },
      ],
    };
    fs.writeFileSync(calendarPath, JSON.stringify(calendar, null, 2));
  });

  afterEach(() => {
    if (db && db.engine === 'sqlite') {
      db.close();
    }
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('normalizes various date formats correctly', () => {
    expect(normalizeDateFormat('25/12/2026')).toBe('2026-12-25');
    expect(normalizeDateFormat('05/01/2027')).toBe('2027-01-05');
    expect(normalizeDateFormat('2026-11-22')).toBe('2026-11-22');
    expect(normalizeDateFormat('2026-11-20T10:00:00Z')).toBe('2026-11-20');
  });

  it('migrates all flat JSON files into relational database cleanly', async () => {
    const migration = new MigrationService(db);
    const report = await migration.migrate({
      peoplePath,
      journalPath,
      autoClosureConfigPath: autoClosurePath,
      calendarPath,
    });

    expect(report.success).toBe(true);
    expect(report.errors.length).toBe(0);
    expect(report.sourceMembers).toBe(2);
    expect(report.migratedMembers).toBe(2);
    expect(report.sourceJournalEntries).toBe(2);
    expect(report.migratedJournalEntries).toBe(2);
    expect(report.sourceAutoClosureRules).toBe(1);
    expect(report.migratedAutoClosureRules).toBe(1);

    if (db.engine === 'sqlite') {
      const memberCount = db.sqlite.prepare('SELECT count(*) as c FROM members').get() as { c: number };
      expect(memberCount.c).toBe(2);

      const journalCount = db.sqlite.prepare('SELECT count(*) as c FROM journal_entries').get() as { c: number };
      expect(journalCount.c).toBe(2);

      const ruleCount = db.sqlite.prepare('SELECT count(*) as c FROM auto_closure_rules').get() as { c: number };
      expect(ruleCount.c).toBe(1);

      const cal = db.sqlite.prepare('SELECT * FROM work_calendars').get() as any;
      expect(cal.timezone).toBe('America/New_York');

      const exc = db.sqlite.prepare('SELECT * FROM calendar_exceptions').get() as any;
      expect(exc.date).toBe('2026-12-25');
      expect(exc.is_working_day).toBe(0);
    }
  });

  it('is completely idempotent (safe to re-run multiple times without duplicate records)', async () => {
    const migration = new MigrationService(db);

    const report1 = await migration.migrate({
      peoplePath,
      journalPath,
      autoClosureConfigPath: autoClosurePath,
      calendarPath,
    });
    expect(report1.success).toBe(true);

    // Second run
    const report2 = await migration.migrate({
      peoplePath,
      journalPath,
      autoClosureConfigPath: autoClosurePath,
      calendarPath,
    });
    expect(report2.success).toBe(true);
    expect(report2.errors.length).toBe(0);

    if (db.engine === 'sqlite') {
      const memberCount = db.sqlite.prepare('SELECT count(*) as c FROM members').get() as { c: number };
      expect(memberCount.c).toBe(2);

      const journalCount = db.sqlite.prepare('SELECT count(*) as c FROM journal_entries').get() as { c: number };
      expect(journalCount.c).toBe(2);
    }
  });

  it('handles corrupt JSON gracefully and reports error without crashing', async () => {
    const corruptJournalPath = path.join(tempDir, 'corrupt-journal.json');
    fs.writeFileSync(corruptJournalPath, '{"invalid_json": broken');

    const migration = new MigrationService(db);
    const report = await migration.migrate({
      journalPath: corruptJournalPath,
    });

    expect(report.success).toBe(false);
    expect(report.errors.length).toBeGreaterThan(0);
    expect(report.errors[0]).toContain('Error migrating journal');
  });
});
