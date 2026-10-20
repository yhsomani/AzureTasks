# Handoff Report: Live Integration Architecture & Mutation Guardrails

**Agent:** `teamwork_preview_explorer_survey_2`  
**Date:** 2026-10-19T05:45:00Z  
**Integrity Mode:** development  
**Working Directory:** `/Users/yashsomani/Desktop/Asure Bord Project/new-app`  
**Status:** Complete (Hard Handoff)

---

## 1. Observation

Direct code and configuration inspection of `/Users/yashsomani/Desktop/Asure Bord Project/new-app` revealed the following exact files, configurations, endpoints, queries, and mutation surfaces.

### 1.1 Credential & Configuration Management

1. **`.env` Configuration File (`new-app/.env`)**:
   - `AZURE_DEVOPS_PAT` (lines 1): Encrypted/raw Personal Access Token (`***REDACTED***`).
   - `AZURE_DEVOPS_ORG` (line 2): `"BFLDevOpsOrg"`.
   - `AZURE_DEVOPS_PROJECT` (line 3): `"3in1_Agile_Projects"`.
   - `AZURE_DEVOPS_TIMEZONE` (line 4): `"Asia/Kolkata"`.
   - `WORK_ITEM_TYPE` (line 8): `"3in1 Task"`.
   - `TASK_SERIES` (line 9): `"3in1_PWA_MyAccount"`.
   - `TITLE_PREFIX` (line 10): `"3in1_PWA_MyAccount |"`.
   - `AUTO_CLOSE` (line 15): `"true"`.
   - `GITHUB_TOKEN` (line 23): GitHub Personal Access Token (`***REDACTED***`).
   - `GITHUB_USER_SUFFIX` (line 24): `"_bflghec"`.
   - `GITHUB_ORG` (line 25): `"3in1-AppFrontEnd"`.
   - `NODE_EXTRA_CA_CERTS` (line 27): `"/Users/yashsomani/Desktop/Asure Bord Project/new-app/certs/zscaler.pem"`.

2. **Roster & Settings (`new-app/people.json`)**:
   - Defines target organization: `"BFLDevOpsOrg"` (line 2).
   - Target project: `"3in1_Agile_Projects"` (line 3).
   - Work item type: `"3in1 Task"` (line 4).
   - GitHub Org: `"3in1-AppFrontEnd"` (line 9), suffix: `"_bflghec"` (line 10).
   - Roster members: `yash_somani` (`yash.somani@bajajfinserv.in`), pod `"108_My Account Part 2"`, title prefix `"108_My Account Part 2"`, `githubRepositories: []`, `githubBranches: []` (lines 12–23).
   - Automation defaults: `"schedulerEnabled": false`, `"schedulerAutoStart": false`, `"autoClose": false` (lines 24–27).

3. **Configuration Repository (`src/infrastructure/config/file-config-repo.ts`)**:
   - Class `FileConfigRepository` implements `ConfigRepository` (lines 17–323).
   - Method `load()` (lines 30–119) loads `people.json`, validates unique member identities (`seenIdentities`, lines 84–95), and merges environment overrides via `loadEnvOverrides()` (lines 277–292).
   - Secret protection: `delete data.githubToken;` (line 166) prevents persisting secrets to `people.json`.
   - `savePat()` (line 244) delegates to `saveEnvVariable('AZURE_DEVOPS_PAT', pat)` (lines 248–275) with atomic write `writeAtomically()` (lines 146–161) and verifies `SECRET_STORAGE_MODE`.

4. **Composition Root (`src/container.ts`)**:
   - Method `buildApp()` (lines 44–141) initializes configuration, registers credentials with secret scrubbing logger `logger.registerSecret(pat)` (line 59) and `logger.registerSecret(ghToken)` (line 62).
   - Instantiates `client = new AzureDevOpsClient(config)` (line 70).
   - Instantiates `workItemRepo = new AzureWorkItemService(client, () => config.timezone)` (line 72).
   - Instantiates `githubClient = new GitHubClient(...)` (lines 78–83).

---

### 1.2 Azure DevOps Integration Analysis

