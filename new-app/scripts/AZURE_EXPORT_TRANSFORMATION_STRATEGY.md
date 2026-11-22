# Azure Exporter Transformation Strategy

## 1. Purpose and Scope

This strategy applies only to the Azure DevOps export workflow discussed in this project, centered on `scripts/export-azure-readable-data.mjs` and the resulting `azure-data.db` database.

Primary goal: provide reliable, secure, repeatable, and dashboard-ready snapshots for these projects:

- `3_in_1_IT_Projects`
- `3in1_Agile_Projects`
- `3_in_1_AppFrontEnd_Tasks`

Secondary goal: support future dashboards without requiring every run to repeatedly download every available Azure payload in full detail.

## 2. Product Vision

The exporter should behave like a small, dependable data pipeline rather than a debugging script.

A user should be able to:

1. Run one simple command.
2. Select one or both supported projects.
3. Choose `dashboard`, `full`, or `forensic` scope.
4. Receive progress and a clear completion summary.
5. Query `azure-data.db` with stable, documented tables.
6. Re-run safely: a successful run fully replaces the active snapshot, while failed runs preserve the previous valid database.
7. Identify missing permissions and unsupported endpoints without treating expected “not available” responses as critical failures.

Success criteria:

- Both project snapshots complete within an agreed maintenance window.
- Every run has a unique run ID, timestamps, scope, and completeness status.
- A dashboard can read the database without parsing nested JSON blobs as its primary model.
- No PAT, token-derived authorization data, or secret-bearing service-connection values are stored.
- No temporary database or journal file survives after the process exits.
- A failed or interrupted run never corrupts or silently truncates the active database.
- Re-runs can reuse unchanged records and fetch only changed records where Azure APIs support it.

## 3. Current Strengths

### Product

- The project scope is now explicit and limited to the two requested Azure projects.
- The exporter supports broad Azure DevOps coverage: work items, teams, repositories, pull requests, builds, releases, tests, wikis, dashboards, and service endpoints.
- Data is checkpointed during long runs, so progress is not completely lost on interruption.

### Engineering

- The implementation uses Node.js and requires no large external database server.
- SQLite is suitable for a local, single-writer, dashboard-oriented dataset.
- Each checkpoint is written to a temporary database and atomically replaces the target database.
- Temporary database and SQLite sidecar files are removed in `finally` blocks.
- PAT values are read from the environment rather than being hard-coded into the exporter.
- API errors are collected instead of immediately terminating the entire run.

### Security

- Generated data files are ignored by Git.
- The final database uses owner-only permissions on macOS/Linux.
- Error logging sanitizes the PAT and Basic authorization value.
- The workflow is read-only from a functional perspective, except for pipeline preview requests that should be removed or explicitly isolated.

## 4. Current Weaknesses and Root Causes

### 4.1 Monolithic design

The exporter currently mixes:

- CLI parsing
- authentication
- retry policy
- pagination
- endpoint discovery
- domain traversal
- persistence
- progress output
- error classification
- run metadata

Root cause: capabilities were added incrementally to one script. This makes changes risky and endpoint-specific behavior difficult to test.

### 4.2 Excessive full-database rewrites

Every successful endpoint rewrites all accumulated data into a brand-new SQLite database. As the in-memory document grows, checkpoint cost and memory usage increase sharply. This is effectively expensive $O(n^2)$-style work across a full run because the same accumulated payload is serialized repeatedly.

Root cause: the checkpoint strategy inherited text-file behavior after storage moved to SQLite.

### 4.3 Entire run held in memory

All data remains in `document.data` while also being persisted repeatedly. Large repositories, work-item histories, logs, pull-request payloads, and test suites can consume substantial memory.

Root cause: the database is used as a final archive rather than as the live write store.

### 4.4 Nested payload model is difficult for dashboards

`datasets` stores one JSON document per scope. This is flexible, but dashboards must understand Azure-specific nested structures and dynamic scope names.

Root cause: storage optimized for preservation rather than analytics.

### 4.5 No resume capability

If a run is interrupted, the final checkpoint contains useful data, but the next run restarts from the beginning and rewrites everything.

Root cause: there is no durable job state per project, endpoint, or resource.

### 4.6 Over-fetching

