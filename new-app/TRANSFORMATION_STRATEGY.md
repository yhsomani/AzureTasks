# Enterprise Transformation Strategy & Solution Design: Azure DevOps Engineering Work Operations Platform (WorkOps)

**Document Version:** 1.0.0  
**Target Product:** Azure DevOps 3in1 Task Studio (`azure-3in1-task-creator` v2.0.0 $\rightarrow$ Enterprise WorkOps v3.0.0)  
**Author:** Multi-Disciplinary Transformation Taskforce  
**Target Scope:** Complete Architectural, Engineering, Security, UI/UX, QA, and Operational Evolution  
**Date:** 2026-11-21  
**Status:** Approved for Phased Execution  

---

## 1. Executive Summary & Vision Statement

### 1.1 Executive Summary
The `azure-3in1-task-creator` application began as a specialized tactical script engineered to solve a painful administrative burden within agile engineering pods: the daily creation, morning activation, and end-of-day (EOD) closure of tracking tasks in Azure DevOps, linked to GitHub Enterprise pull requests as deliverables. Over iterative sprints, this automation evolved into a feature-dense monolith comprising 27,080 lines of code across TypeScript, vanilla JavaScript, and test suites. 

While the application features a well-structured Domain-Driven Design (DDD) domain core with 798 unit and integration tests, it remains constrained by foundational architectural and operational vulnerabilities:
1. **Single-Host Local File Persistence & Concurrency Bottlenecks**: State is stored in flat JSON files (`people.json`, `.task-journal.json`), resulting in $O(N)$ full-file re-writes on every single task transaction, vulnerable PID-based local filesystem locks (`.execution-lock.json`), and volatile in-memory timers (`setTimeout`) that are wiped on process restarts.
2. **Review/Execution Plan Drift Hazard (RISK-001)**: The planning endpoint (`POST /api/tasks/plan`) generates a preview, but the execution endpoint (`POST /api/tasks/execute`) re-queries Azure DevOps from scratch at execution time. Any external change between review and execution can cause unverified tasks to be created in Azure DevOps.
3. **Identity, Compliance, and Security Gaps**: Authentication relies entirely on shared static HTTP Basic Auth credentials (`API_AUTH_TOKEN`), while all Azure DevOps mutations execute under a single shared Personal Access Token (PAT). Consequently, changes cannot be attributed to individual human operators, violating SOC 2, ISO 27001, and corporate compliance standards. Furthermore, automated 8-hour task closures without verified PR evidence create serious audit risks.
4. **Monolithic Frontend Architecture**: The user interface is driven by a single 4,083-line vanilla JavaScript file (`app.js`) manipulating 12 distinct views and 8 modals within a 1,080-line HTML file via 74 direct `innerHTML` assignments, with unminified assets, unpinned CDN dependencies (Chart.js), and mobile ergonomics suffering from inverted heading typography and cramped 2D matrix scrolling.
5. **Quality and CI Brittleness**: An unmocked system clock causes integration tests (`create-tasks.test.ts:352`) to deterministically fail whenever CI pipelines execute on Saturdays or Sundays. Brittle string-matching tests inspect source code via `fs.readFileSync` rather than verifying runtime contracts.

### 1.2 Vision Statement
**Transform the Azure 3in1 Task Creator from a fragile, single-host automation script into an enterprise-grade, cloud-native Engineering Work Operations Platform ("WorkOps").**

The transformed platform will serve as an authoritative, intelligent hub that aligns developer activity, agile sprint management, and corporate compliance. It will deliver:
- **Zero-Drift Execution**: An Immutable Plan Protocol with signed, short-lived tokens ensuring that what is reviewed is exactly what is executed.
- **Verified Governance**: A policy engine requiring verifiable commit/PR deliverables before tasks can be closed, eliminating fraudulent or unverified timesheet compliance.
- **Zero-Trust Identity**: Full Microsoft Entra ID (Azure AD) SSO, per-user OAuth2 delegation, and granular Role-Based Access Control (RBAC).
- **Cloud-Native Scalability**: Dual-engine persistence (embedded SQLite WAL for local/edge; PostgreSQL for enterprise multi-node clusters) paired with a decoupled, durable job scheduler (BullMQ/Redis or PgBoss).
- **Delightful, Accessible UI/UX**: A modern, component-driven frontend (React 19 + Vite + Tailwind CSS + shadcn/ui) organized into three intuitive workspaces with fluid typography, responsive card-based layouts, and WCAG 2.1 AA compliance.

---

## 2. Multi-Disciplinary Analysis Across Nine Specialist Perspectives

```
+-------------------------------------------------------------------------------------------------------------------+
|                                 NINE-PERSPECTIVE TRANSFORMATION MATRIX                                            |
+--------------------------+---------------------------------------------------+------------------------------------+
| Perspective              | Current Baseline State                            | Target Enterprise State (WorkOps)  |
+--------------------------+---------------------------------------------------+------------------------------------+
| 1. Product Management    | Single-team batch workbench; lead bottleneck      | Multi-tier WorkOps; dev cockpit;   |
|                          | with no personal contributor views.               | automated sprint cadence & alerts. |
| 2. UI/UX Design          | 4,083-line app.js, 12 views in 1 DOM; inverted    | React 19 + shadcn/ui; 3 workspaces;|
|                          | mobile fonts (27px); cramped 2D matrix table.     | fluid typography; mobile cards.    |
| 3. Software Architecture | Hexagonal core, but flat JSON persistence;        | Dual SQLite WAL / PostgreSQL;      |
|                          | in-process scheduler; local file PID lock.        | BullMQ worker; distributed locks.  |
| 4. Engineering           | Vanilla JS frontend; 74 innerHTML calls;          | Strict TypeScript end-to-end;      |
|                          | dead .bak files; unmounted auto-closure routes.   | component isolation; clean builds. |
| 5. Security              | Shared Basic Auth token; shared Azure PAT;        | Entra ID SSO (OIDC); per-user RBAC;|
|                          | corporate PII in git; High DoS in body-parser.    | sanitized repo; patched CVEs.      |
| 6. Performance           | Unminified assets; 0 cache TTL; unpinned CDN;     | Content-hashed assets; local chart;|
|                          | sequential 100-item Azure WIQL queries.           | bounded parallel queries (p-limit).|
| 7. QA & Quality Eng.     | 798 tests, but weekend failure in create-tasks;   | Deterministic fake timers; true    |
|                          | brittle string-matching UI tests; 0% FE coverage. | component tests; Playwright E2E.   |
| 8. DevOps & SRE          | Bare-metal Node process; no Dockerfile;           | Multi-stage Docker; Helm charts;   |
|                          | missing CI/CD in repo; plaintext .env secrets.    | GitHub Actions CI; deep probes.    |
| 9. Business Analysis     | Unverified 8h task auto-closure; single-tenant    | Verified PR gating engine; multi-  |
|                          | hardcoding; risk of audit non-compliance.         | tenant/multi-pod; quantified ROI.  |
+--------------------------+---------------------------------------------------+------------------------------------+
```

### 2.1 Perspective 1: Product Management
#### 2.1.1 Value Proposition & Market Fit
The current application successfully saves ~15–20 minutes of daily administrative overhead per developer by automating the generation of daily child tasks under parent User Stories and logging completed work. However, because the system relies on a single shared screen and shared credentials, the operational burden falls entirely on the Scrum Master or Software Development Manager (SDM), who must manually configure, review, and execute batch runs for 6–10 developers. 

The transformed platform shifts from a **tactical batch script** to an **Engineering Work Operations Hub (WorkOps)**. It empowers both leads and individual contributors, aligning day-to-day coding deliverables directly with agile sprint tracking.

