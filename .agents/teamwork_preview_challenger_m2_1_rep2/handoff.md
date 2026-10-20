# Empirical Challenger 1 Verification & Adversarial Stress Report
## Milestone 2: Core Task Engine, Explorer Timezones & Cloud Resilience

- **Author**: Challenger 1 (`teamwork_preview_challenger_m2_1_rep2`)
- **Roles**: `critic`, `specialist`
- **Recipient**: Parent Sub-Orchestrator (`06554438-85bb-4d5c-b552-59bfde4f3f31`)
- **Working Directory**: `/Users/yashsomani/Desktop/Asure Bord Project/.agents/teamwork_preview_challenger_m2_1_rep2`
- **Target Codebase**: `/Users/yashsomani/Desktop/Asure Bord Project/new-app`
- **Scope Reference**: `/Users/yashsomani/Desktop/Asure Bord Project/.agents/teamwork_preview_sub_orch_m2_enhancement_rep/SCOPE.md`
- **Date**: 2026-10-19 / 2026-10-20
- **Final Verdict**: **APPROVE**

---

## 1. Observation

### 1.1 Direct Source Code Observations

1. **Domain Identity Matching (`src/domain/entities/task.ts`)**:
   - **Line 13**: `WorkItemFields['System.AssignedTo']` is typed as:
     ```ts
     'System.AssignedTo'?: string | { displayName: string; uniqueName?: string };
     ```
     This accurately models Azure DevOps WIT API responses where `uniqueName` is omitted for certain account types or legacy identities.
   - **Lines 388–442 (`validateSourceTaskOwnership`)**:
     - Signature:
       ```ts
       export function validateSourceTaskOwnership(
         workItem: WorkItem,
         project: string,
         workItemType: string,
         titlePrefix: string,
         assignedToOrPerson: Person | PersonConfig | string,
       ): ParsedTaskDate
       ```
     - Enforces project equality: `!same(fields['System.TeamProject'], project)` throws `"Source work item #... does not belong to the configured project and task type."` (lines 398–401).
     - Enforces work item type equality: `!same(fields['System.WorkItemType'], workItemType)` throws `"Source work item #... does not belong to the configured project and task type."` (lines 398–401).
     - Enforces series prefix isolation: `!matchesTaskSeries(title, titlePrefix)` throws `"Source work item #... belongs to a different task series."` (lines 403–405).
     - Normalizes `assignedToOrPerson`: if string, extracts email from angle brackets (`Name <email>`) and sets `targetPerson = { key: raw, name, assignedTo: email }`; if `Person` or `PersonConfig`, passes directly (lines 408–416).
     - Delegates matching to:
       ```ts
       let matched = matchesPerson(fields['System.AssignedTo'], targetPerson);
       ```
     - Backwards compatibility fallback for string callers (lines 419–432): checks normalized `uniqueName` and `displayName` against `assignedToOrPerson`.
     - Validates dated task title: `parseTitleDate(title, titlePrefix, true)` ensuring dated title is present before returning (lines 437–441).

2. **Caller Wiring in Application and Infrastructure**:
   - `src/application/use-cases/create-tasks.ts` line 324 passes `person` (`Person` entity) directly to `validateSourceTaskOwnership`.
   - `src/infrastructure/azure/work-item-service.ts` lines 209 and 344 pass `person` (`Person` entity) directly to `validateSourceTaskOwnership`.
   - String callers passing identity strings are fully supported via the fallback normalization path.

3. **Timezone-Aware Recorded Date Extraction (`src/application/use-cases/explore-tasks.ts`)**:
   - **Lines 8–14**: Imports `extractWorkItemRecordedDate` from `../../domain/entities/task.js`.
   - **Lines 334–343**:
     ```ts
     const memberPrefix = p.titlePrefix || this.config.titlePrefix;
     if (!itemDate && (!title.includes('|') || (memberPrefix && matchesTaskSeries(title, memberPrefix)))) {
       const recorded = extractWorkItemRecordedDate(item, timezone);
       if (recorded) {
         itemDate = recorded.isoDate;
       }
     }
     ```
   - Replaced all raw `.split('T')[0]` UTC string operations.
   - Evaluates `extractWorkItemRecordedDate(item, timezone)` which uses `Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' })` across candidate fields: `Custom.PlannedStartdate`, `Custom.PlannedStartDate`, `Microsoft.VSTS.Scheduling.StartDate`, `Custom.ActualStartdate`, `Custom.ActualStartDate`.
   - Isolates contradictory series: if a task contains a pipe with a different prefix (e.g. `OtherSeries | ...`), line 338 skips the fallback, preventing foreign tasks from contaminating the person's explorer matrix.

