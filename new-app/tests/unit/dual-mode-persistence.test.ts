import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { createDatabase, WorkOpsDb } from '../../src/infrastructure/persistence/database.js';
import { RelationalJournalRepository } from '../../src/infrastructure/persistence/relational-journal-repo.js';
import { FileJournalRepository } from '../../src/infrastructure/journal/file-journal-repo.js';
import { DualJournalRepository } from '../../src/infrastructure/persistence/dual-journal-repo.js';
import { RelationalConfigRepository } from '../../src/infrastructure/config/relational-config-repo.js';
import { FileConfigRepository } from '../../src/infrastructure/config/file-config-repo.js';
import { DualConfigRepository } from '../../src/infrastructure/config/dual-config-repo.js';
import { RelationalAutoClosureConfigRepository } from '../../src/infrastructure/config/relational-auto-closure-config-repo.js';
import { FileAutoClosureConfigRepository } from '../../src/infrastructure/config/file-auto-closure-config-repo.js';
import { DualAutoClosureConfigRepository } from '../../src/infrastructure/config/dual-auto-closure-config-repo.js';
import { RelationalAutoClosureAuditRepository } from '../../src/infrastructure/journal/relational-auto-closure-audit-repo.js';
import { FileAutoClosureAuditRepository } from '../../src/infrastructure/journal/file-auto-closure-audit-repo.js';
import { DualAutoClosureAuditRepository } from '../../src/infrastructure/journal/dual-auto-closure-audit-repo.js';
import { JournalEntry, PersonConfig } from '../../src/domain/ports/repositories.js';
import { AutoClosureConfig, AutoClosureAuditLog } from '../../src/domain/entities/auto-closure-config.js';
import { WorkCalendar } from '../../src/domain/services/work-calendar.js';