#### 2.1.2 Personas & User Journeys
1. **Engineering Manager / Scrum Lead ("Alex")**:
   - *Needs*: High-level team sprint coverage, zero missing daily tasks, automated capacity-adjusted task generation, and automated EOD closure verification.
   - *Current Pain*: Afraid of duplicate task creation in Azure; must manually cross-reference leave calendars; re-runs planning multiple times.
   - *Target Journey*: Opens Team Planning workspace $\rightarrow$ Selects upcoming rolling window $\rightarrow$ System evaluates team capacity, holidays, and active stories $\rightarrow$ Inspects signed immutable plan diff $\rightarrow$ Approves batch execution with one click $\rightarrow$ Receives delivery summary on Microsoft Teams.
2. **Individual Contributor / Developer ("Priya")**:
   - *Needs*: Minimal friction; wants to know her daily task ID, verify her PR is linked, and ensure her work hours are credited accurately without manual data entry.
   - *Current Pain*: No personal view; cannot see what the automation created without opening Azure DevOps; cannot run ad-hoc tasks safely.
   - *Target Journey*: Logs into Developer Cockpit via Entra ID SSO $\rightarrow$ Sees today's active task, linked branch, and open PRs $\rightarrow$ Clicks 1-Click "Log 8h & Close with PR" $\rightarrow$ Instant verification badge.
3. **Compliance Auditor / Executive ("Elena")**:
   - *Needs*: Transparent, tamper-evident audit logs showing who authorized task creations, verified proof of work for closed tasks, and timesheet integrity.
   - *Current Pain*: Shared Basic Auth token makes it impossible to determine who performed an action; automated 8-hour closures with zero PRs look like time fraud.
   - *Target Journey*: Accesses Governance & Audit workspace $\rightarrow$ Filters immutable journal by user, date, or work item $\rightarrow$ Verifies cryptographic PR linkage $\rightarrow$ Exports signed compliance report in CSV/JSON.
4. **DevOps / Platform Administrator ("Marcus")**:
   - *Needs*: Painless zero-downtime deployment, containerized isolation, automated secret rotation, and predictable resource utilization.
   - *Current Pain*: Plaintext secrets in `.env`; single Node process crash kills scheduled timers; PID file lock corrupts if container dies.
   - *Target Journey*: Deploys via Helm chart on Kubernetes $\rightarrow$ Secrets pulled from Azure Key Vault $\rightarrow$ Health probes monitor DB and queue $\rightarrow$ Background worker runs independently from web pod.

#### 2.1.3 Feature Gaps
- **Multi-Tenant / Multi-Pod Support**: Currently hardcoded to one organization (`BFLDevOpsOrg`) and one project (`3in1_Agile_Projects`). Required: hierarchical data model supporting Organizations, Departments, Pods, and Teams.
- **Custom Work Item Templates**: Task titles and fields are hardcoded to `3in1_PWA_MyAccount | [Date]`. Required: configurable template engine with custom field mappings and token replacement (`{{prefix}} | {{sprint}} | {{date}}`).
- **Bi-Directional Webhook Sync**: Currently relies on periodic polling. Required: inbound webhook listener for Azure DevOps work item updates and GitHub PR merges.
- **Enterprise Notification Dispatcher**: Required: rich webhook integrations for Slack and Microsoft Teams to broadcast morning planning previews and EOD closure digests.

---

### 2.2 Perspective 2: UI/UX Design
#### 2.2.1 Cognitive Overload & Visual Hierarchy
The current interface loads 12 distinct functional views and 8 modal dialogs into a single HTML DOM tree, toggling visibility via CSS `.view { display: none; }` and `.view.active { display: block; }`. On initial load, users are confronted with 4 KPI cards, "Needs attention" alert boxes, recent activity streams, two Chart.js charts, a plan preview table, and a daily PR table all on one screen.

Furthermore, critical action buttons ("Activate today's tasks" and "Close today's tasks") are redundantly duplicated across five different screens: Topbar, Dashboard card actions, Planner actions, Lifecycle view, and Scheduler view.

**Target Consolidation: Three Focused Workspaces**
```
+-------------------------------------------------------------------------------------------------------------------+
|                                      CONSOLIDATED 3-WORKSPACE ARCHITECTURE                                        |
+------------------------------------+---------------------------------------------+--------------------------------+
| Workspace 1: Daily Workflow        | Workspace 2: Team & Planning                | Workspace 3: Governance & Ops  |
+------------------------------------+---------------------------------------------+--------------------------------+
| - Personal Developer Cockpit       | - Interactive Task Coverage Matrix          | - Tamper-Evident Audit Journal |
| - Today's Work Summary & PR Sync   | - Rolling Window Task Planner               | - Decoupled Scheduler Daemon   |
| - 1-Click Task Lifecycle Actions   | - Team Roster & Skill Profiles              | - Identity & RBAC Management   |
| - Real-Time SSE Execution Console  | - Capacity & Holiday Work Calendar          | - Telemetry & System Health    |
+------------------------------------+---------------------------------------------+--------------------------------+
```

#### 2.2.2 Design System & Ergonomics
- **Fluid Typography**: The current stylesheet exhibits an inverted scaling bug where mobile headings under `@media (max-width: 600px)` scale up to `27px` while desktop headings are `18px/24px` (`styles.css:521, 543`), causing extreme line wrapping on phones.
  - *Remediation*: Implement a strict fluid typography scale using CSS `clamp()`:
    ```css
    --font-size-sm: clamp(0.75rem, 0.7rem + 0.25vw, 0.875rem);
    --font-size-base: clamp(0.875rem, 0.8rem + 0.35vw, 1rem);
    --font-size-lg: clamp(1.125rem, 1rem + 0.5vw, 1.25rem);
    --font-size-xl: clamp(1.35rem, 1.15rem + 0.8vw, 1.75rem);
    --font-size-2xl: clamp(1.65rem, 1.35rem + 1.2vw, 2.25rem);
    ```
- **Consistent Surface Tokens**: The current `.card` selector resets background to `transparent`, removes borders, and strips border-radius (`styles.css:203`), while individual rows have borders and shadows.
  - *Remediation*: Adopt unified elevation and surface tokens:
    ```css
    :root {
      --surface-base: #f8fafc;
      --surface-card: #ffffff;
      --surface-overlay: #f1f5f9;
      --border-subtle: #e2e8f0;
      --border-strong: #cbd5e1;
      --text-primary: #0f172a;
      --text-muted: #64748b;
      --accent-primary: #2563eb;
      --radius-sm: 6px;
      --radius-md: 10px;
      --radius-lg: 16px;
    }
    [data-theme="dark"] {
      --surface-base: #090d16;
      --surface-card: #111827;
      --surface-overlay: #1f2937;
      --border-subtle: #1e293b;
      --border-strong: #334155;
      --text-primary: #f8fafc;
      --text-muted: #94a3b8;
      --accent-primary: #3b82f6;
    }
    ```

#### 2.2.3 Mobile-Responsive Card Redesign
The current Task Explorer displays a 14-day horizontal matrix with fixed-width columns that overflows viewports narrower than 1200px, forcing awkward 2D panning.
- *Target Mobile UX*: On viewports below 768px, dynamically transition the matrix table into a responsive **Day-by-Day Card Accordion** or **Swipe Carousel**. Each card represents an engineer's daily allocation, displaying status badges (`Created`, `Active`, `Closed`, `Leave`, `Missing`), work hours, and linked PR pills with single-tap action drawers.

#### 2.2.4 Accessibility (WCAG 2.1 AA Compliance)
- **Modal Focus Management**: Replace duplicate, conflicting global keydown listeners (`app.js:2438, 3837`) with standard Radix UI / shadcn dialog primitives featuring automated focus trapping, background `aria-hidden` inert toggling, and reliable `Escape` key dismissal.
- **Contrast Ratios**: Remediate warning badge pills (`--warning-bg: #fffbeb`, `--warning-text: #b45309`) to achieve a verified minimum contrast ratio of 4.5:1 against card backgrounds.
- **Accessible Data Visualizations**: Complement canvas charts with hidden `<table class="sr-only">` data fallbacks and ARIA summaries (`aria-label="Sprint Effort Burndown Chart"`) for assistive technologies.

