# Codebase Architecture & Operational Boundaries Survey Report: `new-app/`

## 1. Observation

### 1.1 Directory Structure & Framework Reality
While the dispatch mission prompt referenced `(Next.js/Node studio)` and asked for Next.js router type (App vs Pages) and React version, direct static analysis of `/Users/yashsomani/Desktop/Asure Bord Project/new-app/package.json` (lines 1-54) and the filesystem shows that **`new-app/` is NOT a Next.js or React application**.
- **Package Name & Version**: `"name": "azure-3in1-task-creator"`, `"version": "2.0.0"` (`package.json:2-3`).
- **Module System**: `"type": "module"` (ESM), Node.js target ≥ 22 (`package.json:5,38`).
- **Runtime Dependencies**: Strictly three production dependencies (`package.json:48-52`):
  - `express`: `^5.2.1`
  - `dotenv`: `^18.0.6`
  - `cors`: `^2.8.6`
- **Development Tooling**:
  - `typescript`: `^5.7.3`
  - `tsx`: `^4.19.3`
  - `vitest`: `5.0.5` & `@vitest/coverage-v8`: `5.0.5`
  - `eslint`: `10.12.0` & `prettier`: `^3.0.0`
- **Frontend Architecture**: A dependency-free, high-performance vanilla Single-Page Application (SPA) located at `/Users/yashsomani/Desktop/Asure Bord Project/new-app/src/presentation/web/public/`:
  - `index.html` (803 lines, 47.9 KB): Semantic HTML5 shell, 10 distinct view sections, 6 modals, and 1 execution console drawer.
  - `styles.css` (832 lines, 29.0 KB): Custom CSS custom-property design system with dark/light themes, responsive grid, and accessible typography.
  - `app.js` (2,830 lines, 110.8 KB): Vanilla ES6+ client controller with reactive view renderers, client-side SWR caching, Server-Sent Events (SSE) log ingestion, and Chart.js integration (via CDN `chart.umd.min.js@4.4.8`).

### 1.2 Architectural Layers & Code Topology
The backend is designed according to **Hexagonal (Ports & Adapters) Architecture** and **Domain-Driven Design (DDD)**:

```
new-app/
├── src/
│   ├── index.ts                     # CLI Entry Point & Process Runner
│   ├── container.ts                 # Composition Root & DI Wiring
│   ├── domain/                      # Pure Business Rules (Zero External I/O)
│   │   ├── entities/
│   │   │   ├── person.ts            # Person Aggregate & Identity Resolution
│   │   │   └── task.ts              # WorkItem, Relation Whitelists, Title Parsers
│   │   ├── value-objects/
│   │   │   └── date-window.ts       # Date Math, UTC/Wall-Clock Conversion, Jitter
│   │   ├── services/
│   │   │   ├── task-services.ts     # Discovery, Duplication, FieldCopy, RelationCopy
│   │   │   └── github-service.ts    # EMU Username Derivation, PR Formatting
│   │   ├── ports/
│   │   │   └── repositories.ts      # Interfaces for WorkItem, Config, Journal, Lock, Scheduler
│   │   └── index.ts                 # Domain Exports Barrel
│   ├── application/                 # Orchestration & Use Cases
│   │   └── use-cases/
│   │       ├── create-tasks.ts      # Multi-person plan execution & reconciliation
│   │       ├── plan-tasks.ts        # Dry-run task planning
│   │       ├── explore-tasks.ts     # Date coverage matrix & burndown statistics
│   │       ├── close-daily-tasks.ts # EOD task closure with PR deliverables
│   │       ├── repair-relations.ts  # Idempotent link repair for partial items
│   │       ├── get-status.ts        # Azure DevOps connectivity & project validation
│   │       └── config.ts            # People, settings, and PAT configuration
│   ├── infrastructure/              # Adapters & Platform Integrations
│   │   ├── azure/
│   │   │   ├── client.ts            # AzureDevOpsClient with retry backoff & 429 guard
│   │   │   └── work-item-service.ts # AzureWorkItemService implementing WorkItemRepository
│   │   ├── github/
│   │   │   └── github-client.ts     # GitHubClient with EMU & PR deliverable queries
│   │   ├── config/
│   │   │   └── file-config-repo.ts  # Atomic file writer & precedence resolver
│   │   ├── journal/
│   │   │   └── file-journal-repo.ts # Append-only task journal & 10MB archiver
│   │   ├── lock/
│   │   │   └── file-lock-repo.ts    # Single-host execution lock with PID liveness check
│   │   ├── logging/
│   │   │   └── logger.ts            # Ring-buffer logger with secret scrubbing & SSE
│   │   ├── scheduler/
│   │   │   └── node-scheduler-repo.ts# Dual-timer weekday automation & auto-close
│   │   └── security/
│   │       └── tls-safety.ts        # Strict TLS verification enforcer
│   └── presentation/                # Presentation Layer
│       ├── api/
│       │   ├── server.ts            # Express 5 server, Basic Auth, CSP, ListenHost
│       │   ├── routes.ts            # Express Router with 19 REST endpoints
│       │   └── request-origin.ts    # Origin / Fetch-Metadata anti-CSRF guard
│       └── web/public/              # Static Frontend Assets
│           ├── index.html
│           ├── styles.css
│           └── app.js
├── tests/                           # 31 Vitest Test Suites (349 tests)
│   ├── unit/                        # 14 unit test suites
│   ├── integration/                 # 17 integration test suites
│   ├── browser/                     # Playwright headless UI journey regression
│   └── fixtures/                    # Mock data & restart probes
├── scripts/                         # Operational & Preflight Verification Scripts
│   ├── staging-readonly-verify.mjs  # Read-only HTTP staging diagnostics
│   ├── state-backup.mjs             # Offline non-secret backup/verify/restore tool
│   ├── verify-azure-schema.mjs      # Work item type & schema field preflight
│   ├── verify-azure-identities.mjs  # Read-only Azure VSSPS account lookup
│   └── verify-azure-workitems.mjs   # Bounded read-only WIQL task series check
├── people.json                      # Configured team roster & connection settings
└── .env.example                     # Environment configuration reference
```

### 1.3 UI Views and Client Components
Analysis of `index.html` (lines 84-577) and `app.js` (lines 1-2830) confirms 10 top-level views:
1. **Dashboard (`#view-dashboard`)**: Connection status, KPIs (connection, team size, rolling window, daily scheduler), Smart Insights card, Chart.js effort trend and status distribution charts, today's plan preview, recent activity timeline.
2. **My Work (`#view-mywork`)**: Personal work-item view filtered by member, displaying active tasks, progress, hours, and direct Azure DevOps links.
3. **Task Explorer (`#view-explorer`)**: Interactive multi-user date matrix, preset filters (Current Week, Next Week, Sprint, Last 14 Days, Custom Range), individual cell inspection, and missing task creation trigger.
4. **Daily Burndown (`#view-burndown`)**: Monthly matrix of completed vs remaining hours and effort allocations per person.
5. **Plan & Create (`#view-planner`)**: Previews eligible tasks for the rolling creation window (today through Thursday), displays duplicate detection status, source task linkage, and explicit creation execution.
6. **Scheduler (`#view-scheduler`)**: Background automation dashboard, next run countdown, persistent toggle, run time picker, and manual "Run Now" trigger.
7. **Team Management (`#view-people`)**: Roster editor for adding/modifying team members, assigned identities, roles, PODs, custom title prefixes, and GitHub repository/branch scope overrides.
8. **Audit Log (`#view-journal`)**: Complete journal of historical task creations and closures, verification statuses, CSV/JSON export, and relation repair triggers.
9. **Live Logs (`#view-logs`)**: Real-time streaming log console powered by Server-Sent Events (SSE) with log level filters.
10. **Settings (`#view-settings`)**: Organization, project, timezone, schedule time, Thursday shift mode, Azure DevOps PAT management, and GitHub Enterprise integration settings.

**Modals & Drawers** (`index.html:580-795`):
- `#executionDrawer`: Live slide-out terminal console for real-time operation output.
- `#dateInspectModal`: Detailed inspection of all work items for a specific date and member.
- `#userInspectModal`: Comprehensive overview of all tasks for a specific user across a date window.
- `#confirmModal`: Mandatory explicit confirmation dialog before any mutating action.
- `#personModal`: Form for adding or editing team member configurations.
- `#adHocModal`: Custom single-task generation modal with optional source ID and estimates.
- `#eodModal`: End-of-Day EOD task closure preview, PR deliverable review, and confirmation dialog.