1. **Client Core (`src/infrastructure/azure/client.ts`)**:
   - Class `AzureDevOpsClient` (lines 29–253).
   - Base URL: `https://dev.azure.com` (line 46).
   - Authentication: HTTP Basic Auth with PAT:
     ```typescript
     // line 59
     `Basic ${Buffer.from(`:${this.pat}`).toString('base64')}`
     ```
   - Target URL format: `${this.baseUrl}/${this.organization}${path}` (line 73).
   - Replay safety gate:
     ```typescript
     // lines 77-78
     const replaySafe = method === 'GET' ||
       (method === 'POST' && /\/_apis\/wit\/wiql(?:\?|$)/i.test(path));
     ```
   - Rate limit (HTTP 429) & 5xx retry: Only retries when `replaySafe === true`. Non-replay-safe write requests throw `AzureClientError` immediately to prevent duplicate mutations (lines 114–116, 130–132, 182–184).

2. **Azure Work Item Service (`src/infrastructure/azure/work-item-service.ts`)**:
   - Class `AzureWorkItemService` implements `WorkItemRepository` (lines 28–599).
   - **Validation & Read-Only Endpoints**:
     - `validateProject(project)`: `GET /_apis/projects/${project}?api-version=7.0` (line 43).
     - `validateWorkItemType(project, workItemType)`: `GET /${project}/_apis/wit/workitemtypes/${encodeURIComponent(workItemType)}?api-version=7.0` (lines 47–49).
     - `getWorkItem(id)`: `GET /_apis/wit/workitems/${id}?$expand=relations&api-version=7.0` (lines 473–475).
     - Batch fetch: `GET /${project}/_apis/wit/workitems?ids=${chunk}&$expand=relations&api-version=7.0` (lines 126, 245, 365, 459).
   - **WIQL Queries Used in Code**:
     - *WIQL 1: Single Person Source Task Discovery* (lines 75–83):
       ```sql
       SELECT [System.Id], [System.Title], [System.AssignedTo], [System.CreatedDate]
       FROM WorkItems
       WHERE [System.TeamProject] = '${this.escapeWiql(project)}'
         AND [System.WorkItemType] = '${this.escapeWiql(workItemType)}'
         AND [System.State] <> 'Removed'
         AND ([System.AssignedTo] = '${this.escapeWiql(personIdentity)}' OR [System.AssignedTo] CONTAINS '${this.escapeWiql(personIdentity)}')
       ORDER BY [System.CreatedDate] DESC, [System.Id] DESC
       ```
     - *WIQL 2: Title Prefix Fallback* (lines 92–100):
       ```sql
       SELECT [System.Id], [System.Title], [System.AssignedTo], [System.CreatedDate]
       FROM WorkItems
       WHERE [System.TeamProject] = '${this.escapeWiql(project)}'
         AND [System.WorkItemType] = '${this.escapeWiql(workItemType)}'
         AND [System.Title] CONTAINS '${this.escapeWiql(titlePrefix)}'
         AND [System.State] <> 'Removed'
       ORDER BY [System.CreatedDate] DESC, [System.Id] DESC
       ```
     - *WIQL 3: Team Source Discovery Query* (lines 201–208):
       ```sql
       SELECT [System.Id], [System.Title], [System.AssignedTo], [System.CreatedDate]
       FROM WorkItems
       WHERE [System.TeamProject] = '${this.escapeWiql(project)}'
         AND [System.WorkItemType] = '${this.escapeWiql(workItemType)}'
         AND [System.State] <> 'Removed'
         AND [System.AssignedTo] IN (${assignedEmails})
       ORDER BY [System.CreatedDate] DESC, [System.Id] DESC
       ```
     - *WIQL 4: Duplicate Detection Query* (lines 308–316):
       Targeted by person identity and date window.
     - *WIQL 5: Candidate Tasks for Explorer & EOD* (lines 405–421):
       Selects `[System.Id]` filtered by project, type, active states, and assignee list or title prefix.
     - *WIQL 6: Existing Task Check by Title and Assignee* (lines 563–570).
   - **Team, Iteration, and Hierarchy / Tree Handling**:
     - *Teams*: Synced between local `people.json` roster and Azure DevOps identities. Azure REST endpoint: `GET /_apis/projects/${project}/teams?api-version=7.0`.
     - *Iterations*: Read from existing work items via `sourceWorkItem.fields['System.IterationPath']` (`src/domain/services/task-services.ts:191`). Azure REST endpoint: `GET /${project}/_apis/work/teamsettings/iterations?api-version=7.0`.
     - *Trees / Work Item Links*: Work items are fetched with `$expand=relations`. Relations are filtered by `COPYABLE_RELATION_TYPES` (`'System.LinkTypes.Hierarchy-Reverse'`, `'System.LinkTypes.Hierarchy-Forward'`, `'System.LinkTypes.Related'`) in `src/domain/entities/task.ts:18–20`, preserving parent User Story / Feature hierarchies.
   - **Remote Mutation Operations in Azure DevOps**:
     - *Creation*: `createWorkItemWithReconciliation(...)` (line 478):
       `POST /${project}/_apis/wit/workitems/$${encodeURIComponent(workItemType)}?api-version=7.0` with `Content-Type: application/json-patch+json`.
     - *Relation Copying*: `copyRelations(...)` (line 512):
       `PATCH /_apis/wit/workitems/${targetId}?api-version=7.0` with `[ { op: 'add', path: '/relations/-', value: ... } ]`.
     - *Modification / Closure*: `patchWorkItem(...)` (line 583):
       `PATCH /_apis/wit/workitems/${id}${qs}` with `Content-Type: application/json-patch+json`.

