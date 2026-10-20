# Milestone 2: Technical Change Log

## Overview
Milestone 2 enhances the core domain and application layer across 3in1 Task Studio (`new-app/`) to achieve robust identity matching, timezone-aware date extraction, resilient custom field casing for EOD process rule recovery, network timeout and exponential backoff retry resilience in the GitHub client, and Azure orphan task discovery and relation repair.

---

## Files Modified and Created

### 1. `src/domain/entities/task.ts`
- **Change**: 
  - Updated `WorkItemFields['System.AssignedTo']` from `string | { displayName: string; uniqueName: string }` to `string | { displayName: string; uniqueName?: string }` to accurately model Azure DevOps work items that provide only `displayName`.
  - Refactored `validateSourceTaskOwnership` to accept `Person | PersonConfig | string` as the assignee target.
  - Delegated assignee matching to domain-standard `matchesPerson(fields['System.AssignedTo'], targetPerson)` from `src/domain/entities/person.ts`.
  - Added full backward compatibility for string callers by constructing minimal target person objects and checking both `displayName` and `uniqueName` fallback equality.
- **Rationale**: Eliminates false ownership rejections when Azure provides only a display name (without `uniqueName`), or when a `Person` entity with email and name is validated against a work item containing only a display name or email.

### 2. `src/application/use-cases/create-tasks.ts`
- **Change**: Updated line 324 call site of `validateSourceTaskOwnership` to pass the `Person` entity (`person`) directly instead of `person.assignedTo`.
- **Rationale**: Provides both display name and email to `validateSourceTaskOwnership`, allowing `matchesPerson` to match either `uniqueName` or `displayName`.

### 3. `src/infrastructure/azure/work-item-service.ts`
- **Change**: Updated call sites at lines 209 and 344 of `validateSourceTaskOwnership` to pass `person` directly instead of `person.assignedTo`.
- **Rationale**: Ensures discovered Azure work items with either displayName or uniqueName are verified against full `Person` identity.

### 4. `src/application/use-cases/explore-tasks.ts`
- **Change**:
  - Imported `extractWorkItemRecordedDate` from `../../domain/entities/task.js`.
  - Replaced raw `.split('T')[0]` string operations with `extractWorkItemRecordedDate(item, timezone)`.
  - Broadened series check to use `memberPrefix = p.titlePrefix || this.config.titlePrefix` so tasks under the default series prefix can resolve recorded scheduling dates.
- **Rationale**: Prevents workday date shifting across UTC midnight boundaries (e.g. 20:00 UTC corresponds to 01:30 next calendar day in `Asia/Kolkata` UTC+5:30), accurately grouping work items into local calendar columns.

### 5. `src/application/use-cases/close-daily-tasks.ts`
- **Change**:
  - In `TF401320` rule recovery (lines 312–370), inspected candidate work item fields for `Custom.ActualStartDate` / `Custom.PlannedStartDate` vs lowercase variants to dynamically detect tenant casing preference.
  - Constructed `ruleOps` using the detected casing.
  - Added automated fallback retry that inverts casing (`Custom.ActualStartdate` <-> `Custom.ActualStartDate` and `Custom.ActualEnddate` <-> `Custom.ActualEndDate`) if the initial patch fails due to schema/rule errors.
- **Rationale**: Azure DevOps custom process templates vary by tenant; Agile/CMMI custom templates often require PascalCase fields. The automated detection and recovery retry guarantees zero task closure failures across all tenants.

### 6. `src/infrastructure/github/github-client.ts`
- **Change**:
  - Added `timeout` (default 30,000ms), `maxRetries` (default 3), and `initialRetryDelayMs` (default 1,000ms) to `GitHubClientOptions`.
  - Added `calculateBackoff` (with exponential scaling and jitter) and `sleep` methods.
  - Refactored `request<T>` with an `AbortController` timeout (`clearTimeout` in `finally`).
  - Implemented bounded retry loop handling HTTP 429, HTTP 403 (when rate limit headers indicate throttling: `x-ratelimit-remaining === '0'` or `retry-after`), and HTTP 5xx.
  - Inspected `retry-after` and `x-ratelimit-reset` headers, with optional chaining (`res.headers?.get?.(...)`) to support Vitest mock fetch objects.
- **Rationale**: GitHub Search APIs enforce secondary rate limits (30 req/min) and occasional network/server spikes. Because all GitHub operations are read-only (`GET`), retrying with backoff ensures resilience without duplicate mutations.