The current “all possible details” mode recursively downloads very high-volume data, including every pull request, branch commit list, work item history, test case list, and log entry. This is too expensive for routine dashboard refreshes.

Root cause: product scope has not been separated into dashboard requirements and forensic/archive requirements.

### 4.7 Hidden sensitivity risk

A full Azure export may contain:

- Employee identities and email addresses
- Pull-request comments
- Work-item descriptions and attachments
- Build/release logs
- Service connection metadata
- Secret references or pipeline output accidentally containing sensitive values

Root cause: “read-only” was interpreted as authorization safety, not data-governance safety.

### 4.8 Error handling is too coarse

HTTP 400, 401, 403, 404, and 500 currently belong to the same generic export error collection.

Root cause: the exporter lacks an endpoint capability model that classifies expected absence, permission gaps, unsupported APIs, and transient failures differently.

### 4.9 Read-only guarantee is weakened

Pipeline preview uses `POST`. Although preview is intended not to execute a pipeline, it is still less suitable for a strictly read-only exporter and may trigger validation behavior.

Root cause: “all possible details” was prioritized over a strict read-only guarantee.

### 4.10 Tooling and observability gaps

- No resume state or job history
- No machine-readable completion report
- No rate-limit telemetry
- No retry-delay metrics
- No API request count by category
- No schema version migration framework
- No automated integration tests using recorded Azure responses
- No data-integrity validation after export

## 5. Required Features and Functionalities

### P0 — Required for dependable operation

1. **Strictly read-only request policy**
   - Allow GET only for the standard export.
   - Remove pipeline preview POST requests from the default read-only run.
   - Allow WIQL POST only for work-item lookup because Azure DevOps requires query-by-POST; tag it explicitly as a read-only query exception.

2. **Atomic full refresh**
   - Write to `azure-data.db.building` or a uniquely named staging database.
   - Validate schema and counts.
   - Atomically rename the completed database to `azure-data.db`.
   - Delete all staging files immediately in success and failure cleanup.
   - Never expose a zero-byte final database.

3. **Incremental commit behavior**
   - Write each dataset directly into the staging database during the run.
   - Do not serialize the entire accumulated dataset for every checkpoint.
   - Insert or replace one dataset row at a time in a transaction.

4. **Durable run state**
   - `exports`: run ID, status, timestamps, scope, schema version
   - `sync_cursors`: resource type, project, cursor/continuation state
   - `sync_steps`: endpoint/status/count/duration/error
   - `export_errors`: classified errors

5. **Normalized dashboard tables**
   - `projects`
   - `teams`
   - `team_members`
   - `work_items`
   - `work_item_revisions`
   - `work_item_relations`
   - `comments`
   - `repositories`
   - `branches`
   - `commits`
   - `pull_requests`
   - `pull_request_reviews`
   - `pipelines`
   - `pipeline_runs`
   - `builds`
   - `releases`
   - `test_plans`
   - `test_suites`
   - `test_cases`
   - `test_runs`
   - `wikis`
   - `dashboards`

6. **Raw preservation for lossless inspection**
   - Keep `raw_datasets(scope, project_id, payload_json)` for unavailable or future entity shapes.
   - Normalize what dashboards use; preserve the rest for traceability.

7. **Explicit completeness status**
   - `complete`
   - `partial_permission`
   - `partial_api_limitation`
   - `failed`
   - `superseded`

8. **Clear permission diagnostics**
   - Report the exact PAT scope required for each blocked category.
   - Separate missing token scope from user-level Azure permission denial, missing resources, and unsupported endpoints.

### P1 — High value

9. **Export modes**
   - `dashboard`: only data required by known dashboard views; default.
   - `full`: complete metadata and histories for both projects.
   - `forensic`: full scope plus raw logs, previews, attachments, and deep nested history; opt-in only.

10. **Project and category filters**
    - `--project`, `--category`, `--since`, and `--resume-run`.
    - `--dry-run` lists endpoints and estimated request volume without fetching.

11. **Resume from last successful resource**
    - Track completed scopes and cursors in the staging database.
    - Resume interrupted runs when Azure resource version/cursors are still valid.

12. **Incremental synchronization**
    - Use changed dates, cursor tokens, revision values, and continuation tokens where supported.
    - Schedule periodic full reconciliation to detect deletions and missed updates.

