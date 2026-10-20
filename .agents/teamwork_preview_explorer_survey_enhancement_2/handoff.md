# Survey Explorer 2: Core Task Planning, Creation, Repair Engine & Integrations Audit

**Executive Summary:**
A comprehensive architectural and functional audit of the 3in1 Task Studio (`new-app/`) confirms a robust Hexagonal DDD architecture, strict zero-mutation guardrails, and 353 passing tests. However, critical gaps exist: (1) `validateSourceTaskOwnership` relies on fragile string comparison rather than `matchesPerson`, (2) `explore-tasks` raw UTC date splitting causes workday shifts across UTC midnight boundaries in non-UTC timezones, (3) `close-daily-tasks` TF401320 recovery uses fixed-case custom field names (`Custom.ActualStartdate`) risking rejection on PascalCase process templates, (4) `repair-relations` lacks concurrency locking and orphan detection in Azure DevOps, and (5) `GitHubClient` lacks retries, timeout configuration, and rate-limit backoff.

---

## 1. Observation

### 1.1 Domain Entities and Value Objects

1. **`Person` Entity (`src/domain/entities/person.ts`)**:
   - Lines 42-62: `extractIdentity(assignedToVal: unknown)` safely parses identity objects (`{ displayName, uniqueName }`) and string representations (`"Name <email@domain>"`, `"email@domain"`, `"Name"`).
   - Lines 67-89: `matchesPerson(assignedToVal: unknown, person: PersonConfig | Person): boolean` performs authoritative matching:
     ```ts
     if (identity.uniqueName) {
       const unique = identity.uniqueName.toLowerCase().trim();
       return unique === targetEmail;
     }
     if (identity.displayName) {
       const display = identity.displayName.toLowerCase().trim();
       return display === targetName || display === targetEmail;
     }
     ```
   - Lines 113-127: `validatePerson` validates `githubRepositories` (max 12, valid owner/repo regex, no path traversal `.` or `..`) and `githubBranches` (max 12, length <= 128, valid ref regex).