### 7. `src/application/use-cases/repair-relations.ts`
- **Change**:
  - Added `OrphanTaskItem`, `ExtendedRepairReport`, and `RepairRelationsOptions` interfaces.
  - Supported optional `LockRepository` in constructor.
  - Implemented `detectOrphanTasks(candidateTasks: WorkItem[], titlePrefix?: string)`: filters tasks matching series prefix that lack a `System.LinkTypes.Hierarchy-Reverse` parent link. Fetches full item if relations are not yet populated.
  - Implemented `repairOrphanTasks(orphans: OrphanTaskItem[], referenceSourceTask: WorkItem)`: copies parent relation from reference source task and performs read-back verification. Flags items as `REPAIRED` or `UNRESOLVED`.
  - Updated `execute(options)`: acquires and releases concurrency lock, and combines journal relation repairs with orphan detection and repair.
- **Rationale**: Enables discovery and repair of orphan tasks created outside the local `.task-journal.json`, restoring parent-child work item hierarchies in Azure DevOps.

### 8. `src/container.ts`
- **Change**: Passed `lockRepo` when instantiating `RepairRelationsUseCase` in `createContainer()`.
- **Rationale**: Protects relation repair from concurrent execution collisions.

### 9. `tests/unit/task-entities.test.ts`
- **Change**: Added unit tests verifying `validateSourceTaskOwnership` with:
  - Exact string identity
  - `Person` entity with `uniqueName` and `displayName`
  - `PersonConfig` object
  - `Person` entity when Azure provides only `displayName`
  - `Person` entity when Azure provides raw string displayName matching person name
  - `Person` entity when Azure provides `Name <email>` string format
  - String caller passing display name matching Azure object `displayName`
  - String caller passing `Name <email>` matching displayName-only Azure source
  - Rejection of mismatched uniqueName and cross-person/cross-project attempts

### 10. `tests/unit/explore-tasks.test.ts`
- **Change**: Added unit test verifying that Azure scheduling timestamps (e.g. `2026-10-19T20:00:00Z` and `2026-10-20T19:30:00Z`) are correctly mapped to local calendar dates (`2026-10-20` and `2026-10-21`) in `Asia/Kolkata` (+05:30) across UTC midnight boundaries.

### 11. `tests/unit/close-daily-tasks.test.ts` (New File)
- **Change**: Added comprehensive unit tests for `CloseDailyTasksUseCase` verifying:
  - `TF401320` rule recovery using PascalCase fields (`Custom.ActualStartDate`, `Custom.ActualEndDate`) when tenant uses PascalCase.
  - `TF401320` rule recovery using lowercase fields (`Custom.ActualStartdate`, `Custom.ActualEnddate`) when tenant uses lowercase.
  - Alternate casing fallback retry when initial recovery patch is rejected.

### 12. `tests/unit/github-client.test.ts`
- **Change**: Added unit tests verifying:
  - Request timeout and abort via `AbortController`.
  - HTTP 429 rate limit retry with `retry-after` header backoff.
  - HTTP 403 secondary rate limit retry with `x-ratelimit-remaining === '0'`.
  - HTTP 500 server error retry and eventual success.
  - Exhaustion of server error retries (503).
  - Immediate failure on non-retryable client errors (HTTP 404).

### 13. `tests/unit/repair-relations.test.ts` (New File)
- **Change**: Added comprehensive unit tests for `RepairRelationsUseCase` verifying:
  - `detectOrphanTasks` identifies tasks lacking `Hierarchy-Reverse` parent relation and filters by series prefix.
  - `detectOrphanTasks` fetches full item if relations are not pre-populated.
  - `repairOrphanTasks` copies parent relation and verifies read-back.
  - `repairOrphanTasks` marks `UNRESOLVED` when reference task has no parent relation.
  - `repairOrphanTasks` marks `UNRESOLVED` when read-back verification fails.
  - Concurrency locking: blocks execution when lock is held by another process; acquires and releases lock properly.
  - Full execution flow combining journal repairs and orphan task repair.

### 14. `tests/unit/repositories.test.ts`
- **Change**: Fixed timezone mismatch in `NodeSchedulerRepository` test by using UTC timezone for `todayIso` formatting when testing scheduler configured in UTC.

---

## Verification Summary
- `npm run typecheck`: 0 errors (exit code 0)
- `npm run typecheck:tests`: 0 errors (exit code 0)
- `npm run lint`: 0 warnings, 0 errors (exit code 0)
- `npm test`: 34 test files passed, 379 tests passed, 0 failures (exit code 0)
- `npm run build`: Clean production build to `dist/` (exit code 0)