---

### 1.3 GitHub Integration Analysis

1. **Client Implementation (`src/infrastructure/github/github-client.ts`)**:
   - Class `GitHubClient` (lines 17–351).
   - Default API URL: `https://api.github.com` (line 25).
   - Authentication: HTTP Bearer header:
     ```typescript
     // line 339
     headers.Authorization = `Bearer ${this.token}`;
     ```
   - Target Org: `3in1-AppFrontEnd` (from `.env` line 25 and `people.json` line 9).
   - SDK / Octokit: No external SDK is used; uses native `fetch` over REST API v3.
   - GraphQL: Not used.
2. **REST Endpoints Queried**:
   - User Email Search: `GET /search/users?q=${encodeURIComponent(normalizedEmail)}+in:email` (line 70).
   - Commit Author Search Fallback: `GET /search/commits?q=author-email:${encodeURIComponent(normalizedEmail)}&sort=author-date&order=desc` with preview header `Accept: application/vnd.github.cloak-preview+json` (lines 87–88).
   - Pull Request Search: `GET /search/issues?q=${encodeURIComponent(query)}&sort=created&order=desc&per_page=${limit}&page=${page}` (lines 144–146), where query includes `type:pr author:${username} org:${org} created:${from}..${to}`.
   - Scoped Commits Query: `GET /repos/${repo}/commits?author=${username}&since=${since}&until=${until}&per_page=100&page=${page}` (lines 231–235).
3. **Domain Formatting (`src/domain/services/github-service.ts`)**:
   - `deriveGitHubUsernameFromEmail(email, suffix)`: EMU derivation formula `email.split('@')[0].replace(/\./g, '-') + suffix` (e.g. `yash.somani@bajajfinserv.in` -> `yash-somani_bflghec`).
   - `formatPrTaskDescription(...)`: Formats HTML containing PR links, numbers, repositories, and merge statuses.
4. **Mutation Operations in GitHub**:
   - **ZERO mutation operations exist.** `GitHubClient` implements only `request<T>` with HTTP GET. There are no POST, PATCH, PUT, or DELETE methods, no issue/PR creation, comment creation, or tag creation.

---

### 1.4 Mutation Guardrail Analysis

All potential mutation entry points across CLI, Web API, and Background Jobs were mapped:

| Entry Point | Target Method | Target External System | Guardrail Present | Safe Execution Mode |
|---|---|---|---|---|
| CLI `npm start -- run` | `CreateTasksUseCase.execute` | Azure DevOps (Creates work items) | Yes (`--dry-run`) | Use `npm start -- plan` or `npm start -- run --dry-run` |
| CLI `npm start -- close-today` | `CloseDailyTasksUseCase.execute` | Azure DevOps (Patches state to 'Closed') | Yes (`--dry-run`) | Use `npm start -- close-today --dry-run --all` |
| CLI `npm start -- repair` | `RepairRelationsUseCase.execute` | Azure DevOps (Patches relations) | Requires `--yes` | Do NOT run without checking uncopied relations |
| HTTP POST `/api/tasks/execute` | `createTasks.execute` | Azure DevOps (Creates work items) | Requires `confirm: true` | Pass `{"dryRun": true}` |
| HTTP POST `/api/tasks/adhoc` | `createTasks.executeAdHocTask` | Azure DevOps (Creates work items) | Requires `confirm: true` | **NO dry-run supported; DO NOT INVOKE** |
| HTTP POST `/api/tasks/close-today` | `closeDailyTasks.execute` | Azure DevOps (Patches state to 'Closed') | Requires `confirm: true` | Pass `{"dryRun": true}` |
| HTTP POST `/api/tasks/repair` | `repairRelations.execute` | Azure DevOps (Patches relations) | Requires `confirm: true` | **NO dry-run supported; DO NOT INVOKE** |
| HTTP POST `/api/explorer/create-missing`| `createTasks.execute` | Azure DevOps (Creates work items) | Requires `confirm: true` | **NO dry-run flag passed; DO NOT INVOKE** |
| Background Scheduler | `schedulerRepo.scheduleDaily` | Azure DevOps (Creates work items) | Disabled in config | Ensure `schedulerEnabled: false` |
| Background EOD Closure | `schedulerRepo.scheduleAutoCloseDaily`| Azure DevOps (Closes work items) | Disabled in config | Ensure `schedulerEnabled: false` |
| Local State Writes | `file-config-repo`, `file-journal-repo` | Local filesystem (`people.json`, `.env`) | None | Do not invoke config/pat mutation APIs |

**Key Built-In Guardrail Mechanisms**:
1. **Application-Level Dry-Run**:
   - In `CreateTasksUseCase.execute`: `if (input.dryRun) { return this.buildOutput(finalPlans, new Map()); }` (line 227). Bypasses lock acquisition and task creation completely.
   - In `CloseDailyTasksUseCase.execute`: `if (isDryRun)` skips `patchWorkItem`, returns `status: 'simulated'`, and avoids updating audit journals or Azure DevOps.
2. **Naturally Plan-Only Modules**:
   - `PlanTasksUseCase` (`src/application/use-cases/plan-tasks.ts`): Queries source tasks and duplicates, computes date matrix, but has no reference or call to `createWorkItemWithReconciliation`.
   - `ExploreTasksUseCase` (`src/application/use-cases/explore-tasks.ts`): Pure read-only matrix builder.
3. **Role-Based API Guardrail (`src/presentation/api/server.ts:38–51`)**:
   - Configurable `API_VIEWER_USER` and `API_VIEWER_TOKEN`. When authenticating as a viewer, Express blocks all POST/PUT/PATCH/DELETE calls with HTTP 403 Forbidden, except read-only previews: `['/api/tasks/plan', '/api/tasks/close-today']` (with `dryRun: true`).
4. **Script-Level Read-Only Preflights (`scripts/verify-azure-*.mjs`)**:
   - `scripts/verify-azure-schema.mjs`: Read-only GETs to inspect `3in1 Task` fields and states.
   - `scripts/verify-azure-identities.mjs`: Read-only GETs to VSSPS identity API.
   - `scripts/verify-azure-workitems.mjs`: Read-only WIQL query and batch GET with strict read-only guarantees.

---

## 2. Logic Chain

The architecture of `new-app/` separates query orchestration, domain planning, and remote persistence into distinct layers.

1. **Step 1: Ingestion & Resolution (Observations 1.1.1, 1.1.2, 1.1.4)**
   - Configuration is loaded from `people.json` and `.env`.
   - Azure DevOps PAT and GitHub Token are registered with the secret scrubber and injected into `AzureDevOpsClient` and `GitHubClient`.
   - Target tenant is locked to `organization: BFLDevOpsOrg`, `project: 3in1_Agile_Projects`, `githubOrg: 3in1-AppFrontEnd`.

2. **Step 2: Read-Only Work Item & Hierarchy Discovery (Observations 1.2.1, 1.2.2)**
   - When checking existing tasks or planning, `AzureWorkItemService` issues read-only WIQL queries (POST to `/_apis/wit/wiql?api-version=7.0`).
   - Azure DevOps returns work item IDs, which are fetched in chunks of 100 via `GET /_apis/wit/workitems?ids=...&$expand=relations&api-version=7.0`.
   - Hierarchy and tree relations are inspected in memory (`COPYABLE_RELATION_TYPES`) without modifying the remote graph.

3. **Step 3: GitHub PR & Activity Retrieval (Observations 1.3.1, 1.3.2, 1.3.3)**
   - When generating EOD descriptions or checking PR activity, `GitHubClient.resolveUserByEmail` resolves corporate emails to GitHub logins via deterministic EMU suffix matching (`_bflghec`) or GitHub search.
   - It queries `GET /search/issues?q=type:pr author:... org:3in1-AppFrontEnd created:...`.
   - Pull requests are formatted into HTML descriptions in pure memory (`formatPrTaskDescription`).

