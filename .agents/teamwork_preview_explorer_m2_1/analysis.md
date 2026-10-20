# Detailed Technical Investigation & Implementation Blueprint
## Milestone 2: Core Task Engine, Explorer Timezones & Cloud Resilience

- **Author**: Explorer Agent (teamwork_preview_explorer_m2_1)
- **Target Codebase**: `/Users/yashsomani/Desktop/Asure Bord Project/new-app`
- **Scope Reference**: `/Users/yashsomani/Desktop/Asure Bord Project/.agents/teamwork_preview_sub_orch_m2_enhancement/SCOPE.md`
- **Survey Reference**: `/Users/yashsomani/Desktop/Asure Bord Project/.agents/teamwork_preview_explorer_survey_enhancement_2/handoff.md`
- **Date**: 2026-10-19

---

## 1. Executive Summary

Milestone 2 addresses core domain accuracy, timezone boundary integrity, cloud provider resilience, and relation graph completeness across the 3in1 Task Studio. A thorough inspection of the production source files confirms five critical areas requiring targeted enhancement:

1. **Identity Matching in Source Task Ownership (`task.ts:386-421`)**: Replaces brittle string equality with domain-authoritative `matchesPerson(fields['System.AssignedTo'], person)`. This resolves false rejections when Azure DevOps exposes `displayName` without `uniqueName` or when team configurations contain display names.
2. **Timezone-Aware Date Extraction in Explorer (`explore-tasks.ts:331-339`)**: Eliminates naive UTC `.split('T')[0]` string operations in favor of `extractWorkItemRecordedDate(item, timezone)`, preventing date-slippage across UTC midnight boundaries (e.g. for `Asia/Kolkata` UTC+5:30).
3. **Resilient Field Casing in Process Rule Recovery (`close-daily-tasks.ts:312-335`)**: Removes hardcoded lowercase `Custom.ActualStartdate` / `Custom.ActualEnddate` during `TF401320` rule recovery, detecting existing field casing on the work item (`Custom.ActualStartDate` / `Custom.ActualEndDate`) and applying an automated fallback swap if the initial patch is rejected.
4. **GitHub Client Timeout & Backoff Resilience (`github-client.ts:436-455`)**: Introduces an `AbortController` (30s default) with `clearTimeout` in `finally`, plus a bounded exponential backoff retry loop (default 3 retries) for HTTP 429, 403 (rate limited via `x-ratelimit-remaining` / `retry-after`), and 5xx errors for read-only queries.
5. **Orphan Task Discovery & Repair (`repair-relations.ts:28-101`)**: Extends relation repair beyond local `.task-journal.json` entries to detect and repair orphan work items (work items matching the series pattern lacking `System.LinkTypes.Hierarchy-Reverse` parent links), and injects optional concurrency lock protection.

---

## 2. Target Area 1: Source Task Ownership Identity Matching

### 2.1 Current Observation
In `src/domain/entities/task.ts` (lines 386–421):
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

### 2.2 Root Cause & Gap Analysis
1. `validateSourceTaskOwnership` accepts `assignedTo: string` and performs simple case-insensitive string equality (`same(actualIdentity, assignedTo)`).
2. If `assignedTo` is an email (`yash.somani@bajajfinserv.in`) and Azure DevOps returns `{ displayName: 'Yash Somani' }` without `uniqueName`, `actualIdentity` evaluates to `'Yash Somani'`.
3. `same('Yash Somani', 'yash.somani@bajajfinserv.in')` returns `false`, erroneously rejecting a valid source work item.
4. In contrast, `src/domain/entities/person.ts` already contains the authoritative matching domain function:
   ```typescript
   export function matchesPerson(assignedToVal: unknown, person: PersonConfig | Person): boolean
   ```
   `matchesPerson` parses `uniqueName` and `displayName`, checking both email and person name.

