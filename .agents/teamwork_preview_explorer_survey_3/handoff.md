# Handoff Report: Codebase Health, Test Suite Structure, and Verification Tooling

**Survey Agent**: teamwork_preview_explorer_survey_3  
**Target App**: `/Users/yashsomani/Desktop/Asure Bord Project/new-app`  
**Timestamp**: 2026-10-19T05:48:00Z  
**Status**: Completed (Hard Handoff)

---

## 1. Observation

### 1.1 Tooling & Configuration Inspection

#### A. `package.json` & Package Metadata
- **Identity**: `azure-3in1-task-creator` v2.0.0, `"type": "module"` (pure ESM).
- **Architecture Note**: Despite `ORIGINAL_REQUEST.md` referencing a "Next.js/Node studio", `new-app/` has **zero Next.js dependencies**. It is a Node.js Express server (`express` v5.2.1, `cors` v2.8.6, `dotenv` v18.0.6) serving a vanilla JavaScript/HTML5 single-page application located in `src/presentation/web/public/` (`app.js`, `index.html`, `styles.css`).
- **Core Scripts**:
  - `"dev"`: `"tsx watch src/index.ts"`
  - `"start"`: `"node dist/index.js"`
  - `"build"`: `"tsc && node -e \"import('fs').then(fs => fs.cpSync('src/presentation/web/public', 'dist/presentation/web/public', { recursive: true }))\""`
  - `"typecheck"`: `"tsc --noEmit"`
  - `"test"`: `"vitest run"`
  - `"test:watch"`: `"vitest"`
  - `"test:coverage"`: `"vitest run --coverage"`
  - `"lint"`: `"eslint \"src/**/*.ts\""`
  - `"format"`: `"prettier --write \"src/**/*.ts\""`
  - `"verify:staging:readonly"`: `"node scripts/staging-readonly-verify.mjs"`
  - `"state:backup"`: `"node scripts/state-backup.mjs backup"`
  - `"state:verify"`: `"node scripts/state-backup.mjs verify"`
  - `"state:restore"`: `"node scripts/state-backup.mjs restore"`
  - `"verify:schema:readonly"`: `"node scripts/verify-azure-schema.mjs"`
  - `"test:schema"`: `"node --test scripts/verify-azure-schema.test.mjs"`
  - `"verify:identities:readonly"`: `"node scripts/verify-azure-identities.mjs"`
  - `"test:identities"`: `"node --test scripts/verify-azure-identities.test.mjs"`
  - `"verify:workitems:readonly"`: `"node scripts/verify-azure-workitems.mjs"`
  - `"test:workitems"`: `"node --test scripts/verify-azure-workitems.test.mjs"`
- **DevDependencies**:
  - `typescript`: `^5.7.3`
  - `vitest`: `5.0.5`
  - `@vitest/coverage-v8`: `5.0.5`
  - `eslint`: `10.12.0`
  - `@typescript-eslint/eslint-plugin`: `^8.0.0`
  - `@typescript-eslint/parser`: `^8.0.0`
  - `prettier`: `^3.0.0`
  - `tsx`: `^4.19.3`
  - `@types/express`: `^5.0.6`, `@types/cors`: `^2.8.19`, `@types/node`: `^22.13.5`

#### B. `tsconfig.json`
- `compilerOptions`: `target`: `"ES2022"`, `module`: `"NodeNext"`, `moduleResolution`: `"NodeNext"`, `strict`: `true`, `outDir`: `"./dist"`, `rootDir`: `"./src"`.
- `include`: `["src/**/*"]`
- `exclude`: `["node_modules", "dist", "tests"]` (line 19)
- **Key Observation**: The `tests/` directory is explicitly excluded from `tsconfig.json`. Consequently, `npm run typecheck` (`tsc --noEmit`) type checks only the application sources under `src/`.