### 1.4 API Endpoints Map
Analysis of `src/presentation/api/routes.ts` (lines 75-561) reveals 19 endpoints:
- `GET /api/session`: Returns current authenticated role (`operator` vs `viewer`).
- `GET /api/health`: Unauthenticated process liveness check (`{ status: 'alive' }`).
- `GET /api/ready`: Authenticated read-only Azure DevOps readiness check (503 when unavailable).
- `GET /api/status`: Connection, project, work-item type, and PAT health report.
- `GET /api/config`: Reads configuration (PAT and tokens masked).
- `POST /api/config/people`: Saves updated team roster (validates unique identities).
- `POST /api/config/settings`: Updates general settings and GitHub credentials.
- `POST /api/config/pat`: Saves Azure DevOps PAT with automatic secret scrubbing registration.
- `POST /api/tasks/plan`: Previews upcoming task creation (read-only; accessible to viewers).
- `POST /api/tasks/execute`: Executes Azure task creation (requires `confirm: true` and explicit member scope).
- `POST /api/tasks/adhoc`: Creates a single ad-hoc task with duplicate protection.
- `POST /api/tasks/repair`: Idempotently repairs missing relations on partially created tasks.
- `POST /api/tasks/close-today`: Executes or previews EOD task closure with PR evidence (dryRun accessible to viewers).
- `GET /api/explorer`: Queries multi-user task matrix and burndown stats across date ranges.
- `POST /api/explorer/create-missing`: Evaluates and creates missing tasks discovered via the explorer.
- `GET /api/journal`: Queries recent audit log entries and unfinished relation counts.
- `GET /api/journal/export`: Streams audit journal as CSV (formula-injection safe) or JSON download.
- `GET /api/scheduler`: Returns background scheduler status, next run, and next auto-close time.
- `POST /api/scheduler/toggle`: Starts or stops background automation with persistence flag.
- `POST /api/scheduler/config`: Updates schedule run time, auto-close window, and auto-start settings.
- `POST /api/scheduler/run-now`: Manually triggers scheduled task creation immediately (`confirm: true`, `all: true`).
- `POST /api/scheduler/trigger-autoclose`: Manually triggers EOD closure immediately (`confirm: true`, `all: true`).
- `GET /api/github/test-user`: Tests GitHub username resolution and fetches PR deliverables for a member.
- `GET /api/logs/recent`: Returns recent structured log entries from the in-memory ring buffer.
- `GET /api/logs/stream`: Real-time SSE endpoint streaming scrubbed log entries to the UI.

### 1.5 CLI Commands
Defined in `src/index.ts` (lines 18-290):
1. `serve`: Launches web dashboard and API server on configured port (default 3000).
2. `plan`: Previews task creation in CLI (dry-run mode).
3. `run`: Executes task creation (requires `--all` or `--person`, plus `--yes` for non-interactive).
4. `daemon`: Starts the background scheduler process in unattended mode.
5. `close-today`: Closes today's tasks using Azure workflow rules (`--dry-run` or `--all`/`--person` + `--yes`).
6. `repair`: Repairs incomplete relationship copies (`--yes` required).
7. `help`: Displays CLI usage and argument documentation.

### 1.6 Verification Execution Evidence
Ran the official project build, typecheck, and test commands from `/Users/yashsomani/Desktop/Asure Bord Project/new-app`:
1. `npm run typecheck` (`tsc --noEmit`): **Exited code 0**. Zero type errors.
2. `npm run lint` (`eslint "src/**/*.ts"`): **Exited code 0**. Zero lint violations.
3. `npm test` (`vitest run`): **Exited code 0**. 31 test files passed, 349 tests passed in 2.06s.
4. `npm run test:schema && npm run test:identities && npm run test:workitems` (`node --test`): **Exited code 0**. 19 node tests passed in 183ms.

---

## 2. Logic Chain