### 2.3 Implementation Blueprint for Worker
1. **Modify `src/domain/entities/task.ts`**:
   - Import `matchesPerson, Person, PersonConfig` from `./person.js`.
   - Update `validateSourceTaskOwnership` parameter signature:
     ```typescript
     export function validateSourceTaskOwnership(
       workItem: WorkItem,
       project: string,
       workItemType: string,
       titlePrefix: string,
       person: Person | PersonConfig | string,
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

       const personConfig: PersonConfig | Person = typeof person === 'string'
         ? { key: person, name: person, assignedTo: person }
         : person;

       if (!matchesPerson(fields['System.AssignedTo'], personConfig)) {
         throw new Error(`Source work item #${workItem.id} is not assigned to the selected team member.`);
       }

       const parsed = parseTitleDate(title, titlePrefix, true);
       if (!parsed.isValid) {
         throw new Error(`Source work item #${workItem.id} has no unambiguous dated task title.`);
       }
       return parsed;
     }
     ```
2. **Update Call Sites**:
   - `src/application/use-cases/create-tasks.ts` line 324:
     Pass `person` instead of `person.assignedTo`:
     ```typescript
     const parsedDate = validateSourceTaskOwnership(
       item, this.config.project, this.config.workItemType, memberPrefix, person
     );
     ```
   - `src/infrastructure/azure/work-item-service.ts` line 209:
     Pass `person` instead of `person.assignedTo`:
     ```typescript
     validateSourceTaskOwnership(workItem, project, workItemType, prefix, person);
     ```
   - `src/infrastructure/azure/work-item-service.ts` line 344:
     Pass `person` instead of `person.assignedTo`:
     ```typescript
     const parsedDate = validateSourceTaskOwnership(
       workItem, project, workItemType, prefix, person
     );
     ```
   - `src/infrastructure/azure/work-item-service.ts` line 65:
     Passes `personIdentity: string`. Handled cleanly by string branch in `validateSourceTaskOwnership`.

---

## 3. Target Area 2: Timezone-Aware Recorded Date Extraction in Explorer

### 3.1 Current Observation
In `src/application/use-cases/explore-tasks.ts` (lines 331–339):
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

### 3.2 Root Cause & Gap Analysis
1. Extracting dates via `.split('T')[0]` operates purely on the raw UTC ISO string.
2. Example failure scenario:
   - User timezone: `Asia/Kolkata` (UTC+5:30).
   - An Azure task has `Custom.PlannedStartdate: "2026-10-18T20:00:00Z"`.
   - In Kolkata local time, this timestamp corresponds to `2026-10-19 01:30:00`.
   - `.split('T')[0]` returns `"2026-10-18"`, misattributing the task to the previous calendar day.
   - Result: In the Explorer grid, October 18 shows a duplicate or misplaced task, while October 19 shows as `MISSING`.
3. In `src/domain/entities/task.ts:242-267`, `extractWorkItemRecordedDate(item: WorkItem, timezone = 'UTC')` already implements timezone-accurate date extraction using `Intl.DateTimeFormat('en-CA', { timeZone: timezone })` across all relevant Azure scheduling fields (`Custom.PlannedStartdate`, `Custom.PlannedStartDate`, `Microsoft.VSTS.Scheduling.StartDate`, `Custom.ActualStartdate`, `Custom.ActualStartDate`).

### 3.3 Implementation Blueprint for Worker
1. In `src/application/use-cases/explore-tasks.ts`:
   - Import `extractWorkItemRecordedDate` from `../../domain/entities/task.js`.
   - Refactor lines 331–339 to:
     ```typescript
     // Fallback to Azure scheduling dates if not already found (PlannedStartdate, StartDate, ActualStartdate)
     // only if task belongs to their series or has no contradictory series
     if (!itemDate && (!title.includes('|') || (p.titlePrefix && matchesTaskSeries(title, p.titlePrefix)))) {
       const recorded = extractWorkItemRecordedDate(item, timezone);
       if (recorded) {
         itemDate = recorded.isoDate;
       }
     }
     ```
2. Note that `timezone` is already in scope at line 202 (`const timezone = this.config.timezone || 'Asia/Kolkata';`).

---

## 4. Target Area 3: Process Template Rule Error Recovery & Field Casing

### 4.1 Current Observation
In `src/application/use-cases/close-daily-tasks.ts` (lines 312–335):
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

### 4.2 Root Cause & Gap Analysis
1. Lines 324 and 325 acknowledge both casing variations (`Custom.ActualStartdate` and `Custom.ActualStartDate`).
2. However, lines 327 and 330 hardcode the patch paths to `/fields/Custom.ActualStartdate` and `/fields/Custom.ActualEnddate`.
3. In Azure DevOps tenants using the Agile or CMMI inherited templates with PascalCase field names (`Custom.ActualStartDate`), Azure rejects the patch operation because the lowercase field does not exist, causing task closure to fail.

### 4.3 Implementation Blueprint for Worker
1. Detect field casing from `item.fields`:
   - Inspect existing keys on `item.fields` for `Custom.ActualStartDate` / `Custom.PlannedStartDate` vs lowercase variants.
   - Use the detected casing when constructing `ruleOps`.
2. Add automatic recovery fallback:
   - If the first patch attempt fails, swap the casing (`Custom.ActualStartdate` <-> `Custom.ActualStartDate` and `Custom.ActualEnddate` <-> `Custom.ActualEndDate`) and retry once before rethrowing.
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

  // Detect casing preference from item fields
  const fieldKeys = Object.keys(item.fields);
  const prefersPascalCase = fieldKeys.some(k =>
    k === 'Custom.ActualStartDate' ||
    k === 'Custom.ActualEndDate' ||
    k === 'Custom.PlannedStartDate' ||
    (k.startsWith('Custom.') && k.endsWith('Date'))
  );

  const startField = prefersPascalCase ? 'Custom.ActualStartDate' : 'Custom.ActualStartdate';
  const endField = prefersPascalCase ? 'Custom.ActualEndDate' : 'Custom.ActualEnddate';

  if (!hasActualStart) {
    ruleOps.push({ op: 'add', path: `/fields/${startField}`, value: String(plannedStart || `${targetDate}T04:00:00Z`) });
  }
  if (!hasActualEnd) {
    ruleOps.push({ op: 'add', path: `/fields/${endField}`, value: `${targetDate}T13:00:00Z` });
  }

  try {
    await this.workItemRepo.patchWorkItem(taskId, ruleOps, { bypassRules: false });
  } catch (initialErr: any) {
    // If rejected, attempt inverted casing before failing
    const alternateOps = ruleOps.map(op => {
      if (op.path === '/fields/Custom.ActualStartdate') return { ...op, path: '/fields/Custom.ActualStartDate' };
      if (op.path === '/fields/Custom.ActualStartDate') return { ...op, path: '/fields/Custom.ActualStartdate' };
      if (op.path === '/fields/Custom.ActualEnddate') return { ...op, path: '/fields/Custom.ActualEndDate' };
      if (op.path === '/fields/Custom.ActualEndDate') return { ...op, path: '/fields/Custom.ActualEnddate' };
      return op;
    });
    await this.workItemRepo.patchWorkItem(taskId, alternateOps, { bypassRules: false });
  }
}
```