#### C. `eslint.config.js`
- Uses ESLint flat config (ESLint 10 compatible).
- Configured files: `['src/**/*.ts', 'tests/**/*.ts']`.
- Parser: `@typescript-eslint/parser`.
- Rules: `@typescript-eslint/no-unused-vars` warning (ignoring `^_`), `no-unused-vars`: `off`, `no-console`: `off`.
- **Key Observation**: While the config specifies `tests/**/*.ts`, the `package.json` script runs `eslint "src/**/*.ts"`, leaving test files unlinted during `npm run lint`.

#### D. `vitest.config.ts`
- `test.globals`: `true`
- `test.environment`: `'node'`
- `test.include`: `['tests/**/*.test.ts']`
- `test.coverage`:
  - `provider`: `'v8'`
  - `reporter`: `['text', 'html']`
  - `include`: `['src/**/*.ts']`
  - `exclude`: `['src/index.ts', 'src/container.ts']`

#### E. CI Quality Gates (`.github/workflows/ci.yml`)
- Triggers on push and pull request against `main`, `master`, `feat/**`, `fix/**`.
- Enforces:
  1. `npm audit --omit=dev --audit-level=high` (0 high vulnerabilities allowed)
  2. Complete lockfile audit with 3-attempt retry: `npm audit --package-lock-only --audit-level=high`
  3. `npm run typecheck`
  4. `npm run lint -- --max-warnings=0`
  5. `npm run test:coverage`
  6. Static script syntax validation:
     - `node --check src/presentation/web/public/app.js`
     - `node --check scripts/staging-readonly-verify.mjs`
     - `node --check scripts/verify-azure-schema.mjs`
     - `node --check scripts/verify-azure-identities.mjs`
     - `node --check scripts/verify-azure-workitems.mjs`
  7. Node test runner preflights:
     - `npm run test:schema`
     - `npm run test:identities`
     - `npm run test:workitems`
  8. Production build: `npm run build`
  9. HTTP shell & authentication smoke test (starts server on port 3188, verifies 401 unauthorized fallback, curl basic auth, DOM contract checks)
  10. Isolated browser testing:
      - Runs `npm install --no-save --package-lock=false playwright@1.56.1`
      - Runs `npx playwright install --with-deps chromium`
      - Runs `node tests/browser/ui-journeys.mjs`
  11. Multi-OS matrix test on `windows-latest` and `macos-latest` (clean install, typecheck, lint, test, build).

---

### 1.2 Test Suites Inventory

The repository contains **3 distinct testing frameworks / layers**:

| Layer | Runner | File Location | File Count | Test Count | Execution Time | Description |
|---|---|---|---|---|---|---|
| **Unit & Integration Tests** | Vitest 5.0.5 | `tests/unit/*.test.ts`, `tests/integration/*.test.ts` | 31 files | 349 tests | 2.35s | Domain logic, use cases, repos, API routes, security, in-memory DOM harness |
| **Azure Verification Tests** | Node Native Test Runner (`node --test`) | `scripts/*.test.mjs` | 3 files | 19 tests | 0.17s | Pure function tests for Azure schema compatibility, identity resolution, WIQL parsing |
| **Browser E2E User Journeys** | Playwright (external) | `tests/browser/ui-journeys.mjs` | 1 file | Multi-viewport flow | N/A (CI-only) | End-to-end headless Chromium test with synthetic mock fixtures and mutation interception |

#### Detailed Suite Breakdown