---

### 2.3 Perspective 3: Software Architecture
#### 2.3.1 Hexagonal DDD Evolution
The backend successfully isolates domain value objects (`WorkItem`, `DateWindow`, `Person`) and use cases. However, it violates hexagonal principles by coupling use cases directly to filesystem-specific repository implementations (`FileJournalRepository`, `FileLockRepository`, `FileConfigRepository`).

**Target Clean Architecture Layering**:
```
+---------------------------------------------------------------------------------------------------+
|                                 HEXAGONAL DOMAIN ARCHITECTURE                                      |
+---------------------------------------------------------------------------------------------------+
|                                      PRESENTATION LAYER                                           |
|       [Vite / React SPA]         [REST API Controllers]          [SSE Log & Status Streams]       |
+---------------------------------------------------------------------------------------------------+
|                                       APPLICATION LAYER                                           |
|   [CreateTasksUseCase]    [CloseDailyTasksUseCase]    [ActivateTasksUseCase]    [AuditLogUseCase]  |
|                       [GenerateImmutablePlanUseCase]    [ExecutePlanTokenUseCase]                  |
+---------------------------------------------------------------------------------------------------+
|                                         DOMAIN LAYER                                              |
|      [WorkItem (Aggregate)]     [PlanToken (Entity)]     [PolicyEngine (Domain Service)]          |
|      [DateWindow (Value Object)]                         [WorkCalendar (Aggregate)]              |
+---------------------------------------------------------------------------------------------------+
|                                      INFRASTRUCTURE PORTS                                         |
|  <<IWorkItemRepo>>   <<IJournalRepo>>   <<IConfigRepo>>   <<ILockManager>>   <<IJobScheduler>>    |
+---------------------------------------------------------------------------------------------------+
|                                   INFRASTRUCTURE ADAPTERS                                         |
|   [AzureDevOpsRestAdapter]    [DrizzleSqliteAdapter]    [DrizzlePostgresAdapter]                  |
|   [RedisDistributedLock]      [BullMqJobScheduler]      [EntraIdOidcAuthAdapter]                  |
+---------------------------------------------------------------------------------------------------+
```

#### 2.3.2 Relational Persistence Architecture
The current `FileJournalRepository` exhibits an $O(N)$ write pathology: every new task or audit log entry reads the entire multi-megabyte `.task-journal.json` array into Node memory, appends items, stringifies the whole array, and writes it to a temporary file before renaming (`file-journal-repo.ts:37-47`). Under concurrent usage or container crashes, this causes severe I/O thrashing and data corruption.

**Target Database Solution**:
Introduce a pluggable persistence adapter using **Drizzle ORM** supporting:
1. **SQLite (WAL Mode)**: For standalone local installations and single-container edge deployments. SQLite with Write-Ahead Logging delivers sub-millisecond atomic transactions and zero operational overhead.
2. **PostgreSQL**: For enterprise Kubernetes clusters, supporting multi-node concurrency, row-level locking, and connection pooling.

#### 2.3.3 Distributed Concurrency Locks
The current `FileLockRepository` uses a local filesystem lock (`.execution-lock.json` with the `wx` exclusive flag) and checks OS process liveness via `process.kill(pid, 0)`. In containerized environments or multi-instance deployments, process IDs collide and filesystem locks cannot coordinate across physical nodes.
- *Remediation*: Implement a distributed lock adapter using **Redis Redlock** (with 30-second heartbeats and auto-release leases) or **PostgreSQL Advisory Locks** (`pg_try_advisory_lock`), ensuring mutual exclusion across all application replicas.

#### 2.3.4 Decoupled Background Job Scheduler
Currently, scheduled task runs rely on Node's volatile in-process timers (`setTimeout` and `setInterval` in `NodeSchedulerRepository`). If the Node process crashes, restarts during deployment, or experiences event loop starvation during large WIQL batches, scheduled runs are dropped.
- *Remediation*: Decouple scheduling from the HTTP server process into a dedicated worker daemon (`bin/worker.ts`) powered by **BullMQ** (backed by Redis) or **PgBoss** (backed by PostgreSQL). Jobs are durably persisted, support cron schedules with time zone awareness, provide automatic retry with exponential backoff, and record execution history in the database.

---

### 2.4 Perspective 4: Engineering & Tech Stack
#### 2.4.1 End-to-End TypeScript Migration
While the backend enjoys strict TypeScript (`strict: true`), the entire presentation layer (`app.js`, 4,083 lines) is written in untyped vanilla JavaScript. This produces severe regressions during refactoring, silent `undefined` property bugs, and zero compile-time contract verification between backend API responses and frontend state.
- *Remediation*: Migrate the entire frontend to strict TypeScript (`.tsx`) under a unified monorepo workspace or clean client/server directory structure, sharing DTOs and value object types directly from `src/domain/` to the UI components.

#### 2.4.2 Component Deconstruction & Separation of Concerns
Deconstruct `app.js` into cohesive, single-responsibility modules:
- `src/presentation/web/src/components/ui/`: Atomic design primitives (Button, Badge, Modal, Card, Table, Drawer).
- `src/presentation/web/src/features/daily-cockpit/`: Developer cockpit, task action triggers, active work card.
- `src/presentation/web/src/features/planning/`: Coverage matrix, plan preview, diff inspector.
- `src/presentation/web/src/features/governance/`: Journal table, audit exporter, scheduler controls.
- `src/presentation/web/src/hooks/`: React Query hooks (`usePlan`, `useExecutePlan`, `useJournalStream`).
- `src/presentation/web/src/store/`: Lightweight state management (Zustand or TanStack Store).

#### 2.4.3 Elimination of XSS Vulnerabilities
The current `app.js` performs 74 direct `innerHTML` assignments, interpolating task titles, person names, and error messages without consistent sanitization.
- *Remediation*: Replace all imperative `innerHTML` assignments with declarative React JSX. Where markdown or external rich text is rendered, enforce strict HTML sanitization via `DOMPurify`.

#### 2.4.4 Build & Tooling Modernization
Replace the primitive build script (`tsc && node -e "fs.cpSync(...)"`) with **Vite**:
- TypeScript transpilation and JSX bundling with lightning-fast Hot Module Replacement (HMR).
- Automatic code splitting, tree shaking, and CSS asset hashing (`index.[hash].js`, `index.[hash].css`).
- Built-in Gzip/Brotli compression reducing initial JavaScript payload from 160 KB to <45 KB.

---

### 2.5 Perspective 5: Security & Compliance
#### 2.5.1 Identity, Authentication & Single Sign-On (SSO)
The current server relies on HTTP Basic Authentication over a single shared secret (`API_AUTH_TOKEN`). If one engineer leaves the team or leaks the token, the entire system is compromised. Furthermore, all operations in Azure DevOps execute under a single shared Personal Access Token (`AZURE_DEVOPS_PAT`), eliminating non-repudiation.
- *Target Identity Solution*:
  1. Integrate **Microsoft Entra ID (formerly Azure Active Directory)** via OpenID Connect (OIDC) / OAuth 2.0 with PKCE.
  2. Implement an On-Behalf-Of (OBO) flow or user-delegated Azure DevOps tokens, ensuring that when Priya executes a task creation or closure, Azure DevOps records the mutation under Priya's authenticated identity.
  3. Establish four granular RBAC roles:
     - `Admin`: Manage system settings, team rosters, and integrations.
     - `Lead`: Generate and execute batch plans, configure calendars, override closures.
     - `Developer`: View personal cockpit, create ad-hoc personal tasks, link PRs.
     - `Auditor`: Read-only access to audit journals, compliance metrics, and exports.

