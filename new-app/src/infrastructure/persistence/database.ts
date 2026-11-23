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
  CREATE TABLE IF NOT EXISTS app_settings (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL,
    category TEXT NOT NULL DEFAULT 'general',
    description TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS organizations (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS departments (
    id TEXT PRIMARY KEY,
    org_id TEXT NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS azure_projects (
    project_id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    state TEXT,
    visibility TEXT,
    revision INTEGER,
    is_authoritative_for_tasks INTEGER NOT NULL DEFAULT 0,
    is_authoritative_for_cicd INTEGER NOT NULL DEFAULT 0,
    last_update_time TEXT,
    sync_run_id TEXT,
    synced_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS canonical_identities (
    id TEXT PRIMARY KEY,
    canonical_email TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    primary_username TEXT,
    avatar_url TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS teams (
    id TEXT PRIMARY KEY,
    dept_id TEXT NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
    project_id TEXT REFERENCES azure_projects(project_id) ON DELETE SET NULL,
    azure_team_id TEXT,
    name TEXT NOT NULL,
    description TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS members (
    id TEXT PRIMARY KEY,
    team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    email TEXT NOT NULL UNIQUE,
    display_name TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'Developer',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS identity_aliases (
    id TEXT PRIMARY KEY,
    canonical_id TEXT NOT NULL REFERENCES canonical_identities(id) ON DELETE CASCADE,
    identity_type TEXT NOT NULL,
    alias_value TEXT NOT NULL,
    is_verified INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(identity_type, alias_value)
  );

  CREATE TABLE IF NOT EXISTS team_members (
    id TEXT PRIMARY KEY,
    team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    canonical_id TEXT NOT NULL REFERENCES canonical_identities(id) ON DELETE CASCADE,
    role TEXT NOT NULL DEFAULT 'Developer',
    pod TEXT,
    title_prefix TEXT,
    auto_close_enabled INTEGER NOT NULL DEFAULT 1,
    enabled INTEGER NOT NULL DEFAULT 1,
    source_task_id INTEGER,
    github_repositories_json TEXT,
    github_branches_json TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(team_id, canonical_id)
  );

  CREATE TABLE IF NOT EXISTS work_calendars (
    id TEXT PRIMARY KEY,
    team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    timezone TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    cycle_anchor_day INTEGER NOT NULL DEFAULT 4,
    default_hours REAL NOT NULL DEFAULT 8.0,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS calendar_exceptions (
    id TEXT PRIMARY KEY,
    calendar_id TEXT NOT NULL REFERENCES work_calendars(id) ON DELETE CASCADE,
    date TEXT NOT NULL,
    is_working_day INTEGER NOT NULL DEFAULT 0,
    available_hours REAL NOT NULL DEFAULT 0.0,
    canonical_id TEXT REFERENCES canonical_identities(id) ON DELETE SET NULL,
    description TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS work_items (
    project_id TEXT NOT NULL REFERENCES azure_projects(project_id) ON DELETE CASCADE,
    work_item_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    state TEXT NOT NULL,
    assigned_identity_id TEXT REFERENCES canonical_identities(id) ON DELETE SET NULL,
    raw_assigned_to_json TEXT,
    area_path TEXT NOT NULL,
    iteration_path TEXT NOT NULL,
    created_date TEXT NOT NULL,
    changed_date TEXT NOT NULL,
    closed_date TEXT,
    parent_id INTEGER,
    tags TEXT,
    original_estimate REAL,
    remaining_work REAL,
    completed_work REAL,
    payload_json TEXT NOT NULL,
    sync_run_id TEXT,
    synced_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY(project_id, work_item_id)
  );

  CREATE TABLE IF NOT EXISTS work_item_revisions (
    project_id TEXT NOT NULL,
    work_item_id INTEGER NOT NULL,
    revision INTEGER NOT NULL,
    state TEXT,
    changed_by_identity_id TEXT REFERENCES canonical_identities(id) ON DELETE SET NULL,
    changed_at TEXT NOT NULL,
    fields_json TEXT NOT NULL,
    sync_run_id TEXT,
    synced_at TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY(project_id, work_item_id, revision),
    FOREIGN KEY(project_id, work_item_id) REFERENCES work_items(project_id, work_item_id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS plan_tokens (
    token_hash TEXT PRIMARY KEY,
    plan_token TEXT NOT NULL,
    operator_id TEXT REFERENCES canonical_identities(id) ON DELETE SET NULL,
    operator_email TEXT,
    expires_at INTEGER NOT NULL,
    is_executed INTEGER NOT NULL DEFAULT 0,
    executed_at TEXT,
    snapshot_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS journal_entries (
    id TEXT PRIMARY KEY,
    run_id TEXT,
    team_id TEXT REFERENCES teams(id) ON DELETE SET NULL,
    operator_id TEXT REFERENCES canonical_identities(id) ON DELETE SET NULL,
    operator_email TEXT,
    action_type TEXT NOT NULL,
    work_item_id INTEGER,
    project_id TEXT REFERENCES azure_projects(project_id) ON DELETE SET NULL,
    target_iso_date TEXT,
    title TEXT,
    field_copy_status TEXT,
    relation_copy_status TEXT,
    verified INTEGER NOT NULL DEFAULT 1,
    details_json TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS auto_closure_rules (
    id TEXT PRIMARY KEY,
    team_id TEXT NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    rule_name TEXT NOT NULL DEFAULT 'Default Rule',
    cutoff_time TEXT NOT NULL DEFAULT '18:00',
    min_hours REAL NOT NULL DEFAULT 8.0,
    require_pr_evidence INTEGER NOT NULL DEFAULT 1,
    require_git_commits INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS auto_closure_audit_logs (
    id TEXT PRIMARY KEY,
    rule_id TEXT REFERENCES auto_closure_rules(id) ON DELETE SET NULL,
    task_id INTEGER NOT NULL,
    project_id TEXT REFERENCES azure_projects(project_id) ON DELETE SET NULL,
    canonical_id TEXT REFERENCES canonical_identities(id) ON DELETE SET NULL,
    evaluation_status TEXT NOT NULL,
    pr_evidence_json TEXT,
    decision_reason TEXT NOT NULL,
    operator_override_id TEXT REFERENCES canonical_identities(id) ON DELETE SET NULL,
    evaluated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS distributed_locks (
    lock_key TEXT PRIMARY KEY,
    owner_token TEXT NOT NULL,
    pid INTEGER NOT NULL DEFAULT 0,
    hostname TEXT NOT NULL DEFAULT '',
    acquired_at TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sync_metadata (
    id TEXT PRIMARY KEY,
    project_id TEXT NOT NULL REFERENCES azure_projects(project_id) ON DELETE CASCADE,
    resource_type TEXT NOT NULL,
    last_sync_run_id TEXT NOT NULL,
    continuation_token TEXT,
    watermark_timestamp TEXT,
    record_count INTEGER NOT NULL DEFAULT 0,
    sync_status TEXT NOT NULL,
    error_details TEXT,
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(project_id, resource_type)
  );

  CREATE INDEX IF NOT EXISTS idx_work_items_assigned ON work_items(assigned_identity_id, state);
  CREATE INDEX IF NOT EXISTS idx_work_items_project_state ON work_items(project_id, state);
  CREATE INDEX IF NOT EXISTS idx_journal_created ON journal_entries(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_journal_work_item ON journal_entries(work_item_id);
  CREATE INDEX IF NOT EXISTS idx_identity_alias ON identity_aliases(identity_type, alias_value);
  CREATE INDEX IF NOT EXISTS idx_auto_closure_task ON auto_closure_audit_logs(task_id, evaluated_at DESC);
`;

export const POSTGRES_DDL = `
  CREATE TABLE IF NOT EXISTS app_settings (
    key VARCHAR(255) PRIMARY KEY,
    value_json TEXT NOT NULL,
    category VARCHAR(100) NOT NULL DEFAULT 'general',
    description TEXT,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS organizations (
    id VARCHAR(255) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    slug VARCHAR(255) NOT NULL UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS departments (
    id VARCHAR(255) PRIMARY KEY,
    org_id VARCHAR(255) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS azure_projects (
    project_id VARCHAR(255) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    state VARCHAR(100),
    visibility VARCHAR(100),
    revision INTEGER,
    is_authoritative_for_tasks INTEGER NOT NULL DEFAULT 0,
    is_authoritative_for_cicd INTEGER NOT NULL DEFAULT 0,
    last_update_time TEXT,
    sync_run_id VARCHAR(255),
    synced_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS canonical_identities (
    id VARCHAR(255) PRIMARY KEY,
    canonical_email VARCHAR(255) NOT NULL UNIQUE,
    display_name VARCHAR(255) NOT NULL,
    primary_username VARCHAR(255),
    avatar_url TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS teams (
    id VARCHAR(255) PRIMARY KEY,
    dept_id VARCHAR(255) NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
    project_id VARCHAR(255) REFERENCES azure_projects(project_id) ON DELETE SET NULL,
    azure_team_id VARCHAR(255),
    name VARCHAR(255) NOT NULL,
    description TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS members (
    id VARCHAR(255) PRIMARY KEY,
    team_id VARCHAR(255) NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    email VARCHAR(255) NOT NULL UNIQUE,
    display_name VARCHAR(255) NOT NULL,
    role VARCHAR(100) NOT NULL DEFAULT 'Developer',
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS identity_aliases (
    id VARCHAR(255) PRIMARY KEY,
    canonical_id VARCHAR(255) NOT NULL REFERENCES canonical_identities(id) ON DELETE CASCADE,
    identity_type VARCHAR(100) NOT NULL,
    alias_value VARCHAR(255) NOT NULL,
    is_verified INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(identity_type, alias_value)
  );

  CREATE TABLE IF NOT EXISTS team_members (
    id VARCHAR(255) PRIMARY KEY,
    team_id VARCHAR(255) NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    canonical_id VARCHAR(255) NOT NULL REFERENCES canonical_identities(id) ON DELETE CASCADE,
    role VARCHAR(100) NOT NULL DEFAULT 'Developer',
    pod VARCHAR(255),
    title_prefix VARCHAR(255),
    auto_close_enabled INTEGER NOT NULL DEFAULT 1,
    enabled INTEGER NOT NULL DEFAULT 1,
    source_task_id INTEGER,
    github_repositories_json TEXT,
    github_branches_json TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(team_id, canonical_id)
  );

  CREATE TABLE IF NOT EXISTS work_calendars (
    id VARCHAR(255) PRIMARY KEY,
    team_id VARCHAR(255) NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    timezone VARCHAR(100) NOT NULL DEFAULT 'Asia/Kolkata',
    cycle_anchor_day INTEGER NOT NULL DEFAULT 4,
    default_hours REAL NOT NULL DEFAULT 8.0,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS calendar_exceptions (
    id VARCHAR(255) PRIMARY KEY,
    calendar_id VARCHAR(255) NOT NULL REFERENCES work_calendars(id) ON DELETE CASCADE,
    date VARCHAR(20) NOT NULL,
    is_working_day INTEGER NOT NULL DEFAULT 0,
    available_hours REAL NOT NULL DEFAULT 0.0,
    canonical_id VARCHAR(255) REFERENCES canonical_identities(id) ON DELETE SET NULL,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS work_items (
    project_id VARCHAR(255) NOT NULL REFERENCES azure_projects(project_id) ON DELETE CASCADE,
    work_item_id INTEGER NOT NULL,
    type VARCHAR(100) NOT NULL,
    title TEXT NOT NULL,
    state VARCHAR(100) NOT NULL,
    assigned_identity_id VARCHAR(255) REFERENCES canonical_identities(id) ON DELETE SET NULL,
    raw_assigned_to_json TEXT,
    area_path TEXT NOT NULL,
    iteration_path TEXT NOT NULL,
    created_date TEXT NOT NULL,
    changed_date TEXT NOT NULL,
    closed_date TEXT,
    parent_id INTEGER,
    tags TEXT,
    original_estimate REAL,
    remaining_work REAL,
    completed_work REAL,
    payload_json TEXT NOT NULL,
    sync_run_id VARCHAR(255),
    synced_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(project_id, work_item_id)
  );

  CREATE TABLE IF NOT EXISTS work_item_revisions (
    project_id VARCHAR(255) NOT NULL,
    work_item_id INTEGER NOT NULL,
    revision INTEGER NOT NULL,
    state VARCHAR(100),
    changed_by_identity_id VARCHAR(255) REFERENCES canonical_identities(id) ON DELETE SET NULL,
    changed_at TEXT NOT NULL,
    fields_json TEXT NOT NULL,
    sync_run_id VARCHAR(255),
    synced_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(project_id, work_item_id, revision),
    FOREIGN KEY(project_id, work_item_id) REFERENCES work_items(project_id, work_item_id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS plan_tokens (
    token_hash VARCHAR(255) PRIMARY KEY,
    plan_token TEXT NOT NULL,
    operator_id VARCHAR(255) REFERENCES canonical_identities(id) ON DELETE SET NULL,
    operator_email VARCHAR(255),
    expires_at BIGINT NOT NULL,
    is_executed INTEGER NOT NULL DEFAULT 0,
    executed_at TEXT,
    snapshot_json TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS journal_entries (
    id VARCHAR(255) PRIMARY KEY,
    run_id VARCHAR(255),
    team_id VARCHAR(255) REFERENCES teams(id) ON DELETE SET NULL,
    operator_id VARCHAR(255) REFERENCES canonical_identities(id) ON DELETE SET NULL,
    operator_email VARCHAR(255),
    action_type VARCHAR(100) NOT NULL,
    work_item_id INTEGER,
    project_id VARCHAR(255) REFERENCES azure_projects(project_id) ON DELETE SET NULL,
    target_iso_date VARCHAR(20),
    title TEXT,
    field_copy_status VARCHAR(50),
    relation_copy_status VARCHAR(50),
    verified INTEGER NOT NULL DEFAULT 1,
    details_json TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS auto_closure_rules (
    id VARCHAR(255) PRIMARY KEY,
    team_id VARCHAR(255) NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    rule_name VARCHAR(255) NOT NULL DEFAULT 'Default Rule',
    cutoff_time VARCHAR(20) NOT NULL DEFAULT '18:00',
    min_hours REAL NOT NULL DEFAULT 8.0,
    require_pr_evidence INTEGER NOT NULL DEFAULT 1,
    require_git_commits INTEGER NOT NULL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS auto_closure_audit_logs (
    id VARCHAR(255) PRIMARY KEY,
    rule_id VARCHAR(255) REFERENCES auto_closure_rules(id) ON DELETE SET NULL,
    task_id INTEGER NOT NULL,
    project_id VARCHAR(255) REFERENCES azure_projects(project_id) ON DELETE SET NULL,
    canonical_id VARCHAR(255) REFERENCES canonical_identities(id) ON DELETE SET NULL,
    evaluation_status VARCHAR(50) NOT NULL,
    pr_evidence_json TEXT,
    decision_reason TEXT NOT NULL,
    operator_override_id VARCHAR(255) REFERENCES canonical_identities(id) ON DELETE SET NULL,
    evaluated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS distributed_locks (
    lock_key VARCHAR(255) PRIMARY KEY,
    owner_token VARCHAR(255) NOT NULL,
    pid INTEGER NOT NULL DEFAULT 0,
    hostname VARCHAR(255) NOT NULL DEFAULT '',
    acquired_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at BIGINT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sync_metadata (
    id VARCHAR(255) PRIMARY KEY,
    project_id VARCHAR(255) NOT NULL REFERENCES azure_projects(project_id) ON DELETE CASCADE,
    resource_type VARCHAR(100) NOT NULL,
    last_sync_run_id VARCHAR(255) NOT NULL,
    continuation_token TEXT,
    watermark_timestamp TEXT,
    record_count INTEGER NOT NULL DEFAULT 0,
    sync_status VARCHAR(50) NOT NULL,
    error_details TEXT,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(project_id, resource_type)
  );

  CREATE INDEX IF NOT EXISTS idx_pg_work_items_assigned ON work_items(assigned_identity_id, state);
  CREATE INDEX IF NOT EXISTS idx_pg_work_items_project_state ON work_items(project_id, state);
  CREATE INDEX IF NOT EXISTS idx_pg_journal_created ON journal_entries(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_pg_journal_work_item ON journal_entries(work_item_id);
  CREATE INDEX IF NOT EXISTS idx_pg_identity_alias ON identity_aliases(identity_type, alias_value);
  CREATE INDEX IF NOT EXISTS idx_pg_auto_closure_task ON auto_closure_audit_logs(task_id, evaluated_at DESC);
`;

function ensureColumnExists(
  sqlite: BetterSqliteDatabase,
  tableName: string,
  columnName: string,
  columnDef: string
): void {
  try {
    const tableExists = sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
      .get(tableName);
    if (!tableExists) return;

    const cols = sqlite.prepare(`PRAGMA table_info('${tableName}');`).all() as Array<{ name: string }>;
    const exists = cols.some((c) => c.name.toLowerCase() === columnName.toLowerCase());
    if (!exists) {
      sqlite.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${columnDef};`);
    }
  } catch {
    // ignore
  }
}

export function initSqliteSchema(sqlite: BetterSqliteDatabase): void {
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = ON');
  sqlite.pragma('busy_timeout = 5000');
  sqlite.exec(SQLITE_DDL);

  // Schema evolution for existing databases: ensure new columns exist if table was created previously
  ensureColumnExists(sqlite, 'journal_entries', 'run_id', 'TEXT');
  ensureColumnExists(sqlite, 'journal_entries', 'operator_id', 'TEXT');
  ensureColumnExists(sqlite, 'journal_entries', 'project_id', 'TEXT');
  ensureColumnExists(sqlite, 'journal_entries', 'target_iso_date', 'TEXT');
  ensureColumnExists(sqlite, 'journal_entries', 'title', 'TEXT');
  ensureColumnExists(sqlite, 'journal_entries', 'field_copy_status', 'TEXT');
  ensureColumnExists(sqlite, 'journal_entries', 'relation_copy_status', 'TEXT');
  ensureColumnExists(sqlite, 'journal_entries', 'verified', 'INTEGER NOT NULL DEFAULT 1');

  ensureColumnExists(sqlite, 'teams', 'project_id', 'TEXT');
  ensureColumnExists(sqlite, 'teams', 'azure_team_id', 'TEXT');
  ensureColumnExists(sqlite, 'teams', 'description', 'TEXT');
  ensureColumnExists(sqlite, 'teams', 'is_active', 'INTEGER NOT NULL DEFAULT 1');
  ensureColumnExists(sqlite, 'teams', 'updated_at', "TEXT NOT NULL DEFAULT (datetime('now'))");

  ensureColumnExists(sqlite, 'organizations', 'updated_at', "TEXT NOT NULL DEFAULT (datetime('now'))");
  ensureColumnExists(sqlite, 'work_calendars', 'default_hours', 'REAL NOT NULL DEFAULT 8.0');

  ensureColumnExists(sqlite, 'calendar_exceptions', 'available_hours', 'REAL NOT NULL DEFAULT 0.0');
  ensureColumnExists(sqlite, 'calendar_exceptions', 'canonical_id', 'TEXT');
  ensureColumnExists(sqlite, 'calendar_exceptions', 'created_at', "TEXT NOT NULL DEFAULT (datetime('now'))");

  ensureColumnExists(sqlite, 'plan_tokens', 'operator_id', 'TEXT');
  ensureColumnExists(sqlite, 'plan_tokens', 'operator_email', 'TEXT');
  ensureColumnExists(sqlite, 'plan_tokens', 'executed_at', 'TEXT');

  ensureColumnExists(sqlite, 'auto_closure_rules', 'rule_name', "TEXT NOT NULL DEFAULT 'Default Rule'");
  ensureColumnExists(sqlite, 'auto_closure_rules', 'require_git_commits', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumnExists(sqlite, 'auto_closure_rules', 'is_active', 'INTEGER NOT NULL DEFAULT 1');
  ensureColumnExists(sqlite, 'auto_closure_rules', 'updated_at', "TEXT NOT NULL DEFAULT (datetime('now'))");

  ensureColumnExists(sqlite, 'distributed_locks', 'pid', 'INTEGER NOT NULL DEFAULT 0');
  ensureColumnExists(sqlite, 'distributed_locks', 'hostname', "TEXT NOT NULL DEFAULT ''");
  ensureColumnExists(sqlite, 'distributed_locks', 'acquired_at', "TEXT NOT NULL DEFAULT (datetime('now'))");

  // Re-verify indexes
  try {
    sqlite.exec(`
      CREATE INDEX IF NOT EXISTS idx_work_items_assigned ON work_items(assigned_identity_id, state);
      CREATE INDEX IF NOT EXISTS idx_work_items_project_state ON work_items(project_id, state);
      CREATE INDEX IF NOT EXISTS idx_journal_created ON journal_entries(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_journal_work_item ON journal_entries(work_item_id);
      CREATE INDEX IF NOT EXISTS idx_identity_alias ON identity_aliases(identity_type, alias_value);
      CREATE INDEX IF NOT EXISTS idx_auto_closure_task ON auto_closure_audit_logs(task_id, evaluated_at DESC);
    `);
  } catch {
    // ignore
  }
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