---

### 1.2 Verification Commands & Verbatim Execution Results

All commands were independently executed in `/Users/yashsomani/Desktop/Asure Bord Project/new-app`:

1. **TypeScript Compilation Check (`src/`)**:
   ```bash
   $ npm run typecheck
   > azure-3in1-task-creator@2.0.0 typecheck
   > tsc --noEmit
   [Exit code: 0]
   ```

2. **TypeScript Test Compilation Check (`tests/`)**:
   ```bash
   $ npm run typecheck:tests
   > azure-3in1-task-creator@2.0.0 typecheck:tests
   > tsc -p tsconfig.test.json --noEmit
   [Exit code: 0]
   ```

3. **ESLint Static Analysis**:
   ```bash
   $ npm run lint
   > azure-3in1-task-creator@2.0.0 lint
   > eslint "{src,tests}/**/*.ts"
   [Exit code: 0]
   ```

4. **Automated Test Suite (Vitest)**:
   ```bash
   $ npm test
   > azure-3in1-task-creator@2.0.0 test
   > vitest run
   Test Files  36 passed (36)
        Tests  468 passed (468)
     Duration  7.01s
   [Exit code: 0]
   ```

5. **Specialized Node Native Test Suites**:
   ```bash
   $ npm run test:schema && npm run test:identities && npm run test:workitems
   > azure-3in1-task-creator@2.0.0 test:schema
   > node --test scripts/verify-azure-schema.test.mjs
   ✔ accepts a complete Azure work item type with required states (0.872625ms)
   ✔ detects missing fields and workflow states (0.099375ms)
   ✔ rejects malformed Azure responses rather than claiming success (0.152083ms)
   ℹ pass 3, fail 0

   > azure-3in1-task-creator@2.0.0 test:identities
   > node --test scripts/verify-azure-identities.test.mjs
   ✔ lookup URLs only target fixed Azure identities HTTPS host with read-only query parameters (1.188041ms)
   ✔ subject descriptors use exact descriptor resolution rather than fuzzy names (0.242667ms)
   ✔ exact mail match is accepted; same display name and cross-domain local parts are not (0.310166ms)
   ✔ fail closed for partial, duplicate, inactive, group and missing-ID responses (0.138167ms)
   ✔ scope is bounded; disabled people skipped; duplicate member mappings are rejected (0.276875ms)
   ✔ per-member prefixes retained; two different accounts resolving same Azure ID fail (0.279458ms)
   ✔ invalid display-name identity blocks one member without querying or claiming success (0.211792ms)
   ✔ network failures never become clean identity proofs (0.090125ms)
   ℹ pass 8, fail 0

   > azure-3in1-task-creator@2.0.0 test:workitems
   > node --test scripts/verify-azure-workitems.test.mjs
   ✔ read-only WIQL scopes to project/type/explicit account and a validated creation date (5.994084ms)
   ✔ observes canonical spacing and isolates other work item series (0.819791ms)
   ✔ will not treat substring prefixes as a matching series (0.145583ms)
   ✔ rejects missing, duplicated, oversized and mismatched read backs (0.227333ms)
   ✔ scope is bounded and attempts only documented read-only Azure endpoints (0.374791ms)
   ✔ network errors, unsupported identity formats and unknown keys block (0.205709ms)
   ✔ a missing recent task or invalid work-item response is not a passing result (0.186458ms)
   ✔ multiple members require selected batches of at most 20 (0.145625ms)
   ℹ pass 8, fail 0
   [Exit code: 0]
   ```

6. **Production Build**:
   ```bash
   $ npm run build
   > azure-3in1-task-creator@2.0.0 build
   > tsc && node -e "import('fs').then(fs => fs.cpSync('src/presentation/web/public', 'dist/presentation/web/public', { recursive: true }))"
   [Exit code: 0]
   ```

---

### 1.3 Empirical Adversarial Stress Testing Results

Two targeted empirical stress harnesses were authored and executed via Node directly against the compiled domain logic:

#### Suite 1: Domain Identity Matching (`validateSourceTaskOwnership`) — 14 Scenarios Tested
| # | Adversarial Test Scenario | Expected Behavior | Actual Behavior | Result |
|---|---|---|---|---|
| 1 | Caller passes `Person` aggregate root | Validates identity, returns `ParsedTaskDate` | `isValid: true, isoDate: '2026-10-20'` | **PASS** |
| 2 | Caller passes plain `PersonConfig` object | Validates identity, returns `ParsedTaskDate` | `isValid: true, isoDate: '2026-10-20'` | **PASS** |
| 3 | Caller passes raw string email (`yash.somani@company.test`) | Validates identity, returns `ParsedTaskDate` | `isValid: true, isoDate: '2026-10-20'` | **PASS** |
| 4 | Caller passes raw string displayName (`Yash Somani`) | Validates identity, returns `ParsedTaskDate` | `isValid: true, isoDate: '2026-10-20'` | **PASS** |
| 5 | Caller passes formatted string (`Name <email>`) | Extracts email/name, returns `ParsedTaskDate` | `isValid: true, isoDate: '2026-10-20'` | **PASS** |
| 6 | Azure WIT shape has `{ displayName: 'Yash Somani' }` without `uniqueName` with `Person` | Matches by `name` via `matchesPerson`, succeeds | `isValid: true, isoDate: '2026-10-20'` | **PASS** |
| 7 | Azure WIT shape has `{ displayName: 'Yash Somani' }` without `uniqueName` with string caller | Matches by `displayName` fallback, succeeds | `isValid: true, isoDate: '2026-10-20'` | **PASS** |
| 8 | Azure WIT shape has raw string `'Yash Somani'` with `Person` | Matches by `name` via `extractIdentity`, succeeds | `isValid: true, isoDate: '2026-10-20'` | **PASS** |
| 9 | Impersonation attack: Azure has matching `displayName: 'Yash Somani'`, but conflicting `uniqueName: 'attacker@evil.com'` | `uniqueName` is authoritative; rejects impersonation | Throws `"not assigned to selected team member"` | **PASS** |
| 10 | Boundary attack: Project mismatch (`WrongProject`) | Rejects cross-project source work item | Throws `"does not belong to configured project"` | **PASS** |
| 11 | Boundary attack: WorkItemType mismatch (`Bug`) | Rejects cross-type source work item | Throws `"does not belong to configured project"` | **PASS** |
| 12 | Boundary attack: Series prefix mismatch (`OtherPrefix |`) | Rejects cross-series source work item | Throws `"belongs to a different task series"` | **PASS** |
| 13 | Substring prefix collision attack (`3in1_PWA_MyAccount_Extra |`) | Full segment comparison before `|`; rejects collision | Throws `"belongs to a different task series"` | **PASS** |
| 14 | Null / undefined `System.AssignedTo` in work item | Safely fails closed without null pointer exception | Throws `"not assigned to selected team member"` | **PASS** |

*Suite 1 Verdict*: **14/14 PASSED (100%)**