### 2.1 End-to-End Task Creation Workflow
1. **Source Discovery**:
   - `CreateTasksUseCase.execute()` or `PlanTasksUseCase.execute()` takes an input specifying target members (`personKeys` or `all: true`).
   - `TaskDiscoveryService` queries Azure DevOps using WIQL in `AzureWorkItemService.findLatestTaskForPerson()` (`src/infrastructure/azure/work-item-service.ts:75-105`), filtering by project, work item type, and `System.AssignedTo`.
   - The discovered source task is validated for ownership via `validateSourceTaskOwnership()` (`src/domain/entities/task.ts:352-387`) to ensure it matches the configured task series prefix, project, and assignee.
2. **Date Window Planning**:
   - `DatePlanningService.planForPerson()` invokes `planCreationDates()` (`src/domain/value-objects/date-window.ts:209-275`).
   - The planning window calculates from `todayIso` (configured timezone, e.g. `Asia/Kolkata`) through the next stop day (Thursday) via `getNextThursdayIso()`.
   - Weekend days (Saturday, Sunday) are marked as `WEEKEND_SKIP`.
   - Existing tasks for each person across the window are fetched via `AzureWorkItemService.getExistingTasksForPerson()`. If a task already exists for a date, it is marked as `DUPLICATE_ALREADY_EXISTS` or `MULTIPLE_EXISTING_TASKS`.
   - Only days with status `PLANNED` proceed to creation.
3. **Execution & Field Cloning**:
   - `TaskExecutionService.executeTask()` calls `FieldCopyService.buildFieldPatchOperations()` (`src/domain/services/task-services.ts:123-272`).
   - Mandatory fields are injected: `System.Title` (`<Prefix> | <MMM DD>`), `System.AssignedTo`, `System.State` (`New`), and start/end dates converted from local wall-clock (09:30 - 18:30) to UTC ISO timestamps via `zonedTimeToUtcIso()`.
   - Planned start/end dates are populated on `Custom.PlannedStartdate` and `Custom.PlannedEnddate`.
   - Estimates are copied if `copyEstimates` is enabled; `CompletedWork` is reset to 0, and `RemainingWork` is set to `OriginalEstimate` if `resetActualWork` is enabled.
   - Lifecycle, revision, watermarks, attachment counts, and historical date fields are strictly excluded via a blacklist set (`task-services.ts:197-227`).
4. **Creation with Reconciliation**:
   - `AzureWorkItemService.createWorkItemWithReconciliation()` sends a JSON Patch (`POST /${project}/_apis/wit/workitems/$${type}`) to Azure DevOps. If a duplicate item was created concurrently, it reconciles with the existing item.
5. **Relation Whitelisting & Preservation**:
   - `RelationCopyService.copyRelations()` filters relations using `filterCopyableRelations()` (`src/domain/entities/task.ts:119-131`).
   - Safe copyable types: Parent (`Hierarchy-Reverse`), Related, Dependency Forward/Reverse, Predecessor/Successor, Duplicate Forward/Reverse, Hyperlink, and ArtifactLink.
   - Strictly excluded: Child (`Hierarchy-Forward`) to prevent reparenting source children, and `AttachedFile` binary attachments.
6. **Independent Read-Back Verification & Audit Trail**:
   - `CreateTasksUseCase.verifyCreatedTask()` (`src/application/use-cases/create-tasks.ts:135-168`) performs an independent `GET` read-back of the created work item from Azure DevOps, verifying that title, assignee, type, state, planned start time, and all expected relations match.
   - Results are recorded in `FileJournalRepository` (`.task-journal.json`), logging `runId`, `personKey`, `targetIsoDate`, `createdWorkItemId`, `fieldCopyStatus`, `relationCopyStatus`, and `verified: boolean`.
   - The single-host lock (`FileLockRepository`) is released upon completion.

### 2.2 End-of-Day (EOD) Task Auto-Closure Workflow
1. `CloseDailyTasksUseCase.execute()` (`src/application/use-cases/close-daily-tasks.ts:82-250`):
   - Acquires the execution lock.
   - Discovers candidate work items for the target date across enabled team members.
   - Matches work items against each member using `matchesPerson()` and `parseWorkItemTaskDate()`. Tasks already in state `Closed` or `Resolved` are flagged as `already_closed`.