13. **SQLite dashboard views**
    - Precomputed views for project overview, workload by team/user, PR aging, build failure rate, release cadence, test health, and recent activity.
    - Materialized summary tables refreshed at the end of a run.

14. **Data retention policy**
    - Configurable retention for logs, attachments, historical raw payloads, and debug responses.
    - Compact old raw detail while retaining normalized dashboard facts.

### P2 — Later maturity

15. **Plugin-based collectors**
    - Independent collectors for work items, code, builds, releases, tests, wiki, and configuration.

16. **Concurrent bounded collection**
    - Controlled parallelism with per-host limits.
    - Respect Azure throttling and `Retry-After`.

17. **Optional encrypted export**
    - Encrypt at rest if the database will be shared, backed up, or stored on managed endpoints.

18. **Schema migration and export utility**
    - Migrations for future dashboard schema versions.
    - Read-only query/export commands for CSV, Parquet, or application APIs.

## 6. Unnecessary Components and Technical Debt to Remove

### Remove from routine export

- Pipeline preview POST requests
- Test plan configuration endpoints that are consistently unavailable or unrelated to dashboard goals
- Duplicate endpoint calls for the same project/team metadata
- Raw service-connection values where only metadata is useful
- Re-fetching all revisions and logs on every run
- Massive debug-level per-record terminal output
- Text-file export paths and legacy text parsing
- Old zero-byte `data.txt` support
- Default recursive fetching of every attachment or log body

### Refactor

- Single giant function into domain collectors and persistence modules
- URL construction into an Azure endpoint catalog
- Retry/pagination logic into reusable transport helpers
- Error classification into a dedicated policy module
- Schema keys derived from long human-readable scopes into stable integer/UUID entity relationships

### Keep only if justified

- Service hook and notification subscription data
- Service endpoints and variable groups
- Full commit lists per branch
- All work-item revisions
- Pipeline/build logs
- All PR iterations and attachments

These items contain sensitive data and can make a run impractically large. They belong in `full` or `forensic` mode unless a dashboard explicitly requires them.

## 7. Recommended Target Architecture

```text
CLI / Scheduler
      |
      v
Export Coordinator
      |
      +-- Capability Probe
      +-- Run Planner
      +-- Collector Registry
      |      +-- Projects/Teams
      |      +-- Work Items
      |      +-- Repositories/PRs
      |      +-- Pipelines/Builds
      |      +-- Releases
      |      +-- Tests
      |      +-- Wiki/Dashboards
      +-- Rate-Limited Transport
      +-- SQLite Staging Writer
      +-- Validator / Summary Builder
      +-- Atomic Publisher
      |
      v
Active azure-data.db
      |
      +-- Dashboard API
      +-- Read-only analytics queries
      +-- Backup/retention process
```

### Module boundaries

Suggested structure:

```text
scripts/azure-export/
  cli.mjs
  coordinator.mjs
  config.mjs
  transport.mjs
  capabilities.mjs
  persistence/
    schema.mjs
    writer.mjs
    migrations.mjs
  collectors/
    projects.mjs
    teams.mjs
    work-items.mjs
    repositories.mjs
    pipelines.mjs
    builds.mjs
    releases.mjs
    tests.mjs
    wikis.mjs
    resources.mjs
  domain/
    errors.mjs
    summaries.mjs
  tests/
```

The existing script can remain as a compatibility entry point while delegating to these modules.

## 8. Proposed SQLite Strategy

### Active and staging files

- Active file: `azure-data.db`
- Staging file: hidden or uniquely named, for example `.azure-data.<run-id>.building.db`
- Final actions: validate, close SQLite, atomically rename, and delete all sidecars

### Transactions

- One transaction per endpoint page or small batch.
- WAL mode may be used for the private staging database to improve write throughput.
- Close and checkpoint the database before atomic publication.
- Avoid rewriting the whole database for each endpoint.

### Important indexes

- `work_items(project_id, changed_date)`
- `work_items(project_id, assigned_to, state)`
- `work_item_revisions(work_item_id, revision)`
- `pull_requests(repository_id, status, created_date)`
- `commits(repository_id, commit_date)`
- `pipeline_runs(pipeline_id, finished_date)`
- `builds(definition_id, finish_time)`
- `test_runs(plan_id, started_date)`
- `sync_steps(run_id, status)`