2. **`Task` Entity (`src/domain/entities/task.ts`)**:
   - Lines 77-88: `COPYABLE_RELATION_TYPES` establishes an explicit whitelist (`Hierarchy-Reverse` [Parent], `Related`, `Dependency-Forward`, `Dependency-Reverse`, `Dependency-Predecessor`, `Dependency-Successor`, `Duplicate-Forward`, `Duplicate-Reverse`, `Hyperlink`, `ArtifactLink`).
   - Lines 97-100: `EXCLUDED_RELATION_TYPES` forbids copying `Hierarchy-Forward` (preventing accidental child reparenting) and `AttachedFile`.
   - Lines 136-236: `parseTitleDate` implements multi-mode parsing (prefix-anchored regex, segment scanning across pipes/colons/hyphens, start-of-title dates, anywhere-in-title dates) with valid month/day checks.
   - Lines 242-267: `extractWorkItemRecordedDate(item: WorkItem, timezone: string)` converts Azure scheduling timestamps (`Custom.PlannedStartdate`, `Microsoft.VSTS.Scheduling.StartDate`, `Custom.ActualStartdate`) into target timezone local ISO dates via `Intl.DateTimeFormat('en-CA', { timeZone: timezone })`.
   - Lines 276-363: `parseWorkItemTaskDate` anchors yearless task titles to recorded Azure dates in the target timezone, rejecting mismatches (`if (hadRecordedDate) return { ...parsed, isoDate: '', year: 0, isValid: false };`) and enforcing `requireRecordedWorkday` during EOD operations.
   - **Discrepancy in `validateSourceTaskOwnership` (Lines 407-415)**:
     ```ts
     const raw = fields['System.AssignedTo'];
     let actualIdentity: string | undefined;
     if (typeof raw === 'string') {
       actualIdentity = raw.match(/<([^>]+)>/)?.[1] || raw.trim();
     } else if (raw && typeof raw === 'object') {
       actualIdentity = String((raw as any).uniqueName || (raw as any).displayName || '').trim();
     }
     if (!actualIdentity || !same(actualIdentity, assignedTo)) {
       throw new Error(`Source work item #${workItem.id} is not assigned to the selected team member.`);
     }
     ```
     `validateSourceTaskOwnership` takes `assignedTo: string` instead of a `Person` entity and relies on direct string equality (`same(actualIdentity, assignedTo)`). When Azure provides only `displayName` or when `assignedTo` is an email while the source item only exposes display name, this check throws even though `matchesPerson` would consider the identity valid.

3. **`DateWindow` Value Object (`src/domain/value-objects/date-window.ts`)**:
   - Lines 39-52: `getTodayIso(timezone)` safely extracts local wall-clock dates in IANA timezones.
   - Lines 99-125: `zonedTimeToUtcIso(isoDate, hhmm, timeZone)` converts wall-clock local time into UTC instants.
   - Lines 134-203: `computeTaskCloseTimestamp(targetDate, timezone, startTimeStr, endTimeStr, now)` generates randomized EOD closure timestamps bounded between `startTimeStr` (18:15) and `endTimeStr` (18:45), with strict clamping ensuring `targetUtc <= now.toISOString()`.
   - Lines 280-295: `validateNotPastDate(requestedIso, actualTodayIso)` enforces that tasks are only created for the current or future dates (`requestedIso >= actualTodayIso`).

4. **Domain Services (`src/domain/services/task-services.ts`, `github-service.ts`)**:
   - `FieldCopyService` (lines 197-227): Comprehensive blacklist of system and lifecycle fields (`System.Id`, `System.Rev`, `System.Watermark`, `System.History`, `Microsoft.VSTS.Common.ActivatedDate`, `ClosedDate`, etc.). Dynamically injects `Custom.GenAIEnabled` defaulting to `'No'`.
   - `RelationCopyService` (lines 300-320): `repairRelations` computes difference between source relations and target relations (`targetKeys = new Set((target.relations ?? []).map(r => ...))`), achieving complete idempotency.
   - `GitHubService` (lines 56-73): `deriveGitHubUsernameFromEmail` converts corporate emails (`local.part@corp.com`) to GitHub EMU usernames (`local-part_bflghec`). Lines 77-84 implement HTML escaping for rich-text descriptions.

---

### 1.2 Application Use Cases

1. **`CreateTasksUseCase` (`src/application/use-cases/create-tasks.ts`)**:
   - Lines 174-178: Acquires exclusive single-host file lock via `this.lockRepo.acquire()`, releasing in `finally`.
   - Lines 197-198: Enforces `validateNotPastDate(configuredTodayIso, actualTodayIso)`.
   - Lines 253: Pre-validates local journal accessibility (`await this.journalRepo.getEntries(1)`) *before* issuing remote Azure mutations.
   - Lines 135-168: `verifyCreatedTask` independently reads back the created Azure work item and verifies ID, Title, AssignedTo (via `matchesPerson`), WorkItemType, State, Start Date (within 1000ms), and copyable relations.
   - Lines 285-442: `executeAdHocTask` allows single ad-hoc task creation with explicit parameters (`targetIsoDate`, `customTitle`, `originalEstimate`, `activity`, `description`). Lines 298-300 strictly forbid bypassing duplicate checks:
     ```ts
     if (input.bypassDuplicateCheck) {
       throw new Error('Bypassing duplicate detection is disabled for task safety.');
     }
     ```
   - Lines 829-845: `promptConfirm` checks `process.stdin.isTTY` and halts execution if non-interactive without `--yes`, preventing automated command hanging.

2. **`CloseDailyTasksUseCase` (`src/application/use-cases/close-daily-tasks.ts`)**:
   - Lines 90-94: Concurrency lock acquired when `!isDryRun`.
   - Lines 155-157: Uses `parseWorkItemTaskDate(item, personPrefix, activeConfig.timezone, true)` with `requireRecordedWorkday = true`, ensuring historical tasks without recorded scheduling fields cannot be closed by accident.
   - Lines 216-243: Detects already-closed items (`isClosedState` or `hasClosedDate`) and skips them cleanly.
   - Lines 289-294: Validates recorded completed and remaining work hours; appends audit entry into `System.History` preserving historical actuals.
   - **Discrepancy in Process Rule Error Recovery (Lines 312-335)**:
     When Azure DevOps returns rule validation error `TF401320`, recovery ops are added:
     ```ts
     ruleOps.push({ op: 'add', path: '/fields/Custom.ActualStartdate', value: String(plannedStart || `${targetDate}T04:00:00Z`) });
     ruleOps.push({ op: 'add', path: '/fields/Custom.ActualEnddate', value: `${targetDate}T13:00:00Z` });
     ```
     Notice that fields are hardcoded to `Custom.ActualStartdate` and `Custom.ActualEnddate` (lowercase 'd'). If an Azure DevOps process template defines `Custom.ActualStartDate` or `Custom.ActualEndDate` (PascalCase), the patch operation fails.

3. **`ExploreTasksUseCase` (`src/application/use-cases/explore-tasks.ts`)**:
   - Lines 143-199: 9 built-in date presets (`today`, `yesterday`, `this_week`, `last_week`, `current_month`, `previous_month`, `last_7_days`, `last_30_days`, `today_to_next_thursday`).
   - Lines 244-250: Enforces `MAX_DAYS = 120` to prevent unbounded range queries.
   - Lines 360-538: Aggregates metrics per user and across the organization: state distributions (`New`, `Active`, `Closed`, `Resolved`), coverage percentage, recorded vs. unrecorded completed work hours.
   - **Discrepancy in Fallback Date Extraction (Lines 331-339)**:
     ```ts
     if (item.fields['Custom.PlannedStartdate']) {
       itemDate = String(item.fields['Custom.PlannedStartdate']).split('T')[0];
     } else if (item.fields['Microsoft.VSTS.Scheduling.StartDate']) {
       itemDate = String(item.fields['Microsoft.VSTS.Scheduling.StartDate']).split('T')[0];
     } else if (item.fields['Custom.ActualStartdate']) {
       itemDate = String(item.fields['Custom.ActualStartdate']).split('T')[0];
     }
     ```
     Unlike `extractWorkItemRecordedDate` in `task.ts` which uses `Intl.DateTimeFormat` with the configured timezone, `explore-tasks.ts` uses `.split('T')[0]`. In non-UTC timezones (e.g. `Asia/Kolkata` UTC+5:30), any timestamp before 00:00 UTC (e.g. `2026-10-18T20:00:00Z`, which is `2026-10-19 01:30` IST) will be extracted as `2026-10-18`, shifting the task to the prior day.

4. **`PlanTasksUseCase` (`src/application/use-cases/plan-tasks.ts`)**:
   - Pure read-only use case mirroring task planning without lock acquisition or Azure mutations.

5. **`RepairRelationsUseCase` (`src/application/use-cases/repair-relations.ts`)**:
   - Lines 38-100: Iterates through `this.journal.getUnfinishedRelations()`, fetches source and target work items, applies idempotent relation copying, verifies read-back relations, and updates journal records.
   - **Gaps**:
     - **Missing Lock**: `RepairRelationsUseCase` does not instantiate or acquire `LockRepository`. If relation repair is executed via CLI (`npm start -- repair --yes`) while another user triggers `create-tasks` or `close-daily-tasks`, concurrent mutations can occur.
     - **Journal-Only Scope**: Only repairs tasks recorded in the local `.task-journal.json`. It cannot discover or repair orphan work items created outside the local journal or if the journal was purged.

---

### 1.3 Infrastructure Adapters & Cloud Integrations

1. **`AzureDevOpsClient` (`src/infrastructure/azure/client.ts`)**:
   - Lines 77-78: Non-replayable write boundary:
     ```ts
     const replaySafe = method === 'GET' ||
       (method === 'POST' && /\/_apis\/wit\/wiql(?:\?|$)/i.test(path));
     ```
   - Lines 113-138: Write requests (`POST` to workitems, `PATCH`) do *not* retry on HTTP 429, 500, or network timeouts; they throw immediately with `AzureClientError(..., retryable: false)`. This strictly prevents duplicate task creation.
   - Lines 96-110: Proper `AbortController` timeout management (default 30s) with `clearTimeout` in `finally`.
   - Lines 120-125: Exponential backoff with jitter and `Retry-After` header parsing for read-only requests.

2. **`AzureWorkItemService` (`src/infrastructure/azure/work-item-service.ts`)**:
   - Lines 32-41: `requireCompleteBatch` validates batch responses from Azure DevOps, throwing if IDs are missing.
   - Lines 124, 265, 423, 532: Chunks requests to 100 IDs per batch (`CHUNK_SIZE = 100`).
   - Lines 120, 261, 407, 528: Caps candidates to 5,000 items to avoid out-of-memory or timeout errors.
   - Line 675: `escapeWiql(value)` escapes single quotes for WIQL injection defense.

3. **`GitHubClient` (`src/infrastructure/github/github-client.ts`)**:
   - Exclusively issues HTTP `GET` requests (`/search/users`, `/search/commits`, `/search/issues`, `/repos/{owner}/{repo}/commits`). Zero mutation methods exist.
   - Lines 159-164: Rejects incomplete search results (`data.incomplete_results === true`) and searches exceeding 1,000 items.
   - Lines 212-213: Limits repository/branch combinations to 20 to prevent excessive API load.
   - **Gaps**:
     - **No Retry or Rate-Limit Handling**: `request` directly invokes `fetchFn` and throws immediately on `!res.ok`. If GitHub returns HTTP 429 or HTTP 403 (search API rate limit: 30 requests/min), the call fails without backoff or `x-ratelimit-reset` parsing.
     - **No Request Timeout**: Unlike `AzureDevOpsClient`, `GitHubClient.request` does not use an `AbortController` or timeout, meaning hung connections can block indefinitely.

4. **`FileLockRepository`, `FileJournalRepository`, `NodeSchedulerRepository`**:
   - `FileLockRepository`: Single-host concurrency lock (`.execution-lock.json`) with exclusive creation flag `wx`, PID liveness check (`process.kill(pid, 0)`), and ownership UUID token.
   - `FileJournalRepository`: Atomic writes (`fs.openSync`, `fs.writeFileSync`, `fs.fsyncSync`, `fs.renameSync`), log rotation at 10MB or 10,000 entries into `.journal-archives/`, CSV formula injection defense.
   - `NodeSchedulerRepository`: Heartbeat check (60s interval) for missed auto-close windows, persistent attempt tracking (`lastAutoClose`) before remote calls to prevent repeat retries, jittered randomization (18:15–18:45).

---

### 1.4 Test Suite & Diagnostics Execution

- `npm test`: Executed Vitest across 32 test suites (14 unit, 17 integration, 1 additional). All 353 tests passed with exit code 0.
- `npm run typecheck`: `tsc --noEmit` executed with exit code 0 and zero TypeScript errors.
- `npm run lint`: `eslint "src/**/*.ts"` executed with exit code 0 and zero lint violations.

---

## 2. Logic Chain

### Step 1: Identity Matching Discrepancy in Source Task Ownership Validation
- **Premise**: In `src/domain/entities/person.ts`, `matchesPerson` is the domain standard for identity matching, checking both `uniqueName` (email) and `displayName` against `person.assignedTo` and `person.name`.
- **Observation**: In `src/domain/entities/task.ts:407-415`, `validateSourceTaskOwnership` manually resolves `actualIdentity` from `uniqueName || displayName` and evaluates `same(actualIdentity, assignedTo)`.
- **Deduction**: If a user configures `person.assignedTo` as their email address (e.g. `jane.doe@company.com`) but the source task's `System.AssignedTo` is returned by Azure with only `displayName` (`"Jane Doe"`), `validateSourceTaskOwnership` throws an error: `Source work item #${workItem.id} is not assigned to the selected team member.`
- **Remedy**: Update `validateSourceTaskOwnership` to accept `Person` (or use `matchesPerson(fields['System.AssignedTo'], person)`), aligning with domain modeling principles.