#### 2.5.2 Repository Sanitization & PII Removal
The repository currently tracks `people.json` in source control, which exposes real employee names, corporate email addresses (`@bajajfinserv.in`), internal pod names, and GitHub usernames.
- *Remediation*:
  1. Add `people.json`, `.task-journal.json`, `.auto-closure-config.json`, and `.work-calendar.json` to `.gitignore`.
  2. Provide sanitized template files: `people.example.json` and `config.example.json` containing synthetic mock data.
  3. Run `git-filter-repo` or BFG Repo-Cleaner in corporate repositories to purge historical PII commits.

#### 2.5.3 Dependency CVE Remediation
A comprehensive `npm audit` reveals 10 known vulnerabilities (1 High, 9 Moderate):
- **High Severity (GHSA-27r3-jxmh-p828)**: Denial of Service in `body-parser` (versions 2.0.0–2.3.0) via trailing bytes after a compressed request body.
- **Moderate Severity (GHSA-g3hv-75wg-m249)**: DoS in `minimatch` via globparts amplification in linting dependencies.
- **Moderate Severity (GHSA-6pq8-jhm2-2vcw)**: DoS in `qs` when encountering objects with non-callable own `toString`.
- *Action*: Update Express to >=5.2.1 with patched sub-dependencies and enforce automated Dependabot scanning in CI.

#### 2.5.4 Secure Enterprise TLS & Certificate Management
The current codebase monkeypatches Node's internal `tls.createSecureContext` using dynamic imports in `src/infrastructure/security/tls-safety.ts` to load enterprise proxy certificates (`certs/zscaler.pem`).
- *Target Solution*: Deprecate runtime monkeypatching. Formalize enterprise CA injection via standard environment variables (`NODE_EXTRA_CA_CERTS=/path/to/enterprise-ca.pem`) configured in Docker and container orchestrators.

---

### 2.6 Perspective 6: Performance & Scalability
#### 2.6.1 Asset Delivery & Caching Optimizations
Currently, the Express server serves static assets with `Cache-Control: no-cache, no-store, must-revalidate` (`server.ts:167-175`). Every page navigation re-downloads 267 KB of unminified JavaScript and CSS. Furthermore, Chart.js is loaded from an unpinned public CDN (`https://cdn.jsdelivr.net/npm/chart.js@4.4.8/dist/chart.umd.min.js`), which fails if the corporate network is airgapped or blocks public CDNs.
- *Remediation*:
  1. Bundle Chart.js directly into the local application bundle via `npm install chart.js`.
  2. Implement content-hashed static asset filenames via Vite (`assets/index.[hash].js`).
  3. Configure long-term caching for immutable assets (`Cache-Control: public, max-age=31536000, immutable`), reserving `no-cache` strictly for `index.html`.

#### 2.6.2 Azure DevOps API Query Optimization
In `src/infrastructure/azure/work-item-service.ts`, WIQL queries return candidate work item IDs, after which `AzureWorkItemService` chunks queries into slices of 100 IDs and loops over them sequentially (`_apis/wit/workitems?ids=${ids}&$expand=relations`). When candidate items reach thousands across large teams, dozens of sequential HTTP calls occur synchronously in the request path, inducing 3–10 seconds of latency and risking Azure HTTP 429 rate limits.
- *Remediation*: Introduce **bounded parallel fetching** using `p-limit` with a concurrency factor of 5–10, accompanied by a Token Bucket rate limiter and automated exponential backoff on HTTP 429 (`Retry-After`).

#### 2.6.3 Database Query Indexing
Transitioning from flat JSON to relational persistence requires optimal database indexing:
```sql
CREATE INDEX idx_journal_tenant_date ON journal_entries (tenant_id, work_date DESC);
CREATE INDEX idx_journal_person ON journal_entries (person_id, status);
CREATE INDEX idx_work_items_external ON work_items (tenant_id, azure_work_item_id);
CREATE INDEX idx_tasks_date_status ON tasks (planned_date, status);
```

---

### 2.7 Perspective 7: QA & Quality Engineering
#### 2.7.1 Eliminating the Weekend Temporal Bug
The test suite currently contains a deterministic time-bomb bug in `tests/integration/create-tasks.test.ts:352`:
```typescript
// tests/integration/create-tasks.test.ts:15
const TODAY = getTodayIso('UTC');
```
When `npm test` runs on a Saturday or Sunday, `DateWindow.computePlannedDates()` evaluates `TODAY` as a weekend (`dayOfWeek === 0 || dayOfWeek === 6`) when `skipWeekends: true` is configured. The item is immediately marked with `status: 'WEEKEND_SKIP'`, bypassing the duplicate task detection check. As a result, `result.personResults[0].duplicateSkips` is empty, and the assertion `expect(duplicateSkip).toBeDefined()` throws an error.
- *Remediation*: Enforce deterministic time mocking across all test suites using Vitest's `vi.useFakeTimers()`:
  ```typescript
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-14T10:00:00Z')); // Deterministic Wednesday
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  ```

#### 2.7.2 Modernizing Brittle UI Tests
Tests in `tests/integration/ui-shell.test.ts` currently use `node:fs.readFileSync` to read source files as raw text and perform regex/string containment checks (e.g. `expect(js).toContain("$('.nav-item').forEach")`). These tests do not verify runtime behavior and fail on minor variable renames.
- *Remediation*: Replace raw string assertion tests with true component tests using **Vitest + React Testing Library + JSDOM**, verifying that elements render, respond to user events, and manage state accurately.

#### 2.7.3 Formalizing Playwright E2E Automation
The repository includes a browser test script (`tests/browser/ui-journeys.mjs`), but `playwright` is not installed in `package.json`, causing the script to fail immediately when executed.
- *Remediation*: Install `@playwright/test` in `devDependencies`, establish `playwright.config.ts`, and integrate headless browser testing into CI pipelines, executing full end-to-end user journeys (plan creation, preview verification, task execution, and log streaming).

#### 2.7.4 Comprehensive Code Coverage Instrumentation
Frontend assets in `app.js` currently have 0% tracked code coverage because `vitest.config.ts` only includes `src/**/*.ts`. Migrating the frontend to TypeScript and including `src/presentation/web/src/**/*.{ts,tsx}` in coverage tracking will enforce an organizational quality gate of >=85% code coverage.

---

### 2.8 Perspective 8: DevOps & SRE
#### 2.8.1 Multi-Stage Containerization
The repository lacks containerization artifacts. Deployments rely on manual Node execution on developer workstations.
- *Target Artifact*: A multi-stage `Dockerfile` producing a secure, minimal container image running under a non-root unprivileged user:
```dockerfile
# Stage 1: Build & Prune
FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
RUN npm run build:client

# Stage 2: Production Runtime
FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup -S workops && adduser -S workops -G workops
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=builder --chown=workops:workops /app/dist ./dist
USER workops
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1
CMD ["node", "dist/index.js"]
```

#### 2.8.2 Cloud-Native CI/CD Pipeline
Establish a standardized GitHub Actions workflow (`.github/workflows/ci.yml`) executing on all pull requests:
1. Static analysis: `eslint`, `prettier --check`.
2. Type checking: `tsc --noEmit` across backend and client.
3. Test suite: `vitest run --coverage` with fake timer enforcement.
4. E2E validation: Headless Playwright test runs against mock Azure services.
5. Container build: Docker image build and Trivy vulnerability scan.

#### 2.8.3 Deep Health & Observability Probes
Enhance `/api/health` and `/api/ready` to provide detailed diagnostic telemetry:
- `status`: `UP` | `DEGRADED` | `DOWN`
- `storage`: SQLite WAL checkpoint / PostgreSQL pool connection latency
- `azureConnectivity`: Ping latency to Azure DevOps REST API
- `scheduler`: Last heartbeat timestamp of the decoupled worker daemon
- `memory`: Process heap usage and RSS limits