2. **GitHub Evidence Ingestion**:
   - For active tasks, `GitHubClient.getPrDeliverablesForDate()` queries GitHub API for pull requests authored by the member on that date.
   - Member emails are deterministically mapped to GitHub Enterprise Managed User (EMU) logins using `deriveGitHubUsernameFromEmail(email, suffix)` (e.g. `yash.somani@bajajfinserv.in` -> `yash-somani_bflghec`).
   - PR deliverables and authored commits (scoped to allowlisted repos/branches) are formatted into HTML using `formatPrTaskDescription()` (`src/domain/services/github-service.ts:72-115`).
   - If zero PRs are found, the system explicitly logs that no PR evidence was found rather than inventing completion.
3. **Azure Workflow Transition & Closure**:
   - Computes randomized closure timestamp between `autoCloseStartTime` (18:15) and `autoCloseEndTime` (18:45) clamped to current wall-clock time (`computeTaskCloseTimestamp()`).
   - Builds patch operations setting `System.State = 'Closed'`, `Microsoft.VSTS.Scheduling.CompletedWork` (preserving recorded hours), `RemainingWork = 0`, `ActualEndDate`, and rich-text HTML description.
   - Executes patch via `AzureWorkItemService.patchWorkItem()` adhering strictly to Azure DevOps project workflow rules (`bypassRules: false`).
   - Records outcome in the audit journal and updates scheduler's `lastAutoClose` timestamp.

---

## 3. Caveats & Architectural Gaps

1. **Single-Host Concurrency Constraint**:
   - The file lock (`FileLockRepository` in `.execution-lock.json`) uses process PID and random ownership tokens. While robust against orphaned dead-process locks on a single host, it is **not a distributed lock**. Running multiple instances (e.g., across multiple containers or servers) sharing the same state directory or running concurrent schedulers is unsupported and could lead to race conditions.
2. **In-Memory Scalability Limits**:
   - The journal repository (`FileJournalRepository`) reads and writes the entire `.task-journal.json` array into memory. While rotation at 10 MB or 10,000 entries prevents runaway growth by moving older entries to `.journal-archives/`, extremely large audit histories will require moving to SQLite or PostgreSQL if entry volume grows by orders of magnitude.
   - WIQL queries in `work-item-service.ts` fetch candidate batches up to a safety ceiling of 5,000 work items. For enterprise projects with tens of thousands of tasks in a single iteration, query pagination with continuation tokens would be required.
3. **Secret Storage in Production**:
   - When running in `NODE_ENV=production`, `file-config-repo.ts` enforces `SECRET_STORAGE_MODE=external` by default (`lines 252-259`), which refuses to write PATs to `.env` through the web UI form. In production, credentials (`AZURE_DEVOPS_PAT`, `GITHUB_TOKEN`, `API_AUTH_TOKEN`) must be provisioned externally through environment variables or secret managers (e.g., Azure Key Vault).
4. **Basic Authentication & Reverse Proxy Dependency**:
   - HTTP Basic Authentication (`basicAuth` in `server.ts`) protects the web UI and API. Without an HTTPS reverse proxy (such as Nginx, Caddy, or Azure Application Gateway), credentials travel encoded in base64. The server deliberately binds to `127.0.0.1` by default to prevent unintentional plaintext exposure on public network interfaces.
5. **Team Configuration Starting State**:
   - The checked-in `people.json` contains a sample team roster with 1 configured member (`yash_somani`). Background scheduling and automatic EOD closure are disabled by default (`schedulerEnabled: false`, `autoClose: false`). Operators must configure real tenant identities and explicitly approve automation before enabling unattended daemons.

---

## 4. Conclusion & Enumerated Feature Inventory

### 4.1 Architectural Summary
The `new-app/` codebase is a cleanly structured, production-hardened Node.js/Express 5.2.1 application. It strictly enforces Hexagonal Architecture with complete separation of concerns:
- **Pure domain logic** for date arithmetic, identity matching, title parsing, field exclusions, and relation whitelisting.
- **Robust operational safety** with atomic file writes, secret scrubbing across all log sinks, anti-CSRF/Origin guards, strict TLS enforcement, and non-replayable write requests on network failure.
- **Zero test failures**: 349 Vitest tests and 19 Node sub-tests pass with 100% success rate, and TypeScript compile checks succeed with 0 errors.