### Data integrity

At completion:

- foreign-key checks pass
- required counts are non-negative
- project IDs belong to the selected projects
- no duplicate primary keys exist
- expected parent records exist
- selected projects are both marked complete or explicitly partial
- each partial scope has a reason and actionable next step

## 9. Performance and Scalability Improvements

1. **Stream instead of accumulating in memory**
   - Parse a response, normalize records, insert records, release memory.

2. **Bounded concurrency**
   - Start with concurrency 2–4 per Azure host.
   - Stop increasing concurrency when response times or 429/503 rates rise.

3. **Backpressure and rate limiting**
   - Respect `Retry-After` and `X-RateLimit-*` headers.
   - Use exponential backoff with jitter.
   - Cap retries by error type.

4. **Continuation-token correctness**
   - Persist pagination cursor and page size.
   - Resume at the next page, not from the start of the endpoint.

5. **Incremental fetch by category**
   - Work items: changed-date/revision based
   - Builds/pipeline runs: ID or completion-time cursor
   - Pull requests: updated-date and status filters where available
   - Commits: branch tip comparison where possible

6. **Large payload separation**
   - Store log/attachment metadata by default.
   - Fetch bodies only in `forensic` mode.

7. **Avoid serial per-child explosion**
   - Process pull requests, teams, and build children with bounded worker pools rather than thousands of fully sequential calls.

8. **Measure and budget**
   - Track requests, records, bytes, duration, and retries per collector.
   - Set configurable execution-time and payload-size budgets.

## 10. Security and Governance

### Secrets

- Keep PAT only in `.env`, a secret manager, or process environment.
- Never store the PAT, Basic header, authorization URL, or decoded identity claims in SQLite.
- Revoke exposed PATs immediately and rotate them if printed in chat, logs, or source history.

### Least privilege

Recommended separation:

- **Application PAT:** Project and Team Read + Work Items Read & Write.
- **Dashboard PAT:** the minimum read scopes required by enabled collectors.
- **Full forensic PAT:** explicitly reviewed and short-lived.

Read scopes commonly needed by the exporter:

- Project and Team: Read
- Work Items: Read
- Code: Read
- Build: Read
- Release: Read
- Test Management: Read
- Wiki: Read
- Team Dashboard: Read
- Graph: Read
- Identity: Read
- Service Connections: Read & query
- Task Groups: Read
- Variable Groups: Read
- Environment: Read & manage
- Deployment Groups: Read & manage, only if those collectors are enabled
- Packaging: Read, only if feeds are enabled

### Data minimization

- Do not export secret values from service connections or variable groups.
- Redact known secret patterns from logs and responses.
- Store only metadata for secure files.
- Exclude attachments and full build logs from `dashboard` mode by default.

### File security

- Database mode: `0600` where supported.
- Export directory mode: `0700` where practical.
- Keep `.db`, `.db-wal`, `.db-shm`, `.db-journal`, staging, and backup files ignored by Git.
- Encrypt database backups if they leave the workstation or controlled runner.

### Auditability

- Record PAT scope probe outcomes, not PAT details.
- Record which collector was skipped and why.
- Record total objects and errors without logging sensitive payload content.

## 11. Usability and Dashboard Readiness

### CLI defaults

Recommended default command:

```text
npm run azure:export
```

Default behavior:

- Projects: `3_in_1_IT_Projects,3in1_Agile_Projects`
- Projects: `3_in_1_AppFrontEnd_Tasks,3in1_Agile_Projects`
- Mode: `dashboard`
- Output: `azure-data.db`
- No full logs or attachment bodies
- Resume if a compatible incomplete run exists
- Publish only on successful validation

### CLI output

Show:

- Run ID
- Mode and selected projects
- Current category/resource
- Counts and rate
- Retry/throttle information
- Errors summarized by type
- Final database path
- Completion status and duration

Do not print every PR child endpoint. Write detailed progress to a log or status table, and keep terminal output concise.

### Dashboard query layer

Provide stable SQL views rather than forcing the dashboard to parse raw JSON. Suggested views:

- `v_project_overview`
- `v_team_workload`
- `v_work_item_cycle_time`
- `v_pr_activity`
- `v_build_health`
- `v_release_health`
- `v_test_health`
- `v_data_freshness`
- `v_export_errors`