### Step 2: Timezone Midnight Boundary Shift in Explorer Task Matrix
- **Premise**: Azure DevOps WIT stores timestamps in UTC. In a timezone like `Asia/Kolkata` (UTC+5:30), UTC times between 18:30 and 23:59 belong to the *next* calendar day locally.
- **Observation**: `src/domain/entities/task.ts:242-267` (`extractWorkItemRecordedDate`) correctly uses `Intl.DateTimeFormat('en-CA', { timeZone: timezone })`. However, `src/application/use-cases/explore-tasks.ts:331-339` extracts date via:
  `itemDate = String(item.fields['Custom.PlannedStartdate']).split('T')[0];`
- **Deduction**: A task scheduled at 20:00 UTC on 2026-10-18 (which is 01:30 AM IST on 2026-10-19) is parsed by `.split('T')[0]` as `2026-10-18`. In the Explorer matrix, it displays on October 18 instead of October 19.
- **Remedy**: Replace raw string splitting in `explore-tasks.ts` with `extractWorkItemRecordedDate(item, timezone)` or timezone-aware ISO formatting.

### Step 3: Custom Field Casing Vulnerability During Tenant Rule Error Recovery
- **Premise**: Azure DevOps process templates vary across organizations: some define `Custom.ActualStartdate` and `Custom.ActualEnddate`, while others define `Custom.ActualStartDate` and `Custom.ActualEndDate` (PascalCase).
- **Observation**: In `close-daily-tasks.ts:327-330`, when handling `TF401320` rule errors, patch operations only target `Custom.ActualStartdate` and `Custom.ActualEnddate`. In contrast, `FieldCopyService` (lines 160-165) and `extractWorkItemRecordedDate` check both casing conventions.
- **Deduction**: If an organization’s process template requires `Custom.ActualStartDate` (capital D), the recovery patch fails with a schema error.
- **Remedy**: Detect existing field casing on the work item or provide PascalCase aliases in the recovery fallback patch.

