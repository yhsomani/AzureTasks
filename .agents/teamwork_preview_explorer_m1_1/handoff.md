# Milestone 1 (M1) Architecture & Operational Boundaries Verification Report

## 1. Observation

### 1.1 Architecture & Framework Reality: Codebase vs. Prompt Clarification
The initial user request (`ORIGINAL_REQUEST.md:13`) described the target system as:
> *"Analyse the architecture, workflows, modules, test suites, and operational boundaries of the new-app/ Next.js/Node studio."*

Direct static inspection of `/Users/yashsomani/Desktop/Asure Bord Project/new-app/package.json` (lines 1–54) and the codebase reveals that **`new-app/` is NOT a Next.js or React application**:
- **Package Manifest** (`package.json:2-9`):
  ```json
  "name": "azure-3in1-task-creator",
  "version": "2.0.0",
  "description": "Azure DevOps 3in1 Task Studio - task planning, creation, audit and automation",
  "type": "module",
  "main": "dist/index.js"
  ```
- **Runtime Environment**: Node.js target ≥ 22 (`@types/node`: `^22.13.5` in `package.json:38`), running ECMAScript Modules (ESM) natively (`"type": "module"`).
- **Production Runtime Dependencies** (`package.json:48-52`): Exactly **three** dependencies:
  ```json
  "dependencies": {
    "cors": "^2.8.6",
    "dotenv": "^18.0.6",
    "express": "^5.2.1"
  }
  ```
- **Zero Next.js / Zero React**:
  - `grep_search` across `new-app/src` for `from 'react'` or `from 'next'` yielded **0 results**.
  - `find_by_name` for `.jsx` or `.tsx` files in `new-app/src` returned **0 results**.
  - `package.json` contains no `next`, `react`, `react-dom`, `@next/...`, or `@types/react`.
- **TypeScript Configuration** (`tsconfig.json:1-20`):
  - `"target": "ES2022"`, `"module": "NodeNext"`, `"moduleResolution": "NodeNext"`, `"strict": true`.
  - Zero JSX compiler flags (no `"jsx"` option exists). Pure Node.js ESM compilation target.
- **Frontend Architecture**:
  - Rather than a Next.js server-rendered application, the frontend is a zero-dependency vanilla HTML5/CSS3 Single Page Application (SPA) served statically from `src/presentation/web/public/`:
    - `index.html` (803 lines, 47.9 KB): Semantic HTML5 markup, 10 view sections, 6 dialog modals, 1 slide-out execution drawer, and a CDN link to Chart.js (`https://cdn.jsdelivr.net/npm/chart.js@4.4.8/dist/chart.umd.min.js`).
    - `styles.css` (832 lines, 29.0 KB): Pure CSS custom properties design system with dark/light themes, accessible contrast, responsive layout.
    - `app.js` (2,830 lines, 110.8 KB): Vanilla ES6+ client controller with view routing, client-side SWR caching, Server-Sent Events (SSE) log ingestion, and Chart.js canvas renderers.

---

### 1.2 Hexagonal (Ports & Adapters) & Domain-Driven Design (DDD) Layering
Inspection of all 31 source files under `src/` establishes a rigorous Hexagonal architecture:

```
new-app/src/
├── index.ts                     # CLI Entry Point & Process Runner (assertTlsSafety)
├── container.ts                 # Composition Root & Dependency Injection Wiring
├── domain/                      # Pure Business Rules (Zero External I/O)
│   ├── index.ts                 # Domain Exports Barrel
│   ├── entities/
│   │   ├── person.ts            # Person Aggregate Root, Config & Identity Normalization
│   │   └── task.ts              # WorkItem, Relation Whitelists, Title Date Parsers
│   ├── value-objects/
│   │   └── date-window.ts       # Date Math, UTC/Wall-Clock Conversion, Jitter, Planning
│   ├── services/
│   │   ├── task-services.ts     # TaskDiscovery, DuplicateDetector, FieldCopy, RelationCopy, DatePlanning, TaskExecution
│   │   └── github-service.ts    # EMU Username Derivation, PR Description Formatting
│   └── ports/
│       └── repositories.ts      # Interfaces: WorkItemRepository, ConfigRepository, JournalRepository, SchedulerRepository, LockRepository
├── application/                 # Orchestration & Use Cases
│   └── use-cases/
│       ├── create-tasks.ts      # Multi-person plan execution, ad-hoc creation, read-back verification
│       ├── close-daily-tasks.ts # EOD task auto-closure with PR evidence & dry-run simulation
│       ├── explore-tasks.ts     # Multi-user date matrix & burndown data provider
│       ├── plan-tasks.ts        # Dry-run task planning engine (zero remote mutation)
│       ├── repair-relations.ts  # Idempotent relationship repair for partial tasks
│       ├── get-status.ts        # Azure DevOps connectivity & project validation
│       └── config.ts            # Settings, team roster management & masked PAT storage
├── infrastructure/              # Adapters & Platform Integrations
│   ├── azure/
│   │   ├── client.ts            # AzureDevOpsClient: exponential backoff & rate-limit guards
│   │   └── work-item-service.ts # AzureWorkItemService implementing WorkItemRepository
│   ├── github/
│   │   └── github-client.ts     # GitHubClient (GET only) with EMU & PR deliverable queries
│   ├── config/
│   │   └── file-config-repo.ts  # FileConfigRepository implementing ConfigRepository (atomic fsync)
│   ├── journal/
│   │   └── file-journal-repo.ts # FileJournalRepository implementing JournalRepository (10MB rotation)
│   ├── lock/
│   │   └── file-lock-repo.ts    # FileLockRepository implementing LockRepository (PID liveness check)
│   ├── logging/
│   │   └── logger.ts            # Logger with automated secret scrubbing, ring buffer, SSE sink
│   ├── scheduler/
│   │   └── node-scheduler-repo.ts # NodeSchedulerRepository implementing SchedulerRepository (dual timer)
│   └── security/
│       └── tls-safety.ts        # assertTlsSafety: rejects insecure TLS bypass flags
└── presentation/                # Presentation Layer
    ├── api/
    │   ├── server.ts            # Express 5 server, HTTP Basic Auth (RBAC), CSP, 127.0.0.1 bind
    │   ├── routes.ts            # Express Router with 19 REST endpoints (25 route handlers)
    │   └── request-origin.ts    # unsafeRequestOriginGuard (Origin & Sec-Fetch-Site anti-CSRF)
    └── web/public/              # Static Frontend Assets
        ├── index.html           # 10 views, 6 modals, 1 drawer
        ├── styles.css           # Vanilla CSS theme system
        └── app.js               # Vanilla SPA client controller
```

#### Layer-by-Layer Verification:
1. **Domain Layer (`src/domain/`)**:
   - `entities/person.ts` (199 lines): `PersonConfig`, `PersonIdentity`, identity extraction from Azure `AssignedTo` object/string, `matchesPerson` with exact match rules, `validatePerson` with GitHub repo/branch syntax validators, `Person` aggregate root class.
   - `entities/task.ts` (405 lines): `WorkItem`, `WorkItemFields`, `WorkItemRelation`. Whitelists 10 safe relations (`COPYABLE_RELATION_TYPES`: Parent `Hierarchy-Reverse`, Related, Dependency Forward/Reverse, Predecessor/Successor, Duplicate Forward/Reverse, Hyperlink, ArtifactLink). Excludes `Hierarchy-Forward` (Child) and `AttachedFile`. Implements multi-segment date parsing (`parseTitleDate`, `parseWorkItemTaskDate`), `matchesTaskSeries`, and `validateSourceTaskOwnership`.
   - `value-objects/date-window.ts` (295 lines): Pure functions for date arithmetic (`getTodayIso`, `getDayOfWeek`, `addDays`, `getNextThursdayIso`), timezone wall-clock conversion (`zonedTimeToUtcIso`), randomized EOD closure jitter (`computeTaskCloseTimestamp`), `planCreationDates`, and `validateNotPastDate`.
   - `services/task-services.ts` (420 lines): Pure domain services: `TaskDiscoveryService`, `DuplicateDetector`, `FieldCopyService` (with comprehensive 30+ field exclusion set), `RelationCopyService` (with idempotent `repairRelations`), `DatePlanningService`, and `TaskExecutionService`.
   - `services/github-service.ts` (116 lines): Pure domain functions: `deriveGitHubUsernameFromEmail` (maps e.g. `user@bajajfinserv.in` -> `user_bflghec`), `escapeHtml`, and `formatPrTaskDescription` (generates rich-text WIT description from PR/commit activity).
   - `ports/repositories.ts` (244 lines): Technology-agnostic interface definitions: `WorkItemRepository`, `ConfigRepository`, `JournalRepository`, `SchedulerRepository`, `LockRepository`, and type contracts.
   - **Architectural Dependency Direction**: Grep search confirms `src/domain/` imports **only** internal domain siblings (`../entities/...`, `../ports/...`, `../value-objects/...`). Zero imports from `application`, `infrastructure`, `presentation`, or third-party I/O packages.

