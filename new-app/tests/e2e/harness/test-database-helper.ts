import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

export interface TestDatabaseHelperOptions {
  enableSqlite?: boolean;
}

export class TestDatabaseHelper {
  public readonly tempDir: string;
  private sqliteDb: DatabaseSync | null = null;
  private sqlitePath: string;

  constructor(options: TestDatabaseHelperOptions = {}) {
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
    db.exec(`
      CREATE TABLE IF NOT EXISTS organizations (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS departments (
        id TEXT PRIMARY KEY,
        org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS teams (
        id TEXT PRIMARY KEY,
        dept_id TEXT NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS members (
        id TEXT PRIMARY KEY,
        team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
        email TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'Developer',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS work_calendars (
        id TEXT PRIMARY KEY,
        team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
        timezone TEXT NOT NULL DEFAULT 'UTC',
        cycle_anchor_day INTEGER NOT NULL DEFAULT 4,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS calendar_exceptions (
        id TEXT PRIMARY KEY,
        calendar_id TEXT NOT NULL REFERENCES work_calendars(id) ON DELETE CASCADE,
        date TEXT NOT NULL,
        is_working_day INTEGER NOT NULL DEFAULT 0,
        description TEXT
      );

      CREATE TABLE IF NOT EXISTS plan_tokens (
        token_hash TEXT PRIMARY KEY,
        plan_token TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        is_executed INTEGER NOT NULL DEFAULT 0,
        snapshot_json TEXT NOT NULL,
        operator_email TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS journal_entries (
        id TEXT PRIMARY KEY,
        team_id TEXT,
        action_type TEXT NOT NULL,
        operator_email TEXT NOT NULL,
        work_item_id INTEGER,
        details_json TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS auto_closure_rules (
        id TEXT PRIMARY KEY,
        team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
        cutoff_time TEXT NOT NULL DEFAULT '18:00',
        min_hours REAL NOT NULL DEFAULT 8.0,
        require_pr_evidence INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS distributed_locks (
        lock_key TEXT PRIMARY KEY,
        owner_token TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      );
    `);
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
        DELETE FROM distributed_locks;
        DELETE FROM journal_entries;
        DELETE FROM plan_tokens;
        DELETE FROM calendar_exceptions;
        DELETE FROM work_calendars;
        DELETE FROM auto_closure_rules;
        DELETE FROM members;
        DELETE FROM teams;
        DELETE FROM departments;
        DELETE FROM organizations;
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