## 12. Quality Assurance Strategy

### Unit tests

- CLI argument validation
- project selection
- URL construction and encoding
- continuation-token handling
- retry decisions
- error classification
- data normalization
- redaction behavior
- temp-file cleanup
- atomic publication

### Contract tests

- Recorded Azure responses for 200, 400, 401, 403, 404, 409, 429, 500, and 503.
- Verify exact mapping to complete, partial, unsupported, or failed outcomes.
- Test unusual names, spaces, Unicode, and special characters in project/team/ref names.

### Integration tests

- Use a disposable SQLite file.
- Run a small fixture graph through all collectors.
- Verify normalized tables, foreign keys, summaries, and indexes.
- Simulate interruption and ensure the active database remains valid.

### Data reconciliation tests

For representative fixtures, compare:

- API item count versus normalized row count
- parent-child references
- requested project boundaries
- duplicate IDs
- deleted/missing records
- final summary counts

### End-to-end tests

- A read-only smoke test against both requested projects.
- A bounded canary with one team, one repository, and one recent work-item range.
- A scheduled full validation in a controlled environment.

## 13. DevOps and Operations

### Recommended commands

- `npm run azure:export`
- `npm run azure:export:full`
- `npm run azure:export:smoke`
- `npm run azure:verify`
- `npm run azure:query -- --view project_overview`

### Scheduling

- Dashboard mode: periodically, only after acceptance of data freshness needs.
- Full reconciliation: less frequently, during low-usage hours.
- Immediate retry: only for transient throttling/network errors.
- Permission errors: do not retry repeatedly; notify operators.

### CI checks

1. lint
2. type/module syntax check
3. unit tests
4. recorded-contract tests
5. SQLite migration test
6. secret scan
7. ignored-output check
8. optional read-only live smoke test with a dedicated test PAT

### Deployment

- Keep PATs in CI secret stores or a managed secret service.
- Use a dedicated, low-privilege export identity.
- Restrict access to generated SQLite files.
- Store backups according to organizational retention rules.

### Monitoring

Track:

- successful/partial/failed run count
- run duration
- request count and records written
- API throttle/retry count
- error count by classification
- active database age
- per-project freshness
- database size and growth trend

## 14. Business Analysis and Dashboard Requirements

Before collecting every endpoint, define the first dashboard questions. Recommended initial outcomes:

### Executive/project overview

- Active project health
- Work-item totals and state distribution
- Completed versus overdue work
- Recent work by team and assignee
- Data freshness and missing permission indicators

### Engineering productivity

- PR count, cycle time, review delay, merge rate
- Build success/failure rate and duration
- Pipeline execution frequency
- Release frequency and outcomes
- Commit activity by repository/branch

### Quality

- Test plan and suite coverage
- Test pass/fail trends
- Failed tests by area
- Regression volume by iteration

### Governance

- Export completeness
- Scope/permission gaps
- Resource access failures
- High-risk or stale identities
- Resource configuration drift

Define a small metric glossary before UI implementation:

- source field
- formula
- filter rules
- timezone
- update cadence
- owner
- known limitations

## 15. Roadmap

### Phase 0 — Stabilize (1–2 days)

- Remove pipeline preview requests from standard export.
- Keep the two-project scope as the default.
- Validate SQLite staging cleanup and atomic publication.
- Keep current broad collectors functional.
- Add clear completion/partial/failure statuses.
- Add command summaries instead of per-child terminal spam.

Exit criteria:

- Repeated smoke tests leave one valid active database and no temp files.
- Script syntax, schema checks, and secret-scan checks pass.
- Team member, Graph, Identity, Dashboard, and environment capability statuses are clear.

### Phase 1 — Simplify persistence (3–5 days)

- Stop rebuilding the whole database after every endpoint.
- Write normalized records directly to a staging SQLite database.
- Add `exports`, `sync_steps`, `sync_cursors`, and `export_errors` tables.
- Move in-memory `document.data` to bounded buffers.
- Add schema versioning and foreign-key validation.

Exit criteria:

- Database write time scales linearly with fetched data.
- A bounded smoke run stays within an agreed memory limit.

### Phase 2 — Dashboard mode (5–8 days)