2. **Application Layer (`src/application/use-cases/`)**:
   - `create-tasks.ts` (`CreateTasksUseCase`, lines 108–846): Orchestrates multi-person task creation, ad-hoc single task creation, duplicate checking, and independent read-back verification (`verifyCreatedTask` queries Azure DevOps to verify fields, state, and copied links).
   - `close-daily-tasks.ts` (`CloseDailyTasksUseCase`, lines 71–385): Discovers candidate daily work items, queries GitHub PR deliverables via `GitHubClient`, formats descriptions, applies Azure DevOps JSON patch with `bypassRules: false`, supports `dryRun` mode, and records results to audit journal.
   - `explore-tasks.ts` (`ExploreTasksUseCase`, lines 108–562): Multi-user intelligent date matrix provider with presets (`CURRENT_WEEK`, `NEXT_WEEK`, `LAST_14_DAYS`, `SPRINT`, `CURRENT_MONTH`), burndown statistics, and missing-task detection.
   - `plan-tasks.ts` (`PlanTasksUseCase`, lines 26–165): Generates a dry-run preview of upcoming task creation without creating or mutating any remote tasks.
   - `repair-relations.ts` (`RepairRelationsUseCase`, lines 28–102): Identifies partially created tasks from the audit journal and idempotently re-copies missing relations.
   - `get-status.ts` (`GetSystemStatusUseCase`, lines 22–69): Validates project and work item type accessibility against Azure DevOps; returns masked PAT health.
   - `config.ts` (`ConfigUseCases`, lines 33–136): Manages people roster, system settings, and masked PAT persistence with identity duplication guards.
   - **Architectural Dependency Direction**: Application use cases depend solely on domain entities, domain services, and repository ports. They do not import from `presentation`.

3. **Infrastructure Layer (`src/infrastructure/`)**:
   - Adapters implement domain ports:
     - `azure/work-item-service.ts` implements `WorkItemRepository`.
     - `config/file-config-repo.ts` implements `ConfigRepository`.
     - `journal/file-journal-repo.ts` implements `JournalRepository`.
     - `lock/file-lock-repo.ts` implements `LockRepository`.
     - `scheduler/node-scheduler-repo.ts` implements `SchedulerRepository`.
   - Security and utility adapters:
     - `azure/client.ts`: Low-level HTTPS client with exponential backoff on 429/5xx and non-replayable write boundaries.
     - `github/github-client.ts`: Strictly HTTP GET only.
     - `logging/logger.ts`: Central logger with automated secret scrubbing and SSE streaming.
     - `security/tls-safety.ts`: Enforces TLS validation.

4. **Presentation Layer (`src/presentation/`)**:
   - `api/server.ts` (184 lines): Configures Express 5 app, security headers, anti-CSRF origin guard, HTTP Basic Auth (differentiating `operator` vs `viewer`), JSON body parsing, API routing, static file serving, SPA fallback, and default `127.0.0.1` binding.
   - `api/routes.ts` (561 lines): Maps 19 REST endpoints across 25 route handlers.
   - `api/request-origin.ts` (74 lines): `unsafeRequestOriginGuard` validates `Origin` and `Sec-Fetch-Site` headers on mutating requests (`POST`, `PUT`, `PATCH`, `DELETE`).
   - `web/public/` (`index.html`, `styles.css`, `app.js`): Zero-dependency vanilla frontend SPA.