### 4.2 Comprehensive Enumerated Feature Inventory

#### Core Domain & Planning Features
1. **Dynamic Task Series Resolution**: Configurable per-member and global task series prefix (`3in1_PWA_MyAccount |`, POD prefixes).
2. **Multi-Segment Title Date Parsing**: Resolves dates from diverse title formats (`Prefix | MMM DD`, `Prefix | DD Month`, `DD-MM-YYYY`, etc.) anchored against Azure recorded dates.
3. **Rolling Workday Window Planning**: Computes dates from today to the next stop day (Thursday by default), supporting `CURRENT` and `FOLLOWING` Thursday shift modes.
4. **Weekend & Holiday Skipping**: Automatically skips Saturdays and Sundays during task planning.
5. **Multi-User Duplicate Detection**: Identifies existing work items by prefix, assignee, and date, flagging duplicates (`DUPLICATE_ALREADY_EXISTS`, `MULTIPLE_EXISTING_TASKS`).
6. **Safe Field Cloning**: Copies scalar fields and identity references while strictly excluding audit timestamps, revision watermarks, child links, and attachment counters.
7. **Safe Relation Whitelisting**: Preserves Parent (`Hierarchy-Reverse`), Related, Dependency, and Link relations while strictly blocking Child (`Hierarchy-Forward`) to prevent hierarchy corruption.
8. **Independent Read-Back Verification**: Reads back newly created work items from Azure DevOps to verify field values, state, start dates, and link counts before asserting success.
9. **Idempotent Relation Repair**: Detects partially created tasks in the journal and re-copies only missing links without duplicating existing relations.

#### Automation & End-of-Day (EOD) Features
10. **Dual-Timer Background Scheduler**: Manages morning task creation (default 09:30) and evening auto-closure (18:15-18:45) in the configured IANA timezone.
11. **Persistent Scheduler State**: Preserves enabled status and schedule configuration across server restarts via `FileConfigRepository`.
12. **Scheduler Heartbeat & Missed Run Recovery**: Evaluates missed schedules on startup and during continuous operation.
13. **EOD Task Closure Engine**: Finds daily tasks for team members and executes transition to `Closed` using Azure project workflow rules (`bypassRules: false`).
14. **GitHub Enterprise EMU Integration**: Resolves corporate emails to GitHub Enterprise Managed User logins (e.g. `user@bajajfinserv.in` -> `user_bflghec`).
15. **PR Deliverable Evidence Extraction**: Fetches PRs authored by members on the target date and generates structured HTML descriptions for work items.
16. **Randomized Closure Jitter**: Generates realistic closure timestamps between 18:15 and 18:45 IST clamped to current time to prevent future-date errors.
17. **Durable EOD Checkpoint**: Persists attempt records to prevent repeated automatic retries on failed or empty scans.

#### User Interface Views & Controls
18. **Interactive Dashboard**: Real-time status cards, rolling window KPI, effort trend chart, status distribution chart, and quick plan preview.
19. **Task Explorer Matrix**: Cross-tabulation of team members vs dates, showing cell statuses (`CREATED`, `MISSING`, `DUPLICATE`, `WEEKEND_SKIP`).
20. **Preset Explorer Ranges**: One-click filters for Current Week, Next Week, Sprint (14 days), and custom date pickers.
21. **My Work View**: Member-specific task view showing assigned work items, status badges, and direct links to Azure DevOps.
22. **Daily Burndown Matrix**: Monthly effort aggregation tracking completed hours, remaining work, and daily allocations.
23. **Plan & Create Studio**: Interactive plan generator with per-cell and batch execution triggers.
24. **Team Management Roster**: CRUD interface for team members with duplicate identity detection and POD prefix configuration.
25. **Settings Management Studio**: Configuration panel for Azure organization, project, timezone, Thursday mode, PAT, and GitHub settings.
26. **Audit Journal Explorer**: Searchable and filterable table of past task creations, status badges, and repair buttons.
27. **CSV / JSON Audit Export**: Instant export of audit trails with spreadsheet formula-injection mitigation.
28. **Live SSE Log Console**: Streaming terminal drawer and full-page log monitor with real-time log level filtering.
29. **Theme Toggle**: Built-in dark/light mode toggle with persistent CSS custom properties.

