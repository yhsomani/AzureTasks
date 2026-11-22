# Azure Export Pipeline

## Commands

- `npm run azure:export` — dashboard mode, both selected projects
- `npm run azure:export:full` — metadata and histories
- `npm run azure:export:forensic` — deep logs, attachments, and previews
- `npm run azure:export:smoke` — bounded validation run
- `npm run azure:normalize` — normalize an existing `azure-data.db` in place
- `npm run azure:verify` — validate integrity, required projects, foreign keys, and dashboard views
- `npm run test:azure-export` — unit tests

The active database is `azure-data.db`. Every run writes to a hidden staging database and atomically publishes only after SQLite integrity validation. The previous active database is preserved on failure.

## Modes

- `dashboard`: normalized dashboard-relevant metadata, work items, PR summaries, pipelines, builds, releases, tests, and wikis.
- `full`: dashboard data plus commits, revisions, comments, and test results.
- `forensic`: all available details, including logs, attachments, and pipeline previews.

## Storage

- `exports` — run metadata and completion status
- `sync_steps` — endpoint progress and duration
- `sync_cursors` — resumable pagination cursors
- `datasets` — raw Azure payloads by stable scope (retained as the migration fallback)
- `azure_projects`, `azure_teams`, `identities`, `team_members` — project and team directory data
- `work_items`, `work_item_revisions` — current and historical work-item data
- `repositories`, `repository_refs`, `pull_requests` — source-control data
- `pipelines`, `pipeline_runs`, `builds`, `releases` — delivery and build data
- `test_plans`, `test_suites`, `test_runs`, `wikis` — quality and documentation data
- `v_project_overview`, `v_team_workload`, `v_pr_activity`, `v_build_health`, `v_test_health` — dashboard-ready views
- `export_errors` — classified errors and remediation signals
- `v_export_status`, `v_data_freshness`, `v_export_errors`, `v_project_datasets` — dashboard/operations views

No PAT is stored in the database. Temporary databases and SQLite sidecars are removed immediately after success or failure.