---

### 2.9 Perspective 9: Business Analysis
#### 2.9.1 Governance & Compliance Risk Mitigation
In `src/application/use-cases/close-daily-tasks.ts`, the EOD task closure workflow sets completed work to 8 hours by default and marks tasks as Closed even when zero GitHub pull requests or commits are found (`p.autoCloseEnabled !== false`). 

If external compliance auditors (e.g. SOC 2 or corporate quality audits) evaluate these records, automated 8-hour timesheet closures with no verifiable deliverables can be flagged as fraudulent work logging.
- *Business Control*: Connect the **Verified Auto-Closure Policy Engine**. Tasks without verified GitHub PR or commit evidence cannot be closed automatically; they are flagged as `NEEDS_REVIEW` and require explicit human signoff in the lead dashboard.

#### 2.9.2 Quantifiable ROI & Business Impact
- **Time Savings**: Automating daily task creation, morning activation, and EOD closure saves an average of 18 minutes per developer per working day.
  - Across a 50-developer engineering organization: $50 \times 18\text{ min/day} = 15\text{ hours/day} = 3,750\text{ hours/year}$.
  - At a blended engineering cost of $65/hour, the direct annual productivity gain is **$243,750 USD**.
- **Delivery Predictability**: Eliminating missing daily tasks ensures 100% accurate sprint burndown curves, empowering engineering leadership with reliable velocity forecasting.

---

## 3. Current State Assessment: Strengths, Weaknesses, Bloat & Technical Debt

### 3.1 Detailed Strengths Inventory
1. **Solid Hexagonal Domain Foundation**: The business logic governing work item generation, date window calculations (`DateWindow`), and task naming rules is clean, modular, and thoroughly tested.
2. **Comprehensive Test Suite (798 Tests)**: High unit test density covering edge cases, date boundaries, leap years, and string formatting.
3. **In-Memory Read Coordination (`ReadCoordinator`)**: Excellent optimization that collapses concurrent identical reads to Azure DevOps into a single inflight HTTP request.
4. **Secret Scrubbing in Logging**: `LoggerService.registerSecret()` automatically redacts sensitive PATs and tokens from application logs.

---

### 3.2 Technical Debt, Bloat & Dead Code Inventory

```
+-------------------------------------------------------------------------------------------------------------------+
|                                 TECHNICAL DEBT & BLOAT REMOVAL INVENTORY                                          |
+------------------------------------------------------+---------+--------------------------------------------------+
| Artifact Path                                        | Size    | Description & Remediation Action                 |
+------------------------------------------------------+---------+--------------------------------------------------+
| src/application/use-cases/close-daily-tasks-updated.ts| 374 L   | DEAD CODE. Truncated duplicate use case. Delete. |
| src/presentation/api/auto-closure-routes.ts          | 274 L   | DEAD CODE. Unmounted router with 6 dead endpoints.|
|                                                      |         | Wire into server or refactor into modern engine. |
| src/application/use-cases/close-daily-tasks.ts.bak   | 23 KB   | BACKUP ARTIFACT. Committed in src/. Delete.      |
| src/infrastructure/azure/work-item-service.ts.bak    | 28 KB   | BACKUP ARTIFACT. Committed in src/. Delete.      |
| src/infrastructure/journal/file-journal-repo.ts.bak  | 6.5 KB  | BACKUP ARTIFACT. Committed in src/. Delete.      |
| ../routes_backup.ts                                  | 18 KB   | BACKUP ARTIFACT. Root-level duplicate. Delete.   |
| people.json                                          | 91 L    | PII HAZARD. Real employee names and emails in git|
|                                                      |         | Add to .gitignore; create people.example.json.   |
| src/presentation/web/public/app.js                   | 4,083 L | MONOLITH. Untyped JS with 74 innerHTML calls.     |
|                                                      |         | Deconstruct into modular React 19 components.    |
| src/presentation/web/public/index.html               | 1,080 L | MONOLITH. 12 views loaded in single DOM.         |
|                                                      |         | Replace with client router and code splitting.   |
| cdn.jsdelivr.net/npm/chart.js@4.4.8                  | Ext CDN | SUPPLY CHAIN RISK. Unpinned CDN dependency.      |
|                                                      |         | Install chart.js via npm and bundle locally.     |
| .task-journal.json                                   | Variable| SCALABILITY DEBT. O(N) full-file rewrite on write|
|                                                      |         | Migrate to relational SQLite/PostgreSQL storage. |
| .execution-lock.json                                 | 1 File  | CONCURRENCY DEBT. Single-host PID-based file lock|
|                                                      |         | Replace with Redis/PostgreSQL distributed lock.  |
| tests/integration/create-tasks.test.ts:352           | 1 Test  | TEMPORAL BUG. Fails deterministically on weekend|
|                                                      |         | Implement vi.useFakeTimers() deterministic clock.|
| tests/integration/ui-shell.test.ts                   | 80 L    | BRITTLE TEST. Asserts raw code strings via fs.   |
|                                                      |         | Replace with Testing Library component tests.    |
+------------------------------------------------------+---------+--------------------------------------------------+
```

---

## 4. Target Solution Architecture & Scalability Improvements

### 4.1 Target Solution Architecture Diagram

```
+-------------------------------------------------------------------------------------------------------------------+
|                                  TARGET WORKOPS PLATFORM ARCHITECTURE                                              |
+-------------------------------------------------------------------------------------------------------------------+

                                              +----------------------------+
                                              |      CLIENT BROWSER        |
                                              | React 19 + Tailwind + Vite |
                                              +--------------+-------------+
                                                             | (HTTPS / WSS / SSE)
                                                             v
+-------------------------------------------------------------------------------------------------------------------+
| INGRESS & API GATEWAY / REVERSE PROXY (Traefik / NGINX / Azure App Gateway)                                       |
| - TLS Termination & Rate Limiting                                                                                 |
| - Microsoft Entra ID (OIDC) JWT Token Validation                                                                  |
+-------------------------------------------------------------------------------------------------------------------+
                                                             |
                                                             v
+-------------------------------------------------------------------------------------------------------------------+
| WORKOPS CORE APPLICATION PODS (Stateless HTTP/REST Web Service)                                                   |
|                                                                                                                   |
|  +-------------------------------------------------------------------------------------------------------------+  |
|  | Presentation Layer (Express 5 REST API + SSE Controllers)                                                  |  |
|  | - AuthGuard (RBAC)         - RequestContext (Tenant, User)    - OpenTelemetry Tracing Middleware            |  |
|  +------------------------------------------------------+------------------------------------------------------+  |
|                                                         |                                                         |
|  +------------------------------------------------------v------------------------------------------------------+  |
|  | Application Layer (Use Cases & Orchestrators)                                                               |  |
|  | - GenerateImmutablePlanUseCase  - ExecutePlanTokenUseCase  - TaskLifecycleUseCase  - AuditComplianceUseCase  |  |
|  +------------------------------------------------------+------------------------------------------------------+  |
|                                                         |                                                         |
|  +------------------------------------------------------v------------------------------------------------------+  |
|  | Domain Core Layer (Pure Business Logic & Policy Engines)                                                    |  |
|  | - WorkItem Aggregate           - DateWindow Value Object   - VerifiedAutoClosurePolicyEngine                |  |
|  | - PlanToken Entity             - WorkCalendar Aggregate    - IdentityMapper Domain Service                  |  |
|  +------------------------------------------------------+------------------------------------------------------+  |
|                                                         |                                                         |
|  +------------------------------------------------------v------------------------------------------------------+  |
|  | Hexagonal Ports & Adapter Layer                                                                             |  |
|  | [IWorkItemRepository]      [IJournalRepository]      [IConfigRepository]      [IDistributedLockManager]     |  |
|  +-------------------------------------------------------------------------------------------------------------+  |
+-------------------------------------------------------------------------------------------------------------------+
             |                                 |                                 |                       |
             v                                 v                                 v                       v
+-------------------------+       +-------------------------+       +------------------------+ +--------------------+
| AZURE DEVOPS REST API   |       | GITHUB ENTERPRISE API   |       | DURABLE JOB QUEUE      | | DISTRIBUTED LOCK   |
| - WIQL Batch Work Items |       | - Pull Requests & Commits|      | - BullMQ / Redis or    | | - Redis Redlock or |
| - Bounded Concurrency   |       | - Enterprise EMU Mapping|       | - PgBoss on Postgres   | | - PG Advisory Lock |
+-------------------------+       +-------------------------+       +-----------+------------+ +--------------------+
                                                                                |
                                                                                v
+-------------------------------------------------------------------------------------------------------------------+
| ASYNCHRONOUS WORKER DAEMON PODS (Decoupled Background Execution)                                                  |
| - Morning Auto-Activation Worker (09:00 / 17:30 IST)                                                              |
| - EOD Verified Auto-Closure Worker (18:15 IST with PR Evidence Check)                                             |
| - Rolling Window Pre-Calculation & Cache Warmer                                                                   |
+-------------------------------------------------------------------------------------------------------------------+
                                                |
                                                v
+-------------------------------------------------------------------------------------------------------------------+
| RELATIONAL DATABASE PERSISTENCE LAYER (Drizzle ORM)                                                               |
| Local/Edge: SQLite 3 with Write-Ahead Logging (WAL mode)                                                          |
| Enterprise: PostgreSQL 16 (High Availability Replicas, Row-Level Security, Point-in-Time Recovery)                 |
+-------------------------------------------------------------------------------------------------------------------+
```