---

## 5. Target Area 4: GitHub Client Timeout & Exponential Backoff Retries

### 5.1 Current Observation
In `src/infrastructure/github/github-client.ts` (lines 436–455):
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

### 5.2 Root Cause & Gap Analysis
1. **Missing Timeout**: `request` does not use an `AbortController`. If a GitHub connection hangs, the Node process can remain blocked indefinitely.
2. **Missing Retry & Backoff**: GitHub rate limits Search API endpoints heavily (30 req/min). When a secondary rate limit or burst limit occurs (HTTP 429 or HTTP 403 with `x-ratelimit-remaining: '0'`), `GitHubClient` fails immediately with an uncaught exception, aborting EOD task closure.
3. **Idempotency Guarantee**: All methods in `GitHubClient` are strictly read-only HTTP `GET` queries (`/search/users`, `/search/commits`, `/search/issues`, `/repos/{owner}/{repo}/commits`). Retrying read operations is 100% replay-safe.

### 5.3 Implementation Blueprint for Worker
1. Update `GitHubClientOptions` in `src/infrastructure/github/github-client.ts`:
   ```typescript
   export interface GitHubClientOptions {
     token?: string;
     apiUrl?: string;
     org?: string;
     userSuffix?: string;
     fetchFn?: typeof fetch;
     timeout?: number;    // default 30000 ms
     maxRetries?: number; // default 3 attempts
   }
   ```
2. Store configuration and add helper methods:
   ```typescript
   private readonly timeout: number;
   private readonly maxRetries: number;

   constructor(options: GitHubClientOptions = {}) {
     this.options = options;
     this.apiUrl = (options.apiUrl || process.env.GITHUB_API_URL || 'https://api.github.com').replace(/\/+$/, '');
     this.fetchFn = options.fetchFn || globalThis.fetch;
     this.timeout = options.timeout ?? 30000;
     this.maxRetries = options.maxRetries ?? 3;
   }

   private calculateBackoff(attempt: number): number {
     const baseDelay = 1000;
     const maxDelay = 30000;
     const exp = Math.min(baseDelay * Math.pow(2, attempt), maxDelay);
     const jitter = Math.random() * 200;
     return exp + jitter;
   }

   private sleep(ms: number): Promise<void> {
     return new Promise(resolve => setTimeout(resolve, ms));
   }
   ```
