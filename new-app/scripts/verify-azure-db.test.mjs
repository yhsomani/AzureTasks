import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { verifyAzureDatabase } from './verify-azure-db.mjs';

test('verifyAzureDatabase validates real azure-data.db and passes all quality checks', () => {
  const dbPath = path.resolve(process.cwd(), 'azure-data.db');
  const summary = verifyAzureDatabase(dbPath);

  assert.equal(summary.failedChecks, 0, 'No quality checks should fail');
  assert.equal(summary.totalChecks, 12, 'Expected 12 total quality checks');
  assert.equal(summary.passedChecks, 12, 'All 12 quality checks should pass');

  // Verify integrity check passed
  const integrity = summary.results.find((r) => r.name === 'SQLite PRAGMA integrity_check');
  assert.ok(integrity, 'Integrity check must be present');
  assert.equal(integrity.passed, true);
  assert.equal(integrity.actual, 'ok');

  // Verify table counts
  const buildsCount = summary.results.find((r) => r.name.includes('azure_builds count'));
  assert.ok(buildsCount?.passed, 'azure_builds count check must pass');

  const teamsCount = summary.results.find((r) => r.name.includes('azure_teams count'));
  assert.ok(teamsCount?.passed, 'azure_teams count check must pass');
  assert.equal(teamsCount?.actual, '247');

  const projectsCount = summary.results.find((r) => r.name.includes('azure_projects count'));
  assert.ok(projectsCount?.passed, 'azure_projects count check must pass');
  assert.equal(projectsCount?.actual, '2');

  const pipelineRunsCount = summary.results.find((r) => r.name.includes('azure_pipeline_runs count'));
  assert.ok(pipelineRunsCount?.passed, 'azure_pipeline_runs count check must pass');

  const releasesCount = summary.results.find((r) => r.name.includes('azure_releases count'));
  assert.ok(releasesCount?.passed, 'azure_releases count check must pass');

  // Verify indexes
  const requiredIndexes = [
    'idx_builds_def_health',
    'idx_pipeline_runs_pipe_created',
    'idx_pipeline_runs_proj_created',
    'idx_azure_teams_proj_name',
  ];
  for (const idx of requiredIndexes) {
    const idxResult = summary.results.find((r) => r.name.includes(idx));
    assert.ok(idxResult?.passed, `Index check ${idx} must pass`);
    assert.equal(idxResult?.actual, 'FOUND');
  }

  // Verify benchmarks
  const buildBench = summary.results.find((r) => r.name.includes('Build Health'));
  assert.ok(buildBench?.passed, 'Build health benchmark must pass (< 15ms)');
  assert.ok(buildBench?.durationMs < 15.0, `Build health duration should be < 15ms, got ${buildBench?.durationMs}`);

  const teamBench = summary.results.find((r) => r.name.includes('Team Filter'));
  assert.ok(teamBench?.passed, 'Team filter benchmark must pass (< 15ms)');
  assert.ok(teamBench?.durationMs < 15.0, `Team filter duration should be < 15ms, got ${teamBench?.durationMs}`);
});

test('verifyAzureDatabase throws error when db file does not exist', () => {
  assert.throws(
    () => verifyAzureDatabase(path.resolve(process.cwd(), 'non-existent-db.db')),
    /not found/
  );
});