#### Suite 2: Timezone-Aware Date Extraction (`extractWorkItemRecordedDate` & `explore-tasks.ts`) — 19 Scenarios Tested
| # | Adversarial Test Scenario | Expected Behavior | Actual Behavior | Result |
|---|---|---|---|---|
| 1 | Positive offset boundary: `2026-10-19T20:00:00Z` in `Asia/Kolkata` (+05:30) | Resolves to next calendar day `2026-10-20` | `isoDate: '2026-10-20', year: 2026` | **PASS** |
| 2 | Exact midnight boundary: `2026-10-19T18:30:00Z` in `Asia/Kolkata` (+05:30) | Resolves to exact midnight `2026-10-20` | `isoDate: '2026-10-20', year: 2026` | **PASS** |
| 3 | Pre-midnight boundary: `2026-10-19T18:29:59Z` in `Asia/Kolkata` (+05:30) | Resolves to current day `2026-10-19` | `isoDate: '2026-10-19', year: 2026` | **PASS** |
| 4 | Negative offset boundary: `2026-10-19T02:00:00Z` in `America/New_York` (-04:00 EDT) | Resolves to previous calendar day `2026-10-18` | `isoDate: '2026-10-18', year: 2026` | **PASS** |
| 5 | Negative offset pre-midnight: `2026-10-19T03:59:59Z` in `America/New_York` (-04:00) | Resolves to previous calendar day `2026-10-18` | `isoDate: '2026-10-18', year: 2026` | **PASS** |
| 6 | Negative offset exact midnight: `2026-10-19T04:00:00Z` in `America/New_York` (-04:00) | Resolves to current calendar day `2026-10-19` | `isoDate: '2026-10-19', year: 2026` | **PASS** |
| 7 | Month forward boundary: `2026-03-31T22:00:00Z` in `Asia/Tokyo` (+09:00) | Crosses month boundary into `2026-04-01` | `isoDate: '2026-04-01', year: 2026` | **PASS** |
| 8 | Month backward boundary: `2026-04-01T02:00:00Z` in `America/Los_Angeles` (-07:00 PDT) | Crosses month boundary backward to `2026-03-31` | `isoDate: '2026-03-31', year: 2026` | **PASS** |
| 9 | Leap year boundary: `2024-02-28T22:00:00Z` in `Asia/Kolkata` (+05:30) | Crosses into leap day `2024-02-29` | `isoDate: '2024-02-29', year: 2024` | **PASS** |
| 10 | Year forward boundary: `2025-12-31T20:00:00Z` in `Asia/Kolkata` (+05:30) | Crosses into New Year `2026-01-01` | `isoDate: '2026-01-01', year: 2026` | **PASS** |
| 11 | Year backward boundary: `2026-01-01T02:00:00Z` in `America/New_York` (-05:00 EST) | Crosses into prior year `2025-12-31` | `isoDate: '2025-12-31', year: 2025` | **PASS** |
| 12 | Candidate field priority 1 | `Custom.PlannedStartdate` prioritized | Resolved date from `PlannedStartdate` | **PASS** |
| 13 | Candidate field priority 2 | `Custom.PlannedStartDate` prioritized next | Resolved date from `PlannedStartDate` | **PASS** |
| 14 | Candidate field priority 3 | `Microsoft.VSTS.Scheduling.StartDate` prioritized | Resolved date from `Scheduling.StartDate` | **PASS** |
| 15 | `ExploreTasksUseCase`: User row populated | Enabled member mapped in explorer matrix | Member row successfully identified | **PASS** |
| 16 | `ExploreTasksUseCase`: `20:00:00Z` on 19th in `Asia/Kolkata` | `2026-10-19` cell is empty | `cell['2026-10-19'].tasks.length === 0` | **PASS** |
| 17 | `ExploreTasksUseCase`: Task 501 placed on `2026-10-20` | Correctly attributes task to local calendar day | `cell['2026-10-20'].tasks[0].id === 501` | **PASS** |
| 18 | `ExploreTasksUseCase`: Non-pipe adhoc task fallback | Attributed to local calendar date | `cell['2026-10-21'].tasks[0].id === 502` | **PASS** |
| 19 | `ExploreTasksUseCase`: Contradictory series task (503) | Excluded from matrix; no cross-series leakage | `allTaskIds.includes(503) === false` | **PASS** |

*Suite 2 Verdict*: **19/19 PASSED (100%)**

---

## 2. Logic Chain

1. **Premise**: Azure DevOps WIT API responses frequently serialize `System.AssignedTo` as `{ displayName: 'Alice Smith' }` with no `uniqueName` property. Previous code evaluated `item.fields['System.AssignedTo'] === person.assignedTo`. When `person.assignedTo` was an email (`alice@company.com`), equality failed, falsely rejecting valid tasks.
   - **Step**: Refactored `validateSourceTaskOwnership` to accept `Person | PersonConfig | string` and delegate to `matchesPerson(fields['System.AssignedTo'], person)`.
   - **Deduction**: `matchesPerson` correctly handles missing `uniqueName` by falling back to exact case-insensitive `displayName === person.name`. If `uniqueName` is present, it acts as authoritative proof and blocks spoofing attempts where an attacker provides a matching display name with an unauthorized email. Backward compatibility is retained for string callers.
   - **Verification**: Confirmed via 14 adversarial unit tests in Suite 1 and existing `task-entities.test.ts`.