5. **Composition Root & Entry Point**:
   - `src/container.ts` (lines 44–141): `buildApp()` assembles the dependency graph, loads configuration, registers secrets in the logger, instantiates adapters, injects them into use cases, wires scheduler callbacks, and handles auto-start.
   - `src/index.ts` (lines 1–314): Bootstraps environment via `dotenv.config()`, immediately calls `assertTlsSafety()`, parses CLI arguments (`serve`, `plan`, `run`, `daemon`, `close-today`, `repair`, `help`), and invokes the corresponding use case or starts the server.

---

### 1.3 UI Views, Controls & REST API Endpoints Map

#### Verified UI Views (10 Views in `index.html:84-577`):
| # | View ID | Title / Section | Description & Key Controls |
|---|---------|-----------------|-----------------------------|
| 1 | `#view-dashboard` | Dashboard | Status KPIs (connection, team size, rolling window, daily scheduler), Smart Insights card, Chart.js effort trend & status charts, today's plan preview, recent activity timeline. |
| 2 | `#view-mywork` | My Work | Personal work item view filtered by team member; displays active tasks, state badges, hours, and direct Azure DevOps links. |
| 3 | `#view-explorer` | Task Explorer | Interactive multi-user date matrix, preset filters (Current Week, Next Week, Sprint, Last 14 Days, Custom Range), cell inspection, and missing task creation trigger. |
| 4 | `#view-burndown` | Daily Burndown | Monthly matrix of completed vs remaining hours and effort allocations per person. |
| 5 | `#view-planner` | Plan & Create | Previews eligible tasks for the rolling creation window (today to Thursday), shows duplicate detection status, source task linkage, and execution trigger. |
| 6 | `#view-scheduler` | Scheduler | Background automation dashboard, countdown timer, persistent toggle, run time picker, manual "Run Now" trigger, and EOD auto-close trigger. |
| 7 | `#view-people` | Team Management | CRUD roster editor for team members, assigned identities, roles, PODs, title prefixes, and GitHub repository/branch scope overrides. |
| 8 | `#view-journal` | Audit Log | Searchable audit trail of historical creations and closures, verification statuses, CSV/JSON export, and relation repair trigger. |
| 9 | `#view-logs` | Live Logs | Real-time streaming log console powered by Server-Sent Events (SSE) with log level filtering (debug, info, warn, error). |
| 10 | `#view-settings` | Settings | Organization, project, timezone, schedule time, Thursday shift mode, Azure DevOps PAT management, and GitHub Enterprise integration settings. |

#### Verified Modals & Slide-Out Drawers (`index.html:580-795`):
- `#executionDrawer`: Slide-out live terminal drawer for real-time operation output.
- `#dateInspectModal`: Detailed inspection of all work items for a specific date and member.
- `#userInspectModal`: Comprehensive overview of all tasks for a specific user across a date window.
- `#confirmModal`: Mandatory explicit confirmation dialog before executing task creation in Azure DevOps.
- `#personModal`: Form for adding or editing team member configurations.
- `#adHocModal`: Custom single-task generation modal with optional source ID, estimates, and activities.
- `#eodModal`: End-of-Day task closure preview, PR deliverable review, and confirmation dialog.

