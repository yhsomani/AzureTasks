# Project: 3in1 Task Studio (new-app) Architecture, Live Read-Only Verification & Health Audit

## Architecture
- **Framework & Runtime**: Node.js (v22 ESM) with Express 5.2.1. Note: Clarified from initial user prompt description of "(Next.js/Node studio)" — the application contains zero Next.js or React dependencies; it is a high-performance Express 5 studio serving a dependency-free vanilla HTML5/CSS3 Single Page Application (SPA) from `src/presentation/web/public/`.
- **Design Pattern**: Hexagonal (Ports & Adapters) Architecture + Domain-Driven Design (DDD):
  - `src/domain/`: Pure business rules with zero external I/O (Entities: `Person`, `Task`; Value Objects: `DateWindow`; Domain Services: `TaskServices`, `GitHubService`; Ports: `repositories.ts`).
  - `src/application/`: Orchestration and use cases (`create-tasks`, `close-daily-tasks`, `explore-tasks`, `plan-tasks`, `repair-relations`, `get-status`, `config`).
  - `src/infrastructure/`: Technology adapters (`AzureDevOpsClient`, `AzureWorkItemService`, `GitHubClient`, `FileConfigRepository`, `FileJournalRepository`, `FileLockRepository`, `NodeSchedulerRepository`, `Logger`, `tls-safety`).
  - `src/presentation/`: Express REST API (`server.ts`, `routes.ts`, `request-origin.ts`) and Vanilla Web UI assets (`app.js`, `index.html`, `styles.css`).
- **Operational Boundaries**:
  - Single-host exclusive file lock with PID verification (`.execution-lock.json`).
  - Atomic file writes using temporary files (`.tmp`) and `fsync` before rename.
  - Strict TLS enforcement (rejects insecure flags like `ALLOW_INSECURE_TLS` or `NODE_TLS_REJECT_UNAUTHORIZED=0`; requires `certs/zscaler.pem`).
  - Automated secret scrubbing across console, file, and SSE log sinks.
  - Role-based HTTP Basic Authentication (differentiating `operator` vs read-only `viewer`).
  - Anti-CSRF Origin and Sec-Fetch-Site request header validation.
  - Localhost ingress binding (`127.0.0.1`) by default.
- **Strict Zero-Mutation Guardrails**:
  - GitHub client implements exclusively HTTP GET requests (zero mutation operations exist).
  - Azure DevOps client isolates all mutations behind explicit confirmation flags (`confirm: true`), `--dry-run` CLI options, and non-replayable error boundaries.
  - Read-only preflight scripts in `scripts/` provide bounded live inspection without state modification.