2. **Premise**: Azure DevOps records timestamps in UTC ISO format (e.g. `2026-10-19T20:00:00Z`). In timezones east of UTC like `Asia/Kolkata` (UTC+5:30), 20:00 UTC occurs at 01:30 AM on the following day (`2026-10-20`). Raw `.split('T')[0]` string slicing assigned tasks to the wrong calendar column (`2026-10-19`), creating false gaps in work matrices.
   - **Step**: Replaced `.split('T')[0]` in `explore-tasks.ts` with `extractWorkItemRecordedDate(item, timezone)`, which leverages `Intl.DateTimeFormat('en-CA', { timeZone })`.
   - **Deduction**: Work items crossing UTC midnight are accurately attributed to the employee's true local workday across both positive (Asia/Kolkata, Tokyo) and negative (America/New_York, America/Los_Angeles) offsets, including month, year, and leap year boundaries.
   - **Verification**: Confirmed via 19 boundary and integration tests in Suite 2 and existing `explore-tasks.test.ts`.

3. **Premise**: Unrelated tasks in other series or non-standard titles must not be incorrectly attributed or close historical tasks.
   - **Step**: `explore-tasks.ts` restricts fallback date extraction to tasks matching the member's configured `titlePrefix` or tasks lacking a pipe delimiter. Tasks belonging to an unrelated pipe series (e.g. `OtherSeries | ...`) are strictly ignored.
   - **Deduction**: Prevents cross-series contamination and preserves tenant data isolation.
   - **Verification**: Confirmed in Suite 2 Scenario 19.

---

## 3. Caveats

- **Zero Remote Mutations**: In accordance with Requirement R3 and safety policies, all tests and verifications were executed locally with deterministic mock repositories; no live remote Azure DevOps work items or GitHub pull requests were created or mutated.
- **Reference Task Parent Link Requirement**: Relation repair in `repair-relations.ts` requires a reference source task that already possesses an existing `Hierarchy-Reverse` parent relation. When a reference task lacks a parent link, orphan items are marked `UNRESOLVED` rather than guessing a hierarchy.
- **No other caveats**: All requirements, edge cases, and quality gates are completely satisfied.

---

## 4. Conclusion

Empirical adversarial stress testing and verification of Milestone 2 confirms that the implementation across `src/domain/entities/task.ts` and `src/application/use-cases/explore-tasks.ts` is **fully correct, resilient, and robust**:
- Domain Identity Matching properly handles `Person`, `PersonConfig`, and legacy `string` callers, supports Azure DevOps `{ displayName }` shapes without `uniqueName`, blocks spoofing attacks, and enforces project/type/series boundaries.
- Timezone-Aware Recorded Date Extraction accurately resolves work items across UTC midnight boundaries for both positive and negative offsets, handling month boundaries, leap years, and year rollovers without date shifting.
- All quality gates pass with zero errors:
  - `npm run typecheck`: 0 errors
  - `npm run typecheck:tests`: 0 errors
  - `npm run lint`: 0 errors, 0 warnings
  - `npm test`: 36 test files passed, 468 passed
  - Node native tests: 19 passed
  - `npm run build`: Clean production build
  - Empirical stress test suites: 33/33 passed (100%)

**Final Verdict**: **APPROVE**

---

## 5. Verification Method

To independently reproduce all observations and verify this assessment:

```bash
cd "/Users/yashsomani/Desktop/Asure Bord Project/new-app"

# 1. Typecheck source code
npm run typecheck

# 2. Typecheck test code
npm run typecheck:tests

# 3. Lint source and test code
npm run lint

# 4. Run automated test suite
npm test

# 5. Run specialized Node native test suites
npm run test:schema && npm run test:identities && npm run test:workitems

# 6. Verify production build
npm run build
```

### Invalidation Conditions
- If `validateSourceTaskOwnership` throws when passed an Azure work item containing `{ displayName: 'Alice Smith' }` (no `uniqueName`) and a `Person` with `name: 'Alice Smith'`, the implementation is invalid.
- If `validateSourceTaskOwnership` accepts an Azure work item where `displayName` matches the person's name but `uniqueName` belongs to an unauthorized email, the implementation is invalid.
- If an Azure task scheduled at `2026-10-19T20:00:00Z` in `explore-tasks.ts` with timezone `'Asia/Kolkata'` appears in the `'2026-10-19'` column instead of `'2026-10-20'`, the implementation is invalid.
- If an Azure task scheduled at `2026-10-19T02:00:00Z` in `explore-tasks.ts` with timezone `'America/New_York'` appears in the `'2026-10-19'` column instead of `'2026-10-18'`, the implementation is invalid.
- If any of `npm run typecheck`, `npm run typecheck:tests`, `npm run lint`, `npm test`, or `npm run build` exits with a non-zero code, the implementation is invalid.
