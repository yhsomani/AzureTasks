#!/usr/bin/env node

/**
 * Standalone Database Verification Script for Azure DevOps Data (azure-data.db).
 * 
 * Verifies SQLite database integrity, physical/virtual table record counts,
 * composite index presence in sqlite_master, and query execution performance benchmarks.
 *
 * Exit code 0 on complete success, exit code 1 if any check fails.
 */

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import Database from 'better-sqlite3';

/**
 * Executes full verification suite against the specified Azure SQLite database.
 * @param {string} [customPath]
 * @returns {object}
 */
export function verifyAzureDatabase(customPath) {
  const overallStart = performance.now();
  const dbPath = customPath || process.argv[2] || process.env.AZURE_DATA_DB || path.resolve(process.cwd(), 'azure-data.db');
  const results = [];

  if (!fs.existsSync(dbPath)) {
    throw new Error(`Database file not found at: ${dbPath}`);
  }

  // Open database in strict read-only mode with fileMustExist flag
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });

  try {
    // Configure runtime pragmas for high-throughput reads
    db.pragma('journal_mode = WAL');
    db.pragma('cache_size = -64000');

    // Setup session-level compatibility views mapping domain models to underlying tables
    db.exec(`
      CREATE TEMP VIEW IF NOT EXISTS azure_builds AS
      SELECT 
        b.build_id AS buildId,
        b.project_id AS projectId,
        b.definition_id AS definitionId,
        COALESCE(p.name, 'Definition ' || b.definition_id) AS definitionName,
        b.result,
        b.finish_time AS finishTime
      FROM main.builds b
      LEFT JOIN main.pipelines p ON p.pipeline_id = b.definition_id AND p.project_id = b.project_id;

      CREATE TEMP VIEW IF NOT EXISTS azure_teams AS
      SELECT 
        team_id AS teamId,
        team_id,
        project_id AS projectId,
        project_id,
        name,
        description
      FROM main.azure_teams;

      CREATE TEMP VIEW IF NOT EXISTS azure_pipeline_runs AS
      SELECT * FROM main.pipeline_runs;

      CREATE TEMP VIEW IF NOT EXISTS azure_releases AS
      SELECT * FROM main.releases;
    `);

    // 1. SQLite PRAGMA integrity_check
    const integrityStart = performance.now();
    const integrityRows = db.pragma('integrity_check');
    const integrityDuration = performance.now() - integrityStart;
    const isIntegrityOk = Array.isArray(integrityRows) &&
      integrityRows.length === 1 &&
      integrityRows[0].integrity_check === 'ok';

    results.push({
      name: 'SQLite PRAGMA integrity_check',
      category: 'INTEGRITY',
      expected: 'ok',
      actual: isIntegrityOk ? 'ok' : JSON.stringify(integrityRows),
      passed: isIntegrityOk,
      durationMs: integrityDuration,
    });

    // 2. Table Counts Verification
    const countChecks = [
      {
        name: 'azure_builds count',
        query: 'SELECT COUNT(*) AS count FROM azure_builds',
        description: '> 57,000 (actual ~57,400+)',
        validator: (c) => c > 57000,
      },
      {
        name: 'azure_teams count',
        query: 'SELECT COUNT(*) AS count FROM azure_teams',
        description: '== 247',
        validator: (c) => c === 247,
      },
      {
        name: 'azure_projects count',
        query: 'SELECT COUNT(*) AS count FROM main.azure_projects',
        description: '== 2',
        validator: (c) => c === 2,
      },
      {
        name: 'azure_pipeline_runs count',
        query: 'SELECT COUNT(*) AS count FROM azure_pipeline_runs',
        description: '> 9,000 (actual ~48,700+)',
        validator: (c) => c > 9000,
      },
      {
        name: 'azure_releases count',
        query: 'SELECT COUNT(*) AS count FROM azure_releases',
        description: '> 9,000 (actual ~9,100+)',
        validator: (c) => c > 9000,
      },
    ];

    for (const check of countChecks) {
      const cStart = performance.now();
      const row = db.prepare(check.query).get();
      const cDuration = performance.now() - cStart;
      const count = row?.count ?? 0;
      const passed = check.validator(count);

      results.push({
        name: `Table Count: ${check.name}`,
        category: 'TABLE_COUNT',
        expected: check.description,
        actual: count.toLocaleString(),
        passed,
        durationMs: cDuration,
      });
    }

    // 3. Composite Indexes in sqlite_master
    const requiredIndexes = [
      'idx_builds_def_health',
      'idx_pipeline_runs_pipe_created',
      'idx_pipeline_runs_proj_created',
      'idx_azure_teams_proj_name',
    ];

    const masterIndexes = new Set(
      db.prepare("SELECT name FROM sqlite_master WHERE type = 'index'").all()
        .map((r) => r.name)
    );

    for (const idxName of requiredIndexes) {
      const exists = masterIndexes.has(idxName);
      results.push({
        name: `Composite Index: ${idxName}`,
        category: 'INDEX',
        expected: 'EXISTS',
        actual: exists ? 'FOUND' : 'MISSING',
        passed: exists,
      });
    }

    // 4. Performance Benchmarks (< 15ms target)
    // 4a. Build health aggregation query
    const buildHealthSql = `
      SELECT 
        definitionId, 
        definitionName, 
        COUNT(*) as totalRuns, 
        SUM(CASE WHEN result = 'succeeded' THEN 1 ELSE 0 END) as succeeded, 
        SUM(CASE WHEN result = 'failed' THEN 1 ELSE 0 END) as failed 
      FROM azure_builds 
      GROUP BY definitionId, definitionName 
      ORDER BY totalRuns DESC 
      LIMIT 20
    `;
    const buildHealthStmt = db.prepare(buildHealthSql);

    // Warmup query execution
    buildHealthStmt.all();

    // Measured execution
    const buildBenchStart = performance.now();
    const buildRows = buildHealthStmt.all();
    const buildElapsedMs = performance.now() - buildBenchStart;
    const buildBenchPassed = buildElapsedMs < 15.0 && buildRows.length > 0;

    results.push({
      name: 'Benchmark: Build Health Aggregation Query',
      category: 'BENCHMARK',
      expected: '< 15.00 ms (returning rows)',
      actual: `${buildElapsedMs.toFixed(2)} ms (${buildRows.length} definitions returned)`,
      passed: buildBenchPassed,
      durationMs: buildElapsedMs,
    });

    // 4b. Team query with project filter
    const projectRow = db.prepare('SELECT project_id FROM main.azure_projects LIMIT 1').get();
    const sampleProjectId = projectRow?.project_id || 'd07e3437-8c91-4438-8719-7a9a126582db';

    const teamFilterSql = `SELECT teamId, name FROM azure_teams WHERE projectId = ? LIMIT 50`;
    const teamFilterStmt = db.prepare(teamFilterSql);

    // Warmup query execution
    teamFilterStmt.all(sampleProjectId);

    // Measured execution
    const teamBenchStart = performance.now();
    const teamRows = teamFilterStmt.all(sampleProjectId);
    const teamElapsedMs = performance.now() - teamBenchStart;
    const teamBenchPassed = teamElapsedMs < 15.0 && teamRows.length > 0;

    results.push({
      name: 'Benchmark: Team Filter by Project Query',
      category: 'BENCHMARK',
      expected: '< 15.00 ms (returning rows)',
      actual: `${teamElapsedMs.toFixed(2)} ms (${teamRows.length} teams returned)`,
      passed: teamBenchPassed,
      durationMs: teamElapsedMs,
    });

  } finally {
    db.close();
  }

  const totalDurationMs = performance.now() - overallStart;
  const passedChecks = results.filter((r) => r.passed).length;
  const failedChecks = results.filter((r) => !r.passed).length;

  return {
    dbPath,
    totalChecks: results.length,
    passedChecks,
    failedChecks,
    totalDurationMs,
    results,
  };
}