#### Complete REST API Endpoints Map (`src/presentation/api/routes.ts`):
| # | Method | Path | Required Role | Mutation Guardrail / Constraints | Description |
|---|--------|------|---------------|----------------------------------|-------------|
| 1 | `GET` | `/api/session` | Any / Viewer | Read-only | Returns authenticated role (`operator` vs `viewer`). |
| 2 | `GET` | `/api/health` | Unauthenticated | Read-only | Process liveness check (`{ status: 'alive' }`). |
| 3 | `GET` | `/api/ready` | Authenticated | Read-only | Validates Azure DevOps connectivity (503 if down). |
| 4 | `GET` | `/api/status` | Authenticated | Read-only | System health, project, work item type, and masked PAT report. |
| 5 | `GET` | `/api/config` | Authenticated | Read-only | Reads configuration with masked PAT and GitHub tokens. |
| 6 | `POST` | `/api/config/people` | Operator | Mutates `people.json` (atomic write) | Saves updated team roster; validates unique identities. |
| 7 | `POST` | `/api/config/settings` | Operator | Mutates `people.json` / `.env` | Updates timezone, schedule time, Thursday mode, GitHub settings. |
| 8 | `POST` | `/api/config/pat` | Operator | Mutates `.env` (atomic write) | Saves Azure DevOps PAT; immediately registers secret with logger. |
| 9 | `POST` | `/api/tasks/plan` | Viewer / Operator | **Read-only** preview | Previews upcoming task creation window without mutation. |
| 10 | `POST` | `/api/tasks/execute` | Operator | **Mutating**: Requires `confirm: true` | Executes Azure DevOps task creation for selected members. |
| 11 | `POST` | `/api/tasks/adhoc` | Operator | **Mutating**: Requires `confirm: true` | Creates a single ad-hoc task with duplicate protection. |
| 12 | `POST` | `/api/tasks/repair` | Operator | **Mutating**: Requires `confirm: true` | Idempotently repairs missing relations on partial tasks. |
| 13 | `POST` | `/api/tasks/close-today` | Viewer (`dryRun: true`) / Operator (`confirm: true`) | Mutating only if `dryRun !== true` | Previews or executes EOD task closure with PR evidence. |
| 14 | `GET` | `/api/explorer` | Authenticated | Read-only | Queries multi-user task matrix and burndown statistics. |
| 15 | `POST` | `/api/explorer/create-missing` | Operator | **Mutating**: Requires `confirm: true` | Creates missing tasks discovered via the explorer view. |
| 16 | `GET` | `/api/journal` | Authenticated | Read-only | Queries recent audit log entries and unfinished relation count. |
| 17 | `GET` | `/api/journal/export` | Authenticated | Read-only | Streams audit journal as CSV (formula-injection safe) or JSON. |
| 18 | `GET` | `/api/scheduler` | Authenticated | Read-only | Returns scheduler running status, next run, and next auto-close. |
| 19 | `POST` | `/api/scheduler/toggle` | Operator | Mutates scheduler state | Starts or stops background automation with persistence flag. |
| 20 | `POST` | `/api/scheduler/config` | Operator | Mutates scheduler config | Updates schedule run time, auto-close window, auto-start. |
| 21 | `POST` | `/api/scheduler/run-now` | Operator | **Mutating**: Requires `confirm: true`, `all: true` | Manually triggers scheduled task creation immediately. |
| 22 | `POST` | `/api/scheduler/trigger-autoclose` | Operator | **Mutating**: Requires `confirm: true`, `all: true` | Manually triggers EOD closure immediately. |
| 23 | `GET` | `/api/github/test-user` | Authenticated | Read-only | Tests GitHub EMU resolution and queries authored PRs. |
| 24 | `GET` | `/api/logs/recent` | Authenticated | Read-only | Fetches recent scrubbed log entries from ring buffer. |
| 25 | `GET` | `/api/logs/stream` | Authenticated | Read-only (SSE) | Real-time Server-Sent Events stream of scrubbed logs. |

---

### 1.4 Operational Boundaries & Security Controls

1. **Single-Host Exclusive Lock** (`src/infrastructure/lock/file-lock-repo.ts:15-108`):
   - Path: `.execution-lock.json`.
   - Uses `fs.writeFileSync(..., { flag: 'wx' })` for atomic lock acquisition.
   - Embeds PID (`process.pid`), ISO acquisition timestamp, and UUID owner token.
   - PID liveness check via `process.kill(pid, 0)` with `EPERM` error code handling.
   - Stale lock reclamation only occurs if the recorded process is dead.
   - Safe release: only the instance matching both `ownerToken` and `pid` can remove the lock.
   - Note: Designed exclusively for single-host deployments; not a distributed lock.

