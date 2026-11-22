import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { NORMALIZED_SCHEMA } from './schema.mjs';
import { normalizeDatabase } from './normalize.mjs';

const cleanup = file => {
  for (const suffix of ['', '-journal', '-wal', '-shm']) fs.rmSync(`${file}${suffix}`, { force: true });
};

export class SqliteExportWriter {
  constructor(outputPath, { runId = randomUUID(), mode, projects, organization }) {
    this.outputPath = path.resolve(outputPath);
    this.runId = runId;
    this.mode = mode;
    this.projects = projects;
    this.organization = organization;
    this.stagingPath = path.join(path.dirname(this.outputPath), `.azure-export-${runId}.building.db`);
    cleanup(this.stagingPath);
    fs.mkdirSync(path.dirname(this.outputPath), { recursive: true });
    this.database = new DatabaseSync(this.stagingPath);
    this.initialize();
  }

  initialize() {
    this.database.exec(`
      PRAGMA foreign_keys=ON;
      PRAGMA journal_mode=WAL;
      PRAGMA synchronous=NORMAL;
      CREATE TABLE exports (
        run_id TEXT PRIMARY KEY, organization TEXT NOT NULL, mode TEXT NOT NULL,
        requested_projects TEXT NOT NULL, status TEXT NOT NULL, started_at TEXT NOT NULL,
        completed_at TEXT, dataset_count INTEGER NOT NULL DEFAULT 0, error_count INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE export_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE sync_steps (
        id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, scope TEXT NOT NULL,
        status TEXT NOT NULL, record_count INTEGER NOT NULL DEFAULT 0, duration_ms INTEGER NOT NULL DEFAULT 0,
        message TEXT, UNIQUE(run_id, scope)
      );
      CREATE TABLE sync_cursors (
        run_id TEXT NOT NULL, project_name TEXT NOT NULL, resource_type TEXT NOT NULL,
        cursor TEXT, updated_at TEXT NOT NULL, PRIMARY KEY(run_id, project_name, resource_type)
      );
      CREATE TABLE datasets (
        scope TEXT PRIMARY KEY, project_name TEXT NOT NULL, record_count INTEGER NOT NULL DEFAULT 0,
        payload TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE export_errors (
        id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL, scope TEXT NOT NULL,
        status INTEGER, category TEXT NOT NULL, message TEXT, cause TEXT, response TEXT, url TEXT
      );
      CREATE INDEX datasets_project_idx ON datasets(project_name);
      CREATE INDEX errors_scope_idx ON export_errors(scope);
      CREATE INDEX errors_run_idx ON export_errors(run_id);
      CREATE VIEW v_export_status AS SELECT * FROM exports ORDER BY started_at DESC;
      CREATE VIEW v_data_freshness AS
        SELECT project_name, COUNT(*) AS datasets, MAX(updated_at) AS last_updated
        FROM datasets GROUP BY project_name;
      CREATE VIEW v_export_errors AS
        SELECT category, status, COUNT(*) AS error_count, COUNT(DISTINCT scope) AS affected_scopes
        FROM export_errors GROUP BY category, status;
      CREATE VIEW v_project_datasets AS
        SELECT project_name, record_count, scope, updated_at
        FROM datasets WHERE project_name <> 'organization';
    `);
    this.database.exec(NORMALIZED_SCHEMA);
    this.database.prepare('INSERT INTO exports(run_id,organization,mode,requested_projects,status,started_at) VALUES (?,?,?,?,?,?)')
      .run(this.runId, this.organization, this.mode, JSON.stringify(this.projects), 'running', new Date().toISOString());
    this.setMeta('formatVersion', '3');
    this.setMeta('organization', this.organization);
    this.setMeta('mode', this.mode);
    this.setMeta('requestedProjects', JSON.stringify(this.projects));
    this.setMeta('output', this.outputPath);
  }

  setMeta(key, value) {
    this.database.prepare('INSERT OR REPLACE INTO export_meta(key,value) VALUES (?,?)').run(key, String(value));
  }

  saveDataset(scope, projectName, payload) {
    const count = Array.isArray(payload?.value) ? payload.value.length : Array.isArray(payload) ? payload.length : 0;
    this.database.prepare('INSERT OR REPLACE INTO datasets(scope,project_name,record_count,payload,updated_at) VALUES (?,?,?,?,?)')
      .run(scope, projectName, count, JSON.stringify(payload), new Date().toISOString());
  }

  saveStep(scope, status, recordCount, durationMs, message = '') {
    this.database.prepare(`INSERT INTO sync_steps(run_id,scope,status,record_count,duration_ms,message) VALUES (?,?,?,?,?,?) ON CONFLICT(run_id,scope) DO UPDATE SET status=excluded.status,record_count=excluded.record_count,duration_ms=excluded.duration_ms,message=excluded.message`)
      .run(this.runId, scope, status, recordCount, durationMs, message);
  }

  saveCursor(projectName, resourceType, cursor) {
    this.database.prepare('INSERT OR REPLACE INTO sync_cursors(run_id,project_name,resource_type,cursor,updated_at) VALUES (?,?,?,?,?)')
      .run(this.runId, projectName, resourceType, cursor || '', new Date().toISOString());
  }

  importCursors(rows = []) {
    const statement = this.database.prepare('INSERT OR REPLACE INTO sync_cursors(run_id,project_name,resource_type,cursor,updated_at) VALUES (?,?,?,?,?)');
    for (const row of rows) {
      statement.run(this.runId, row.project_name, row.resource_type, row.cursor || '', row.updated_at || new Date().toISOString());
    }
  }

  saveError({ scope, status, category, message = '', cause = '', response = '', url = '' }) {
    this.database.prepare('INSERT INTO export_errors(run_id,scope,status,category,message,cause,response,url) VALUES (?,?,?,?,?,?,?,?)')
      .run(this.runId, scope, status ?? null, category, message, cause, response, url);
  }

  publish(status = 'complete') {
    const completedAt = new Date().toISOString();
    const datasetCount = this.database.prepare('SELECT COUNT(*) AS count FROM datasets').get().count;
    const errorCount = this.database.prepare('SELECT COUNT(*) AS count FROM export_errors WHERE run_id=?').get(this.runId).count;
    this.database.prepare('UPDATE exports SET status=?,completed_at=?,dataset_count=?,error_count=? WHERE run_id=?')
      .run(status, completedAt, datasetCount, errorCount, this.runId);
    this.setMeta('completedAt', completedAt);
    this.setMeta('datasetCount', datasetCount);
    this.setMeta('errorCount', errorCount);
    const integrity = this.database.prepare('PRAGMA integrity_check').get();
    if (integrity.integrity_check !== 'ok') throw new Error(`SQLite integrity check failed: ${integrity.integrity_check}`);
    this.database.exec('PRAGMA wal_checkpoint(TRUNCATE);');
    this.setMeta('normalizationPending', 'true');
    this.database.close();
    this.database = undefined;
    normalizeDatabase(this.stagingPath);
    for (const suffix of ['-journal', '-wal', '-shm']) fs.rmSync(`${this.stagingPath}${suffix}`, { force: true });
    fs.renameSync(this.stagingPath, this.outputPath);
    fs.chmodSync(this.outputPath, 0o600);
    cleanup(this.stagingPath);
    return { runId: this.runId, datasetCount, errorCount, outputPath: this.outputPath };
  }

  abort() {
    try { this.database?.close(); } catch {}
    this.database = undefined;
    cleanup(this.stagingPath);
  }
}