4. **Step 4: Mutation Interception & Guardrail Gating (Observations 1.4.1, 1.4.2)**
   - All mutations terminate at three specific functions in `AzureWorkItemService`: `createWorkItemWithReconciliation`, `copyRelations`, and `patchWorkItem`.
   - In dry-run or plan mode, execution short-circuits before those functions are reached:
     - `PlanTasksUseCase` does not call them.
     - `CreateTasksUseCase` checks `input.dryRun` and exits at line 227.
     - `CloseDailyTasksUseCase` checks `input.dryRun` and skips line 277.
     - Web API routes `/api/tasks/execute` and `/api/tasks/close-today` require `confirm: true` before invoking mutations.

5. **Step 5: Zero-Mutation Guarantee (Observations 1.4.1, 1.4.2, 1.4.3)**
   - Because `GitHubClient` has no mutation methods and Azure DevOps client mutations are strictly isolated behind explicit confirmation / dry-run branches, live read connectivity can be verified with 100% certainty without modifying any remote work item or GitHub resource.

---

## 3. Caveats

1. **Accidental Mutation Hazards**:
   - Calling `npm start -- run --yes --all` or `npm start -- run` without `--dry-run` or selecting "Confirm" in the CLI will immediately create real work items in Azure DevOps.
   - Calling `POST /api/tasks/adhoc` with `confirm: true` has NO dry-run mode and will immediately create a work item.
   - Calling `POST /api/tasks/repair` with `confirm: true` or `npm start -- repair --yes` will patch relation links on existing Azure work items.
   - If `AUTO_CLOSE="true"` in `.env` is paired with `schedulerEnabled: true` or `schedulerAutoStart: true` in `people.json`, unattended background tasks could mutate work items between 18:15 and 18:45 IST. (In current `people.json`, `schedulerEnabled` is `false`).

2. **Network & Corporate TLS Interception**:
   - The environment uses corporate SSL interception (Zscaler). All scripts and Node processes must retain `NODE_EXTRA_CA_CERTS="/Users/yashsomani/Desktop/Asure Bord Project/new-app/certs/zscaler.pem"`.
   - `assertTlsSafety()` enforces this rule and will throw a fatal error if `NODE_TLS_REJECT_UNAUTHORIZED=0` or `ALLOW_INSECURE_TLS=true` is set.

3. **Token Scopes & Rate Limits**:
   - Azure DevOps PAT requires `vso.work` (Work Items Read) for safe read verification. If `vso.identity` is absent, `verify-azure-identities.mjs` will fail with HTTP 401/403.
   - GitHub Token requires `repo` (for private repo commit search) and `read:org`. GitHub Search API enforces a strict rate limit of 30 requests per minute.

4. **Assumptions Made**:
   - Target Azure DevOps organization `BFLDevOpsOrg` and project `3in1_Agile_Projects` are accessible with the active PAT.
   - Target GitHub organization `3in1-AppFrontEnd` is accessible with the active GitHub token.

---

## 4. Conclusion & Actionable Safe Verification Plan

To verify live read connectivity against Azure DevOps (teams, iterations, work item trees) and GitHub (PR activity) with **ZERO remote mutations**, execute the following structured verification suite.

### Phase A: Azure DevOps Live Read Verification (Zero Mutation)

1. **Verify Work Item Schema & Creation States (Read-Only)**:
   ```bash
   NODE_EXTRA_CA_CERTS="/Users/yashsomani/Desktop/Asure Bord Project/new-app/certs/zscaler.pem" \
   AZURE_DEVOPS_ORG="BFLDevOpsOrg" \
   AZURE_DEVOPS_PROJECT="3in1_Agile_Projects" \
   AZURE_DEVOPS_PAT="<PAT>" \
   node scripts/verify-azure-schema.mjs
   ```
   *Action*: Queries `GET /3in1_Agile_Projects/_apis/wit/workitemtypes/3in1%20Task` and `GET .../fields`. Reads fields and states without creating or modifying work items.