### Step 4: Relation Repair Concurrency & Scope Limitations
- **Premise**: Concurrency locks must guard all mutating operations to prevent race conditions and partial states.
- **Observation**: `CreateTasksUseCase` and `CloseDailyTasksUseCase` acquire `LockRepository`. `RepairRelationsUseCase` does not inject or call `LockRepository`. Additionally, `RepairRelationsUseCase` only queries `journal.getUnfinishedRelations()`.
- **Deduction**: If `npm start -- repair --yes` runs concurrently with automated creation or closure, simultaneous patches can conflict. Furthermore, any orphan tasks in Azure DevOps not recorded in the journal cannot be repaired.
- **Remedy**: Inject `LockRepository` into `RepairRelationsUseCase`, and provide an Azure-native orphan task detection mode (querying tasks in the series with zero parent links).

### Step 5: Network Resilience Disparity: Azure Client vs. GitHub Client
- **Premise**: External integrations must handle network jitter, timeouts, and rate limits gracefully.
- **Observation**: `AzureDevOpsClient` features 30s timeouts, non-replayable write boundaries, retry loops with exponential backoff and jitter, and `Retry-After` header handling. `GitHubClient.request` lacks timeouts, retries, and rate limit backoff.
- **Deduction**: If GitHub returns HTTP 429 or HTTP 403 (Search API rate limit: 30 req/min) during EOD PR fetching or daily summary, `GitHubClient` fails immediately, causing task closure failures.
- **Remedy**: Equip `GitHubClient` with a request timeout (AbortController) and bounded retry logic with exponential backoff on HTTP 429/403/5xx for read-only calls.