#### Operational & Security Boundaries
30. **Role-Based Session Management**: Distinguishes between `operator` (read-write) and `viewer` (read-only preview) roles via HTTP Basic Auth.
31. **Origin & CSRF Guard**: Inspects `Origin` and `Sec-Fetch-Site` headers on all mutating HTTP methods (`POST`, `PUT`, `PATCH`, `DELETE`).
32. **Localhost Ingress Binding**: Binds to `127.0.0.1` by default to prevent accidental plaintext network exposure.
33. **Strict TLS Enforcement**: Fails startup if insecure TLS bypass flags are set (`ALLOW_INSECURE_TLS` or `NODE_TLS_REJECT_UNAUTHORIZED=0`).
34. **Automated Secret Scrubbing**: Redacts PATs, GitHub tokens, and Base64 auth headers from console, file, and SSE log outputs.
35. **Atomic File Storage**: Writes files via temporary files (`.tmp`) with `fsync` before renaming to prevent corrupted configuration on crash.
36. **Single-Host Exclusive Lock**: Prevents overlapping execution runs with PID liveness verification.
37. **Rate Limit & Transient Retry**: Automatic exponential backoff on HTTP 429 and 5xx errors for replay-safe read requests.
38. **Offline State Backup & Restore Tool**: Dedicated CLI script (`scripts/state-backup.mjs`) to package and restore state bundles with SHA-256 manifests.

---

## 5. Verification Method

To independently verify all findings in this survey report without mutating remote Azure DevOps or GitHub data, execute the following commands from the target directory (`/Users/yashsomani/Desktop/Asure Bord Project/new-app`):

### 5.1 Static Verification & TypeScript Typecheck
```bash
cd "/Users/yashsomani/Desktop/Asure Bord Project/new-app"
npm run typecheck
# Expected: tsc --noEmit completes with exit code 0.
```

### 5.2 Code Quality & Linting
```bash
npm run lint
# Expected: eslint "src/**/*.ts" completes with exit code 0.
```

### 5.3 Automated Unit & Integration Test Suites
```bash
npm test
# Expected: Vitest runs all 31 test files in tests/unit and tests/integration.
# Output: 31 passed (31), 349 tests passed.
```

### 5.4 Node Offline Test Suites
```bash
npm run test:schema
npm run test:identities
npm run test:workitems
# Expected: All 3 suites pass with 19 total offline test cases verified.
```

### 5.5 Inspect Files Referenced in this Report
- `package.json`: Lines 1-54 (Express 5.2.1, 3 runtime dependencies, no Next.js).
- `src/index.ts`: Lines 1-45, 149-289 (CLI command routing).
- `src/container.ts`: Lines 40-141 (Composition root and dependency injection).
- `src/presentation/api/server.ts`: Lines 23-56 (Role-based Basic Auth), 70-80 (CSP headers), 110-114 (Origin guard), 150-162 (127.0.0.1 bind).
- `src/presentation/api/routes.ts`: Lines 75-560 (19 API endpoints).
- `src/presentation/web/public/index.html`: Lines 27-53 (10 UI view buttons), 84-577 (10 view sections), 580-795 (drawers and modals).
- `src/domain/services/task-services.ts`: Lines 122-272 (Field copy rules), 278-320 (Relation copy and repair).
- `src/infrastructure/security/tls-safety.ts`: Lines 6-14 (Strict TLS verification assertion).

### 5.6 Invalidation Conditions
The observations in this report would be invalidated if:
1. `package.json` is modified to introduce Next.js or React dependencies.
2. A database (e.g. PostgreSQL or SQLite) is introduced to replace the filesystem-based state repository.
3. The server is configured to bind directly to public interfaces without an authenticating reverse proxy.
4. Mutation endpoints are modified to allow calls without explicit member scope or confirmation flags.