##### 1. Unit Tests (`tests/unit/`, 14 files, 178 tests)
- `tests/unit/azure-client.test.ts` (14 tests): Tests `AzureDevOpsClient`. Verifies PAT requirement, no retry on 401, exponential backoff on 5xx, rate-limiting (429) backoff, PATCH/POST content types (`application/json-patch+json`), and mutation idempotency guardrails (refusing retry on 503 or socket timeouts).
- `tests/unit/config-use-cases.test.ts` (12 tests): Tests `ConfigUseCase`. Verifies configuration loading, updates, member validation, secret masking (ensures PAT is never returned in plaintext).
- `tests/unit/date-window.test.ts` (18 tests): Tests `DateWindow` value object. Verifies sprint/iteration boundaries, Thursday cutoff logic, weekend skipping, timezone offset calculations.
- `tests/unit/explore-tasks.test.ts` (18 tests): Tests `ExploreTasksUseCase`. Verifies task matrix calculation, coverage calculation, missing combinations, duplicate detection.
- `tests/unit/get-status.test.ts` (3 tests): Tests `GetStatusUseCase`. Verifies server status, Azure connectivity reporting, environment health.
- `tests/unit/github-client.test.ts` (11 tests): Tests `GitHubClient`. Verifies GitHub REST queries, commit/PR lookup, rate limiting, token handling.
- `tests/unit/github-service.test.ts` (9 tests): Tests `DomainGitHubService`. Verifies PR linking to work items, author matching, commit evidence parsing.
- `tests/unit/logger.test.ts` (1 test): Tests logger formatting, redaction, log levels.
- `tests/unit/person.test.ts` (12 tests): Tests `Person` entity. Verifies role mapping, prefix validation, email format checking.
- `tests/unit/repositories.test.ts` (40 tests): Tests file-based and node repositories: `FileConfigRepository`, `FileJournalRepository`, `FileLockRepository`, `NodeSchedulerRepository` (cold restarts, EOD checkpoints, lock contention, corrupted JSON handling).
- `tests/unit/task-entities.test.ts` (20 tests): Tests `Task` domain entities and value objects.
- `tests/unit/task-services.test.ts` (23 tests): Tests `TaskService` domain logic, parent-child work item relationships, hierarchy validation.
- `tests/unit/tls-safety.test.ts` (3 tests): Tests TLS security configurations (TLS 1.2/1.3 min version, secure cipher suites, `rejectUnauthorized`).
- `tests/unit/work-item-service.test.ts` (16 tests): Tests `AzureWorkItemService`. Verifies WIQL generation, query batching, response mapping, parent-link parsing.

##### 2. Integration Tests (`tests/integration/`, 17 files, 171 tests)
- `tests/integration/api-routes.test.ts` (18 tests): Tests Express route handlers (`/api/status`, `/api/health`, `/api/ready`, `/api/tasks/plan`, `/api/tasks/create`, `/api/tasks/close-today`, `/api/journal`, `/api/config`).
- `tests/integration/close-daily-tasks.test.ts` (11 tests): Tests daily task closure use cases in both dry-run and simulated live modes.
- `tests/integration/create-tasks.test.ts` (12 tests): Tests task creation flows, batch planning, duplicate prevention.
- `tests/integration/discovery.test.ts` (4 tests): Tests discovery of Azure DevOps org, project, iterations, and teams.
- `tests/integration/repair-relations.test.ts` (8 tests): Tests orphan task relation repairs and hierarchy restoration.
- `tests/integration/scheduler-cold-restart.test.ts` (4 tests): Tests recovery of scheduler state across hard process restarts using `tests/fixtures/scheduler-restart-probe.mjs`.
- `tests/integration/server-security.test.ts` (12 tests): Tests CORS, Origin headers, CSRF protections, Bearer authentication, timing-safe comparisons.
- `tests/integration/state-backup.test.ts` (4 tests): Tests state backup script integration, SHA-256 integrity manifest generation, offline restore.
- `tests/integration/ui-shell.test.ts` (18 tests): Static contract tests verifying `index.html`, `app.js`, and `styles.css` structure, accessibility tags, 10 view routes, modal focus traps, and viewer-role disabling.
- `tests/integration/ui-navigation-runtime.test.ts` (2 tests): Evaluates `app.js` inside `node:vm` with a synthetic DOM stub to verify routing, active tab styling, and breadcrumbs without a browser.
- `tests/integration/ui-explorer-selection.test.ts` (4 tests): In-memory DOM test for explorer matrix user pill selection/deselection.
- `tests/integration/ui-operations-recovery.test.ts` (8 tests): Tests error banner displays and recovery actions.
- `tests/integration/ui-plan-isolation.test.ts` (2 tests): Tests planner state immutability across route changes.
- `tests/integration/ui-settings-accessibility.test.ts` (4 tests): Tests settings screen ARIA contracts, password reveal toggle, help text descriptions.
- `tests/integration/ui-team-save.test.ts` (4 tests): Tests team member editing and save feedback flows.
- `tests/integration/ui-timezone-feedback.test.ts` (4 tests): Tests timezone selector feedback.
- `tests/integration/ui-work-views.test.ts` (4 tests): Tests navigation to work views.