## Code Layout
- `new-app/package.json`: Project manifest, scripts, and runtime/dev dependencies.
- `new-app/src/index.ts`: CLI entry point and argument parsing.
- `new-app/src/container.ts`: Composition root and dependency injection wiring.
- `new-app/src/domain/`: Pure domain entities, value objects, and repository ports.
- `new-app/src/application/use-cases/`: Application use cases.
- `new-app/src/infrastructure/`: Azure DevOps, GitHub, filesystem, and scheduler adapters.
- `new-app/src/presentation/api/`: Express 5 REST API routes and security middleware.
- `new-app/src/presentation/web/public/`: Vanilla SPA client assets (`index.html`, `styles.css`, `app.js`).
- `new-app/tests/unit/`: 14 unit test suites (178 tests) run via Vitest.
- `new-app/tests/integration/`: 17 integration test suites (171 tests) run via Vitest.
- `new-app/scripts/`: Operational diagnostic and read-only preflight verification scripts.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Express 5 Architecture & Hexagonal Layers | Clean separation into domain, application, infrastructure, presentation | M1 | survey |
| 2 | Vanilla SPA Frontend | 10 UI views, 6 modals, 1 slide-out execution drawer, Chart.js integration | M4 | survey |
| 3 | Single-Host File Lock | Concurrency protection via `.execution-lock.json` with PID checking | M3 | survey |
| 4 | Atomic File Operations | `.tmp` file writing + `fsync` + rename for state durability | M3 | survey |
| 5 | Strict TLS Enforcement | Rejects insecure TLS bypass flags; mandates corporate CA certs | M3 | survey |
| 6 | Automated Secret Scrubbing | Redacts PATs, GitHub tokens, and auth headers across all log sinks | M3 | survey |
| 7 | Role-Based Access Control | HTTP Basic Auth with `operator` vs read-only `viewer` roles | M3 | survey |
| 8 | Anti-CSRF & Origin Guard | Origin / Sec-Fetch-Site validation on mutating HTTP requests | M3 | survey |
| 9 | Localhost Ingress Binding | Default bind to 127.0.0.1 to avoid unintended public network exposure | M3 | survey |
| 10 | TypeScript Typecheck Quality Gate | Clean compilation via `tsc --noEmit` across `src/` | M1 | survey |
| 11 | ESLint Code Quality Gate | Strict static analysis via ESLint 10 across TypeScript sources | M1 | survey |
| 12 | Vitest Automated Test Suites | 353 tests across 32 suites with in-memory isolation | M1 | survey |
| 13 | V8 Code Coverage Engine | >82% statement, >75% branch, and >93% function coverage | M1 | survey |
| 14 | Specialized Node Native Test Suites | 19 tests across schema, identities, and work items via `node --test` | M1 | survey |
| 15 | Dependency Vulnerability Audit | Zero high-severity vulnerabilities via npm audit | M1 | survey |
| 16 | Azure DevOps Organization & Project Connection | Live connectivity to Org: BFLDevOpsOrg, Project: 3in1_Agile_Projects | M2 | survey |
| 17 | Work Item Schema Verification | Validates `3in1 Task` type, required fields, and state workflows | M2 | survey |
| 18 | Team & Member Querying | Fetches team rosters and member identities from Azure DevOps | M2 | survey |
| 19 | Iteration & Sprint Path Discovery | Queries project iteration paths and sprint assignments | M2 | survey |
| 20 | Work Item Tree & Link Hierarchy Query | WIQL tree queries and relation expansion (`$expand=relations`) | M2 | survey |
| 21 | Dry-Run Task Planning Engine | `PlanTasksUseCase` and `npm start -- plan` with zero remote creation | M2 | survey |
| 22 | GitHub Organization & Repository Connection | Live connectivity to Org: 3in1-AppFrontEnd via GitHub REST API | M2 | survey |
| 23 | Enterprise Managed User (EMU) Resolution | Maps corporate emails to GitHub logins (`_bflghec` suffix) | M2 | survey |
| 24 | Pull Request Activity Querying | Queries PRs authored by members in 3in1-AppFrontEnd | M2 | survey |
| 25 | EOD Task Closure Simulation | `CloseDailyTasksUseCase` with `--dry-run` and PR deliverable formatting | M2 | survey |
| 26 | Strict Zero-Mutation Guardrail Enforcement | Bounded GET/list/query only; verification that zero records were altered | M5 | survey |
| 27 | Forensic Integrity Verification | Forensic auditor audit for authentic logic and zero dummy bypasses | M5 | survey |
| 28 | Comprehensive Acceptance Criteria Audit | Cross-verification against all items in ORIGINAL_REQUEST.md | M5 | survey |
| 29 | Test Typecheck & Lint Scope Alignment | Eliminate latent test type errors (`tsconfig.test.json`), unify linting across `tests/` | M1 | survey |
| 30 | Source Task Ownership Identity Matching | Refactor `validateSourceTaskOwnership` to utilize `matchesPerson` | M2 | survey |
| 31 | Timezone-Aware Explorer Date Extraction | Use `extractWorkItemRecordedDate` in `explore-tasks` across UTC midnight boundaries | M2 | survey |
| 32 | Resilient EOD Process Rule Field Casing | Inspect work item fields for `Custom.ActualStartDate` vs `Custom.ActualStartdate` in `close-daily-tasks` | M2 | survey |
| 33 | GitHub Client Resilience | Add `AbortController` timeout and exponential backoff retry on HTTP 429/403/5xx | M2 | survey |
| 34 | Concurrency Hardening & Stale Lock Recovery | Graceful recovery of corrupt/0-byte locks and lock acquisition in `repair-relations` | M3 | survey |
| 35 | Defense-in-Depth TLS Safety Check | Invoke `assertTlsSafety()` at startup in `src/container.ts` (`buildApp`) | M3 | survey |
| 36 | Pattern-Based Secret Scrubbing | Add regex pattern scrubbers for standard tokens across all log channels in `Logger` | M3 | survey |
| 37 | Web SPA Live Logs & Toast Durability | Implement sticky scroll on live logs, level filters/search, and extended error toast duration | M4 | survey |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Codebase Health, Test Type Safety & Lint Diagnostics | Unify test linting, add test typechecking configuration (`tsconfig.test.json`), eliminate 46 latent test type errors, fix `FakeClient` mock field forwarding, remove unused imports. | none | DONE |
| M2 | Core Task Engine, Explorer Timezones & Cloud Resilience | Domain identity matching in `validateSourceTaskOwnership` (`matchesPerson`), timezone-aware recorded date extraction in `explore-tasks`, resilient custom field casing in `close-daily-tasks`, `GitHubClient` request timeout & backoff retries, and Azure-native orphan task detection in `repair-relations`. | M1 | DONE |
| M3 | Operational Safety, Security Guardrails & Concurrency Hardening | `FileLockRepository` corrupt lock recovery and TOCTOU race mitigation, `RepairRelationsUseCase` concurrency locking, `buildApp()` defense-in-depth TLS check, and regex pattern secret scrubbing in `Logger`. | M1 | DONE |
| M4 | Web SPA UI/UX, Live Logging & Feedback Improvements | Sticky scrolling in execution drawer and logs view, log level filtering and search controls, EOD modal text correction, and enhanced toast notification persistence. | M2, M3 | DONE |
| M5 | Comprehensive Automated Testing, Quality Gate Verification & Forensic Audit | Unit and integration tests covering all new features and edge cases, full pass of `npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, and forensic integrity audit. | M1, M2, M3, M4 | DONE |

## Interface Contracts
### Application ↔ Azure DevOps Service
- Protocol: HTTPS REST API v7.0
- Base URL: `https://dev.azure.com/BFLDevOpsOrg`
- Authentication: HTTP Basic Auth with PAT (`:AZURE_DEVOPS_PAT` in Base64)
- Read Endpoints:
  - `GET /_apis/projects/3in1_Agile_Projects?api-version=7.0`
  - `GET /3in1_Agile_Projects/_apis/wit/workitemtypes/3in1%20Task?api-version=7.0`
  - `GET /3in1_Agile_Projects/_apis/work/teamsettings/iterations?api-version=7.0`
  - `POST /3in1_Agile_Projects/_apis/wit/wiql?api-version=7.0` (read-only query)
  - `GET /3in1_Agile_Projects/_apis/wit/workitems?ids={ids}&$expand=relations&api-version=7.0`
- Zero-Mutation Rule: Strictly no `POST /.../workitems/$...` or `PATCH /.../workitems/...` without explicit dry-run bypass.

### Application ↔ GitHub Service
- Protocol: HTTPS REST API v3
- Base URL: `https://api.github.com`
- Authentication: HTTP Bearer Token (`Bearer GITHUB_TOKEN`)
- Read Endpoints:
  - `GET /orgs/3in1-AppFrontEnd`
  - `GET /orgs/3in1-AppFrontEnd/repos?per_page=10`
  - `GET /search/users?q={email}+in:email`
  - `GET /search/issues?q=type:pr+author:{user}+org:3in1-AppFrontEnd`
- Zero-Mutation Rule: Client has zero mutating HTTP methods (GET only).
