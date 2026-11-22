import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { classifyError } from './errors.mjs';
import { parseArguments, modeAllows } from './config.mjs';
import { SqliteExportWriter } from './sqlite-writer.mjs';

test('dashboard mode excludes forensic collections', () => {
  const config = parseArguments(['--mode', 'dashboard', '--projects', 'a,b']);
  assert.equal(modeAllows(config, 'workItems'), true);
  assert.equal(modeAllows(config, 'logs'), false);
  assert.equal(modeAllows(config, 'commits'), false);
});

test('full mode enables deep collections', () => {
  const config = parseArguments(['--mode', 'full']);
  assert.equal(modeAllows(config, 'logs'), false);
  assert.equal(modeAllows(config, 'commits'), true);
  assert.equal(modeAllows(config, 'revisions'), true);
});

test('errors are classified for permission and throttling', () => {
  assert.equal(classifyError({ status: 401 }), 'permission');
  assert.equal(classifyError({ status: 429 }), 'transient');
  assert.equal(classifyError({ status: 400, response: 'exceeds the size limit' }), 'pagination_limit');
});

test('writer publishes one valid database and removes staging sidecars', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'azure-export-'));
  const output = path.join(directory, 'azure-data.db');
  const writer = new SqliteExportWriter(output, { mode: 'dashboard', projects: ['a'], organization: 'org' });
  writer.saveDataset('project.a.teams', 'a', { value: [{ id: 'team', name: 'Team A' }] });
  writer.saveDataset('project.a.details', 'a', { id: 'project-a', name: 'a', state: 'wellFormed' });
  const result = writer.publish('complete');
  assert.equal(result.datasetCount, 2);
  assert.equal(fs.existsSync(writer.stagingPath), false);
  assert.equal(fs.readdirSync(directory).length, 1);
  const database = new DatabaseSync(output, { readOnly: true });
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM datasets').get().count, 2);
  assert.equal(database.prepare("SELECT value FROM export_meta WHERE key='completedAt'").get().value.length > 0, true);
  assert.equal(database.prepare("SELECT value FROM export_meta WHERE key='normalizationPending'").get().value, 'false');
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM azure_projects').get().count, 1);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM azure_teams').get().count, 1);
  assert.equal(database.prepare('SELECT COUNT(*) AS count FROM v_project_overview').get().count, 1);
  database.close();
  fs.rmSync(directory, { recursive: true, force: true });
});