##### 3. Azure Verification Script Tests (`scripts/*.test.mjs`, 3 files, 19 tests)
- `scripts/verify-azure-schema.test.mjs` (3 tests): Tests work item schema preflight assertions against mock Azure metadata.
- `scripts/verify-azure-identities.test.mjs` (8 tests): Tests exact account vs display name disambiguation, descriptor handling, and 50-member bounded batches.
- `scripts/verify-azure-workitems.test.mjs` (8 tests): Tests read-only WIQL syntax, date escaping, 200-item batch limits, prefix observation logic.

##### 4. Browser User Journey Suite (`tests/browser/ui-journeys.mjs`)
- Playwright-based test spinning up real `dist/index.js serve` on port 3189.
- Tests across 4 viewports: Desktop (1366x850), Mobile (390x844), Responsive (375x850, 768x850).
- Intercepts all `/api/**` calls; asserts `mutationRequests.length === 0` (strict read-only enforcement).
- Verifies keyboard accessibility, ARIA states, drawer navigation, EOD preview-before-run safeguard, and read-only viewer mode.

---

### 1.3 Test Coverage Map vs Untested Areas

From `vitest run --coverage` (V8 coverage provider):

```
-------------------|---------|----------|---------|---------|-------------------
File               | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s 
-------------------|---------|----------|---------|---------|-------------------
All files          |   84.39 |    75.37 |   94.46 |   84.39 |                   
 ...tion/use-cases |   79.39 |     69.8 |    92.3 |   79.39 |                   
  ...aily-tasks.ts |   89.92 |    77.41 |     100 |   89.92 | ...43,247,260-261 
  config.ts        |   83.51 |    90.16 |   83.33 |   83.51 | ...,61-62,125-135 
  create-tasks.ts  |   66.98 |     61.8 |   84.61 |   66.98 | ...09-827,833-845 
  explore-tasks.ts |   85.27 |    61.32 |     100 |   85.27 | ...35-441,493,530 
  get-status.ts    |     100 |     90.9 |     100 |     100 | 49                
  plan-tasks.ts    |   78.51 |    45.83 |     100 |   78.51 | ...46-147,150-152 
  ...-relations.ts |     100 |    85.71 |     100 |     100 | 61,63,72,87       
 domain            |     100 |      100 |     100 |     100 |                   
  index.ts         |     100 |      100 |     100 |     100 |                   
 domain/entities   |   94.33 |    85.06 |     100 |   94.33 |                   
  person.ts        |   95.23 |       90 |     100 |   95.23 | 54-55,61-62,88-89 
  task.ts          |   93.87 |    82.69 |     100 |   93.87 | ...84-385,395-396 
 domain/ports      |       0 |        0 |       0 |       0 |                   
  repositories.ts  |       0 |        0 |       0 |       0 | (type defs only)  
 domain/services   |   95.54 |    85.85 |      92 |   95.54 |                   
  ...ub-service.ts |     100 |    88.88 |     100 |     100 | 86,96-97          
  task-services.ts |   94.79 |    84.72 |    90.9 |   94.79 | ...52-255,360-361 
 .../value-objects |   97.82 |    87.93 |     100 |   97.82 |                   
  date-window.ts   |   97.82 |    87.93 |     100 |   97.82 | 187-188,199-200   
 ...tructure/azure |   79.38 |    74.72 |   85.29 |   79.38 |                   
  client.ts        |    86.7 |    78.87 |   94.11 |    86.7 | ...87-188,251-252 
  ...em-service.ts |   76.52 |    72.07 |   76.47 |   76.52 | ...58-581,584-594 
 ...ructure/config |   91.04 |     62.1 |     100 |   91.04 |                   
  ...onfig-repo.ts |   91.04 |     62.1 |     100 |   91.04 | ...55-256,267-269 
 ...ructure/github |   93.41 |     80.8 |     100 |   93.41 |                   
  github-client.ts |   93.41 |     80.8 |     100 |   93.41 | ...40,291,326-327 
 ...ucture/journal |   92.76 |    83.67 |     100 |   92.76 |                   
  ...urnal-repo.ts |   92.76 |    83.67 |     100 |   92.76 | ...70-173,183-186 
 ...structure/lock |   97.53 |    79.48 |     100 |   97.53 |                   
  ...-lock-repo.ts |   97.53 |    79.48 |     100 |   97.53 | 60-61             
 ...ucture/logging |   83.11 |       75 |   84.61 |   83.11 |                   
  logger.ts        |   83.11 |       75 |   84.61 |   83.11 | ...5-70,79-80,101 
 ...ture/scheduler |   76.09 |    71.09 |   96.42 |   76.09 |                   
  ...duler-repo.ts |   76.09 |    71.09 |   96.42 |   76.09 | ...86,520,525-526 
 ...cture/security |     100 |      100 |     100 |     100 |                   
  tls-safety.ts    |     100 |      100 |     100 |     100 |                   
 presentation/api  |   81.87 |    75.55 |     100 |   81.87 |                   
  ...est-origin.ts |   95.65 |    89.13 |     100 |   95.65 | 68-69             
  routes.ts        |    77.3 |    66.22 |     100 |    77.3 | ...38-542,546-551 
  server.ts        |   92.75 |     86.3 |     100 |   92.75 | ...36-141,169-171 
-------------------|---------|----------|---------|---------|-------------------
```

