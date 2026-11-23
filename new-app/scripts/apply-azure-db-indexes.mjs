#!/usr/bin/env node

/**
 * Applies composite indexes to azure-data.db for optimal query performance.
 * 
 * Target indexes:
 * - idx_builds_def_health ON builds(project_id, definition_id, result, finish_time)
 * - idx_pipeline_runs_pipe_created ON pipeline_runs(pipeline_id, created_at DESC)
 * - idx_pipeline_runs_proj_created ON pipeline_runs(project_id, created_at DESC)
 * - idx_azure_teams_proj_name ON azure_teams(project_id, name)
 */

import path from 'node:path';
import fs from 'node:fs';
import Database from 'better-sqlite3';

const dbPath = process.argv[2] || process.env.AZURE_DATA_DB || path.resolve(process.cwd(), 'azure-data.db');

if (!fs.existsSync(dbPath)) {
  console.error(`Database file does not exist at: ${dbPath}`);
  process.exit(1);
}

console.log(`Connecting to SQLite database at: ${dbPath}`);
const db = new Database(dbPath);

try {
  // Ensure WAL mode
  const journalMode = db.pragma('journal_mode = WAL');
  console.log(`Journal mode: ${JSON.stringify(journalMode)}`);

  const indexes = [
    {
      name: 'idx_builds_def_health',
      sql: 'CREATE INDEX IF NOT EXISTS idx_builds_def_health ON builds(project_id, definition_id, result, finish_time)',
      table: 'builds',
    },
    {
      name: 'idx_pipeline_runs_pipe_created',
      sql: 'CREATE INDEX IF NOT EXISTS idx_pipeline_runs_pipe_created ON pipeline_runs(pipeline_id, created_at DESC)',
      table: 'pipeline_runs',
    },
    {
      name: 'idx_pipeline_runs_proj_created',
      sql: 'CREATE INDEX IF NOT EXISTS idx_pipeline_runs_proj_created ON pipeline_runs(project_id, created_at DESC)',
      table: 'pipeline_runs',
    },
    {
      name: 'idx_azure_teams_proj_name',
      sql: 'CREATE INDEX IF NOT EXISTS idx_azure_teams_proj_name ON azure_teams(project_id, name)',
      table: 'azure_teams',
    },
  ];

  for (const idx of indexes) {
    const startTime = performance.now();
    process.stdout.write(`Creating index ${idx.name} on ${idx.table}... `);
    db.prepare(idx.sql).run();
    const elapsed = (performance.now() - startTime).toFixed(2);
    console.log(`DONE (${elapsed} ms)`);
  }

  console.log('Updating SQLite query planner statistics (ANALYZE)...');
  db.prepare('ANALYZE builds').run();
  db.prepare('ANALYZE pipeline_runs').run();
  db.prepare('ANALYZE azure_teams').run();
  console.log('Query planner statistics updated.');

  // Verify query plan for build health
  const queryPlan = db.prepare(`
    EXPLAIN QUERY PLAN
    SELECT project_id, definition_id, COUNT(*) 
    FROM builds 
    GROUP BY project_id, definition_id
  `).all();
  console.log('Build health query plan:', JSON.stringify(queryPlan, null, 2));

  // Benchmark query
  const testStart = performance.now();
  const sample = db.prepare('SELECT * FROM v_build_health ORDER BY runs DESC LIMIT 20').all();
  const testElapsed = (performance.now() - testStart).toFixed(2);
  console.log(`Benchmark: v_build_health top 20 retrieved in ${testElapsed} ms (${sample.length} rows returned)`);

  console.log('Index optimization completed successfully.');
} catch (err) {
  console.error('Error applying indexes:', err);
  process.exit(1);
} finally {
  db.close();
}
