export const NORMALIZED_SCHEMA = `
PRAGMA foreign_keys=ON;

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

CREATE INDEX IF NOT EXISTS idx_work_items_project_changed ON work_items(project_id, changed_at);
CREATE INDEX IF NOT EXISTS idx_work_items_project_state ON work_items(project_id, state);
CREATE INDEX IF NOT EXISTS idx_pull_requests_repo_status ON pull_requests(repository_id, status);
CREATE INDEX IF NOT EXISTS idx_builds_project_finish ON builds(project_id, finish_time);
CREATE INDEX IF NOT EXISTS idx_releases_project_modified ON releases(project_id, modified_at);
CREATE INDEX IF NOT EXISTS idx_test_runs_project_started ON test_runs(project_id, started_at);

CREATE VIEW IF NOT EXISTS v_project_overview AS
SELECT p.project_id, p.name,
  (SELECT COUNT(*) FROM work_items w WHERE w.project_id=p.project_id) AS work_items,
  (SELECT COUNT(*) FROM repositories r WHERE r.project_id=p.project_id) AS repositories,
  (SELECT COUNT(*) FROM pull_requests pr WHERE pr.project_id=p.project_id) AS pull_requests,
  (SELECT COUNT(*) FROM pipelines pl WHERE pl.project_id=p.project_id) AS pipelines,
  (SELECT COUNT(*) FROM builds b WHERE b.project_id=p.project_id) AS builds,
  (SELECT COUNT(*) FROM releases rel WHERE rel.project_id=p.project_id) AS releases,
  (SELECT COUNT(*) FROM test_runs tr WHERE tr.project_id=p.project_id) AS test_runs,
  p.synced_at
FROM azure_projects p;

CREATE VIEW IF NOT EXISTS v_team_workload AS
SELECT project_id, area_path, assigned_identity_id,
  COUNT(*) AS total_items,
  SUM(CASE WHEN lower(COALESCE(state,'')) IN ('closed','done','completed') THEN 1 ELSE 0 END) AS completed_items
FROM work_items GROUP BY project_id, area_path, assigned_identity_id;

CREATE VIEW IF NOT EXISTS v_pr_activity AS
SELECT project_id, repository_id, status, COUNT(*) AS pull_requests, MAX(created_at) AS latest_created_at
FROM pull_requests GROUP BY project_id, repository_id, status;

CREATE VIEW IF NOT EXISTS v_build_health AS
SELECT project_id, definition_id, COUNT(*) AS runs,
  SUM(CASE WHEN result='succeeded' THEN 1 ELSE 0 END) AS succeeded,
  SUM(CASE WHEN result IN ('failed','partiallySucceeded') THEN 1 ELSE 0 END) AS failed,
  MAX(finish_time) AS latest_finished_at
FROM builds GROUP BY project_id, definition_id;

CREATE VIEW IF NOT EXISTS v_test_health AS
SELECT project_id, COUNT(*) AS runs,
  SUM(CASE WHEN lower(COALESCE(outcome,'')) IN ('passed','completed') THEN 1 ELSE 0 END) AS successful,
  MAX(completed_at) AS latest_completed_at
FROM test_runs GROUP BY project_id;
`;