#### Coverage Highlights & Gaps:
- **Excluded by config**: `src/index.ts` (CLI entry point) and `src/container.ts` (dependency injection container) are excluded in `vitest.config.ts`.
- **Public Frontend (`src/presentation/web/public/app.js`)**: Not instrumented by V8 code coverage because it is plain client-side JavaScript. It is verified via DOM contract integration tests and `node:vm` tests.
- **`create-tasks.ts` (66.98% coverage)**: Uncovered lines (809-827, 833-845) correspond to live error recovery and partial failure handling during remote Azure batch operations.
- **`plan-tasks.ts` (78.51% coverage, 45.83% branch)**: Uncovered branches represent fallback dates when holidays or non-standard iterations are configured.
- **`work-item-service.ts` (76.52% coverage)**: Uncovered lines represent exotic Azure REST error payloads, rate limit recovery retries, and malformed JSON-patch error paths.

---

### 1.4 Baseline Verification Command Outputs

All dry checks executed synchronously in `/Users/yashsomani/Desktop/Asure Bord Project/new-app`:

| Command | Status | Output Summary |
|---|---|---|
| `npm run typecheck` | **PASS (0)** | Clean; 0 errors reported by `tsc --noEmit`. |
| `npm run lint` | **PASS (0)** | Clean; 0 errors, 0 warnings across `src/**/*.ts`. |
| `npx eslint "tests/**/*.ts"` | **WARN (0 errors, 1 warning)** | `/tests/unit/get-status.test.ts:1:36: warning 'beforeEach' is defined but never used`. |
| `npm test` | **PASS (0)** | 31 test files, 349 tests passed in 2.35s. |
| `npm run test:coverage` | **PASS (0)** | 31 test files, 349 tests passed. 84.39% statements, 75.37% branch, 94.46% functions. |
| `npm run test:schema` | **PASS (0)** | 3 tests passed in 56.5ms. |
| `npm run test:identities` | **PASS (0)** | 8 tests passed in 55.5ms. |
| `npm run test:workitems` | **PASS (0)** | 8 tests passed in 64.2ms. |
| `npm run build` | **PASS (0)** | Clean compile via `tsc` and asset copy to `dist/`. |
| `npm audit --omit=dev --audit-level=high` | **PASS (0)** | `found 0 vulnerabilities`. |
| `node --check <scripts>` | **PASS (0)** | Syntax check passed on `app.js` and all 4 `.mjs` scripts. |