2. **Verify Project Teams & Iterations (Read-Only REST Query)**:
   ```bash
   # Teams Query
   curl -s -f -H "Authorization: Basic $(echo -n :$AZURE_DEVOPS_PAT | base64)" \
     "https://dev.azure.com/BFLDevOpsOrg/_apis/projects/3in1_Agile_Projects/teams?api-version=7.0"
   
   # Iterations Query
   curl -s -f -H "Authorization: Basic $(echo -n :$AZURE_DEVOPS_PAT | base64)" \
     "https://dev.azure.com/BFLDevOpsOrg/3in1_Agile_Projects/_apis/work/teamsettings/iterations?api-version=7.0"
   ```

3. **Verify Work Item Tree & Hierarchy Query (Read-Only WIQL Query)**:
   ```bash
   # Query Work Item Hierarchy / Trees
   curl -s -f -X POST \
     -H "Authorization: Basic $(echo -n :$AZURE_DEVOPS_PAT | base64)" \
     -H "Content-Type: application/json" \
     -d '{"query": "SELECT [System.Id], [System.Title], [System.WorkItemType] FROM WorkItemLinks WHERE ([Source].[System.TeamProject] = '\''3in1_Agile_Projects'\'' AND [Source].[System.WorkItemType] = '\''3in1 Task'\'') AND ([System.Links.LinkType] = '\''System.LinkTypes.Hierarchy-Forward'\'') MODE (Recursive)"}' \
     "https://dev.azure.com/BFLDevOpsOrg/3in1_Agile_Projects/_apis/wit/wiql?api-version=7.0"
   ```

4. **Verify Application Task Planning & Discovery in Dry-Run Mode**:
   ```bash
   npm start -- plan --all
   ```
   *Action*: Triggers `PlanTasksUseCase.execute()`. Connects to Azure DevOps, queries existing tasks, verifies candidate tasks, and prints the plan to the console. Zero work items are created or modified.

---

### Phase B: GitHub Live Read Verification (Zero Mutation)

1. **Verify Organization Access**:
   ```bash
   curl -s -f -H "Authorization: Bearer $GITHUB_TOKEN" \
     -H "Accept: application/vnd.github.v3+json" \
     "https://api.github.com/orgs/3in1-AppFrontEnd"
   ```

2. **Verify Repositories Query**:
   ```bash
   curl -s -f -H "Authorization: Bearer $GITHUB_TOKEN" \
     -H "Accept: application/vnd.github.v3+json" \
     "https://api.github.com/orgs/3in1-AppFrontEnd/repos?per_page=10"
   ```

3. **Verify Pull Request Activity Search**:
   ```bash
   curl -s -f -H "Authorization: Bearer $GITHUB_TOKEN" \
     -H "Accept: application/vnd.github.v3+json" \
     "https://api.github.com/search/issues?q=type:pr+org:3in1-AppFrontEnd&sort=created&order=desc&per_page=10"
   ```

4. **Verify EOD Task Closure Simulation (Dry-Run Mode)**:
   ```bash
   npm start -- close-today --dry-run --all
   ```
   *Action*: Discovers matched tasks, resolves GitHub user `yash-somani_bflghec`, queries recent PR deliverables, formats task descriptions, and outputs `[SIMULATED]` status. Skips Azure patching completely.

---

## 5. Verification Method

To independently reproduce the analysis and verify codebase health:

1. **Static Analysis & Typecheck**:
   ```bash
   cd "/Users/yashsomani/Desktop/Asure Bord Project/new-app"
   npm run typecheck
   ```
   *Observed Result*: Passed with 0 TypeScript compilation errors.

2. **Unit Test Suite**:
   ```bash
   cd "/Users/yashsomani/Desktop/Asure Bord Project/new-app"
   npm test
   ```
   *Observed Result*: 31 test files passed, 349 tests passed (duration: 3.20s). Includes tests verifying `azure-client`, `work-item-service`, `task-services`, `repositories`, `github-service`, `tls-safety`, and `ui-shell`.

3. **Preflight Script Unit Tests**:
   ```bash
   cd "/Users/yashsomani/Desktop/Asure Bord Project/new-app"
   npm run test:schema && npm run test:identities && npm run test:workitems
   ```
   *Observed Result*: 19 tests passed (3 schema, 8 identities, 8 workitems) confirming strict read-only bounded behavior and refusal of invalid responses.

4. **Configuration Check**:
   Inspect `new-app/people.json` lines 24–27 to verify `schedulerEnabled: false`, `schedulerAutoStart: false`, and `autoClose: false`.
