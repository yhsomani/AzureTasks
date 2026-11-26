import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';

export interface MockAzureDataDbOptions {
  readOnly?: boolean;
  teamCount?: number;
  unassignedCount?: number;
  organization?: string;
}

export interface MockAzureDataDbResult {
  dbPath: string;
  projectIds: string[];
  teamCount: number;
  unassignedCount: number;
  sprintPaths: string[];
}

const AZURE_DATA_DDL = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS azure_projects (
  project_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  state TEXT,
  visibility TEXT,
  revision INTEGER,
  last_update_time TEXT,
  sync_run_id TEXT,
  synced_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS azure_teams (
  team_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES azure_projects(project_id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  sync_run_id TEXT,
  synced_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS identities (
  identity_id TEXT PRIMARY KEY,
  display_name TEXT,
  unique_name TEXT,
  email TEXT,
  subject_descriptor TEXT,
  is_active INTEGER NOT NULL DEFAULT 1,
  sync_run_id TEXT,
  synced_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS team_members (
  team_id TEXT NOT NULL REFERENCES azure_teams(team_id) ON DELETE CASCADE,
  identity_id TEXT NOT NULL REFERENCES identities(identity_id) ON DELETE CASCADE,
  sync_run_id TEXT,
  synced_at TEXT NOT NULL,
  PRIMARY KEY(team_id, identity_id)
);

CREATE TABLE IF NOT EXISTS work_items (
  project_id TEXT NOT NULL REFERENCES azure_projects(project_id) ON DELETE CASCADE,
  work_item_id INTEGER NOT NULL,
  type TEXT,
  title TEXT,
  state TEXT,
  assigned_identity_id TEXT,
  area_path TEXT,
  iteration_path TEXT,
  created_at TEXT,
  changed_at TEXT,
  closed_at TEXT,
  parent_id INTEGER,
  tags TEXT,
  payload_json TEXT NOT NULL,
  sync_run_id TEXT,
  synced_at TEXT NOT NULL,
  PRIMARY KEY(project_id, work_item_id)
);

CREATE TABLE IF NOT EXISTS work_item_revisions (
  project_id TEXT NOT NULL,
  work_item_id INTEGER NOT NULL,
  revision INTEGER NOT NULL,
  state TEXT,
  changed_by_identity_id TEXT,
  changed_at TEXT,
  fields_json TEXT,
  sync_run_id TEXT,
  synced_at TEXT NOT NULL,
  PRIMARY KEY(project_id, work_item_id, revision),
  FOREIGN KEY(project_id, work_item_id) REFERENCES work_items(project_id, work_item_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS repositories (
  repository_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES azure_projects(project_id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  default_branch TEXT,
  remote_url TEXT,
  web_url TEXT,
  is_disabled INTEGER NOT NULL DEFAULT 0,
  sync_run_id TEXT,
  synced_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS repository_refs (
  repository_id TEXT NOT NULL REFERENCES repositories(repository_id) ON DELETE CASCADE,
  ref_name TEXT NOT NULL,
  object_id TEXT,
  peeled_object_id TEXT,
  sync_run_id TEXT,
  synced_at TEXT NOT NULL,
  PRIMARY KEY(repository_id, ref_name)
);

CREATE TABLE IF NOT EXISTS pull_requests (
  pull_request_id INTEGER PRIMARY KEY,
  repository_id TEXT NOT NULL REFERENCES repositories(repository_id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES azure_projects(project_id) ON DELETE CASCADE,
  title TEXT,
  description TEXT,
  status TEXT,
  source_branch TEXT,
  target_branch TEXT,
  creator_identity_id TEXT,
  created_at TEXT,
  closed_at TEXT,
  merge_status TEXT,
  is_draft INTEGER NOT NULL DEFAULT 0,
  payload_json TEXT NOT NULL,
  sync_run_id TEXT,
  synced_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pipelines (
  pipeline_id INTEGER PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES azure_projects(project_id) ON DELETE CASCADE,
  name TEXT,
  folder TEXT,
  revision INTEGER,
  payload_json TEXT NOT NULL,
  sync_run_id TEXT,
  synced_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS pipeline_runs (
  run_id INTEGER PRIMARY KEY,
  pipeline_id INTEGER NOT NULL REFERENCES pipelines(pipeline_id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES azure_projects(project_id) ON DELETE CASCADE,
  name TEXT,
  state TEXT,
  result TEXT,
  created_at TEXT,
  finished_at TEXT,
  source_branch TEXT,
  payload_json TEXT NOT NULL,
  sync_run_id TEXT,
  synced_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS builds (
  build_id INTEGER PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES azure_projects(project_id) ON DELETE CASCADE,
  definition_id INTEGER,
  build_number TEXT,
  status TEXT,
  result TEXT,
  reason TEXT,
  queue_time TEXT,
  start_time TEXT,
  finish_time TEXT,
  source_branch TEXT,
  source_version TEXT,
  payload_json TEXT NOT NULL,
  sync_run_id TEXT,
  synced_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS releases (
  release_id INTEGER PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES azure_projects(project_id) ON DELETE CASCADE,
  definition_id INTEGER,
  name TEXT,
  status TEXT,
  reason TEXT,
  created_at TEXT,
  modified_at TEXT,
  payload_json TEXT NOT NULL,
  sync_run_id TEXT,
  synced_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS test_plans (
  plan_id INTEGER PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES azure_projects(project_id) ON DELETE CASCADE,
  name TEXT,
  description TEXT,
  state TEXT,
  owner_identity_id TEXT,
  start_date TEXT,
  end_date TEXT,
  payload_json TEXT NOT NULL,
  sync_run_id TEXT,
  synced_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS test_suites (
  suite_id INTEGER PRIMARY KEY,
  plan_id INTEGER NOT NULL REFERENCES test_plans(plan_id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES azure_projects(project_id) ON DELETE CASCADE,
  parent_suite_id INTEGER,
  name TEXT,
  suite_type TEXT,
  state TEXT,
  payload_json TEXT NOT NULL,
  sync_run_id TEXT,
  synced_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS test_runs (
  run_id INTEGER PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES azure_projects(project_id) ON DELETE CASCADE,
  plan_id INTEGER,
  name TEXT,
  state TEXT,
  outcome TEXT,
  started_at TEXT,
  completed_at TEXT,
  payload_json TEXT NOT NULL,
  sync_run_id TEXT,
  synced_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS wikis (
  wiki_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES azure_projects(project_id) ON DELETE CASCADE,
  name TEXT,
  type TEXT,
  mapped_path TEXT,
  repository_id TEXT,
  payload_json TEXT NOT NULL,
  sync_run_id TEXT,
  synced_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS export_runs (
  run_id TEXT PRIMARY KEY,
  organization TEXT NOT NULL,
  mode TEXT NOT NULL,
  requested_projects TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  dataset_count INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS export_errors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  status INTEGER,
  category TEXT,
  message TEXT NOT NULL,
  url TEXT
);

CREATE INDEX IF NOT EXISTS idx_work_items_project_changed ON work_items(project_id, changed_at);
CREATE INDEX IF NOT EXISTS idx_work_items_project_state ON work_items(project_id, state);
CREATE INDEX IF NOT EXISTS idx_pull_requests_repo_status ON pull_requests(repository_id, status);
CREATE INDEX IF NOT EXISTS idx_builds_project_finish ON builds(project_id, finish_time);
CREATE INDEX IF NOT EXISTS idx_releases_project_modified ON releases(project_id, modified_at);
CREATE INDEX IF NOT EXISTS idx_test_runs_project_started ON test_runs(project_id, started_at);
CREATE INDEX IF NOT EXISTS idx_builds_def_health ON builds(project_id, definition_id, result, finish_time);
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_pipe_created ON pipeline_runs(pipeline_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_proj_created ON pipeline_runs(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_azure_teams_proj_name ON azure_teams(project_id, name);

CREATE VIEW IF NOT EXISTS v_project_overview AS
SELECT p.project_id, p.name,
  (SELECT COUNT(*) FROM work_items w WHERE w.project_id = p.project_id) AS work_items,
  (SELECT COUNT(*) FROM repositories r WHERE r.project_id = p.project_id) AS repositories,
  (SELECT COUNT(*) FROM pull_requests pr WHERE pr.project_id = p.project_id) AS pull_requests,
  (SELECT COUNT(*) FROM pipelines pl WHERE pl.project_id = p.project_id) AS pipelines,
  (SELECT COUNT(*) FROM builds b WHERE b.project_id = p.project_id) AS builds,
  (SELECT COUNT(*) FROM releases rel WHERE rel.project_id = p.project_id) AS releases,
  (SELECT COUNT(*) FROM test_runs tr WHERE tr.project_id = p.project_id) AS test_runs,
  p.synced_at
FROM azure_projects p;

CREATE VIEW IF NOT EXISTS v_team_workload AS
SELECT project_id, area_path, assigned_identity_id,
  COUNT(*) AS total_items,
  SUM(CASE WHEN lower(COALESCE(state, '')) IN ('closed', 'done', 'completed') THEN 1 ELSE 0 END) AS completed_items
FROM work_items
GROUP BY project_id, area_path, assigned_identity_id;

CREATE VIEW IF NOT EXISTS v_pr_activity AS
SELECT project_id, repository_id, status, COUNT(*) AS pull_requests, MAX(created_at) AS latest_created_at
FROM pull_requests
GROUP BY project_id, repository_id, status;

CREATE VIEW IF NOT EXISTS v_build_health AS
SELECT project_id, definition_id, COUNT(*) AS runs,
  SUM(CASE WHEN result = 'succeeded' THEN 1 ELSE 0 END) AS succeeded,
  SUM(CASE WHEN result IN ('failed', 'partiallySucceeded') THEN 1 ELSE 0 END) AS failed,
  MAX(finish_time) AS latest_finished_at
FROM builds
GROUP BY project_id, definition_id;

CREATE VIEW IF NOT EXISTS v_test_health AS
SELECT project_id, COUNT(*) AS runs,
  SUM(CASE WHEN lower(COALESCE(outcome, '')) IN ('passed', 'completed') THEN 1 ELSE 0 END) AS successful,
  MAX(completed_at) AS latest_completed_at
FROM test_runs
GROUP BY project_id;

CREATE VIEW IF NOT EXISTS v_data_freshness AS
SELECT
  p.name AS project_name,
  (
    (SELECT COUNT(*) FROM work_items w WHERE w.project_id = p.project_id) +
    (SELECT COUNT(*) FROM builds b WHERE b.project_id = p.project_id) +
    (SELECT COUNT(*) FROM releases r WHERE r.project_id = p.project_id) +
    (SELECT COUNT(*) FROM test_runs t WHERE t.project_id = p.project_id)
  ) AS datasets,
  p.synced_at AS last_updated
FROM azure_projects p;

CREATE VIEW IF NOT EXISTS v_export_status AS
SELECT
  run_id,
  organization,
  mode,
  requested_projects,
  status,
  started_at,
  completed_at,
  dataset_count,
  error_count
FROM export_runs;
`;

export function createMockAzureDataDb(
  dbPath: string,
  options: MockAzureDataDbOptions = {}
): MockAzureDataDbResult {
  const dir = path.dirname(dbPath);
  fs.mkdirSync(dir, { recursive: true });
  if (fs.existsSync(dbPath)) {
    fs.chmodSync(dbPath, 0o644);
    fs.unlinkSync(dbPath);
  }

  const teamCount = options.teamCount ?? 260;
  const unassignedCount = options.unassignedCount ?? 12;
  const organization = options.organization || 'test-org';
  const nowIso = new Date().toISOString();
  const syncRunId = 'sync-e2e-seed-001';

  const projectDefs = [
    { id: 'proj-agile-01', name: 'TestProject' },
    { id: 'proj-frontend-02', name: '3_in_1_AppFrontEnd_Tasks' },
  ];
  const sprintPaths = [
    'TestProject\\Sprint 41',
    'TestProject\\Sprint 42',
    '3_in_1_AppFrontEnd_Tasks\\Sprint 42',
  ];

  const db = new Database(dbPath);
  db.pragma('journal_mode = DELETE');
  db.exec(AZURE_DATA_DDL);

  const seedTx = db.transaction(() => {
    const insertProject = db.prepare(`
      INSERT INTO azure_projects (project_id, name, state, visibility, revision, last_update_time, sync_run_id, synced_at)
      VALUES (?, ?, 'wellFormed', 'private', 1, ?, ?, ?)
    `);
    for (const p of projectDefs) {
      insertProject.run(p.id, p.name, nowIso, syncRunId, nowIso);
    }

    const insertIdentity = db.prepare(`
      INSERT INTO identities (identity_id, display_name, unique_name, email, subject_descriptor, is_active, sync_run_id, synced_at)
      VALUES (?, ?, ?, ?, ?, 1, ?, ?)
    `);
    insertIdentity.run('id-alice', 'Alice Chen', 'alice@workops.test', 'alice@workops.test', 'aad.alice', syncRunId, nowIso);
    insertIdentity.run('id-bob', 'Bob Patel', 'bob@workops.test', 'bob@workops.test', 'aad.bob', syncRunId, nowIso);

    const insertTeam = db.prepare(`
      INSERT INTO azure_teams (team_id, project_id, name, description, sync_run_id, synced_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const insertTeamMember = db.prepare(`
      INSERT INTO team_members (team_id, identity_id, sync_run_id, synced_at)
      VALUES (?, ?, ?, ?)
    `);

    const primaryCount = Math.ceil(teamCount * 0.75);
    for (let i = 1; i <= teamCount; i++) {
      const padded = String(i).padStart(3, '0');
      const project = i <= primaryCount ? projectDefs[0] : projectDefs[1];
      const teamId = `team-pod-${padded}`;
      const teamName = `POD-${padded} ${i % 2 === 0 ? 'Platform' : 'Customer'} Engineering`;
      const desc = `Enterprise delivery squad ${padded} under ${project.name}`;
      insertTeam.run(teamId, project.id, teamName, desc, syncRunId, nowIso);
      if (i <= 2) {
        insertTeamMember.run(teamId, i === 1 ? 'id-alice' : 'id-bob', syncRunId, nowIso);
      }
    }

    const insertRepo = db.prepare(`
      INSERT INTO repositories (repository_id, project_id, name, default_branch, remote_url, web_url, is_disabled, sync_run_id, synced_at)
      VALUES (?, ?, ?, 'refs/heads/main', ?, ?, 0, ?, ?)
    `);
    insertRepo.run('repo-01', projectDefs[0].id, 'workops-core', 'https://dev.azure.com/test-org/TestProject/_git/workops-core', 'https://dev.azure.com/test-org/TestProject/_git/workops-core', syncRunId, nowIso);
    insertRepo.run('repo-02', projectDefs[1].id, 'workops-web', 'https://dev.azure.com/test-org/3_in_1_AppFrontEnd_Tasks/_git/workops-web', 'https://dev.azure.com/test-org/3_in_1_AppFrontEnd_Tasks/_git/workops-web', syncRunId, nowIso);

    const insertPr = db.prepare(`
      INSERT INTO pull_requests (pull_request_id, repository_id, project_id, title, description, status, source_branch, target_branch, creator_identity_id, created_at, closed_at, merge_status, is_draft, payload_json, sync_run_id, synced_at)
      VALUES (?, ?, ?, ?, ?, ?, 'refs/heads/feat/modernize', 'refs/heads/main', 'id-alice', ?, ?, 'succeeded', 0, '{}', ?, ?)
    `);
    insertPr.run(501, 'repo-01', projectDefs[0].id, 'Harden OIDC verification', 'Security milestone', 'completed', nowIso, nowIso, syncRunId, nowIso);
    insertPr.run(502, 'repo-02', projectDefs[1].id, 'Rebuild SPA navigation shell', 'UI rebuild', 'active', nowIso, null, syncRunId, nowIso);

    const insertPipeline = db.prepare(`
      INSERT INTO pipelines (pipeline_id, project_id, name, folder, revision, payload_json, sync_run_id, synced_at)
      VALUES (?, ?, ?, '\\', 1, '{}', ?, ?)
    `);
    insertPipeline.run(101, projectDefs[0].id, 'WorkOps CI Build', syncRunId, nowIso);
    insertPipeline.run(102, projectDefs[1].id, 'Frontend SPA Pipeline', syncRunId, nowIso);

    const insertRun = db.prepare(`
      INSERT INTO pipeline_runs (run_id, pipeline_id, project_id, name, state, result, created_at, finished_at, source_branch, payload_json, sync_run_id, synced_at)
      VALUES (?, ?, ?, ?, 'completed', ?, ?, ?, 'refs/heads/main', '{}', ?, ?)
    `);
    insertRun.run(2001, 101, projectDefs[0].id, '20261125.1', 'succeeded', nowIso, nowIso, syncRunId, nowIso);
    insertRun.run(2002, 101, projectDefs[0].id, '20261125.2', 'failed', nowIso, nowIso, syncRunId, nowIso);
    insertRun.run(2003, 102, projectDefs[1].id, '20261125.3', 'succeeded', nowIso, nowIso, syncRunId, nowIso);

    const insertBuild = db.prepare(`
      INSERT INTO builds (build_id, project_id, definition_id, build_number, status, result, reason, queue_time, start_time, finish_time, source_branch, source_version, payload_json, sync_run_id, synced_at)
      VALUES (?, ?, ?, ?, 'completed', ?, 'individualCI', ?, ?, ?, 'refs/heads/main', 'abc1234', '{}', ?, ?)
    `);
    insertBuild.run(3001, projectDefs[0].id, 101, 'B-3001', 'succeeded', nowIso, nowIso, nowIso, syncRunId, nowIso);
    insertBuild.run(3002, projectDefs[0].id, 101, 'B-3002', 'succeeded', nowIso, nowIso, nowIso, syncRunId, nowIso);
    insertBuild.run(3003, projectDefs[0].id, 101, 'B-3003', 'failed', nowIso, nowIso, nowIso, syncRunId, nowIso);
    insertBuild.run(3004, projectDefs[1].id, 102, 'B-3004', 'succeeded', nowIso, nowIso, nowIso, syncRunId, nowIso);

    const insertRelease = db.prepare(`
      INSERT INTO releases (release_id, project_id, definition_id, name, status, reason, created_at, modified_at, payload_json, sync_run_id, synced_at)
      VALUES (?, ?, ?, ?, ?, 'continuousIntegration', ?, ?, '{}', ?, ?)
    `);
    insertRelease.run(4001, projectDefs[0].id, 10, 'Release-42.1', 'active', nowIso, nowIso, syncRunId, nowIso);
    insertRelease.run(4002, projectDefs[1].id, 11, 'Release-42.2', 'active', nowIso, nowIso, syncRunId, nowIso);

    const insertTestPlan = db.prepare(`
      INSERT INTO test_plans (plan_id, project_id, name, description, state, owner_identity_id, start_date, end_date, payload_json, sync_run_id, synced_at)
      VALUES (?, ?, ?, 'Acceptance test plan', 'Active', 'id-alice', ?, ?, '{}', ?, ?)
    `);
    insertTestPlan.run(5001, projectDefs[0].id, 'Sprint 42 Regression Plan', nowIso, nowIso, syncRunId, nowIso);

    const insertTestRun = db.prepare(`
      INSERT INTO test_runs (run_id, project_id, plan_id, name, state, outcome, started_at, completed_at, payload_json, sync_run_id, synced_at)
      VALUES (?, ?, ?, ?, 'Completed', ?, ?, ?, '{}', ?, ?)
    `);
    insertTestRun.run(6001, projectDefs[0].id, 5001, 'Unit & Integration Suite', 'Passed', nowIso, nowIso, syncRunId, nowIso);
    insertTestRun.run(6002, projectDefs[0].id, 5001, 'Smoke Verification Run', 'Completed', nowIso, nowIso, syncRunId, nowIso);
    insertTestRun.run(6003, projectDefs[1].id, null, 'Frontend UI Smoke', 'Passed', nowIso, nowIso, syncRunId, nowIso);

    const insertWorkItem = db.prepare(`
      INSERT INTO work_items (project_id, work_item_id, type, title, state, assigned_identity_id, area_path, iteration_path, created_at, changed_at, closed_at, parent_id, tags, payload_json, sync_run_id, synced_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, '', '{}', ?, ?)
    `);

    // Assigned items across sprint iterations
    insertWorkItem.run(
      projectDefs[0].id,
      7001,
      'User Story',
      'Core API Contract Modernization',
      'Active',
      'id-alice',
      'TestProject\\Platform',
      sprintPaths[0],
      nowIso,
      nowIso,
      null,
      syncRunId,
      nowIso
    );
    insertWorkItem.run(
      projectDefs[0].id,
      7002,
      'Task',
      'Implement Sprint 42 Diagnostics',
      'Closed',
      'id-bob',
      'TestProject\\Platform',
      sprintPaths[1],
      nowIso,
      nowIso,
      nowIso,
      syncRunId,
      nowIso
    );
    insertWorkItem.run(
      projectDefs[1].id,
      7003,
      'Task',
      'Frontend Navigation Accessibility',
      'Active',
      'id-alice',
      '3_in_1_AppFrontEnd_Tasks\\Web',
      sprintPaths[2],
      nowIso,
      nowIso,
      null,
      syncRunId,
      nowIso
    );

    // Unassigned backlog work items (NULL and '' to test both SQL conditions)
    for (let u = 1; u <= unassignedCount; u++) {
      const workItemId = 8000 + u;
      const proj = u <= Math.ceil(unassignedCount * 0.7) ? projectDefs[0] : projectDefs[1];
      const iter = u <= Math.ceil(unassignedCount * 0.7) ? sprintPaths[1] : sprintPaths[2];
      const assignedVal = u % 2 === 0 ? null : '';
      insertWorkItem.run(
        proj.id,
        workItemId,
        u % 3 === 0 ? 'Bug' : 'Task',
        `Unassigned Triage Item #${u} — Backlog Remediation`,
        'New',
        assignedVal,
        `${proj.name}\\Backlog`,
        iter,
        nowIso,
        nowIso,
        null,
        syncRunId,
        nowIso
      );
    }

    db.prepare(`
      INSERT INTO export_runs (run_id, organization, mode, requested_projects, status, started_at, completed_at, dataset_count, error_count)
      VALUES (?, ?, 'incremental', ?, 'completed', ?, ?, 24, 1)
    `).run(syncRunId, organization, projectDefs.map((p) => p.name).join(','), nowIso, nowIso);

    db.prepare(`
      INSERT INTO export_errors (run_id, scope, status, category, message, url)
      VALUES (?, 'wikis', 404, 'not_found', 'Optional wiki archive skipped', 'https://dev.azure.com/test-org/_apis/wiki/wikis')
    `).run(syncRunId);
  });

  seedTx();
  db.close();

  if (options.readOnly) {
    fs.chmodSync(dbPath, 0o444);
  }

  return {
    dbPath,
    projectIds: projectDefs.map((p) => p.id),
    teamCount,
    unassignedCount,
    sprintPaths,
  };
}