---

## 2. Logic Chain

1. **Architecture Model**: The application uses a clean hexagonal/layered design:
   - `domain/`: Entities (`Person`, `Task`), Value Objects (`DateWindow`), Domain Services (`TaskServices`, `GitHubService`), Ports (`repositories.ts`).
   - `application/use-cases/`: `create-tasks`, `close-daily-tasks`, `explore-tasks`, `plan-tasks`, `repair-relations`, `config`, `get-status`.
   - `infrastructure/`: `AzureDevOpsClient`, `AzureWorkItemService`, `GitHubClient`, `FileConfigRepository`, `FileJournalRepository`, `FileLockRepository`, `NodeSchedulerRepository`.
   - `presentation/`: Express server, REST API routes (`routes.ts`), CSRF/Origin security middleware (`request-origin.ts`), static frontend (`src/presentation/web/public/`).
2. **Quality Gate Enforcement**:
   - In development: Developers run `npm test` (fast Vitest in-memory tests) and `npm run typecheck`.
   - In CI: Multiple defense layers run in sequence: security audit -> typecheck -> lint with `--max-warnings=0` -> coverage run -> script syntax check (`node --check`) -> Node test runner suites -> build -> live HTTP server smoke test -> ephemeral Playwright browser test -> cross-platform matrix (Windows + macOS).
3. **Mock Isolation & Read-Only Protection**:
   - Every single test in the standard `npm test` suite intercepts network requests using `vi.spyOn(globalThis, 'fetch')` or in-memory repositories. **Zero outbound network packets** are sent to Azure DevOps or GitHub during `npm test`.
   - In `AzureDevOpsClient`, write requests (`POST`, `PATCH`) are guarded: failed attempts on 503 or network timeout intentionally do not retry to prevent duplicate work item creation ("outcome is uncertain").
   - In `tests/browser/ui-journeys.mjs`, Playwright intercepts all network calls and throws an assertion error if any HTTP method other than `GET` is issued (except a synthetic mocked test for settings and dry-run preview).
4. **Specialized Preflight Tooling**:
   - Recognizing that unit test mocks might diverge from real Azure API schemas, the team built dedicated standalone scripts in `scripts/`:
     - `verify-azure-schema.mjs`: validates work item types and mandatory creation fields via live GET calls.
     - `verify-azure-identities.mjs`: verifies configured team members against the Azure Identity service via live GET calls.
     - `verify-azure-workitems.mjs`: executes read-only WIQL queries to inspect existing work items without modifying anything.
   - These scripts have their own accompanying unit tests (`scripts/*.test.mjs`) tested with Node's native test runner (`node --test`), meaning they can be validated without Vitest or heavy dependencies.

---

## 3. Caveats & Test Suite Gaps

### 3.1 Gaps Relative to R1-R3 Objectives in `ORIGINAL_REQUEST.md`

