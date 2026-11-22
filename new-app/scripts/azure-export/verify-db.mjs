import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const file = path.resolve(process.argv[2] || 'azure-data.db');
if (!fs.existsSync(file)) throw new Error(`Database not found: ${file}`);
const database = new DatabaseSync(file, { readOnly: true });
try {
  const integrity = database.prepare('PRAGMA integrity_check').get();
  const exportRow = database.prepare('SELECT run_id,status,mode,started_at,completed_at,dataset_count,error_count FROM exports ORDER BY started_at DESC LIMIT 1').get();
  const datasets = database.prepare('SELECT COUNT(*) AS count FROM datasets').get().count;
  const projects = database.prepare('SELECT project_name, COUNT(*) AS datasets, SUM(record_count) AS records FROM datasets WHERE project_name <> ? GROUP BY project_name',).all('organization');
  const normalizedTables = Object.fromEntries(['azure_projects','azure_teams','identities','team_members','work_items','work_item_revisions','repositories','repository_refs','pull_requests','pipelines','pipeline_runs','builds','releases','test_plans','test_suites','test_runs','wikis']
    .map(table => [table, database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count]));
  const normalizedProjects = database.prepare('SELECT project_id,name FROM azure_projects ORDER BY name').all();
  const foreignKeys = database.prepare('PRAGMA foreign_key_check').all();
  const views = Object.fromEntries(['v_project_overview','v_team_workload','v_pr_activity','v_build_health','v_test_health']
    .map(view => [view, database.prepare(`SELECT COUNT(*) AS count FROM ${view}`).get().count]));
  console.log(JSON.stringify({ file, integrity: integrity.integrity_check, export: exportRow, datasets, projects, normalizedTables, normalizedProjects, foreignKeyErrors: foreignKeys.length, views }, null, 2));
  const required = ['3_in_1_AppFrontEnd_Tasks', '3in1_Agile_Projects'];
  const missing = required.filter(name => !normalizedProjects.some(project => project.name === name));
  if (integrity.integrity_check !== 'ok' || !exportRow?.completed_at || foreignKeys.length || missing.length) process.exitCode = 1;
} finally {
  database.close();
}