---

## 3. Caveats

1. **Live Remote Mutations Were Not Performed**: In strict adherence to the zero-mutation guardrail and development integrity mode, no live write operations (`POST` / `PATCH`) were executed against Azure DevOps or GitHub.
2. **Process Template Variations**: Azure DevOps custom field definitions (`Custom.PlannedStartdate` vs `Custom.PlannedStartDate`) depend on the specific XML/inherited process template deployed in the tenant.
3. **GitHub Search API Throttling**: GitHub enforces strict primary and secondary rate limits on unauthenticated and authenticated Search API endpoints (30 queries/minute for authenticated users). This constraint must be considered when scaling to larger teams.

---

## 4. Conclusion

The core task engine, domain architecture, and cloud adapters exhibit high discipline, strong data durability, and explicit safety boundaries. To elevate the system to production-grade resilience, the following actionable improvements are recommended:

### Priority 1: High-Impact Functional & Architectural Fixes
1. **Unify Identity Matching in Source Ownership**:
   Refactor `validateSourceTaskOwnership` to utilize `matchesPerson(fields['System.AssignedTo'], person)` to prevent false rejections when Azure provides displayName instead of uniqueName.
2. **Correct Timezone Date Extraction in Explorer**:
   Replace `.split('T')[0]` in `explore-tasks.ts` with `extractWorkItemRecordedDate(item, timezone)` to prevent date shifting across UTC midnight boundaries.