3. Refactor `request<T>` with timeout and retry loop:
   ```typescript
   private async request<T>(endpoint: string, init: RequestInit = {}): Promise<T> {
     const url = `${this.apiUrl}${endpoint}`;
     const baseHeaders: Record<string, string> = {
       Accept: 'application/vnd.github.v3+json',
       'User-Agent': 'Azure-DevOps-Task-Creator',
       ...(init.headers as Record<string, string> || {}),
     };

     if (this.token) {
       baseHeaders.Authorization = `Bearer ${this.token}`;
     }

     for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
       const controller = new AbortController();
       const timeoutId = setTimeout(() => controller.abort(), this.timeout);

       try {
         const res = await this.fetchFn(url, {
           ...init,
           headers: baseHeaders,
           signal: controller.signal,
         });

         // Rate limiting detection (HTTP 429 or HTTP 403 with zero remaining quota)
         const remainingHeader = res.headers?.get?.('x-ratelimit-remaining');
         const isRateLimited = res.status === 429 || (
           res.status === 403 && (remainingHeader === '0' || Boolean(res.headers?.get?.('retry-after')))
         );

         if (isRateLimited) {
           if (attempt >= this.maxRetries) {
             const errorBody = await res.text().catch(() => '');
             throw new Error(`GitHub API rate limit exceeded (HTTP ${res.status}): ${errorBody.slice(0, 200)}`);
           }
           let delay = this.calculateBackoff(attempt);
           const retryAfter = res.headers?.get?.('retry-after');
           const resetHeader = res.headers?.get?.('x-ratelimit-reset');
           if (retryAfter) {
             const sec = Number(retryAfter);
             if (Number.isFinite(sec) && sec > 0) delay = Math.min(sec * 1000, 60000);
           } else if (resetHeader) {
             const resetSec = Number(resetHeader);
             if (Number.isFinite(resetSec)) {
               const diffMs = resetSec * 1000 - Date.now();
               if (diffMs > 0) delay = Math.min(diffMs, 60000);
             }
           }
           await this.sleep(delay);
           continue;
         }

         // Server errors (5xx)
         if (res.status >= 500) {
           if (attempt >= this.maxRetries) {
             const errorBody = await res.text().catch(() => '');
             throw new Error(`GitHub API server error ${res.status}: ${errorBody.slice(0, 200)}`);
           }
           await this.sleep(this.calculateBackoff(attempt));
           continue;
         }

         if (!res.ok) {
           const errorBody = await res.text().catch(() => '');
           throw new Error(`GitHub API error ${res.status} (${res.statusText}): ${errorBody.slice(0, 200)}`);
         }

         return (await res.json()) as T;
       } catch (err: any) {
         if (err?.name === 'AbortError') {
           if (attempt >= this.maxRetries) {
             throw new Error(`GitHub API request timed out after ${this.timeout}ms: ${endpoint}`);
           }
           await this.sleep(this.calculateBackoff(attempt));
           continue;
         }

         const isNetworkError = err instanceof TypeError || String(err?.message || '').toLowerCase().includes('fetch');
         if (isNetworkError && attempt < this.maxRetries) {
           await this.sleep(this.calculateBackoff(attempt));
           continue;
         }

         throw err;
       } finally {
         clearTimeout(timeoutId);
       }
     }

     throw new Error(`GitHub API request failed after ${this.maxRetries} retries: ${endpoint}`);
   }
   ```
   *Vital Detail*: `res.headers?.get?.(...)` optional chaining is required because Vitest test mocks often return plain objects (`{ ok: true, json: ... }`) without a real `Headers` instance.

---

## 6. Target Area 5: Orphan Task Discovery & Repair Mechanism

### 6.1 Current Observation
In `src/application/use-cases/repair-relations.ts` (lines 28–101):
1. `execute()` only processes `this.journal.getUnfinishedRelations()`.
2. Tasks created outside the local journal or tasks whose journal was lost/purged cannot be diagnosed or repaired.
3. No concurrency locking (`LockRepository`) is acquired.