- Define the dashboard data contract and metric glossary.
- Add `dashboard` mode with normalized entities only.
- Create dashboard views and summary tables.
- Defer logs, attachments, raw diffs, and deep forensic records by default.

Exit criteria:

- Dashboard can answer the initial product questions using SQL tables/views, not ad hoc JSON parsing.
- One project refresh completes predictably under the defined time budget.

### Phase 3 — Reliability and resumability (4–7 days)

- Add bounded concurrency and host-aware rate limiting.
- Implement run resume and per-resource cursors.
- Add transient error classification and deterministic retries.
- Add exact freshness/completeness reports per project/category.

Exit criteria:

- Simulated interruption resumes without re-fetching completed scopes.
- Previous valid database remains active if a new run fails.

### Phase 4 — Incremental synchronization (1–2 weeks)

- Implement change-aware work-item, build, PR, release, and test collectors.
- Add periodic full reconciliation for deletions and drift.
- Add retention and compaction for raw data.

Exit criteria:

- Routine refresh requests and duration are substantially lower than a full run.
- Periodic reconciliation still produces the same normalized truth set.

### Phase 5 — Production operations (ongoing)

- CI/CD and scheduled export runner
- secure secret integration
- backup and restore procedure
- monitoring and alerts
- database encryption decision
- dashboard integration and performance tuning

Exit criteria:

- Export operation is documented, owned, monitored, and recoverable without manual intervention.

## 16. Risk Register and Mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| PAT exposed in chat, logs, or repository | High | Revoke immediately, rotate, use secret storage, add secret scanning |
| Export grows too large or runs too long | High | Dashboard mode, incremental sync, retention, bounded deep fetching |
| Permission changes cause silent incompleteness | High | Capability probes, scope diagnostics, completion flags |
| Interrupt corrupts active database | High | Staging database, validation, atomic rename |
| SQLite writer blocks dashboard reads | Medium | Publish immutable snapshots; readers open the active database read-only |
| Azure throttling slows/fails export | Medium | Rate limits, `Retry-After`, jitter, bounded concurrency |
| Sensitive content enters dashboard dataset | High | Data minimization, redaction, access controls, encrypted backups |
| Azure schema/API changes break collectors | Medium | Contract tests, error classification, versioned collectors |
| Dashboard relies on unstable raw JSON | High | Normalized schema, stable SQL views, migration tests |
| Deletion is not captured during incremental sync | High | Scheduled full reconciliation |
| Overly broad PAT creates operational risk | High | Separate app and read-only dashboard PATs with least privilege |

## 17. Recommended Prioritization

Priority order:

1. Correctness and non-destructive publication
2. Security and PAT/data minimization
3. Dashboard-ready schema
4. Reliable progress/resume behavior
5. Performance and incremental sync
6. Additional forensic completeness

The current “fetch everything” approach should not be the default. The sustainable approach is:

- Fetch everything required for the dashboard quickly and repeatedly.
- Fetch optional forensic detail only when explicitly requested.
- Preserve a capability/error record for anything the PAT or Azure API cannot expose.

## 18. Definition of Done

The transformation is complete when all of the following are true:

- Both requested projects are explicitly scoped.
- The default mode is read-only `dashboard` mode.
- `azure-data.db` is atomically replaced only after validation.
- No temporary SQLite files remain after completion, failure, or interruption cleanup.
- The active database schema is versioned and documented.
- Dashboard queries do not depend on parsing arbitrary scope JSON.
- Every run records completeness, duration, counts, and classified errors.
- The exporter can resume after interruption.
- Routine refreshes are incremental.
- PAT scopes are automatically probed and summarized.
- Automated tests cover transport, persistence, redaction, interruption, and reconciliation.
- Generated databases are Git-ignored and access-controlled.
- `3_in_1_IT_Projects` and `3in1_Agile_Projects` can be monitored independently.
- `3_in_1_AppFrontEnd_Tasks` and `3in1_Agile_Projects` can be monitored independently.

## 19. Immediate Recommended Next Change

Before further endpoint expansion, implement Phase 1: direct SQLite staging writes with bounded memory. This addresses the largest architectural weakness and will reduce runtime, memory use, and checkpoint overhead. Then implement `dashboard` mode before expanding any additional forensic collectors.

This sequence minimizes complexity, improves usability, and creates a stable foundation for the future dashboard.
