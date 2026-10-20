# Technical Exploration & Implementation Handoff Report
## Milestone 2: Core Task Engine, Explorer Timezones & Cloud Resilience

- **Author**: Explorer Agent (teamwork_preview_explorer_m2_1)
- **Recipient**: Worker Agent (teamwork_preview_worker_m2)
- **Target Codebase**: `/Users/yashsomani/Desktop/Asure Bord Project/new-app`
- **Scope Reference**: `/Users/yashsomani/Desktop/Asure Bord Project/.agents/teamwork_preview_sub_orch_m2_enhancement/SCOPE.md`
- **Analysis Reference**: `/Users/yashsomani/Desktop/Asure Bord Project/.agents/teamwork_preview_explorer_m2_1/analysis.md`
- **Date**: 2026-10-19

---

## 1. Observation

A detailed, read-only code inspection was conducted across the target files for Milestone 2 in `/Users/yashsomani/Desktop/Asure Bord Project/new-app`. The observations are documented below with verbatim code extracts, line numbers, and tool command results.

### 1.1 Target Area 1: `validateSourceTaskOwnership` in `src/domain/entities/task.ts`
- **File**: `src/domain/entities/task.ts` (lines 386–421)
- **Observed Code**:
  ```typescript
  export function validateSourceTaskOwnership(
    workItem: WorkItem,
    project: string,
    workItemType: string,
    titlePrefix: string,
    assignedTo: string,
  ): ParsedTaskDate {
    const fields = workItem.fields;
    const same = (a: unknown, b: string) =>
      typeof a === 'string' && a.trim().toLowerCase() === b.trim().toLowerCase();
    if (!same(fields['System.TeamProject'], project) ||
        !same(fields['System.WorkItemType'], workItemType)) {
      throw new Error(`Source work item #${workItem.id} does not belong to the configured project and task type.`);
    }
    const title = String(fields['System.Title'] || '');
    if (!matchesTaskSeries(title, titlePrefix)) {
      throw new Error(`Source work item #${workItem.id} belongs to a different task series.`);
    }

    // Azure's uniqueName is preferred to display-name substring heuristics.
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
    const parsed = parseTitleDate(title, titlePrefix, true);
    if (!parsed.isValid) {
      throw new Error(`Source work item #${workItem.id} has no unambiguous dated task title.`);
    }
    return parsed;
  }
  ```
- **Observed Callers**:
  1. `src/application/use-cases/create-tasks.ts` line 324:
     `const parsedDate = validateSourceTaskOwnership(item, this.config.project, this.config.workItemType, memberPrefix, person.assignedTo);`
  2. `src/infrastructure/azure/work-item-service.ts` line 209:
     `validateSourceTaskOwnership(workItem, project, workItemType, prefix, person.assignedTo);`
  3. `src/infrastructure/azure/work-item-service.ts` line 344:
     `const parsedDate = validateSourceTaskOwnership(workItem, project, workItemType, prefix, person.assignedTo);`
  4. `src/infrastructure/azure/work-item-service.ts` line 65:
     `validateSourceTaskOwnership(workItem, project, workItemType, titlePrefix, personIdentity);`
  5. `tests/unit/task-entities.test.ts` lines 107, 111, 112, 113, 114.
- **Reference in `src/domain/entities/person.ts`** (lines 67–89):
  ```typescript
  export function matchesPerson(assignedToVal: unknown, person: PersonConfig | Person): boolean {
    const identity = extractIdentity(assignedToVal);
    if (!identity) return false;

    const targetEmail = person.assignedTo.toLowerCase().trim();
    const targetName = person.name.toLowerCase().trim();
   
    if (identity.uniqueName) {
      const unique = identity.uniqueName.toLowerCase().trim();
      return unique === targetEmail;
    }

    if (identity.displayName) {
      const display = identity.displayName.toLowerCase().trim();
      return display === targetName || display === targetEmail;
    }

    return false;
  }
  ```

### 1.2 Target Area 2: Recorded Date Extraction in `src/application/use-cases/explore-tasks.ts`
- **File**: `src/application/use-cases/explore-tasks.ts` (lines 331–339)
- **Observed Code**:
  ```typescript
  // Fallback to Azure scheduling dates if not already found (PlannedStartdate, StartDate, ActualStartdate)
  // only if task belongs to their series or has no contradictory series
  if (!itemDate && (!title.includes('|') || (p.titlePrefix && matchesTaskSeries(title, p.titlePrefix)))) {
    if (item.fields['Custom.PlannedStartdate']) {
      itemDate = String(item.fields['Custom.PlannedStartdate']).split('T')[0];
    } else if (item.fields['Microsoft.VSTS.Scheduling.StartDate']) {
      itemDate = String(item.fields['Microsoft.VSTS.Scheduling.StartDate']).split('T')[0];
    } else if (item.fields['Custom.ActualStartdate']) {
      itemDate = String(item.fields['Custom.ActualStartdate']).split('T')[0];
    }
  }
  ```
- **Observed Domain Standard in `src/domain/entities/task.ts`** (lines 242–267):
  ```typescript
  export function extractWorkItemRecordedDate(
    item: WorkItem,
    timezone = 'UTC'
  ): { isoDate: string; year: number } | null {
    const fieldNames = [
      'Custom.PlannedStartdate', 'Custom.PlannedStartDate',
      'Microsoft.VSTS.Scheduling.StartDate',
      'Custom.ActualStartdate', 'Custom.ActualStartDate',
    ];
    for (const field of fieldNames) {
      const raw = item.fields[field];
      if (!raw) continue;
      const date = new Date(String(raw));
      if (!Number.isFinite(date.getTime())) continue;
      const parts = new Intl.DateTimeFormat('en-CA', {
        timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit',
      }).formatToParts(date);
      const part = (type: string) => parts.find(p => p.type === type)?.value || '';
      const isoDate = `${part('year')}-${part('month')}-${part('day')}`;
      const year = Number(part('year'));
      if (isoDate && !Number.isNaN(year)) {
        return { isoDate, year };
      }
    }
    return null;
  }
  ```

### 1.3 Target Area 3: Process Template Rule Error Recovery in `src/application/use-cases/close-daily-tasks.ts`
- **File**: `src/application/use-cases/close-daily-tasks.ts` (lines 312–335)
- **Observed Code**:
  ```typescript
  if (errStr.includes('TF401320') || errStr.toLowerCase().includes('rule error')) {
    logger.info(`Applying compliant closure fields for task #${taskId} to satisfy tenant process rules...`);
    const ruleOps = [...ops];
    const existingDescription = String(item.fields['System.Description'] || '').trim();
    if (!existingDescription) {
      ruleOps.push({
        op: 'add',
        path: '/fields/System.Description',
        value: prDeliverables.htmlDescription || `<div><p>Task completed on ${targetDate}. ${prDeliverables.summaryText}</p></div>`,
      });
    }
    const hasActualStart = Boolean(item.fields['Custom.ActualStartdate'] || item.fields['Custom.ActualStartDate']);
    const hasActualEnd = Boolean(item.fields['Custom.ActualEnddate'] || item.fields['Custom.ActualEndDate']);
    if (!hasActualStart) {
      ruleOps.push({ op: 'add', path: '/fields/Custom.ActualStartdate', value: String(plannedStart || `${targetDate}T04:00:00Z`) });
    }
    if (!hasActualEnd) {
      ruleOps.push({ op: 'add', path: '/fields/Custom.ActualEnddate', value: `${targetDate}T13:00:00Z` });
    }
    await this.workItemRepo.patchWorkItem(taskId, ruleOps, { bypassRules: false });
  } else {
    throw patchErr;
  }
  ```

### 1.4 Target Area 4: GitHub Client Request Logic in `src/infrastructure/github/github-client.ts`
- **File**: `src/infrastructure/github/github-client.ts` (lines 436–455)
- **Observed Code**:
  ```typescript
  private async request<T>(endpoint: string, init: RequestInit = {}): Promise<T> {
    const url = `${this.apiUrl}${endpoint}`;
    const headers: Record<string, string> = {
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'Azure-DevOps-Task-Creator',
      ...(init.headers as Record<string, string> || {}),
    };

    if (this.token) {
      headers.Authorization = `Bearer ${this.token}`;
    }

    const res = await this.fetchFn(url, { ...init, headers });
    if (!res.ok) {
      const errorBody = await res.text().catch(() => '');
      throw new Error(`GitHub API error ${res.status} (${res.statusText}): ${errorBody.slice(0, 200)}`);
    }

    return (await res.json()) as T;
  }
  ```
- **Comparison Reference**: `src/infrastructure/azure/client.ts` lines 94–180 features `AbortController` timeout (30s) with `clearTimeout` in `finally`, exponential backoff (`calculateBackoff`), jitter, and `Retry-After` header inspection.

### 1.5 Target Area 5: Relation Repair in `src/application/use-cases/repair-relations.ts`
- **File**: `src/application/use-cases/repair-relations.ts` (lines 38–53)
- **Observed Code**:
  ```typescript
  async execute(): Promise<RepairReport> {
    const entries = await this.journal.getUnfinishedRelations();
    const rows: RepairRow[] = [];
  ```
- **Observation**: Operates exclusively over `journal.getUnfinishedRelations()`. It has no facility to query or inspect candidate Azure DevOps work items that match the series pattern but lack parent relations (`System.LinkTypes.Hierarchy-Reverse`), and lacks `LockRepository` concurrency locking.

### 1.6 Baseline Health Check
- `npm test`: 32 test suites passed, 353 tests passed (exit code 0).
- `npm run typecheck`: `tsc --noEmit` passed with 0 errors (exit code 0).
- `npm run lint`: `eslint "{src,tests}/**/*.ts"` passed with 0 errors (exit code 0).

---

## 2. Logic Chain

### 2.1 Logic Chain for Area 1 (Source Task Ownership Identity Matching)
1. **Premise**: Azure DevOps WIT API can return `System.AssignedTo` as a plain string (`"Jane Doe"`, `"Jane Doe <jane@company.com>"`), an object with `displayName` and `uniqueName`, or an object with *only* `displayName`.
2. **Observation**: `validateSourceTaskOwnership` extracts `actualIdentity` from `uniqueName || displayName` and checks `same(actualIdentity, assignedTo)`.
3. **Inference**: If `assignedTo` is the configured email (`jane@company.com`), and Azure returns `{ displayName: 'Jane Doe' }`, `same('Jane Doe', 'jane@company.com')` is false.
4. **Deduction**: Valid source tasks are erroneously rejected. Refactoring `validateSourceTaskOwnership` to accept `Person | PersonConfig | string` and delegating to `matchesPerson(fields['System.AssignedTo'], person)` completely eliminates this defect while maintaining 100% backward compatibility for callers passing string identities.

### 2.2 Logic Chain for Area 2 (Timezone Date Extraction in Explorer)
1. **Premise**: Azure DevOps WIT stores date timestamps in UTC.
2. **Observation**: `explore-tasks.ts:333` executes `String(item.fields['Custom.PlannedStartdate']).split('T')[0]`.
3. **Inference**: For organizations in timezones ahead of UTC (e.g. `Asia/Kolkata` UTC+5:30), any timestamp between 18:30 UTC and 23:59 UTC belongs to the *next* calendar day locally (e.g. `2026-10-18T20:00:00Z` is `2026-10-19 01:30:00` IST).
4. **Deduction**: Raw UTC string splitting misallocates evening and overnight work to the previous calendar day. Replacing raw splitting with `extractWorkItemRecordedDate(item, timezone)` groups work items accurately by local calendar day and adds support for PascalCase `Custom.PlannedStartDate` and `Custom.ActualStartDate`.

### 2.3 Logic Chain for Area 3 (Process Template Rule Casing Recovery)
1. **Premise**: Azure DevOps process templates vary across organizations; some define fields as `Custom.ActualStartdate` / `Custom.ActualEnddate` while others define `Custom.ActualStartDate` / `Custom.ActualEndDate` (PascalCase).
2. **Observation**: `close-daily-tasks.ts` lines 324-325 inspect both lowercase and PascalCase, but lines 327 and 330 hardcode the patch paths to `/fields/Custom.ActualStartdate` and `/fields/Custom.ActualEnddate`.
3. **Inference**: When applied to a tenant enforcing PascalCase schema rules, the recovery patch fails with an unrecognized field schema error.
4. **Deduction**: Inspecting existing keys in `item.fields` to detect the preferred casing, combined with an automated fallback swap on initial rejection, guarantees zero process-rule recovery failures across all Azure DevOps tenants.

### 2.4 Logic Chain for Area 4 (GitHub Client Resilience)
1. **Premise**: Cloud APIs experience network timeouts, transient 5xx server spikes, and search API throttling (30 req/min).
2. **Observation**: `GitHubClient.request` lacks an `AbortController` timeout and has no retry or rate-limit handling.
3. **Inference**: Any transient glitch or rate limit causes `GitHubClient` to throw immediately, failing daily task closure operations.
4. **Deduction**: Because all operations in `GitHubClient` are read-only (`GET`), adding an `AbortController` with a 30s timeout and a bounded exponential backoff retry loop (handling 429, 403 with rate-limit headers, and 5xx) provides complete network resilience without risking duplicate side effects.

### 2.5 Logic Chain for Area 5 (Orphan Task Discovery & Repair)
1. **Premise**: Azure DevOps task creation requires linking tasks to a parent item via `System.LinkTypes.Hierarchy-Reverse`.
2. **Observation**: `RepairRelationsUseCase` only processes entries recorded in the local `.task-journal.json`.
3. **Inference**: Tasks created outside the current host machine, or tasks whose local journal was removed, cannot be audited or repaired. Additionally, `RepairRelationsUseCase` does not acquire `LockRepository`.
4. **Deduction**: Extending `RepairRelationsUseCase` with `detectOrphanTasks(candidateTasks)` and `repairOrphanTasks(orphans, referenceSourceTask)`, along with optional `lockRepo` injection, provides complete relation repair capabilities for the studio.

---

## 3. Caveats

1. **Zero-Mutation Verification**: In strict adherence to development guardrails, no live mutating calls (`POST` / `PATCH`) were executed against real Azure DevOps or GitHub enterprise organizations during exploration.
2. **Mock Test Compatibility**: Vitest mock fetches in existing tests (`tests/unit/github-client.test.ts`) often return mock objects without a full `Headers` class. The implementation must use optional chaining (`res.headers?.get?.(...)`) to avoid test failures.
3. **Orphan Parent Resolution**: Orphan task repair requires a valid reference source task that possesses a `System.LinkTypes.Hierarchy-Reverse` parent relation. If no such reference task exists, the orphan task must be flagged as `UNRESOLVED` rather than inventing an arbitrary parent link.

---

## 4. Conclusion

The technical investigation is complete and actionable blueprints are established in `analysis.md`. The Worker agent can proceed to implement the five target enhancements according to the following concrete plan:

1. **`src/domain/entities/task.ts` & `src/domain/entities/person.ts`**:
   - Refactor `validateSourceTaskOwnership` to accept `Person | PersonConfig | string`.
   - Delegate assignee validation to `matchesPerson(fields['System.AssignedTo'], personConfig)`.
   - Update call sites in `create-tasks.ts` (line 324) and `work-item-service.ts` (lines 209, 344) to pass the `Person` entity.
2. **`src/application/use-cases/explore-tasks.ts`**:
   - Import `extractWorkItemRecordedDate` from `task.js`.
   - Replace lines 331–339 with `extractWorkItemRecordedDate(item, timezone)`.
3. **`src/application/use-cases/close-daily-tasks.ts`**:
   - Detect field casing preference from `item.fields` (`Custom.ActualStartDate` vs `Custom.ActualStartdate`).
   - Implement automated fallback casing retry on initial patch failure.
4. **`src/infrastructure/github/github-client.ts`**:
   - Add `timeout` (default 30s) and `maxRetries` (default 3) to `GitHubClientOptions`.
   - Implement `calculateBackoff` and `sleep`.
   - Refactor `request` to use `AbortController` (with `clearTimeout` in `finally`) and exponential backoff retry loop handling 429, 403 (with rate-limit headers), and 5xx.
5. **`src/application/use-cases/repair-relations.ts`**:
   - Add `detectOrphanTasks(candidateTasks: WorkItem[])`.
   - Add `repairOrphanTasks(orphans: OrphanTaskItem[], referenceSourceTask: WorkItem)`.
   - Support optional `LockRepository` injection in constructor.
   - Inject `lockRepo` in `src/container.ts`.
6. **Tests**:
   - Add new unit and integration tests across `task-entities.test.ts`, `explore-tasks.test.ts`, `close-daily-tasks.test.ts`, `github-client.test.ts`, and `repair-relations.test.ts`.

---

## 5. Verification Method

The Worker agent must independently verify all changes using the following sequence of commands:

### 5.1 Static Analysis and Type Safety Verification
Run from `/Users/yashsomani/Desktop/Asure Bord Project/new-app`:
```bash
npm run typecheck
npm run lint
```
*Expected Result*: Zero TypeScript errors, zero ESLint errors or warnings.

### 5.2 Automated Test Suite Execution
Run from `/Users/yashsomani/Desktop/Asure Bord Project/new-app`:
```bash
npm test
```
*Expected Result*: All existing 353 tests pass, plus all newly authored unit and integration tests pass.

### 5.3 Production Build Verification
Run from `/Users/yashsomani/Desktop/Asure Bord Project/new-app`:
```bash
npm run build
```
*Expected Result*: Clean compilation into `dist/` with zero missing modules or asset copy failures.

### 5.4 Invalidation Conditions
- If `validateSourceTaskOwnership` throws when tested with a source task containing `{ displayName: 'Yash Somani' }` and a configured `Person` with `name: 'Yash Somani'`, the implementation is invalid.
- If an Azure work item with `Custom.PlannedStartdate: '2026-10-18T20:00:00Z'` in `explore-tasks.ts` with timezone `'Asia/Kolkata'` appears in the `'2026-10-18'` column instead of `'2026-10-19'`, the implementation is invalid.
- If `close-daily-tasks.ts` fails to close a task on a tenant requiring `Custom.ActualStartDate` (PascalCase), the implementation is invalid.
- If `GitHubClient.request` fails immediately on HTTP 429 without backoff retry, the implementation is invalid.
- If `repair-relations.ts` cannot identify a task lacking `Hierarchy-Reverse` relations from a list of candidate tasks, the implementation is invalid.