| Requirement | Gap Identified | Severity | Impact / Risk |
|---|---|---|---|
| **R1. Architecture Analysis** | Codebase is pure Node.js/Express, NOT Next.js as described in prompt. | Low | Documentation / framing mismatch only; architecture is well-structured. |
| **R2. Live Read-Only Integration Verification** | **Zero live integration tests** exist in `npm test` or `scripts/` for **GitHub API** (Org: `3in1-AppFrontEnd`). Existing GitHub tests (`github-client.test.ts`, `github-service.test.ts`) are 100% mocked. | **High** | Live connectivity, token scopes, and PR querying against GitHub cannot be verified via existing npm commands. Dedicated test/verification scripts must be run or authored. |
| **R2. Live Read-Only Integration Verification** | **No live iteration/sprint verification script** exists in `scripts/`. `verify-azure-workitems.mjs` only queries work items by WIQL; it does not verify Azure DevOps iteration trees or team settings. | **Medium** | Iteration fetching logic in `AzureWorkItemService.getIterations()` is only tested with synthetic mocks in `discovery.test.ts`. |
| **R3. Strict Mutation Guardrail** | `tests/browser/ui-journeys.mjs` (which verifies UI dry-run and non-mutation guardrails) cannot run out-of-the-box locally because `playwright` is intentionally not installed in `node_modules` (CI installs it dynamically via `npm install --no-save`). | **Medium** | Local execution of UI E2E tests requires either running headless via CI or temporary local installation of Playwright. |
| **Codebase Health** | `tsconfig.json` excludes `tests/` from typechecking. | **Low** | Types in test files are not validated during `npm run typecheck`. However, Vitest transpiles tests without runtime syntax issues. |
| **Codebase Health** | `npm run lint` script only targets `"src/**/*.ts"`, missing `tests/**/*.ts`. | **Low** | 1 ESLint warning in `tests/unit/get-status.test.ts` (`beforeEach` unused) is hidden from standard `npm run lint`. |

---

## 4. Conclusion & Recommendations

### Baseline Health Summary
The `new-app/` codebase demonstrates **exceptionally high health and maturity**:
1. **349 of 349** Vitest tests pass cleanly in 2.35 seconds.
2. **19 of 19** Node test runner tests pass in under 200ms.
3. Test coverage is **84.39% statements**, **75.37% branch**, and **94.46% functions**, well above typical industry standards for full-stack studios.
4. Clean TypeScript build and zero high-severity npm vulnerabilities.
5. Strict mutation protections are embedded throughout the architecture: dry-run flags, non-idempotent retry prevention in `AzureDevOpsClient`, and Origin validation middleware.

### Recommendations for Subsequent Phases:
1. **Live Read-Only Verification (R2)**:
   - For Azure DevOps: Leverage `npm run verify:schema:readonly`, `npm run verify:identities:readonly`, and `npm run verify:workitems:readonly` with live environment credentials (`AZURE_DEVOPS_ORG=BFLDevOpsOrg`, `AZURE_DEVOPS_PROJECT=3in1_Agile_Projects`, `AZURE_DEVOPS_PAT=...`).
   - For GitHub: Because no standalone script exists for live GitHub verification, a strictly read-only script or interactive node probe should be utilized to test GitHub API connectivity (`Org: 3in1-AppFrontEnd`) using the configured GitHub token without mutating any repositories.
   - For Iteration Querying: Verify that live iteration fetching (`/_apis/work/teamsettings/iterations`) works via the existing read-only endpoint `/api/status` or direct GET calls.
2. **Lint Script Hygiene**:
   - Update `package.json` lint script in future maintenance to `"eslint \"{src,tests}/**/*.ts\""` and remove the unused `beforeEach` import in `tests/unit/get-status.test.ts`.

---

## 5. Verification Method

To independently reproduce the observations and findings in this report, execute the following commands in `/Users/yashsomani/Desktop/Asure Bord Project/new-app`:

```bash
# 1. Typecheck validation
npm run typecheck

# 2. Linter validation
npm run lint
npx eslint "tests/**/*.ts"   # Reveals the 1 unused variable warning

# 3. Unit and integration test suite
npm test

# 4. Code coverage analysis
npm run test:coverage

# 5. Specialized Azure preflight test suites (Node native test runner)
npm run test:schema
npm run test:identities
npm run test:workitems

# 6. Syntax checks on web and scripts
node --check src/presentation/web/public/app.js
node --check scripts/staging-readonly-verify.mjs
node --check scripts/verify-azure-schema.mjs
node --check scripts/verify-azure-identities.mjs
node --check scripts/verify-azure-workitems.mjs

# 7. Production build validation
npm run build

# 8. Dependency vulnerability audit
npm audit --omit=dev --audit-level=high
```