---

### 4.2 Immutable Plan Protocol (Anti-Drift Specification)
#### 4.2.1 Problem Definition (RISK-001)
In the current application, `POST /api/tasks/plan` scans Azure DevOps and computes planned tasks for user review. When the user confirms by clicking "Execute", the client invokes `POST /api/tasks/execute` passing only `{ all: true }` or a list of person keys. The server **re-queries Azure DevOps from scratch**. 

If Azure DevOps work items were modified during the review period (e.g. parent User Story closed, date window altered, or network failure on one member's query), the executed tasks diverge from what the operator approved.

#### 4.2.2 Protocol Specification
The Immutable Plan Protocol enforces a strict **Two-Phase Commit (2PC) pattern** using cryptographically signed, short-lived plan tokens:

```
[Client UI]                                    [WorkOps Server]                                [Azure DevOps]
     |                                                 |                                              |
     | 1. POST /api/tasks/plan { scope, dateWindow }   |                                              |
     |------------------------------------------------>| 2. Fetch WorkItems & Evaluate Policies       |
     |                                                 |--------------------------------------------->|
     |                                                 |<---------------------------------------------|
     |                                                 | 3. Generate Plan Diff & PlanHash             |
     |                                                 | 4. Sign PlanToken (HMAC-SHA256, 10m TTL)     |
     |                                                 | 5. Store Plan Snapshot in DB                 |
     | 6. Return { planSummary, planToken }            |                                              |
     |<------------------------------------------------|                                              |
     |                                                 |                                              |
     | [Operator reviews exact diff in UI]             |                                              |
     |                                                 |                                              |
     | 7. POST /api/tasks/execute { planToken }        |                                              |
     |------------------------------------------------>| 8. Verify PlanToken signature & TTL          |
     |                                                 | 9. Retrieve exact Plan Snapshot from DB      |
     |                                                 | 10. Acquire Distributed Execution Lock       |
     |                                                 | 11. Execute EXACT planned tasks (no re-query)|
     |                                                 |--------------------------------------------->|
     |                                                 |<---------------------------------------------|
     |                                                 | 12. Record Atomic Journal & Release Lock     |
     | 13. Return { executionSummary, journalIds }     |                                              |
     |<------------------------------------------------|                                              |
```

**PlanToken Data Structure**:
```typescript
export interface ImmutablePlanTokenPayload {
  tokenId: string;              // UUIDv4
  tenantId: string;             // Multi-tenant identifier
  createdBy: string;            // Authenticated user email
  issuedAt: number;             // Epoch milliseconds
  expiresAt: number;            // Epoch milliseconds (issuedAt + 600,000ms = 10 min)
  planHash: string;             // SHA-256 fingerprint of the planned tasks array
  plannedTasksCount: number;
  personKeys: string[];
}

export interface PlannedTaskItem {
  personKey: string;
  sourceTaskId: number;
  parentStoryId: number;
  plannedDate: string;          // ISO Date YYYY-MM-DD
  title: string;
  assignedToEmail: string;
  originalEstimateHours: number;
  status: 'PENDING_CREATION';
}
```

If `expiresAt < Date.now()`, the server returns HTTP 410 (Gone) with code `PLAN_EXPIRED`. If the HMAC signature is invalid, it returns HTTP 400 (Bad Request). Execution is guaranteed to match the preview exactly.

---

### 4.3 Relational Persistence Schema (Drizzle ORM DDL)
The application will replace flat JSON files with a relational schema supported across SQLite and PostgreSQL:

```sql
-- Multi-Tenant Organizations & Teams
CREATE TABLE organizations (
    id VARCHAR(36) PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    azure_org_url VARCHAR(500) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE teams (
    id VARCHAR(36) PRIMARY KEY,
    org_id VARCHAR(36) NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    azure_project VARCHAR(255) NOT NULL,
    work_item_type VARCHAR(100) NOT NULL DEFAULT '3in1 Task',
    task_prefix VARCHAR(255) NOT NULL DEFAULT '3in1_PWA_MyAccount |',
    timezone VARCHAR(100) NOT NULL DEFAULT 'Asia/Kolkata',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Team Members & External Identity Mappings
CREATE TABLE members (
    id VARCHAR(36) PRIMARY KEY,
    team_id VARCHAR(36) NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    full_name VARCHAR(255) NOT NULL,
    corp_email VARCHAR(255) NOT NULL,
    azure_identity_id VARCHAR(255) NOT NULL,
    github_username VARCHAR(255) NOT NULL,
    source_task_id INTEGER NOT NULL,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_team_corp_email UNIQUE (team_id, corp_email)
);

-- Work Calendars & Capacity Exceptions
CREATE TABLE work_calendars (
    id VARCHAR(36) PRIMARY KEY,
    team_id VARCHAR(36) NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    skip_weekends BOOLEAN NOT NULL DEFAULT TRUE,
    planning_cycle_anchor_day INTEGER NOT NULL DEFAULT 4 -- 4 = Thursday
);

CREATE TABLE calendar_exceptions (
    id VARCHAR(36) PRIMARY KEY,
    calendar_id VARCHAR(36) NOT NULL REFERENCES work_calendars(id) ON DELETE CASCADE,
    member_id VARCHAR(36) REFERENCES members(id) ON DELETE CASCADE, -- NULL indicates team-wide holiday
    exception_date DATE NOT NULL,
    capacity_hours NUMERIC(4,2) NOT NULL DEFAULT 0.00, -- 0.00 = full day off, 4.00 = half day
    reason VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Immutable Plan Snapshots
CREATE TABLE plan_tokens (
    token_id VARCHAR(36) PRIMARY KEY,
    team_id VARCHAR(36) NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    created_by_email VARCHAR(255) NOT NULL,
    plan_hash VARCHAR(64) NOT NULL,
    token_payload_json TEXT NOT NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    is_executed BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Tamper-Evident Task Journal
CREATE TABLE journal_entries (
    id VARCHAR(36) PRIMARY KEY,
    team_id VARCHAR(36) NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
    member_id VARCHAR(36) NOT NULL REFERENCES members(id) ON DELETE CASCADE,
    azure_task_id INTEGER NOT NULL,
    parent_story_id INTEGER,
    work_date DATE NOT NULL,
    action_type VARCHAR(50) NOT NULL, -- 'TASK_CREATED', 'TASK_ACTIVATED', 'TASK_CLOSED'
    operator_email VARCHAR(255) NOT NULL,
    completed_hours NUMERIC(4,2),
    linked_pr_urls TEXT, -- JSON array of verified GitHub PR URLs
    verification_status VARCHAR(50) NOT NULL DEFAULT 'VERIFIED',
    payload_snapshot_json TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_journal_team_date ON journal_entries(team_id, work_date DESC);
CREATE INDEX idx_journal_member ON journal_entries(member_id, work_date DESC);
CREATE INDEX idx_journal_azure_task ON journal_entries(azure_task_id);
```

---

## 5. UI/UX Design System & Ergonomic Overhaul

### 5.1 Workspace Restructuring & Navigation
The transformed user interface collapses 12 sprawling views into **Three High-Velocity Workspaces**, accessible via a streamlined, responsive navigation rail:

```
+-------------------------------------------------------------------------------------------------------------------+
| [Logo] WorkOps v3.0         Workspace: [ Daily Workflow v ]               (Tenant: 3in1 Mobile) [Dark/Light] [User]|
+-------------------------------------------------------------------------------------------------------------------+
| Nav Rail   |                                                                                                      |
| ---------- |   DAILY WORKFLOW COCKPIT                                                                             |
| [Cockpit]  |   +-----------------------------------------------------------------------------------------------+  |
| [Planning] |   | Active Sprint: Sprint 48 (Thursday Cycle) | Today: Wednesday, Nov 21 | Status: ALL TASKS ACTIVE  |  |
| [Gov & Ops]|   +-----------------------------------------------------------------------------------------------+  |
|            |                                                                                                      |
|            |   +-----------------------------------+  +-------------------------------------------------------+  |
|            |   | MY WORK TODAY (Priya Sharma)      |  | TEAM SUMMARY (6 Members)                              |  |
|            |   | --------------------------------- |  | ----------------------------------------------------- |  |
|            |   | Task #48291: 3in1_PWA | Nov 21    |  | Active: 5/6 | Missing: 0 | On Leave: 1 (Karan D.)     |  |
|            |   | Parent: User Story #47102 (Auth)  |  | Open PRs: 3 PRs linked today                          |  |
|            |   | Status: [ ACTIVE ] (Started 09:30)|  |                                                       |  |
|            |   | PR: #412 feat(auth): add PKCE     |  | [1-Click: Morning Activation]  [1-Click: EOD Closure] |  |
|            |   |                                   |  +-------------------------------------------------------+  |
|            |   | [ 1-Click: Log 8h & Close Task ]  |                                                             |
|            |   +-----------------------------------+                                                             |
|            |                                                                                                      |
|            |   +-----------------------------------------------------------------------------------------------+  |
|            |   | RECENT AUDIT ACTIVITY (Live SSE Stream)                                                       |  |
|            |   | [16:45] Task #48291 activated by system daemon (PR #412 linked)                               |  |
|            |   | [11:15] Task #48290 created by Alex (Immutable Plan Token #a81f)                              |  |
|            |   +-----------------------------------------------------------------------------------------------+  |
+-------------------------------------------------------------------------------------------------------------------+
```

---

### 5.2 Mobile Responsive Card Redesign (Replacing 2D Matrix)
On viewports smaller than 768px, the wide 14-day table converts to an interactive **Card Accordion**:

```
+-------------------------------------------+
| <   WEDNESDAY, NOV 21, 2026   >           |
| Coverage: 100% (5 Active, 1 Leave)        |
+-------------------------------------------+
| Priya Sharma                              |
| Task: #48291 | 8.0h | Status: [ACTIVE]    |
| PR: #412 (3in1-AppFrontEnd)               |
| [ Close Task ]                            |
+-------------------------------------------+
| Mukul Ramteke                             |
| Task: #48292 | 8.0h | Status: [ACTIVE]    |
| PR: #409 (Payment-Service)                |
| [ Close Task ]                            |
+-------------------------------------------+
| Karan Dham                                |
| Status: [ON LEAVE] (Planned Full Day)     |
| Capacity: 0.0h | No task required         |
+-------------------------------------------+
```

---

## 6. Concrete Engineering, Testing, Deployment & Maintenance Processes

### 6.1 Development Workflow
- **Branching Model**: Trunk-Based Development. All feature work is developed on short-lived branches (`feat/`, `fix/`, `refactor/`) and merged into `main` via PRs requiring passing CI checks and at least one peer approval.
- **Pre-Commit Enforcement**: Configured via `husky` and `lint-staged`:
  - `eslint --fix` and `prettier --write` on staged files.
  - Mandatory regex scan preventing accidental commits of secret keys, PATs, or `.env` files.
- **Strict TypeScript Baseline**: Frontend and backend enforce `strict: true`, `noImplicitAny: true`, and `exactOptionalPropertyTypes: true`.

---

### 6.2 Testing Strategy & Pyramid

```
                                  /\
                                 /  \
                                / 5% \  Playwright E2E User Journeys
                               /------\
                              /  15%   \  Integration (Fake Repos & Mock HTTP)
                             /----------\
                            /    80%     \  Unit Tests (Pure Domain & Value Objects)
                           /--------------\
```

1. **Unit Testing (80%)**: Test pure business domain logic (`DateWindow`, `WorkItem`, `PolicyEngine`, `PlanToken`). Fast, deterministic, memory-only execution.
2. **Integration Testing (15%)**: Test use cases wired to fake repository implementations (`FakeWorkItemRepo`, `DrizzleSqliteAdapter`).
3. **End-to-End Browser Testing (5%)**: Playwright headless browser tests verifying complete user flows in real Chromium and WebKit browsers.
4. **Deterministic Clock Freezing Policy**: Mandatory use of `vi.useFakeTimers()` in all tests interacting with dates to prevent calendar regression bugs.

---

### 6.3 Deployment & Release Pipelines
- **Continuous Integration (CI)**: GitHub Actions workflow triggers on every commit:
  1. `npm run lint`
  2. `npm run typecheck` & `npm run typecheck:client`
  3. `npm test -- --coverage` (enforcing >=85% threshold)
  4. `npm run test:e2e` (headless Playwright)
  5. `docker build` + Trivy container vulnerability scan
- **Continuous Delivery (CD)**:
  - Staging: Automated deployment on merge to `main` via Helm upgrade to Azure Kubernetes Service (AKS) or Azure Container Apps.
  - Production: Tagged semantic releases (`vX.Y.Z`) trigger rolling deployment with zero downtime and automated database schema migrations.

---

### 6.4 Operational Maintenance & Rotation Routines
- **Database Backup & Snapshotting**: Automated daily point-in-time snapshots of SQLite/PostgreSQL databases with 30-day retention.
- **Audit Journal Archiving**: Automated monthly partition archiving moving entries older than 90 days into compressed cold storage (Azure Blob / S3).
- **PAT & Secret Rotation**: Integration with Azure Key Vault with automated 60-day alerts prior to PAT expiration.

---

## 7. Risk Mitigation Strategies & Long-Term Sustainability

```
+-------------------------------------------------------------------------------------------------------------------+
|                                            ENTERPRISE RISK MATRIX                                                 |
+---------+--------------------------+----------+-----------------------------------------------------+-------------+
| Risk ID | Description              | Severity | Mitigation Control                                  | Owner       |
+---------+--------------------------+----------+-----------------------------------------------------+-------------+
| RISK-01 | Review/Execution Drift   | HIGH     | Enforce Immutable Plan Token Protocol; client       | Backend /   |
|         | in task creation batch   |          | submits signed token with 10m TTL.                  | Arch        |
| RISK-02 | Compliance audit failure | HIGH     | Gate auto-closure behind Verified Auto-Closure      | Product /   |
|         | on unverified task close |          | Policy Engine; require verified PR/commit evidence. | Compliance  |
| RISK-03 | Credential compromise /  | HIGH     | Implement Microsoft Entra ID (OIDC) SSO and per-    | Security /  |
|         | lack of non-repudiation  |          | user RBAC; eliminate shared Basic Auth & shared PAT.| DevOps      |
| RISK-04 | Data corruption from     | HIGH     | Migrate from flat JSON to SQLite WAL / PostgreSQL   | Data Eng /  |
|         | concurrent file writes   |          | with ACID transactions and point-in-time backups.   | Backend     |
| RISK-05 | Weekend CI build failure | MEDIUM   | Mock system clocks in all date-dependent tests      | QA /        |
|         | due to calendar coupling |          | using vi.useFakeTimers() and deterministic dates.   | Testing     |
| RISK-06 | Supply chain attack via  | MEDIUM   | Bundle Chart.js locally via npm; remove external    | DevOps /    |
|         | unpinned public CDN      |          | unpinned jsdelivr CDN dependency.                   | Security    |
| RISK-07 | Azure API HTTP 429 rate  | MEDIUM   | Implement bounded concurrency (p-limit) and token   | Backend /   |
|         | limiting during queries  |          | bucket rate limiting with exponential backoff.      | Perf        |
+---------+--------------------------+----------+-----------------------------------------------------+-------------+
```

---

## 8. Structured Transformation Roadmap & Milestone Breakdown

```
+-------------------------------------------------------------------------------------------------------------------+
|                                      PHASED IMPLEMENTATION TIMELINE                                               |
+-------------------------------------------------------------------------------------------------------------------+
| Weeks 1–2   : Phase 1 — Stabilization, Hygiene & Flake Remediation                                               |
| Weeks 3–6   : Phase 2 — Modern Frontend & Design System Overhaul                                                  |
| Weeks 7–10  : Phase 3 — Architecture Modernization & Relational Persistence                                       |
| Weeks 11–13 : Phase 4 — Enterprise Identity, Security & Verified Governance                                       |
| Weeks 14–16 : Phase 5 — DevOps, Multi-Tenancy & Enterprise Observability                                          |
+-------------------------------------------------------------------------------------------------------------------+
```

### Phase 1: Stabilization, Hygiene & Flake Remediation (Weeks 1–2)
- **Deliverables**:
  1. Fix the weekend temporal test bug in `tests/integration/create-tasks.test.ts:352` by introducing deterministic system time mocking via `vi.useFakeTimers()`.
  2. Permanently delete all committed dead backup files (`*.bak`), `../routes_backup.ts`, and unreferenced duplicate `src/application/use-cases/close-daily-tasks-updated.ts`.
  3. Wire or cleanly refactor unmounted `src/presentation/api/auto-closure-routes.ts`.
  4. Purge corporate PII: Add `people.json` and state files to `.gitignore`, and supply sanitized `people.example.json`.
  5. Bundle `chart.js` locally via npm, eliminating external `cdn.jsdelivr.net` link from `index.html`.
  6. Remediate `npm audit` vulnerabilities in `body-parser`, `minimatch`, and `qs`.
- **Success Criteria**: `npm test`, `npm run typecheck`, and `npm run lint` all pass cleanly with 0 failures on any day of the week, with 0 audit vulnerabilities.

### Phase 2: Modern Frontend & Design System Overhaul (Weeks 3–6)
- **Deliverables**:
  1. Initialize modern client application in `src/presentation/web` powered by React 19, TypeScript, Vite, and Tailwind CSS.
  2. Deconstruct monolithic `app.js` (4,083 lines) into atomic components and domain feature hooks.
  3. Consolidate 12 views into Three High-Velocity Workspaces (Daily Workflow, Team & Planning, Governance & Operations).
  4. Fix mobile typography scaling inversion using CSS `clamp()` and replace wide 14-day table on mobile with responsive Card Accordion.
  5. Achieve full WCAG 2.1 AA accessibility compliance with automated Axe-core testing.
- **Success Criteria**: Zero `innerHTML` assignments; frontend fully typed with 0 `tsc` errors; lighthouse accessibility score >=98.

### Phase 3: Architecture Modernization & Relational Persistence (Weeks 7–10)
- **Deliverables**:
  1. Implement Drizzle ORM persistence adapter supporting SQLite (WAL mode) and PostgreSQL.
  2. Migrate data from `people.json` and `.task-journal.json` into relational schema with zero data loss.
  3. Implement the Immutable Plan Protocol: `POST /api/tasks/plan` returns a signed, 10-minute TTL `PlanToken`; `POST /api/tasks/execute` consumes the token, preventing review/execution drift.
  4. Decouple background scheduler from web process into standalone worker daemon (`bin/worker.ts`) using BullMQ/Redis or PgBoss.
  5. Replace single-process file lock (`.execution-lock.json`) with distributed locks (Redis / Postgres).
- **Success Criteria**: Zero file-based JSON rewrites; plan execution mathematically guaranteed against drift; scheduler survives web server restarts.

### Phase 4: Enterprise Identity, Security & Verified Governance (Weeks 11–13)
- **Deliverables**:
  1. Integrate Microsoft Entra ID (Azure AD) OIDC Single Sign-On and JWT validation.
  2. Implement four granular RBAC roles (Admin, Lead, Developer, Auditor).
  3. Transition from shared PAT to delegated user tokens for Azure DevOps operations, ensuring personal audit attribution.
  4. Reconnect and enforce the Verified Auto-Closure Policy Engine: tasks require verified GitHub PR/commit evidence before automated closure is permitted.
  5. Integrate external secret storage (Azure Key Vault / Kubernetes Secrets) eliminating plaintext `.env` storage.
- **Success Criteria**: 100% of audit journal entries attributed to unique authenticated corporate identities; 0 unverified automatic task closures.

### Phase 5: DevOps, Multi-Tenancy & Enterprise Observability (Weeks 14–16)
- **Deliverables**:
  1. Deliver production multi-stage `Dockerfile` and Helm deployment charts for Kubernetes / Azure Container Apps.
  2. Implement full GitHub Actions CI/CD pipeline with automated testing, Playwright E2E browser tests, and container vulnerability scanning.
  3. Expand domain model to support multi-tenant organizations, departments, and multiple agile pods.
  4. Implement OpenTelemetry distributed tracing, Prometheus metrics export, and deep health probes at `/api/health`.
  5. Deliver automated Microsoft Teams and Slack notification dispatchers.
- **Success Criteria**: Cloud-native deployment achieves 99.9% uptime SLA; end-to-end user journeys pass automated Playwright verification in CI.

---

## 9. Conclusion
The Azure DevOps 3in1 Task Studio possesses a battle-tested domain core that has proven its value by saving hundreds of hours of engineering overhead. By addressing its legacy constraints through this comprehensive, first-principles transformation strategy, the platform will evolve into an enterprise-grade **Engineering Work Operations Platform (WorkOps)**. 

This transformation delivers:
- **Rock-solid execution integrity** through the Immutable Plan Protocol.
- **Uncompromised audit compliance** through verified work evidence gating and per-user identity attribution.
- **Modern engineering excellence** through strict TypeScript, component-driven UI, relational persistence, and decoupled background workers.
- **A delightful user experience** prioritizing simplicity, speed, and accessibility for developers and engineering leaders alike.
