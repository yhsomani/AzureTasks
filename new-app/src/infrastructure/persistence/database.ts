import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { Database as BetterSqliteDatabase } from 'better-sqlite3';
import { drizzle as drizzleSqlite } from 'drizzle-orm/better-sqlite3';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import pg from 'pg';
import { drizzle as drizzlePg } from 'drizzle-orm/node-postgres';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { sqliteSchema } from './schema/sqlite-schema.js';
import { postgresSchema } from './schema/postgres-schema.js';

export type DatabaseEngine = 'sqlite' | 'postgres';

export interface DatabaseConfig {
  engine?: DatabaseEngine;
  url?: string;
  sqlitePath?: string;
}

export type WorkOpsDb =
  | {
      engine: 'sqlite';
      drizzle: BetterSQLite3Database<typeof sqliteSchema>;
      sqlite: BetterSqliteDatabase;
      close: () => void;
    }
  | {
      engine: 'postgres';
      drizzle: NodePgDatabase<typeof postgresSchema>;
      pool: pg.Pool;
      close: () => Promise<void>;
    };

export const SQLITE_DDL = `
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
`;

export const POSTGRES_DDL = `
  CREATE TABLE IF NOT EXISTS organizations (
    id VARCHAR(255) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(255) NOT NULL UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS departments (
    id VARCHAR(255) PRIMARY KEY,
    org_id VARCHAR(255) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS teams (
    id VARCHAR(255) PRIMARY KEY,
    dept_id VARCHAR(255) NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS members (
    id VARCHAR(255) PRIMARY KEY,
    team_id VARCHAR(255) NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL UNIQUE,
    display_name VARCHAR(255) NOT NULL,
    role VARCHAR(100) NOT NULL DEFAULT 'Developer',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS work_calendars (
    id VARCHAR(255) PRIMARY KEY,
    team_id VARCHAR(255) NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    timezone VARCHAR(100) NOT NULL DEFAULT 'UTC',
    cycle_anchor_day INTEGER NOT NULL DEFAULT 4,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS calendar_exceptions (
    id VARCHAR(255) PRIMARY KEY,
    calendar_id VARCHAR(255) NOT NULL REFERENCES work_calendars(id) ON DELETE CASCADE,
    date VARCHAR(20) NOT NULL,
    is_working_day INTEGER NOT NULL DEFAULT 0,
    description TEXT
  );

  CREATE TABLE IF NOT EXISTS plan_tokens (
    token_hash VARCHAR(255) PRIMARY KEY,
    plan_token TEXT NOT NULL,
    expires_at BIGINT NOT NULL,
    is_executed INTEGER NOT NULL DEFAULT 0,
    snapshot_json TEXT NOT NULL,
    operator_email VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS journal_entries (
    id VARCHAR(255) PRIMARY KEY,
    team_id VARCHAR(255),
    action_type VARCHAR(100) NOT NULL,
    operator_email VARCHAR(255) NOT NULL,
    work_item_id INTEGER,
    details_json TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS auto_closure_rules (
    id VARCHAR(255) PRIMARY KEY,
    team_id VARCHAR(255) NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    cutoff_time VARCHAR(20) NOT NULL DEFAULT '18:00',
    min_hours REAL NOT NULL DEFAULT 8.0,
    require_pr_evidence INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS distributed_locks (
    lock_key VARCHAR(255) PRIMARY KEY,
    owner_token VARCHAR(255) NOT NULL,
    expires_at BIGINT NOT NULL
  );
`;

export function initSqliteSchema(sqlite: BetterSqliteDatabase): void {
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  sqlite.exec(SQLITE_DDL);
}

export async function initPostgresSchema(pool: pg.Pool): Promise<void> {
  await pool.query(POSTGRES_DDL);
}

export function createDatabase(config: DatabaseConfig = {}): WorkOpsDb {
  const envEngine = process.env.DATABASE_ENGINE as DatabaseEngine | undefined;
  const dbUrl = config.url || process.env.DATABASE_URL;

  const engine: DatabaseEngine =
    config.engine ||
    envEngine ||
    (dbUrl?.startsWith('postgres') ? 'postgres' : 'sqlite');

  if (engine === 'postgres') {
    const pool = new pg.Pool({
      connectionString: dbUrl || 'postgresql://postgres:postgres@localhost:5432/workops',
      max: 20,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 5000,
    });

    const drizzle = drizzlePg(pool, { schema: postgresSchema });

    return {
      engine: 'postgres',
      drizzle,
      pool,
      close: async () => {
        await pool.end();
      },
    };
  }

  // SQLite engine
  let sqlitePath = config.sqlitePath || process.env.SQLITE_PATH;
  if (!sqlitePath && dbUrl?.startsWith('sqlite:')) {
    sqlitePath = dbUrl.slice('sqlite:'.length);
  }
  if (!sqlitePath) {
    sqlitePath = path.resolve(process.cwd(), 'data', 'workops.db');
  }

  if (sqlitePath !== ':memory:') {
    const dir = path.dirname(sqlitePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }

  const sqlite = new Database(sqlitePath);
  initSqliteSchema(sqlite);
  const drizzle = drizzleSqlite(sqlite, { schema: sqliteSchema });

  return {
    engine: 'sqlite',
    drizzle,
    sqlite,
    close: () => {
      try {
        sqlite.close();
      } catch {
        // ignore
      }
    },
  };
}

export async function checkDatabaseHealth(db?: WorkOpsDb): Promise<boolean> {
  if (!db) return false;
  try {
    if (db.engine === 'sqlite') {
      const row = db.sqlite.prepare('SELECT 1 as alive;').get();
      return Boolean(row);
    }
    if (db.engine === 'postgres') {
      const res = await db.pool.query('SELECT 1 as alive;');
      return Boolean(res && res.rows && res.rows.length > 0);
    }
    return false;
  } catch {
    return false;
  }
}