describe('Dual-Mode Persistence & Database Fallback Unit Tests', () => {
  let tempDir: string;
  let dbPath: string;
  let db: WorkOpsDb;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dual-persistence-test-'));
    dbPath = path.join(tempDir, 'test-workops.db');
    db = createDatabase({ sqlitePath: dbPath, engine: 'sqlite' });
  });

  afterEach(() => {
    try {
      db.close();
    } catch {
      // ignore if already closed
    }
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('1. Task Journal Dual-Mode Persistence', () => {
    let fileJournalRepo: FileJournalRepository;
    let relationalJournalRepo: RelationalJournalRepository;
    let dualJournalRepo: DualJournalRepository;
    let journalPath: string;

    beforeEach(() => {
      journalPath = path.join(tempDir, '.task-journal.json');
      fileJournalRepo = new FileJournalRepository(journalPath);
      relationalJournalRepo = new RelationalJournalRepository(db);
      dualJournalRepo = new DualJournalRepository(relationalJournalRepo, fileJournalRepo);
    });

    it('persists journal entries to database by default', async () => {
      const entry: JournalEntry = {
        runId: 'run-1',
        timestamp: new Date().toISOString(),
        personKey: 'dev1',
        personName: 'Developer One',
        assignedTo: 'dev1@example.com',
        targetIsoDate: '2026-11-24',
        title: 'Task 1',
        sourceTaskId: 42,
        createdWorkItemId: 101,
        fieldCopyStatus: 'SUCCESS',
        relationCopyStatus: 'SUCCESS',
        verified: true,
      };

      await dualJournalRepo.record(entry);

      // Verify written to database table
      const rows = (db as any).sqlite.prepare('SELECT * FROM journal_entries WHERE work_item_id = 101').all();
      expect(rows.length).toBe(1);
      expect(rows[0].operator_email).toBe('dev1@example.com');

      // Verify read from dual repository returns the DB entry
      const entries = await dualJournalRepo.getEntries();
      expect(entries.length).toBe(1);
      expect(entries[0].createdWorkItemId).toBe(101);
    });

    it('falls back to JSON file on database disconnect without throwing', async () => {
      // Write entry while DB is healthy (dual-writes to both)
      const entry: JournalEntry = {
        runId: 'run-fallback',
        timestamp: new Date().toISOString(),
        personKey: 'dev2',
        personName: 'Developer Two',
        assignedTo: 'dev2@example.com',
        targetIsoDate: '2026-11-24',
        title: 'Fallback Task',
        sourceTaskId: 42,
        createdWorkItemId: 102,
        fieldCopyStatus: 'SUCCESS',
        relationCopyStatus: 'PARTIAL',
        verified: true,
      };
      await dualJournalRepo.record(entry);

      // Close DB to simulate sudden disconnect
      db.close();

      // Read should seamlessly fall back to JSON file
      const entries = await dualJournalRepo.getEntries();
      expect(entries.length).toBe(1);
      expect(entries[0].createdWorkItemId).toBe(102);

      // getUnfinishedRelations should fall back cleanly
      const unfinished = await dualJournalRepo.getUnfinishedRelations();
      expect(unfinished.length).toBe(1);
      expect(unfinished[0].createdWorkItemId).toBe(102);

      // Export CSV and JSON should fall back cleanly
      const csv = await dualJournalRepo.exportCsv();
      expect(csv).toContain('Fallback Task');
      expect(csv).toContain('102');

      const json = await dualJournalRepo.exportJson();
      expect(json).toContain('Fallback Task');

      // Subsequent writes should not throw error
      const entry2: JournalEntry = {
        ...entry,
        runId: 'run-fallback-2',
        createdWorkItemId: 103,
      };
      await expect(dualJournalRepo.record(entry2)).resolves.not.toThrow();
    });
  });

  describe('2. People & Configuration Dual-Mode Persistence', () => {
    let configFilePath: string;
    let fileConfigRepo: FileConfigRepository;
    let relationalConfigRepo: RelationalConfigRepository;
    let dualConfigRepo: DualConfigRepository;

    beforeEach(() => {
      configFilePath = path.join(tempDir, 'people.json');
      fileConfigRepo = new FileConfigRepository(configFilePath);
      relationalConfigRepo = new RelationalConfigRepository(db, configFilePath);
      dualConfigRepo = new DualConfigRepository(relationalConfigRepo, fileConfigRepo);
    });

    it('persists people to relational tables by default', async () => {
      const people: PersonConfig[] = [
        {
          key: 'alex',
          name: 'Alex Developer',
          assignedTo: 'alex@example.com',
          role: 'Lead',
          enabled: true,
          autoCloseEnabled: true,
          pod: 'Frontend',
          titlePrefix: 'Frontend |',
          sourceTaskId: 42,
          githubUsername: 'alexdev',
          githubRepositories: ['org/repo'],
          githubBranches: ['main'],
        },
      ];

      await dualConfigRepo.savePeople(people);

      // Verify relational tables populated
      const canonicals = (db as any).sqlite.prepare('SELECT * FROM canonical_identities WHERE canonical_email = ?').all('alex@example.com');
      expect(canonicals.length).toBe(1);
      expect(canonicals[0].display_name).toBe('Alex Developer');

      const teamMembers = (db as any).sqlite.prepare('SELECT * FROM team_members').all();
      expect(teamMembers.length).toBe(1);
      expect(teamMembers[0].role).toBe('Lead');
      expect(teamMembers[0].pod).toBe('Frontend');
      expect(teamMembers[0].source_task_id).toBe(42);

      const aliases = (db as any).sqlite.prepare('SELECT * FROM identity_aliases WHERE alias_value = ?').all('alexdev');
      expect(aliases.length).toBe(1);

      // Verify read from dual repository
      const loaded = await dualConfigRepo.load();
      expect(loaded.people.length).toBe(1);
      expect(loaded.people[0].key).toBe('alex');
      expect(loaded.people[0].name).toBe('Alex Developer');
      expect(loaded.people[0].role).toBe('Lead');
    });

    it('auto-seeds database from people.json on startup if DB is empty', async () => {
      // Seed file only
      const initialPeople: PersonConfig[] = [
        {
          key: 'seeded-user',
          name: 'Seeded User',
          assignedTo: 'seeded@example.com',
          role: 'Developer',
          enabled: true,
        },
      ];
      await fileConfigRepo.savePeople(initialPeople);

      // Create new fresh DualConfigRepository instance pointing to empty DB
      const freshDualRepo = new DualConfigRepository(relationalConfigRepo, fileConfigRepo);

      const loaded = await freshDualRepo.load();
      expect(loaded.people.length).toBe(1);
      expect(loaded.people[0].key).toBe('seeded-user');

      // Verify database table was automatically seeded
      const canonicals = (db as any).sqlite.prepare('SELECT * FROM canonical_identities WHERE canonical_email = ?').all('seeded@example.com');
      expect(canonicals.length).toBe(1);
    });

    it('falls back to people.json when database is disconnected', async () => {
      const people: PersonConfig[] = [
        {
          key: 'offline-user',
          name: 'Offline User',
          assignedTo: 'offline@example.com',
          role: 'Developer',
          enabled: true,
        },
      ];
      await dualConfigRepo.savePeople(people);

      // Disconnect DB
      db.close();

      // Read should seamlessly return people from file
      const loaded = await dualConfigRepo.load();
      expect(loaded.people.length).toBe(1);
      expect(loaded.people[0].key).toBe('offline-user');

      // Writes should succeed against file without throwing
      await expect(
        dualConfigRepo.saveSettings({ organization: 'OfflineOrg' })
      ).resolves.not.toThrow();

      const updated = await fileConfigRepo.load();
      expect(updated.organization).toBe('OfflineOrg');
    });
  });

  describe('3. Work Calendar Dual-Mode Persistence', () => {
    let configFilePath: string;
    let fileConfigRepo: FileConfigRepository;
    let relationalConfigRepo: RelationalConfigRepository;
    let dualConfigRepo: DualConfigRepository;

    beforeEach(() => {
      configFilePath = path.join(tempDir, 'people.json');
      fileConfigRepo = new FileConfigRepository(configFilePath);
      relationalConfigRepo = new RelationalConfigRepository(db, configFilePath);
      dualConfigRepo = new DualConfigRepository(relationalConfigRepo, fileConfigRepo);
    });

    it('persists work calendar and exceptions to relational tables and app_settings', async () => {
      const calendar: WorkCalendar = {
        version: 1,
        defaultHours: 7.5,
        memberHours: { dev1: 6.0 },
        exceptions: [
          {
            id: 'exc-1',
            label: 'National Holiday',
            kind: 'holiday',
            startDate: '2026-12-25',
            endDate: '2026-12-25',
            memberKeys: [],
            availableHours: 0,
          },
          {
            id: 'exc-2',
            label: 'Personal Leave',
            kind: 'leave',
            startDate: '2026-12-28',
            endDate: '2026-12-28',
            memberKeys: ['dev1'],
            availableHours: 0,
          },
        ],
      };

      await dualConfigRepo.saveSettings({ calendar });

      // Verify work_calendars table
      const calRows = (db as any).sqlite.prepare('SELECT * FROM work_calendars').all();
      expect(calRows.length).toBe(1);
      expect(calRows[0].default_hours).toBe(7.5);

      // Verify calendar_exceptions table
      const excRows = (db as any).sqlite.prepare('SELECT * FROM calendar_exceptions').all();
      expect(excRows.length).toBe(2);

      // Verify app_settings has calendar key
      const settingRow = (db as any).sqlite.prepare("SELECT value_json FROM app_settings WHERE key = 'calendar'").get();
      expect(settingRow).toBeDefined();
      const parsed = JSON.parse(settingRow.value_json);
      expect(parsed.defaultHours).toBe(7.5);
      expect(parsed.exceptions.length).toBe(2);

      // Verify read from dual repository
      const loaded = await dualConfigRepo.load();
      expect(loaded.calendar).toBeDefined();
      expect(loaded.calendar?.defaultHours).toBe(7.5);
      expect(loaded.calendar?.exceptions.length).toBe(2);
    });

    it('falls back to file calendar when database connection fails', async () => {
      const calendar: WorkCalendar = {
        version: 2,
        defaultHours: 8.0,
        memberHours: {},
        exceptions: [
          {
            id: 'exc-offline',
            label: 'Offline Holiday',
            kind: 'holiday',
            startDate: '2026-12-31',
            endDate: '2026-12-31',
            memberKeys: [],
            availableHours: 0,
          },
        ],
      };
      await dualConfigRepo.saveSettings({ calendar });

      // Disconnect DB
      db.close();

      const loaded = await dualConfigRepo.load();
      expect(loaded.calendar).toBeDefined();
      expect(loaded.calendar?.exceptions[0].label).toBe('Offline Holiday');
    });
  });

  describe('4. Auto-Closure Configuration Dual-Mode Persistence', () => {
    let autoClosurePath: string;
    let fileRepo: FileAutoClosureConfigRepository;
    let relRepo: RelationalAutoClosureConfigRepository;
    let dualRepo: DualAutoClosureConfigRepository;

    beforeEach(() => {
      autoClosurePath = path.join(tempDir, '.auto-closure-config.json');
      fileRepo = new FileAutoClosureConfigRepository(autoClosurePath);
      relRepo = new RelationalAutoClosureConfigRepository(db);
      dualRepo = new DualAutoClosureConfigRepository(relRepo, fileRepo);
    });

    it('persists auto-closure configuration to app_settings and auto_closure_rules', async () => {
      const config: AutoClosureConfig = {
        enabled: true,
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        createdBy: 'admin',
        lastModifiedBy: 'admin',
        rules: [
          {
            ruleId: 'rule-eod-1',
            type: 'inclusion',
            filterType: 'teams',
            filters: [{ id: 'team-default', name: 'Default Team' }],
            description: 'EOD Auto Closure',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            createdBy: 'admin',
          },
        ],
        retentionDays: 60,
      };

      await dualRepo.save(config);

      // Verify app_settings has auto_closure_config
      const setting = (db as any).sqlite.prepare("SELECT value_json FROM app_settings WHERE key = 'auto_closure_config'").get();
      expect(setting).toBeDefined();
      const parsedSetting = JSON.parse(setting.value_json);
      expect(parsedSetting.enabled).toBe(true);
      expect(parsedSetting.rules.length).toBe(1);

      // Verify auto_closure_rules table
      const rules = (db as any).sqlite.prepare('SELECT * FROM auto_closure_rules').all();
      expect(rules.length).toBe(1);
      expect(rules[0].id).toBe('rule-eod-1');

      // Verify read from dual repository
      const loaded = await dualRepo.load();
      expect(loaded.enabled).toBe(true);
      expect(loaded.rules.length).toBe(1);
      expect(loaded.rules[0].ruleId).toBe('rule-eod-1');
      expect(await dualRepo.getVersion()).toBeGreaterThanOrEqual(2);
    });

    it('falls back to file when database is closed', async () => {
      const config: AutoClosureConfig = {
        enabled: true,
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        createdBy: 'admin',
        lastModifiedBy: 'admin',
        rules: [
          {
            ruleId: 'rule-fallback-1',
            type: 'inclusion',
            filterType: 'teams',
            filters: [{ id: 'team-default', name: 'Default Team' }],
            description: 'Fallback Rule',
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            createdBy: 'admin',
          },
        ],
      };
      await dualRepo.save(config);

      // Close DB
      db.close();

      const loaded = await dualRepo.load();
      expect(loaded.enabled).toBe(true);
      expect(loaded.rules[0].ruleId).toBe('rule-fallback-1');

      // Save while DB is disconnected should not throw
      const updatedConfig: AutoClosureConfig = {
        ...loaded,
        enabled: false,
      };
      await expect(dualRepo.save(updatedConfig)).resolves.not.toThrow();

      const finalFromFile = await fileRepo.load();
      expect(finalFromFile.enabled).toBe(false);
    });
  });

  describe('5. Auto-Closure Audit Log Dual-Mode Persistence', () => {
    let auditPath: string;
    let fileAuditRepo: FileAutoClosureAuditRepository;
    let relAuditRepo: RelationalAutoClosureAuditRepository;
    let dualAuditRepo: DualAutoClosureAuditRepository;

    beforeEach(() => {
      auditPath = path.join(tempDir, '.auto-closure-audit.json');
      fileAuditRepo = new FileAutoClosureAuditRepository(auditPath);
      relAuditRepo = new RelationalAutoClosureAuditRepository(db);
      dualAuditRepo = new DualAutoClosureAuditRepository(relAuditRepo, fileAuditRepo);
    });

    it('records and queries audit logs against relational database', async () => {
      const auditLog: AutoClosureAuditLog = {
        id: 'audit-1',
        taskId: 501,
        assignedUser: 'dev1@example.com',
        closedAt: new Date().toISOString(),
        triggerSource: 'scheduled',
        closureReason: 'Completed PR requirements satisfied',
        automationDetails: {
          ruleId: 'rule-1',
          ruleName: 'Default Rule',
          matchedFilterType: 'teams',
          matchedFilters: ['team-default'],
        },
        configurationVersion: 1,
        validationResults: { passed: true },
        status: 'success',
      };

      await dualAuditRepo.record(auditLog);

      // Verify record in auto_closure_audit_logs table
      const rows = (db as any).sqlite.prepare('SELECT * FROM auto_closure_audit_logs WHERE task_id = 501').all();
      expect(rows.length).toBe(1);
      expect(rows[0].evaluation_status).toBe('success');

      // Query through dual repo
      const entries = await dualAuditRepo.getEntries();
      expect(entries.length).toBe(1);
      expect(entries[0].taskId).toBe(501);

      const byTask = await dualAuditRepo.getEntriesByTask(501);
      expect(byTask.length).toBe(1);
      expect(byTask[0].id).toBe('audit-1');

      // Export CSV and JSON
      const csv = await dualAuditRepo.exportCsv();
      expect(csv).toContain('501');
      expect(csv).toContain('dev1@example.com');

      const json = await dualAuditRepo.exportJson();
      expect(json).toContain('501');
    });

    it('falls back to JSON file on database disconnection', async () => {
      const auditLog: AutoClosureAuditLog = {
        id: 'audit-offline-1',
        taskId: 777,
        assignedUser: 'dev2@example.com',
        closedAt: new Date().toISOString(),
        triggerSource: 'scheduled',
        closureReason: 'Closed automatically',
        automationDetails: {},
        configurationVersion: 1,
        validationResults: { passed: true },
        status: 'success',
      };
      await dualAuditRepo.record(auditLog);

      // Close DB
      db.close();

      const entries = await dualAuditRepo.getEntries();
      expect(entries.length).toBe(1);
      expect(entries[0].taskId).toBe(777);

      const byTask = await dualAuditRepo.getEntriesByTask(777);
      expect(byTask.length).toBe(1);

      const csv = await dualAuditRepo.exportCsv();
      expect(csv).toContain('777');

      // Cleanup while disconnected
      const count = await dualAuditRepo.cleanup(new Date(Date.now() + 10000).toISOString());
      expect(count).toBeGreaterThanOrEqual(1);
    });
  });

  describe('6. Database Engine & Configuration Selection', () => {
    it('selects sqlite engine via DB_ENGINE environment variable', () => {
      const origDbEngine = process.env.DB_ENGINE;
      try {
        process.env.DB_ENGINE = 'sqlite';
        const testDb = createDatabase({ sqlitePath: ':memory:' });
        expect(testDb.engine).toBe('sqlite');
        testDb.close();
      } finally {
        if (origDbEngine !== undefined) {
          process.env.DB_ENGINE = origDbEngine;
        } else {
          delete process.env.DB_ENGINE;
        }
      }
    });

    it('respects DB_DISABLED=true to disable database initialization', () => {
      const origDisabled = process.env.DB_DISABLED;
      try {
        process.env.DB_DISABLED = 'true';
        expect(() => createDatabase({ sqlitePath: ':memory:' })).toThrow(/disabled by DB_DISABLED/);
      } finally {
        if (origDisabled !== undefined) {
          process.env.DB_DISABLED = origDisabled;
        } else {
          delete process.env.DB_DISABLED;
        }
      }
    });
  });
});
