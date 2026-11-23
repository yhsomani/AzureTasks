import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { SQLITE_DDL } from '../../../src/infrastructure/persistence/database.js';

export interface TestDatabaseHelperOptions {
  enableSqlite?: boolean;
}

export class TestDatabaseHelper {
  public readonly tempDir: string;
  private sqliteDb: DatabaseSync | null = null;
  private sqlitePath: string;

  constructor(_options: TestDatabaseHelperOptions = {}) {
    this.tempDir = path.join(os.tmpdir(), `workops-e2e-${crypto.randomUUID()}`);
    this.sqlitePath = path.join(this.tempDir, 'workops-e2e.sqlite');
  }

  public async init(): Promise<void> {
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
  }

  public getSqlitePath(): string {
    return this.sqlitePath;
  }

  public getSqliteDb(): DatabaseSync {
    if (!this.sqliteDb) {
      this.sqliteDb = new DatabaseSync(this.sqlitePath);
      this.sqliteDb.exec('PRAGMA journal_mode = WAL;');
      this.sqliteDb.exec('PRAGMA foreign_keys = ON;');
      this.initSqliteSchema();
    }
    return this.sqliteDb;
  }

  public initSqliteSchema(): void {
    const db = this.getSqliteDb();
    db.exec(SQLITE_DDL);
  }

  public writeConfigFile(config: Record<string, any>): string {
    const filePath = path.join(this.tempDir, 'people.json');
    fs.writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf8');
    return filePath;
  }

  public getJournalEntries(): any[] {
    const journalPath = path.join(this.tempDir, '.task-journal.json');
    if (!fs.existsSync(journalPath)) return [];
    try {
      return JSON.parse(fs.readFileSync(journalPath, 'utf8'));
    } catch {
      return [];
    }
  }

  public writeJournalEntries(entries: any[]): void {
    const journalPath = path.join(this.tempDir, '.task-journal.json');
    fs.writeFileSync(journalPath, JSON.stringify(entries, null, 2), 'utf8');
  }

  public async resetDatabase(): Promise<void> {
    if (this.sqliteDb) {
      this.sqliteDb.exec(`
        PRAGMA foreign_keys = OFF;
        DELETE FROM distributed_locks;
        DELETE FROM sync_metadata;
        DELETE FROM auto_closure_audit_logs;
        DELETE FROM auto_closure_rules;
        DELETE FROM journal_entries;
        DELETE FROM plan_tokens;
        DELETE FROM work_item_revisions;
        DELETE FROM work_items;
        DELETE FROM calendar_exceptions;
        DELETE FROM work_calendars;
        DELETE FROM team_members;
        DELETE FROM identity_aliases;
        DELETE FROM members;
        DELETE FROM teams;
        DELETE FROM canonical_identities;
        DELETE FROM azure_projects;
        DELETE FROM departments;
        DELETE FROM organizations;
        DELETE FROM app_settings;
        PRAGMA foreign_keys = ON;
      `);
    }

    const journalPath = path.join(this.tempDir, '.task-journal.json');
    if (fs.existsSync(journalPath)) fs.unlinkSync(journalPath);

    const lockPath = path.join(this.tempDir, '.execution-lock.json');
    if (fs.existsSync(lockPath)) fs.unlinkSync(lockPath);
  }

  public async cleanup(): Promise<void> {
    if (this.sqliteDb) {
      try {
        this.sqliteDb.close();
      } catch {
        // ignore close error
      }
      this.sqliteDb = null;
    }
    if (fs.existsSync(this.tempDir)) {
      try {
        fs.rmSync(this.tempDir, { recursive: true, force: true });
      } catch {
        // ignore cleanup error
      }
    }
  }
}