3. **Resilient Field Casing in EOD Rule Recovery**:
   In `close-daily-tasks.ts`, inspect work item fields for `Custom.ActualStartDate` vs `Custom.ActualStartdate` and apply the matching casing.
4. **Add Lock Repository to Relation Repair**:
   Inject and acquire `LockRepository` in `RepairRelationsUseCase` to guard against concurrent writes.

### Priority 2: Resilience & Integration Enhancements
5. **Add Retry & Timeout to GitHubClient**:
   Introduce an `AbortController` (30s timeout) and retry loop with exponential backoff on HTTP 429, 403 (rate limited), and 5xx to prevent transient network errors from failing EOD closures.
6. **Azure-Native Orphan Task Detection & Repair**:
   Extend `RepairRelationsUseCase` to optionally query Azure DevOps directly for work items matching the task series that lack `System.LinkTypes.Hierarchy-Reverse` parent links.

---

## 5. Verification Method

To independently verify the observations, logic chains, and baseline health documented in this report:

1. **Verify Existing Test Suites**:
   ```bash
   cd "/Users/yashsomani/Desktop/Asure Bord Project/new-app"
   npm test
   ```
   *Expected outcome*: 32 test files pass, 353 tests pass.

2. **Verify Typecheck and Static Analysis**:
   ```bash
   npm run typecheck
   npm run lint
   ```
   *Expected outcome*: Zero errors, clean compilation.

3. **Verify Date Extraction Inconsistency**:
   Inspect `src/application/use-cases/explore-tasks.ts:333` vs `src/domain/entities/task.ts:256-263`. Verify that `explore-tasks.ts` uses `.split('T')[0]` on UTC strings while `task.ts` uses `Intl.DateTimeFormat` with `timezone`.

4. **Verify Identity Matching Discrepancy**:
   Inspect `src/domain/entities/task.ts:407-415` vs `src/domain/entities/person.ts:67-89`. Verify that `validateSourceTaskOwnership` compares `same(actualIdentity, assignedTo)` directly instead of calling `matchesPerson`.

5. **Verify GitHub Client Resilience Discrepancy**:
   Inspect `src/infrastructure/github/github-client.ts:436-455` vs `src/infrastructure/azure/client.ts:94-190`. Verify that `GitHubClient.request` lacks retry loops, backoff delays, and `AbortController` timeouts.

*Invalidation Conditions*: The conclusions regarding `explore-tasks` date shifting would be invalidated if all target organization timezones were UTC+00:00. The relation repair concurrency risk would be invalidated if the application ran strictly in a single-threaded CLI without background scheduler daemon or multi-process access.