2. **Atomic File Storage & State Durability** (`src/infrastructure/config/file-config-repo.ts:149-160`, `src/infrastructure/journal/file-journal-repo.ts:158-174`):
   - Writes to a unique temporary file (`.tmp`) created with `0o600` permissions.
   - Issues `fs.fsyncSync(fd)` to flush bytes to physical storage before closing.
   - Replaces the target file atomically via `fs.renameSync()`.
   - Protects `people.json`, `.env`, and `.task-journal.json` against file corruption during process termination or power loss.
   - Auto-rotates `.task-journal.json` at 10 MB or 10,000 entries into `.journal-archives/`.
   - Protects CSV export against spreadsheet formula injection by prepending `'` to control characters (`[=+@-]|\t|\r|\n`).

3. **Strict TLS Enforcement** (`src/infrastructure/security/tls-safety.ts:6-14`):
   - `assertTlsSafety()` executes on process boot (`src/index.ts:16`).
   - Throws an unhandled exception if `ALLOW_INSECURE_TLS=true` or `NODE_TLS_REJECT_UNAUTHORIZED=0`.
   - Mandates that corporate proxies (e.g. Zscaler) be trusted via `NODE_EXTRA_CA_CERTS=certs/zscaler.pem`.

4. **Automated Secret Scrubbing** (`src/infrastructure/logging/logger.ts:28-53`):
   - Tokens (`AZURE_DEVOPS_PAT`, `GITHUB_TOKEN`, `API_AUTH_TOKEN`, `API_VIEWER_TOKEN`) registered on boot and upon API updates.
   - Generates permutations: raw token, `token <secret>`, `Bearer <secret>`, base64 encodings (`:<secret>`, `admin:<secret>`).
   - Redacts matched patterns with `***` across console stdout/stderr, 500-entry ring buffer, and SSE stream.
   - CLI raw output (`logger.raw`) is also scrubbed.

5. **Role-Based Access Control (RBAC)** (`src/presentation/api/server.ts:23-56`):
   - HTTP Basic Authentication distinguishes between `operator` (read-write) and `viewer` (read-only).
   - Viewer credentials block all mutating HTTP methods (`POST`, `PUT`, `PATCH`, `DELETE`) with HTTP 403 Forbidden.
   - Non-mutating preview endpoints (`POST /api/tasks/plan`, `POST /api/tasks/close-today` with `dryRun: true`) are permitted for viewers.
   - Constant-time secret comparison via `crypto.timingSafeEqual()`.
   - Enforces distinct tokens (`API_VIEWER_TOKEN !== API_AUTH_TOKEN`).

6. **Anti-CSRF & Request Origin Guard** (`src/presentation/api/request-origin.ts:11-73`):
   - Inspects `Origin` and `Sec-Fetch-Site` headers on all mutating HTTP methods.
   - Rejects `cross-site` requests and untrusted `same-site` without origin.
   - Enforces exact string equality with expected host or `CORS_ORIGIN`.

7. **Localhost Ingress Binding** (`src/presentation/api/server.ts:150-153`):
   - Server binds to `LISTEN_HOST=127.0.0.1` by default.
   - Prevents unencrypted HTTP traffic from binding public network interfaces without a reverse proxy.

8. **Strict Zero-Mutation Guardrails on External APIs**:
   - `GitHubClient` (`src/infrastructure/github/github-client.ts:330-349`): Only issues HTTP `GET` requests; zero mutating methods exist.
   - `AzureDevOpsClient` (`src/infrastructure/azure/client.ts:113-138`): Write operations throw non-replayable errors on HTTP 429 or 5xx, preventing duplicate task creation.
   - Mutating API endpoints require explicit `confirm: true` and member scope; CLI commands require `--all` or `--person` plus `--yes`.

---

### 1.5 Quality Gate Execution Results
All official test, lint, and typecheck commands were executed from `/Users/yashsomani/Desktop/Asure Bord Project/new-app`:

1. **TypeScript Typecheck** (`npm run typecheck` / `tsc --noEmit`):
   - **Exit code**: `0`.
   - **Violations**: `0`. Clean compilation.
2. **ESLint Code Quality** (`npm run lint` / `eslint "src/**/*.ts"`):
   - **Exit code**: `0`.
   - **Violations**: `0`. Clean linting.