/**
 * Pretty-prints verification results to stdout.
 * @param {object} summary
 */
export function printVerificationReport(summary) {
  const line = '='.repeat(88);
  console.log('\n' + line);
  console.log('            AZURE-DATA.DB STANDALONE VERIFICATION & QUALITY GATE');
  console.log(line);
  console.log(` Database: ${summary.dbPath}`);
  console.log(` Mode:     Read-Only SQLite (WAL + Cache Optimized)`);
  console.log(` Time:     ${new Date().toISOString()}`);
  console.log('-'.repeat(88));

  for (const r of summary.results) {
    const status = r.passed ? '\x1b[32m[PASS]\x1b[0m' : '\x1b[31m[FAIL]\x1b[0m';
    const duration = r.durationMs !== undefined ? `(${r.durationMs.toFixed(2)} ms)` : '';
    console.log(` ${status} ${r.name.padEnd(46)} | Expected: ${r.expected.padEnd(20)} | Actual: ${r.actual} ${duration}`);
  }

  console.log(line);
  if (summary.failedChecks === 0) {
    console.log(`\x1b[32m SUCCESS: ALL ${summary.totalChecks} QUALITY CHECKS PASSED\x1b[0m (Total Duration: ${summary.totalDurationMs.toFixed(2)} ms)`);
  } else {
    console.log(`\x1b[31m FAILURE: ${summary.failedChecks} OF ${summary.totalChecks} CHECKS FAILED\x1b[0m (Total Duration: ${summary.totalDurationMs.toFixed(2)} ms)`);
  }
  console.log(line + '\n');
}

/**
 * CLI Entrypoint
 */
export async function main() {
  try {
    const summary = verifyAzureDatabase();
    printVerificationReport(summary);

    if (summary.failedChecks > 0) {
      process.exitCode = 1;
    }
  } catch (error) {
    console.error('\n\x1b[31m[FATAL ERROR]\x1b[0m Database verification failed to execute:');
    console.error(error instanceof Error ? error.stack || error.message : String(error));
    process.exitCode = 1;
  }
}

const currentFileUrl = import.meta.url;
const executedFileUrl = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : '';
if (currentFileUrl === executedFileUrl || executedFileUrl.endsWith('verify-azure-db.mjs')) {
  main();
}