### 6.2 Root Cause & Gap Analysis
1. An **orphan task** in Azure DevOps is a work item that belongs to the series (e.g. `3in1_PWA_MyAccount | ...`) but lacks a `System.LinkTypes.Hierarchy-Reverse` parent link.
2. In corporate Azure DevOps tracking, orphan tasks break roll-up metrics, epic hierarchy, and sprint burndown reporting.
3. `RepairRelationsUseCase` should be equipped with:
   - Optional `LockRepository` injection for concurrency safety.
   - `detectOrphanTasks(candidateTasks: WorkItem[])` to identify candidate work items lacking `Hierarchy-Reverse` parent links.
   - `repairOrphanTasks(orphans: OrphanTaskItem[], referenceSourceTask: WorkItem)` to attach the missing parent link from the reference source task and verify read-back.

### 6.3 Implementation Blueprint for Worker
1. Update constructor in `src/application/use-cases/repair-relations.ts`:
   ```typescript
   export interface OrphanTaskItem {
     id: number;
     title: string;
     assignedTo?: string;
     state: string;
     hasParent: boolean;
     parentRelationUrl?: string;
     status: 'DETECTED' | 'REPAIRED' | 'UNRESOLVED' | 'SKIPPED';
     message: string;
   }

   export interface ExtendedRepairReport extends RepairReport {
     orphans?: OrphanTaskItem[];
   }

   export class RepairRelationsUseCase {
     private readonly relationCopy: RelationCopyService;

     constructor(
       private readonly workItemRepo: WorkItemRepository,
       private readonly journal: JournalRepository,
       private readonly lockRepo?: LockRepository
     ) {
       this.relationCopy = new RelationCopyService(workItemRepo);
     }
   ```
2. Implement `detectOrphanTasks`:
   ```typescript
   async detectOrphanTasks(candidateTasks: WorkItem[]): Promise<OrphanTaskItem[]> {
     const orphans: OrphanTaskItem[] = [];
     for (const candidate of candidateTasks) {
       let fullItem = candidate;
       if (!candidate.relations) {
         try {
           fullItem = await this.workItemRepo.getWorkItem(candidate.id);
         } catch {
           continue;
         }
       }
       const relations = fullItem.relations ?? [];
       const hasParent = relations.some(r => r.rel === 'System.LinkTypes.Hierarchy-Reverse');
       if (!hasParent) {
         orphans.push({
           id: fullItem.id,
           title: String(fullItem.fields['System.Title'] || ''),
           assignedTo: typeof fullItem.fields['System.AssignedTo'] === 'string'
             ? fullItem.fields['System.AssignedTo']
             : (fullItem.fields['System.AssignedTo'] as any)?.displayName,
           state: String(fullItem.fields['System.State'] || ''),
           hasParent: false,
           status: 'DETECTED',
           message: 'Missing System.LinkTypes.Hierarchy-Reverse (Parent) relation.',
         });
       }
     }
     return orphans;
   }
   ```