3. **Vitest Automated Test Suites** (`npm test` / `vitest run`):
   - **Exit code**: `0`.
   - **Results**: 31 test files passed (100%), 349 tests passed (100%), 0 failed in 2.78s.
4. **Node Native Test Suites** (`npm run test:schema && npm run test:identities && npm run test:workitems`):
   - **Exit code**: `0`.
   - **Results**: 3 suites passed, 19 tests passed (100%), 0 failed in 179ms.

---

## 2. Logic Chain

1. **Origin of Prompt vs Codebase Divergence**:
   - `ORIGINAL_REQUEST.md` line 13 referred to the project as `new-app/ Next.js/Node studio`.
   - Static inspection of `package.json` reveals the actual dependency manifest has zero Next.js or React runtime packages.
   - The frontend was implemented as a pure vanilla Single Page Application (`index.html`, `styles.css`, `app.js`) served by Express 5.2.1.
   - This architectural choice eliminates JavaScript framework overhead, hydration delays, and bundle bloat while delivering instant load times and complete isolation from external frontend build toolchains.

2. **Strict Inward Dependency Enforcement in Hexagonal Architecture**:
   - The Domain layer contains the core business rules (`Person`, `Task`, date math, field copying, relation filtering).
   - Domain defines interfaces (`WorkItemRepository`, `ConfigRepository`, etc.) in `ports/repositories.ts`.
   - Infrastructure adapters implement these domain interfaces.
   - Application use cases depend only on Domain abstractions.
   - Grep verification confirms zero outward imports from Domain (`src/domain/` imports nothing from outer layers).
   - The presentation layer receives use cases via composition root dependency injection (`src/container.ts`).
   - Consequently, the core business rules are completely independent of UI frameworks, Express, Azure DevOps API versions, or filesystem quirks.

3. **Layered Operational Boundaries for Enterprise Production**:
   - **Startup Boundary**: `assertTlsSafety()` guarantees the process cannot run with disabled TLS certificate verification.
   - **Network Ingress Boundary**: `LISTEN_HOST=127.0.0.1` ensures the server never exposes unencrypted HTTP to public networks.
   - **Authentication Boundary**: Constant-time HTTP Basic Auth separates `operator` (read-write) from `viewer` (read-only).
   - **Anti-CSRF Boundary**: Origin and Fetch-Metadata validation stops cross-site browser attacks.
   - **Concurrency Boundary**: Single-host `.execution-lock.json` with PID checking prevents concurrent background workers.
   - **State Persistence Boundary**: Temp files with `fsync` and atomic rename protect configuration and audit journals from power-loss corruption.
   - **Audit Trail Boundary**: Every task creation is verified by an independent read-back `GET` request and recorded in `.task-journal.json`.
   - **Secret Protection Boundary**: All secrets are scrubbed from console, memory buffers, and SSE streams.

---

## 3. Caveats & Architectural Gaps

1. **Single-Host Concurrency Constraint**:
   - `FileLockRepository` uses local process PID checks (`process.kill(pid, 0)`). This is strictly a **single-host lock**. In multi-container, Kubernetes, or multi-server deployments, a distributed locking mechanism (e.g. Redis Redlock or database lock) would be required.
2. **In-Memory Journal & Batch Limits**:
   - `FileJournalRepository` loads `.task-journal.json` into memory as a JSON array. While rotation at 10 MB or 10,000 entries prevents runaway memory growth, high-throughput enterprise deployments will eventually benefit from an embedded SQLite or PostgreSQL database.
   - WIQL queries in `work-item-service.ts` fetch candidate batches up to 5,000 items. Projects with larger iterations would need continuation-token pagination.
3. **Production Secret Provisioning**:
   - In production (`NODE_ENV=production`), `SECRET_STORAGE_MODE=external` is enforced by default (`file-config-repo.ts:252-259`), blocking UI writes of PATs to `.env`. Production environments must inject credentials via environment variables or secret managers.
4. **Basic Authentication Over Plaintext HTTP**:
   - The built-in HTTP Basic Auth transmits base64-encoded credentials. It relies on binding to `127.0.0.1` and terminating HTTPS at an external reverse proxy (e.g. Nginx, Caddy, Azure App Gateway).
