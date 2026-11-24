# Azure DevOps ALM Intelligence & Work Operations System Architecture

## 1. Overview & Dual Project Boundaries

WorkOps coordinates tasks, sprint planning, governance, and CI/CD operations across two dedicated Azure DevOps projects:

1. **`3in1_Agile_Projects` (Azure Tasks, Automations, Daily Workflow)**
   - **Purpose**: Backlog management, daily task generation, sprint allocation, auto-activation (morning/5:30 PM), and auto-closure (EOD).
   - **Key Entities**: Daily user stories/tasks, POD assignments, capacity management, work item hierarchy, links/relations, and closure journals.
   - **Automations**:
     - *Morning Activation*: Transitions target date tasks to `Active` and seeds PR evidence / deliverables description.
     - *EOD Closure*: Validates work evidence (GitHub PRs, commits, manual notes) against enterprise policy before transitioning tasks to `Closed`.

2. **`3_in_1_AppFrontEnd_Tasks` / `3_in_1_appfrontend` (Pipelines, Deployments, CI/CD)**
   - **Purpose**: Continuous Integration and Deployment, build pipelines, release gates, and artifact deployment.
   - **Telemetry Data**:
     - 218 Build Definitions & Pipelines.
     - 57,403 Build Executions.
     - 48,779 Pipeline Runs.
     - 9,116 Release Deployments.
     - Test run health, failure rate aggregations, duration percentiles.

---

## 2. Data Pipeline Architecture (`scripts/azure-export`)

The data pipeline extracts, normalizes, and indexes historical and operational metadata from Azure DevOps:

```
+-----------------------------------+
| Azure DevOps REST APIs (v7.1/v6.0)|
+-----------------------------------+
                  |
                  | (export-azure-readable-data.mjs)
                  v
       +--------------------+
       |  raw datasets      | (export_meta, datasets, sync_steps)
       +--------------------+
                  |
                  | (normalize.mjs / normalize-db.mjs)
                  v
       +--------------------+
       | Normalized SQLite  | (azure-data.db in WAL mode)
       +--------------------+
                  |
                  +---> azure_projects (2)
                  +---> azure_teams (247 PODs)
                  +---> azure_builds (57,403)
                  +---> azure_pipeline_runs (48,779)
                  +---> azure_releases (9,116)
                  +---> work_items & test_runs
```

### Normalization Workflow:
1. **Raw Ingestion**: Stored into `datasets` table with `project_name`, `scope`, and raw JSON `payload`.
2. **Schema Transformation**: `scripts/azure-export/normalize.mjs` applies relational schema (`schema.mjs`), resolving project keys, team POD metadata (LP, TA, SDM, QL, POD size), and indexing pipelines and builds.
3. **Execution**:
   ```bash
   node scripts/azure-export/normalize-db.mjs azure-data.db
   ```
4. **Verification Quality Gate**:
   ```bash
   node scripts/verify-azure-db.mjs azure-data.db
   ```
   Ensures PRAGMA integrity checks pass and composite query benchmarks execute in `< 15ms`.

---

## 3. GitHub PR Integration & Network Fallback Resilience

The system monitors PR deliverables via `GitHubClient` (`src/infrastructure/github/github-client.ts`).

### Resilient Behaviors:
1. **Enterprise Proxy & TLS**: Corporate inspection gateways (e.g. Zscaler) require valid CA trust bundles (`certs/zscaler.pem`) passed via `NODE_EXTRA_CA_CERTS`. Native TLS enforcement in `src/infrastructure/security/tls-safety.ts` ensures root certificates are validated securely without monkey-patching `NODE_TLS_REJECT_UNAUTHORIZED=0`.
2. **Graceful Upstream Error Handling**:
   - If GitHub API is unreachable, times out, or rate-limited:
     - `getDailyPullRequestsSummary` flags members as `UPSTREAM_ERROR` with `prCount: 0`.
     - In Daily Task Activation (`ActivateDailyTasksUseCase`), a network lookup failure falls back gracefully to standard activation descriptions rather than aborting or blocking daily progress.
     - Web UI (`useDailyWorkflow.ts`) catches PR lookup errors as non-blocking events and presents clear indicator states.

---

## 4. Workspaces & UI Components

The WorkOps platform is structured into four primary workspaces:

1. **Daily Workflow Cockpit (`DailyWorkflowWorkspace`)**:
   - 1-Click Action Bar: Morning Activation (`☀️`), EOD Closure Review (`🌙`), Ad-Hoc Task (`+`).
   - Daily Tasks backlog with state badges and expandable PR deliverables.
   - Live SSE logging and audit stream with auto-scroll and filtering.

2. **Team & Sprint Planning (`TeamPlanningWorkspace`)**:
   - Sprint window matrix, capacity planning, and holiday calendar exceptions.
   - Individual member overrides and leave configuration.

3. **Governance & Operations (`GovernanceWorkspace`)**:
   - Audit journal, scheduler status, relation repair diagnostics, and system settings.

4. **Azure DevOps ALM Intelligence (`AzureIntelligenceWorkspace`)**:
   - **Overview**: High-level telemetry, project status, recent pipeline executions.
   - **CI/CD Health**: Failure rates, build duration percentiles, definition search.
   - **Enterprise PODs**: Searchable directory of 247 teams with lead roles (LP, TA, SDM, QL) and module mappings.
   - **Unassigned Backlog**: Real-time filtering and triage of unassigned user stories and tasks.