3. Implement `repairOrphanTasks`:
   ```typescript
   async repairOrphanTasks(
     orphans: OrphanTaskItem[],
     referenceSourceTask: WorkItem
   ): Promise<OrphanTaskItem[]> {
     const parentRel = (referenceSourceTask.relations ?? []).find(
       r => r.rel === 'System.LinkTypes.Hierarchy-Reverse'
     );

     if (!parentRel) {
       return orphans.map(o => ({
         ...o,
         status: 'UNRESOLVED',
         message: `Reference source task #${referenceSourceTask.id} does not have a parent relation to copy.`,
       }));
     }

     const results: OrphanTaskItem[] = [];
     for (const orphan of orphans) {
       try {
         await this.workItemRepo.copyRelations(
           { ...referenceSourceTask, relations: [parentRel] },
           orphan.id,
           ['System.LinkTypes.Hierarchy-Reverse']
         );

         const readBack = await this.workItemRepo.getWorkItem(orphan.id);
         const verified = (readBack.relations ?? []).some(
           r => r.rel === 'System.LinkTypes.Hierarchy-Reverse' && r.url === parentRel.url
         );

         results.push({
           ...orphan,
           hasParent: verified,
           parentRelationUrl: verified ? parentRel.url : undefined,
           status: verified ? 'REPAIRED' : 'UNRESOLVED',
           message: verified
             ? `Successfully linked to parent: ${parentRel.url}`
             : 'Parent relation copy failed read-back verification.',
         });
       } catch (err: any) {
         results.push({
           ...orphan,
           status: 'UNRESOLVED',
           message: `Failed to attach parent relation: ${err?.message || String(err)}`,
         });
       }
     }
     return results;
   }
   ```
4. Support lock acquisition in `execute`:
   ```typescript
   async execute(options?: { candidateTasks?: WorkItem[]; referenceSourceTask?: WorkItem }): Promise<ExtendedRepairReport> {
     if (this.lockRepo && !this.lockRepo.acquire()) {
       const lock = this.lockRepo.getLockInfo();
       throw new Error(`Cannot run relation repair: another process (PID ${lock?.pid}) is executing.`);
     }

     try {
       // Normal journal repair ...
       // If options?.candidateTasks, run detectOrphanTasks and repairOrphanTasks ...
     } finally {
       this.lockRepo?.release();
     }
   }
   ```
5. Update `src/container.ts`:
   Pass `lockRepo` when constructing `repairRelations`:
   ```typescript
   const repairRelations = new RepairRelationsUseCase(workItemRepo, journalRepo, lockRepo);
   ```

---

## 7. Test Impact & Verification Plan

### 7.1 Existing Test Files Impact Analysis
- `tests/unit/task-entities.test.ts`:
  - 1 existing test suite for `validateSourceTaskOwnership`.
  - Must add tests verifying `matchesPerson` delegation, `Person` and `PersonConfig` objects, and displayName-only Azure records.
- `tests/unit/explore-tasks.test.ts`:
  - Must add tests verifying that work items with UTC evening timestamps (e.g. `20:00:00Z`) are correctly mapped to local calendar dates in `Asia/Kolkata` (UTC+5:30).
- `tests/integration/close-daily-tasks.test.ts`:
  - Must add tests verifying `TF401320` rule error recovery with PascalCase `Custom.ActualStartDate` and `Custom.ActualEndDate`.
- `tests/unit/github-client.test.ts`:
  - Must add tests verifying:
    1. HTTP 429 rate limit retry with `retry-after` header.
    2. HTTP 403 secondary rate limit with `x-ratelimit-remaining: '0'`.
    3. HTTP 500 / 503 transient error retry with exponential backoff.
    4. Timeout abort handling with `AbortController`.
    5. Non-retryable error (e.g. HTTP 404 or 401) immediate rejection.
- `tests/integration/repair-relations.test.ts`:
  - Must add tests verifying:
    1. `detectOrphanTasks` identifies work items lacking parent links.
    2. `repairOrphanTasks` links orphan to parent and verifies read-back.
    3. Concurrency lock acquisition blocks overlapping processes.

### 7.2 Verification Gates Command Protocol
The Worker must execute and pass the following quality gates in `new-app/`:
```bash
npm run typecheck
npm run lint
npm test
npm run build
```
Target results:
- TypeScript compilation: 0 errors.
- ESLint: 0 errors, 0 warnings.
- Vitest: All 353+ tests passing.
- Build: Clean compilation to `dist/`.

---

## 8. Summary of File Modifications for Worker

| Target File | Enhancement | Action |
|---|---|---|
| `src/domain/entities/task.ts` | Area 1: `validateSourceTaskOwnership` | Accept `Person \| PersonConfig \| string` and use `matchesPerson` |
| `src/application/use-cases/create-tasks.ts` | Area 1: Call site | Pass `person` entity to `validateSourceTaskOwnership` |
| `src/infrastructure/azure/work-item-service.ts` | Area 1: Call sites | Pass `person` entity at lines 209 and 344 |
| `src/application/use-cases/explore-tasks.ts` | Area 2: Explorer timezones | Use `extractWorkItemRecordedDate(item, timezone)` |
| `src/application/use-cases/close-daily-tasks.ts` | Area 3: TF401320 casing | Detect casing and apply automated recovery fallback |
| `src/infrastructure/github/github-client.ts` | Area 4: GitHub timeout/retry | Add `AbortController` timeout + bounded exponential retries |
| `src/application/use-cases/repair-relations.ts` | Area 5: Orphan tasks | Add orphan detection/repair + optional `lockRepo` |
| `src/container.ts` | Area 5: Dependency injection | Pass `lockRepo` to `RepairRelationsUseCase` |
| `tests/unit/task-entities.test.ts` | Test Coverage | Add tests for `validateSourceTaskOwnership` with `Person` |
| `tests/unit/explore-tasks.test.ts` | Test Coverage | Add test for UTC midnight boundary timezone parsing |
| `tests/integration/close-daily-tasks.test.ts` | Test Coverage | Add test for PascalCase `TF401320` recovery |
| `tests/unit/github-client.test.ts` | Test Coverage | Add tests for 429/403/5xx retry and timeout |
| `tests/integration/repair-relations.test.ts` | Test Coverage | Add tests for orphan detection, repair, and locking |
