# Product Requirements Document (PRD) & Task Matrix
## Autonomous Legacy-to-New-App Reconstruction & Parity Completion

This document defines the discrete task backlog for bringing `new-app` to complete, verified parity with and superiority over `Legacy`.

---

## 1. Core Objectives
- Ensure **100% of legitimate Legacy features** are architected, implemented, and verified in `new-app`.
- Maintain clean Hexagonal / DDD architecture with TypeScript, ESM, Node >= 22, Express 5.
- Keep `Legacy/` strictly as a reference without runtime dependencies.
- Deliver a premium, responsive, accessible, dark/light-themed UI with interactive charts, coverage matrix, burndown intelligence, and audit logging.
- Ensure all automated unit and integration tests pass, with full typecheck and build validation.

---

## 2. Iterative Task Backlog (Ralph Loop)

### Milestone 1: Domain & Application Layer Reconstitution
- [x] Task 1.1: Design and implement `ExploreTasksUseCase` in `new-app/src/application/use-cases/explore-tasks.ts` supporting date presets, arbitrary start/end range, team filtering, work calculation, and matrix aggregation.
- [x] Task 1.2: Add candidate task query support to `WorkItemRepository` and `AzureWorkItemService` in `new-app/src/infrastructure/azure/work-item-service.ts` to support fetching candidate work items by title prefix and project.
- [x] Task 1.3: Expose `/api/explorer` and `/api/explorer/create-missing` in `new-app/src/presentation/api/routes.ts` with comprehensive unit and integration tests.

### Milestone 2: UI Feature Parity & View Reconstitution
- [x] Task 2.1: Reconstitute and polish the **Audit Log (Journal)** view in `new-app/src/presentation/web/public/index.html` and `app.js` with stats chips, filtering, pagination, and CSV/JSON export.
- [x] Task 2.2: Build the **Intelligent Task Explorer** view in `new-app` UI with preset dropdowns, date picker range, member search & filter pills, KPI summary bar, Coverage Matrix, and Detailed Tasks table with sorting and filtering.
- [x] Task 2.3: Build the **Daily Burndown & Work Intelligence** view in `new-app` UI with month selector, effort distribution charts, burndown matrix, and workload summaries.
- [x] Task 2.4: Build the **My Work** personal developer view in `new-app` UI with assigned tasks, states, dates, and quick ADO links.
- [x] Task 2.5: Implement interactive modal dialogs: **Date Inspection Modal**, **User Inspection Modal**, and **Execution Confirmation Modal** in `new-app/src/presentation/web/public`.
- [x] Task 2.6: Implement the **Live Execution Console Drawer** and topbar trigger in `new-app` for viewing streaming logs during background runs.

### Milestone 3: Verification, Testing & Polish
- [x] Task 3.1: Write automated tests in `new-app/tests/unit` and `new-app/tests/integration` covering `explore-tasks.ts` and explorer API endpoints.
- [x] Task 3.2: Verify full build (`npm run build`), typecheck (`npm run typecheck`), and tests (`npm test`) in `new-app`.
- [x] Task 3.3: Update documentation in `new-app/docs/FEATURE_PARITY.md`, `ARCHITECTURE.md`, `TEST_RESULTS.md`, and `PRODUCTION_READINESS.md`.

### Milestone 4: Multi-POD Title Intelligence & Instant Member Synchronization
- [x] Task 4.1: Engineer resilient date parser in `new-app/src/domain/entities/task.ts` and `Legacy/src/date/parser.ts` supporting colon, hyphen, pipe, full month names, and start-of-title dates.
- [x] Task 4.2: Add candidate work item query filtering by team member identities (`[System.AssignedTo] IN (...)`) and scheduling date fallbacks (`Custom.PlannedStartdate`, `Custom.ActualStartdate`).
- [x] Task 4.3: Implement immediate multi-view cache invalidation and forced re-fetch (`{ forceFresh: true }`) for Explorer, Planner, My Work, and Burndown upon saving or adding team members.

### Milestone 5: 1-Click Task Creation & UI Action Workflows
- [x] Task 5.1: Wire 1-click single task creation (`#btnCreateSingleMissingTask`) into Date Inspect Modal for any flagged missing date.
- [x] Task 5.2: Add direct "+ Create" action button in Detailed Task Explorer list for missing days.
- [x] Task 5.3: Ensure comprehensive task redirection links to Azure DevOps exist across Explorer, My Work, Burndown, and inspection modals.
- [x] Task 5.4: Execute end-to-end verification, typechecks, and test suites across all 122 tests in `new-app` and 75 tests in `Legacy`.
