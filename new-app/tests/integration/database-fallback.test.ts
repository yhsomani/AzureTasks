import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { buildApp, App } from '../../src/container.js';
import { checkDatabaseHealth } from '../../src/infrastructure/persistence/database.js';
import { JournalEntry, PersonConfig } from '../../src/domain/ports/repositories.js';
import { AutoClosureConfig } from '../../src/domain/entities/auto-closure-config.js';
import { WorkCalendar } from '../../src/domain/services/work-calendar.js';

describe('Database Persistence & Dual-Mode Fallback Integration Tests', () => {
  let tempDir: string;
  let configPath: string;
  let dbPath: string;
  let app: App;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'db-fallback-integration-'));
    configPath = path.join(tempDir, 'people.json');
    dbPath = path.join(tempDir, 'workops-integration.db');

    // Create minimal valid people.json
    const initialConfig = {
      organization: 'IntegrationOrg',
      project: 'IntegrationProject',
      people: [
        {
          key: 'member-1',
          name: 'Integration Member',
          assignedTo: 'member1@workops.test',
          role: 'Developer',
          enabled: true,
        },
      ],
    };
    fs.writeFileSync(configPath, JSON.stringify(initialConfig, null, 2), 'utf-8');
  });

  afterEach(async () => {
    if (app?.db) {
      try {
        app.db.close();
      } catch {
        // ignore
      }
    }
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    delete process.env.DB_DISABLED;
    delete process.env.DB_ENGINE;
  });

  it('Scenario 1: Normal Boot with default database persistence', async () => {
    app = await buildApp(configPath, {
      sqlitePath: dbPath,
      autoStartScheduler: false,
    });

    expect(app.db).toBeDefined();
    const isHealthy = await checkDatabaseHealth(app.db);
    expect(isHealthy).toBe(true);

    // 1. Task journal write and read
    const journalEntry: JournalEntry = {
      runId: 'integ-run-1',
      timestamp: new Date().toISOString(),
      personKey: 'member-1',
      personName: 'Integration Member',
      assignedTo: 'member1@workops.test',
      targetIsoDate: '2026-11-24',
      title: 'Integration Test Task',
      sourceTaskId: 42,
      createdWorkItemId: 9001,
      fieldCopyStatus: 'SUCCESS',
      relationCopyStatus: 'SUCCESS',
      verified: true,
    };
    await app.journal.record(journalEntry);

    const journalRows = (app.db as any).sqlite.prepare('SELECT * FROM journal_entries WHERE work_item_id = 9001').all();
    expect(journalRows.length).toBe(1);

    const entries = await app.journal.getEntries();
    expect(entries.some(e => e.createdWorkItemId === 9001)).toBe(true);

    // 2. People & Settings write and read
    const newPerson: PersonConfig = {
      key: 'member-2',
      name: 'Second Member',
      assignedTo: 'member2@workops.test',
      role: 'QA',
      enabled: true,
    };
    await app.configUseCases.savePeople({ people: [...app.config.people, newPerson] });

    const identityRows = (app.db as any).sqlite.prepare('SELECT * FROM canonical_identities WHERE canonical_email = ?').all('member2@workops.test');
    expect(identityRows.length).toBe(1);

    // 3. Calendar write and read
    const calendar: WorkCalendar = {
      version: app.config.calendar?.version ?? 0,
      defaultHours: 8.0,
      memberHours: {},
      exceptions: [
        {
          id: 'holiday-1',
          label: 'Integration Holiday',
          kind: 'holiday',
          startDate: '2026-12-25',
          endDate: '2026-12-25',
          memberKeys: [],
          availableHours: 0,
        },
      ],
    };
    await app.configUseCases.saveSettings({ calendar });

    const calRows = (app.db as any).sqlite.prepare('SELECT * FROM work_calendars').all();
    expect(calRows.length).toBe(1);

    // 4. Auto-closure config write and read
    const autoClosureConfig: AutoClosureConfig = {
      enabled: true,
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      createdBy: 'admin',
      lastModifiedBy: 'admin',
      rules: [
        {
          ruleId: 'integ-rule-1',
          type: 'inclusion',
          filterType: 'teams',
          filters: [{ id: 'team-default', name: 'Default Team' }],
          description: 'Integ rule',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          createdBy: 'admin',
        },
      ],
    };
    await app.autoClosureConfig.save(autoClosureConfig);

    const settingRows = (app.db as any).sqlite.prepare("SELECT * FROM app_settings WHERE key = 'auto_closure_config'").all();
    expect(settingRows.length).toBe(1);

    const loadedAutoClosure = await app.autoClosureConfig.load();
    expect(loadedAutoClosure.enabled).toBe(true);
    expect(loadedAutoClosure.rules.length).toBe(1);
  });

  it('Scenario 2: Sudden DB Disconnect mid-session falls back cleanly to JSON files', async () => {
    app = await buildApp(configPath, {
      sqlitePath: dbPath,
      autoStartScheduler: false,
    });

    // Record an initial entry
    const entry: JournalEntry = {
      runId: 'integ-disconnect-1',
      timestamp: new Date().toISOString(),
      personKey: 'member-1',
      personName: 'Integration Member',
      assignedTo: 'member1@workops.test',
      targetIsoDate: '2026-11-24',
      title: 'Pre-disconnect Task',
      sourceTaskId: 42,
      createdWorkItemId: 9002,
      fieldCopyStatus: 'SUCCESS',
      relationCopyStatus: 'SUCCESS',
      verified: true,
    };
    await app.journal.record(entry);

    // Close the SQLite database to simulate sudden outage
    app.db!.close();
    expect(await checkDatabaseHealth(app.db)).toBe(false);

    // Reading journal entries should not throw, should return from JSON file
    const entries = await app.journal.getEntries();
    expect(entries.some(e => e.createdWorkItemId === 9002)).toBe(true);

    // Writing journal entries should not throw
    const postDisconnectEntry: JournalEntry = {
      ...entry,
      runId: 'integ-disconnect-2',
      createdWorkItemId: 9003,
      title: 'Post-disconnect Task',
    };
    await expect(app.journal.record(postDisconnectEntry)).resolves.not.toThrow();

    // Reading config should not throw, returns from people.json
    const config = await app.configUseCases.getConfig();
    expect(config.organization).toBe('IntegrationOrg');

    // Writing config should not throw, updates people.json
    await expect(
      app.configUseCases.saveSettings({ organization: 'UpdatedWhileDisconnected' })
    ).resolves.not.toThrow();

    const fileRaw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    expect(fileRaw.organization).toBe('UpdatedWhileDisconnected');

    // Auto-closure config load should not throw
    await expect(app.autoClosureConfig.load()).resolves.not.toThrow();

    // Auto-closure audit operations should not throw
    await expect(app.autoClosureAudit.getEntries()).resolves.not.toThrow();
  });

  it('Scenario 3: Cold Start with DB_DISABLED=true operates 100% on legacy JSON files', async () => {
    process.env.DB_DISABLED = 'true';

    app = await buildApp(configPath, {
      sqlitePath: dbPath,
      autoStartScheduler: false,
    });

    expect(app.db).toBeUndefined();

    // All operations succeed on JSON files
    const config = await app.configUseCases.getConfig();
    expect(config.organization).toBe('IntegrationOrg');
    expect(config.people.length).toBe(1);

    const journalEntry: JournalEntry = {
      runId: 'disabled-run-1',
      timestamp: new Date().toISOString(),
      personKey: 'member-1',
      personName: 'Integration Member',
      assignedTo: 'member1@workops.test',
      targetIsoDate: '2026-11-24',
      title: 'Disabled DB Task',
      sourceTaskId: 42,
      createdWorkItemId: 9004,
      fieldCopyStatus: 'SUCCESS',
      relationCopyStatus: 'SUCCESS',
      verified: true,
    };
    await app.journal.record(journalEntry);

    const entries = await app.journal.getEntries();
    expect(entries.some(e => e.createdWorkItemId === 9004)).toBe(true);

    // Database file was never created
    expect(fs.existsSync(dbPath)).toBe(false);
  });

  it('Scenario 4: First-Time Seeding from existing JSON files into empty DB', async () => {
    // Populate people.json with members before booting DB
    const richConfig = {
      organization: 'SeedingOrg',
      project: 'SeedingProject',
      people: [
        {
          key: 'seeded-1',
          name: 'Seeded Alice',
          assignedTo: 'alice@workops.test',
          role: 'Architect',
          enabled: true,
        },
        {
          key: 'seeded-2',
          name: 'Seeded Bob',
          assignedTo: 'bob@workops.test',
          role: 'Engineer',
          enabled: true,
        },
      ],
    };
    fs.writeFileSync(configPath, JSON.stringify(richConfig, null, 2), 'utf-8');

    // Boot app with fresh empty DB
    app = await buildApp(configPath, {
      sqlitePath: dbPath,
      autoStartScheduler: false,
    });

    expect(app.db).toBeDefined();

    // Verify DB was automatically seeded with Alice and Bob
    const rows = (app.db as any).sqlite.prepare('SELECT * FROM canonical_identities ORDER BY canonical_email').all();
    expect(rows.length).toBe(2);
    expect(rows[0].canonical_email).toBe('alice@workops.test');
    expect(rows[1].canonical_email).toBe('bob@workops.test');
  });

  it('Scenario 5: Journal CSV and JSON exports succeed even when database is disconnected', async () => {
    app = await buildApp(configPath, {
      sqlitePath: dbPath,
      autoStartScheduler: false,
    });

    const entry: JournalEntry = {
      runId: 'export-test-1',
      timestamp: new Date().toISOString(),
      personKey: 'member-1',
      personName: 'Integration Member',
      assignedTo: 'member1@workops.test',
      targetIsoDate: '2026-11-24',
      title: 'Export Test Task',
      sourceTaskId: 42,
      createdWorkItemId: 9005,
      fieldCopyStatus: 'SUCCESS',
      relationCopyStatus: 'SUCCESS',
      verified: true,
    };
    await app.journal.record(entry);

    // Disconnect DB
    app.db!.close();

    // Export CSV should fall back to JSON file and return valid CSV string
    const csv = await app.journal.exportCsv();
    expect(csv).toContain('Export Test Task');
    expect(csv).toContain('9005');

    // Export JSON should fall back to JSON file and return valid JSON string
    const json = await app.journal.exportJson();
    expect(json).toContain('Export Test Task');
    const parsed = JSON.parse(json);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.some((e: any) => e.createdWorkItemId === 9005)).toBe(true);
  });
});