5. **Initial Configuration State**:
   - `people.json` contains a default roster with 1 team member (`yash_somani`) with automation disabled by default (`schedulerEnabled: false`, `autoClose: false`). Operators must configure tenant identities before enabling daemons.

---

## 4. Conclusion

The `new-app/` codebase is a verified **Node.js 22 ESM application powered by Express 5.2.1** and a **zero-dependency vanilla HTML5/CSS3 Single Page Application (SPA)**.
- **Zero Next.js / Zero React**: The initial prompt description of "(Next.js/Node studio)" is completely clarified — the codebase contains zero Next.js or React runtime dependencies.
- **Hexagonal Architecture**: Strict inward dependency flow is verified across all layers (Domain, Application, Infrastructure, Presentation) with complete isolation of pure business rules.
- **Full Use Case & Endpoint Coverage**: All 7 use cases, 10 UI views, 6 modals, 1 console drawer, and 19 REST endpoints (25 route handlers) are verified in code.
- **Operational Boundaries**: Single-host locking, atomic `fsync` writes, TLS safety, automated secret scrubbing, Basic Auth RBAC, anti-CSRF guards, localhost binding, and zero-mutation GitHub client are fully operational.
- **100% Quality Gate Success**: TypeScript typecheck (0 errors), ESLint (0 errors), Vitest (349/349 tests pass), and native node tests (19/19 tests pass) execute with zero failures.

---

## 5. Verification Method

To independently reproduce and verify all findings without mutating remote Azure DevOps or GitHub records:

### 5.1 Static Verification Commands
```bash
cd "/Users/yashsomani/Desktop/Asure Bord Project/new-app"

# 1. Typecheck: Verify clean TypeScript compilation
npm run typecheck
# Expected: Exit code 0, zero errors.

# 2. Lint: Verify ESLint code quality
npm run lint
# Expected: Exit code 0, zero warnings or errors.

# 3. Unit & Integration Tests: Verify Vitest test suite
npm test
# Expected: 31 test files passed, 349 tests passed.

# 4. Native Node Test Runners: Verify offline schema, identities, and work item suites
npm run test:schema && npm run test:identities && npm run test:workitems
# Expected: All 3 suites pass (19 offline tests).
```

### 5.2 Dependency & Framework Inspection
```bash
# Verify zero Next.js and zero React runtime dependencies:
cat package.json | grep -E "next|react"
# Expected: Empty output.

# Verify production dependencies:
node -e "const p = require('./package.json'); console.log(Object.keys(p.dependencies));"
# Expected: ['cors', 'dotenv', 'express']
```

### 5.3 Key Code Locations for Direct Review
- Architecture & Manifest: `package.json:1-54`, `tsconfig.json:1-20`.
- Composition Root: `src/container.ts:44-141`.
- CLI Entry & TLS Safety: `src/index.ts:1-314`, `src/infrastructure/security/tls-safety.ts:6-14`.
- Domain Entities & Ports: `src/domain/entities/person.ts:1-199`, `src/domain/entities/task.ts:1-405`, `src/domain/ports/repositories.ts:1-244`.
- Application Use Cases: `src/application/use-cases/create-tasks.ts:108-140`, `src/application/use-cases/close-daily-tasks.ts:71-100`, `src/application/use-cases/plan-tasks.ts:26-70`.
- Infrastructure Adapters: `src/infrastructure/azure/client.ts:110-180`, `src/infrastructure/github/github-client.ts:330-349`, `src/infrastructure/lock/file-lock-repo.ts:15-108`, `src/infrastructure/config/file-config-repo.ts:149-160`.
- Presentation Layer: `src/presentation/api/server.ts:23-56,150-165`, `src/presentation/api/routes.ts:80-530`, `src/presentation/web/public/index.html:27-53,580-795`.

### 5.4 Invalidation Conditions
This report is invalidated if:
1. `package.json` is modified to include Next.js or React runtime packages.
2. The domain layer introduces direct dependencies on infrastructure adapters, express, or external network I/O.
3. The single-host lock is executed concurrently across multiple hosts without distributed coordination.
4. Mutation endpoints are modified to allow task creation without explicit scope or confirmation flags.
