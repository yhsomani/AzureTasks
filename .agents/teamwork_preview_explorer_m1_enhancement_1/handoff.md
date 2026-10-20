# Milestone 1: Codebase Health, Test Type Safety & Lint Diagnostics — Explorer Investigation Report

## 1. Observation

### 1.1 TypeScript Configuration & Compilation Scope (`new-app/tsconfig.json`)
- File: `/Users/yashsomani/Desktop/Asure Bord Project/new-app/tsconfig.json`
- Lines 18-19:
  ```json
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist", "tests"]
  ```
- Command: `npm run typecheck` (`tsc --noEmit`)
  - Output: Exit code 0, 0 errors.
  - Reason: `tests/` is explicitly excluded from compilation.
- Command: `npm run build` (`tsc && node -e "import('fs').then(fs => fs.cpSync('src/presentation/web/public', 'dist/presentation/web/public', { recursive: true }))"`)
  - Output: Exit code 0, builds `dist/` cleanly from `src/`.
  - Consequence: If `tests` were directly included in `tsconfig.json`, `npm run build` would compile tests into `dist/tests/`, polluting production build artifacts.

### 1.2 Analysis of the Initial Survey Command vs Strict Typecheck
- Survey Command: `npx tsc --noEmit --skipLibCheck tests/unit/*.ts tests/integration/*.ts`
  - Output: Exit code 2, 46 errors across 19 files.
  - Root Cause Analysis:
    1. When `tsc` is invoked with individual file arguments without `-p`, it completely ignores `tsconfig.json`.
    2. Without `tsconfig.json`, `tsc` defaults to `--target es3/es5`, `--module commonjs`, and `strict: false`.
    3. Under those legacy defaults, 8 errors were triggered in `src/` files due to `TS2802` (`Set` downlevel iteration in `github-client.ts:210, 211, 262` and `logger.ts:64`) and `TS1259` (`esModuleInterop` default imports in `server.ts:11, 12`).
    4. 14 errors were triggered in `ui-*.test.ts` and `discovery.test.ts` due to missing vitest globals (`TS2304: Cannot find name 'describe' / 'it' / 'expect'`).
    5. Because `strict: false` was active, `(await res.json())` was typed as `any`, hiding the fact that Node 22 fetch returns `Promise<unknown>`.

### 1.3 Strict Project Typechecking with `tsconfig.test.json`
- Candidate Configuration:
  ```json
  {
    "extends": "./tsconfig.json",
    "compilerOptions": {
      "rootDir": ".",
      "module": "ESNext",
      "moduleResolution": "bundler",
      "types": ["node", "vitest/globals"],
      "noEmit": true
    },
    "include": ["src/**/*", "tests/**/*"],
    "exclude": ["node_modules", "dist"]
  }
  ```
- Rationale for compiler option overrides:
  - `"rootDir": "."`: Required because `tsconfig.json` specifies `"rootDir": "./src"`. Without this, TypeScript rejects files outside `src/` (`TS6059: File is not under 'rootDir'`).
  - `"module": "ESNext"` & `"moduleResolution": "bundler"`: In `tsconfig.json`, `"moduleResolution": "NodeNext"` requires explicit `.js` extensions on all relative imports (`TS2835`). Vitest test files use extensionless TypeScript imports (`import ... from '../../src/...'`). Vitest is powered by Vite (a bundler). Setting `bundler` resolution accurately matches the runtime test runner environment.
  - `"types": ["node", "vitest/globals"]`: Resolves Vitest global definitions (`describe`, `it`, `expect`, `beforeEach`, `afterEach`, `vi`) from `node_modules/vitest/globals.d.ts`.
  - `"exclude": ["node_modules", "dist"]`: Overrides the inherited `"exclude": ["node_modules", "dist", "tests"]` from `tsconfig.json`.
- Command Execution: `npx tsc -p <candidate_tsconfig> --noEmit`
- Result: **Found 60 errors across exactly 7 files**. 25 of the 32 test files and all 25 `src/` files pass typecheck with 0 errors.

### 1.4 Detailed Inventory of the 60 Latent Type Errors Across 7 Files

#### 1. `tests/unit/repositories.test.ts` (8 errors TS2345 + 1 missing import)
- Lines 315, 320, 329, 337, 344, 361, 382, 400:
  `error TS2345: Argument of type '{ timezone: string; startTime: string; }' is not assignable to parameter of type 'Pick<AppConfig, "startTime" | "timezone" | "autoClose" | ...>'. Property 'autoClose' is missing in type '{ timezone: string; startTime: string; }' but required in type 'Pick<AppConfig, ...>'.`
- Line 343: `vi.fn()` is used, but line 1 only imports `import { describe, it, expect, beforeEach, afterEach } from 'vitest';` (missing `vi`).
- Implementation Observation: In `src/infrastructure/scheduler/node-scheduler-repo.ts`:
  - Lines 40-49: The default constructor parameter provides `{ autoClose: false, ... }`.
  - Lines 57-58: `autoCloseEnabled: config.autoClose === true`.
  - The runtime code already treats `autoClose` as optional. Furthermore, test line 314 explicitly asserts:
    `it('defaults EOD closure to disabled when config omits autoClose', () => { const scheduler = new NodeSchedulerRepository({ timezone: 'UTC', startTime: '09:30' }); expect(scheduler.getStatus().autoCloseEnabled).toBe(false); });`
    The test's stated intent is to omit `autoClose` to verify default behavior.

#### 2. `tests/unit/work-item-service.test.ts` (2 errors TS2353 + Mock Field Forwarding Bug)
- Lines 56, 65:
  `error TS2353: Object literal may only specify known properties, and 'fields' does not exist in type '{ id: number; title: string; }'.`
- Implementation & Mock Defect:
  - Lines 6-21:
    ```typescript
    class FakeClient {
      public wiql = '';
      constructor(private readonly items: Array<{ id: number; title: string }>) {}
      ...
      async get<T>(_url: string): Promise<T> {
        return {
          value: this.items.map(i => ({ id: i.id, rev: 1, fields: { 'System.Title': i.title, 'System.AssignedTo': 'a@b.com' } })),
          count: this.items.length,
        } as T;
      }
    }
    ```
  - Defect: The constructor ignores `fields`, and `get()` hardcodes `{ 'System.Title': i.title, 'System.AssignedTo': 'a@b.com' }`.
  - As a result, lines 59 & 68 (`'Custom.PlannedStartdate': '2026-10-21T03:30:00.000Z'`) were silently discarded by the mock. The test passed only because `work-item-service.ts:450` fell back to string parsing the title.

#### 3. `tests/integration/create-tasks.test.ts` (9 errors: 2 TS2420 + 7 TS2345)
- Line 19:
  `error TS2420: Class 'FakeWorkItemRepo' incorrectly implements interface 'WorkItemRepository'. Type 'FakeWorkItemRepo' is missing the following properties from type 'WorkItemRepository': findCandidateTasks, patchWorkItem.`
- Line 95:
  `error TS2420: Class 'FakeJournalRepo' incorrectly implements interface 'JournalRepository'. Property 'markRepaired' is missing in type 'FakeJournalRepo' but required in type 'JournalRepository'.`
- Lines 136, 141, 210, 227, 255, 270, 278:
  Cascading `TS2345: Argument of type 'FakeWorkItemRepo' is not assignable to parameter of type 'WorkItemRepository'`.

#### 4. `tests/unit/get-status.test.ts` (1 error TS2740 + 1 ESLint warning)
- Line 8:
  `error TS2740: Type '{ organization: string; project: string; baseUrl: string; workItemType: string; taskSeries: string; titlePrefix: string; stopDayOfWeek: number; thursdayMode: "CURRENT"; timezone: string; people: never[]; schedulerEnabled: false; }' is missing the following properties from type 'AppConfig': startTime, skipWeekends, stopDay, defaultState, autoClose, copyEstimates, resetActualWork, maxRetries, initialRetryDelayMs.`
- Line 1:
  ESLint warning: `1:36 warning 'beforeEach' is defined but never used. Allowed unused vars must match /^_/u @typescript-eslint/no-unused-vars`.

#### 5. `tests/unit/explore-tasks.test.ts` (2 errors: 1 TS2740 + 1 TS2322)
- Line 6:
  `error TS2740: Type '{ ... }' is missing properties from type 'AppConfig': baseUrl, taskSeries, stopDay, defaultState, autoClose, copyEstimates, resetActualWork, maxRetries, initialRetryDelayMs.`
- Line 89:
  `error TS2322: Type 'Mock<() => Promise<({ id: number; fields: { ... } })[]>>' is not assignable to type '(...) => Promise<WorkItem[]>'. Property 'rev' is missing in type '{ id: number; fields: { ... } }'.`
- Line 114:
  `patchFields: vi.fn()` used where `WorkItemRepository` defines `patchWorkItem`.

#### 6. `tests/integration/api-routes.test.ts` (33 errors TS2571 / TS18046)
- Lines 109, 124, 130, 137, 138, 159, 174, 248, 265, 266, 282, 283, 291, 292, 307, 308, 315, 316, 322, 326, 334, 376, 420, 433, 450, 465, 489, 513, 514, 528, 535, 581, 591:
  `error TS2571: Object is of type 'unknown'` and `error TS18046: 'body' is of type 'unknown'`.
- Root Cause: In line 103, `const json = (path: string, init?: RequestInit) => fetch(base + path, init);` returns native Node `Response`. Under `strict: true`, `Response.json()` returns `Promise<unknown>`. Across 33 test cases, accessing `body.success`, `body.data`, or `(await res.json()).status` triggers strict unknown type errors.

#### 7. `tests/integration/server-security.test.ts` (5 errors TS2571)
- Lines 46, 53, 68, 76, 101:
  `error TS2571: Object is of type 'unknown'`.
- Root Cause: Same native `Response.json()` unknown return type when accessing `.data.role`, `.error`.

### 1.5 ESLint Scope & Package Scripts
- File: `/Users/yashsomani/Desktop/Asure Bord Project/new-app/eslint.config.js`
  - Lines 5-6: Already contains `files: ['src/**/*.ts', 'tests/**/*.ts']`.
- File: `/Users/yashsomani/Desktop/Asure Bord Project/new-app/package.json`
  - Line 15: `"lint": "eslint \"src/**/*.ts\""` only lints `src/`.
- Command: `npx eslint "{src,tests}/**/*.ts"`
  - Result: Exit code 0, 0 errors, exactly 1 warning (`tests/unit/get-status.test.ts:1:36 warning 'beforeEach' is defined but never used`).
  - No other lint warnings exist across the entire codebase.

---

## 2. Logic Chain

1. **Premise**: Production build integrity and testing static analysis must have distinct, non-interfering TypeScript configurations.
   - **From Observation 1.1**: `tsconfig.json` compiles `src/` to `dist/` for production. Including `tests/` in `tsconfig.json` causes `dist/tests/` to be generated, polluting the production package.
   - **From Observation 1.3**: Vitest uses Vite's bundler resolution where imports omit `.js` extensions, whereas `tsconfig.json` uses `NodeNext` which requires `.js` extensions.
   - **Deduction**: The proper architectural pattern is a dedicated `tsconfig.test.json` that extends `tsconfig.json`, sets `"rootDir": "."`, `"module": "ESNext"`, `"moduleResolution": "bundler"`, `"types": ["node", "vitest/globals"]`, `"noEmit": true`, and includes `tests/**/*`.

2. **Premise**: Latent test type errors must be fixed at their semantic source rather than through crude suppressions.
   - **From Observation 1.4 #1**: `NodeSchedulerRepository` was designed with defaults for optional configuration fields (`autoClose`, etc.), and `repositories.test.ts:314` tests that omitting `autoClose` defaults to false. Making `autoClose` optional in `node-scheduler-repo.ts` constructor parameter aligns the type contract with the implementation and satisfies all 8 call sites in `repositories.test.ts`.
   - **From Observation 1.4 #2**: `FakeClient` dropped `fields` in `get()`. Adding `fields?: Record<string, any>` to `FakeClient` item type and forwarding `fields` in `get()` fixes the 2 type errors and fixes the behavioral defect where custom start dates were discarded.
   - **From Observation 1.4 #3**: `FakeWorkItemRepo` and `FakeJournalRepo` drifted from `WorkItemRepository` and `JournalRepository`. Implementing the missing methods (`findCandidateTasks`, `patchWorkItem`, `markRepaired`) eliminates 9 errors.
   - **From Observation 1.4 #4 & #5**: `mockConfig` in `get-status.test.ts` and `explore-tasks.test.ts` omitted required `AppConfig` properties; `mockRepo.findCandidateTasks` omitted `rev: 1`. Supplying complete objects eliminates 3 errors.
   - **From Observation 1.4 #6 & #7**: In `api-routes.test.ts`, typing `json`'s return as `Promise<Response & { json(): Promise<any> }>` solves all 33 errors on line 103 without modifying 33 tests. In `server-security.test.ts`, annotating 5 assertions with `as any` eliminates the remaining 5 errors.
   - **Deduction**: All 60 type errors have clean, non-invasive, type-safe remedies that preserve 100% of existing runtime behavior.

3. **Premise**: Static linting must cover all TypeScript code and pass cleanly without warnings.
   - **From Observation 1.5**: `eslint.config.js` already supports `tests/**/*.ts`.
   - **From Observation 1.4 #4 & 1.5**: Removing the unused `beforeEach` import from `tests/unit/get-status.test.ts` reduces lint warnings from 1 to 0.
   - **From Observation 1.5**: Updating `package.json` to `"lint": "eslint \"{src,tests}/**/*.ts\""` and adding `"typecheck:tests": "tsc -p tsconfig.test.json --noEmit"` ensures both CI scripts pass cleanly with 0 errors and 0 warnings.

---

## 3. Caveats

1. **Production `tsconfig.json` Preservation**: `tsconfig.json` MUST NOT have its `exclude: ["node_modules", "dist", "tests"]` removed, because `npm run build` relies on it to build only `src/` to `dist/`. Test typechecking must be conducted exclusively via `tsconfig.test.json`.
2. **ESLint Parser Compatibility**: `eslint.config.js` does not require modification; only `package.json`'s `lint` script argument needs updating from `"src/**/*.ts"` to `"{src,tests}/**/*.ts"`.
3. **Vitest Runtime Test Pass Rate**: None of the proposed type fixes alter application logic or test execution logic; all 353 Vitest tests and all 19 Node native tests will continue to pass 100%.

---

## 4. Conclusion & Actionable Fix Plan for Worker

### Summary of Scope
| Target File | Changes Required | Errors Fixed |
|---|---|---|
| `new-app/tsconfig.test.json` | Create new configuration extending `./tsconfig.json` | Enables clean test typechecking |
| `new-app/package.json` | Add `"typecheck:tests"` script; update `"lint"` script | Covers tests in CI checks |
| `new-app/src/infrastructure/scheduler/node-scheduler-repo.ts` | Make `autoClose` optional in constructor parameter type | Fixes 8 TS2345 errors |
| `new-app/tests/unit/repositories.test.ts` | Add `vi` to line 1 import from `'vitest'` | Fixes 1 missing symbol error |
| `new-app/tests/unit/work-item-service.test.ts` | Add `fields?: Record<string, any>` to `FakeClient` item type; forward in `get()` | Fixes 2 TS2353 errors + preserves fields |
| `new-app/tests/integration/create-tasks.test.ts` | Add `findCandidateTasks`, `patchWorkItem` to `FakeWorkItemRepo`; `markRepaired` to `FakeJournalRepo` | Fixes 9 TS2420 / TS2345 errors |
| `new-app/tests/unit/get-status.test.ts` | Remove unused `beforeEach` import; complete `mockConfig: AppConfig` | Fixes 1 ESLint warning + 1 TS2740 error |
| `new-app/tests/unit/explore-tasks.test.ts` | Complete `mockConfig: AppConfig`; add `rev: 1` to `findCandidateTasks`; fix `patchWorkItem` | Fixes 2 TS2740 / TS2322 errors |
| `new-app/tests/integration/api-routes.test.ts` | Refine return type of `json` helper function at line 103 | Fixes 33 TS2571 / TS18046 errors |
| `new-app/tests/integration/server-security.test.ts` | Assert `(await res.json() as any)` on lines 46, 53, 68, 76, 101 | Fixes 5 TS2571 errors |

---

### Step-by-Step Code Fix Specifications

#### Step 1: Create `new-app/tsconfig.test.json`
Create `/Users/yashsomani/Desktop/Asure Bord Project/new-app/tsconfig.test.json` with:
```json
{
  "extends": "./tsconfig.json",
  "compilerOptions": {
    "rootDir": ".",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "types": ["node", "vitest/globals"],
    "noEmit": true
  },
  "include": ["src/**/*", "tests/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

#### Step 2: Update `new-app/package.json`
- In `scripts`:
  - Change line 15:
    ```json
    "lint": "eslint \"{src,tests}/**/*.ts\"",
    ```
  - Add after line 11 (`"typecheck": "tsc --noEmit",`):
    ```json
    "typecheck:tests": "tsc -p tsconfig.test.json --noEmit",
    ```

#### Step 3: Refine `node-scheduler-repo.ts` Constructor Type
File: `/Users/yashsomani/Desktop/Asure Bord Project/new-app/src/infrastructure/scheduler/node-scheduler-repo.ts`
- Export and use a scheduler config type where `autoClose` is optional:
```typescript
export type SchedulerConfig = Pick<AppConfig, 'timezone' | 'startTime'> &
  Partial<
    Pick<
      AppConfig,
      | 'scheduleTime'
      | 'schedulerEnabled'
      | 'schedulerAutoStart'
      | 'autoClose'
      | 'autoCloseStartTime'
      | 'autoCloseEndTime'
      | 'lastAutoClose'
    >
  >;
```
- In `NodeSchedulerRepository.constructor`:
```typescript
  constructor(
    private readonly config: SchedulerConfig = {
      timezone: 'Asia/Kolkata',
      startTime: '09:30',
      scheduleTime: '09:30',
      schedulerEnabled: false,
      schedulerAutoStart: false,
      autoClose: false,
      autoCloseStartTime: '18:15',
      autoCloseEndTime: '18:45',
    },
    private readonly configRepo?: ConfigRepository
  )
```

#### Step 4: Add `vi` Import in `repositories.test.ts`
File: `/Users/yashsomani/Desktop/Asure Bord Project/new-app/tests/unit/repositories.test.ts`
- Line 1:
```typescript
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
```

#### Step 5: Fix `FakeClient` in `work-item-service.test.ts`
File: `/Users/yashsomani/Desktop/Asure Bord Project/new-app/tests/unit/work-item-service.test.ts`
- Replace lines 6-21:
```typescript
/** Minimal Azure client fake: echoes the batch items regardless of the query. */
class FakeClient {
  public wiql = '';
  constructor(private readonly items: Array<{ id: number; title: string; fields?: Record<string, any> }>) {}

  async post<T>(_url: string, body: { query: string }): Promise<T> {
    this.wiql = body.query;
    return { workItems: this.items.map(i => ({ id: i.id })) } as T;
  }

  async get<T>(_url: string): Promise<T> {
    return {
      value: this.items.map(i => ({
        id: i.id,
        rev: 1,
        fields: {
          'System.Title': i.title,
          'System.AssignedTo': 'a@b.com',
          ...(i.fields ?? {}),
        },
      })),
      count: this.items.length,
    } as T;
  }
}
```

#### Step 6: Fix `FakeWorkItemRepo` and `FakeJournalRepo` in `create-tasks.test.ts`
File: `/Users/yashsomani/Desktop/Asure Bord Project/new-app/tests/integration/create-tasks.test.ts`
- In `FakeWorkItemRepo` (after line 68):
```typescript
  async findCandidateTasks(
    _project: string,
    _workItemType: string,
    _titlePrefix: string,
    _startDate?: string,
    _endDate?: string,
    _personIdentities?: string[]
  ): Promise<WorkItem[]> {
    return [];
  }

  async patchWorkItem(
    id: number,
    _fieldOps: any[],
    _options?: { bypassRules?: boolean }
  ): Promise<WorkItem> {
    return { id, rev: 1, fields: this.createdFields.get(id) ?? {}, relations: [] };
  }
```
- In `FakeJournalRepo` (after line 101):
```typescript
  async markRepaired(
    _entry: JournalEntry,
    _status: JournalEntry['relationCopyStatus'],
    _note: string,
    _verified?: boolean
  ): Promise<boolean> {
    return true;
  }
```

#### Step 7: Clean Up `get-status.test.ts`
File: `/Users/yashsomani/Desktop/Asure Bord Project/new-app/tests/unit/get-status.test.ts`
- Line 1:
```typescript
import { describe, it, expect, vi, afterEach } from 'vitest';
```
- Lines 8-20:
```typescript
  const mockConfig: AppConfig = {
    organization: 'TestOrg',
    project: 'TestProject',
    baseUrl: 'https://dev.azure.com',
    workItemType: '3in1 Task',
    taskSeries: '3in1',
    titlePrefix: '3in1 |',
    startTime: '09:30',
    timezone: 'Asia/Kolkata',
    skipWeekends: true,
    stopDay: 'Thursday',
    stopDayOfWeek: 4,
    thursdayMode: 'CURRENT',
    defaultState: 'To Do',
    autoClose: false,
    copyEstimates: true,
    resetActualWork: true,
    maxRetries: 3,
    initialRetryDelayMs: 1000,
    people: [],
    schedulerEnabled: false,
  };
```

#### Step 8: Fix `explore-tasks.test.ts`
File: `/Users/yashsomani/Desktop/Asure Bord Project/new-app/tests/unit/explore-tasks.test.ts`
- Lines 6-21:
```typescript
  const mockConfig: AppConfig = {
    organization: 'TestOrg',
    project: 'TestProj',
    baseUrl: 'https://dev.azure.com',
    workItemType: 'Task',
    taskSeries: '3in1',
    titlePrefix: '3in1_PWA_MyAccount |',
    timezone: 'Asia/Kolkata',
    startTime: '09:30',
    thursdayMode: 'CURRENT',
    skipWeekends: true,
    stopDay: 'Thursday',
    stopDayOfWeek: 4,
    defaultState: 'To Do',
    autoClose: false,
    copyEstimates: true,
    resetActualWork: true,
    maxRetries: 3,
    initialRetryDelayMs: 1000,
    people: [
      { key: 'user1', name: 'Alice Smith', assignedTo: 'alice@example.com', enabled: true },
      { key: 'user2', name: 'Bob Jones', assignedTo: 'bob@example.com', enabled: true },
      { key: 'user3', name: 'Charlie Disabled', assignedTo: 'charlie@example.com', enabled: false },
    ],
  };
```
- Lines 89-115:
  - Add `rev: 1` to objects returned by `findCandidateTasks`:
    ```typescript
    findCandidateTasks: vi.fn(async () => [
      {
        id: 101,
        rev: 1,
        fields: { ... },
      },
      {
        id: 102,
        rev: 1,
        fields: { ... },
      },
    ]),
    ```
  - Replace line 114 `patchFields: vi.fn()` with `patchWorkItem: vi.fn(async () => ({ id: 0, rev: 1, fields: {} }))`.

#### Step 9: Fix `api-routes.test.ts`
File: `/Users/yashsomani/Desktop/Asure Bord Project/new-app/tests/integration/api-routes.test.ts`
- Replace line 103:
```typescript
const json = async (path: string, init?: RequestInit): Promise<Response & { json(): Promise<any> }> =>
  fetch(base + path, init) as Promise<Response & { json(): Promise<any> }>;
```

#### Step 10: Fix `server-security.test.ts`
File: `/Users/yashsomani/Desktop/Asure Bord Project/new-app/tests/integration/server-security.test.ts`
- Line 46:
```typescript
expect(((await viewerSession.json()) as any).data.role).toBe('viewer');
```
- Line 53:
```typescript
expect(((await denied.json()) as any).error).toContain('read-only');
```
- Line 68:
```typescript
expect(((await duplicatedMembers.json()) as any).error).toContain('duplicate member keys');
```
- Line 76:
```typescript
expect(((await invalid.json()) as any).error).toContain('positive integer');
```
- Line 101:
```typescript
expect(((await operatorSession.json()) as any).data.role).toBe('operator');
```

---

## 5. Verification Method

To verify the investigation and changes, execute the following commands in `/Users/yashsomani/Desktop/Asure Bord Project/new-app`:

1. **Verify Production Typecheck**:
   ```bash
   npm run typecheck
   ```
   *Expected*: Exit code 0, 0 errors.

2. **Verify Test Typecheck (`tsconfig.test.json`)**:
   ```bash
   npm run typecheck:tests
   # or
   npx tsc -p tsconfig.test.json --noEmit
   ```
   *Expected*: Exit code 0, 0 errors across all 32 test files and `src/`.

3. **Verify Unified ESLint (src + tests)**:
   ```bash
   npm run lint
   # or
   npx eslint "{src,tests}/**/*.ts"
   ```
   *Expected*: Exit code 0, 0 errors, 0 warnings.

4. **Verify Automated Vitest Suite**:
   ```bash
   npm test
   ```
   *Expected*: Exit code 0, 32 passed test files, 353 passed tests.

5. **Verify Node Native Test Suites**:
   ```bash
   npm run test:schema && npm run test:identities && npm run test:workitems
   ```
   *Expected*: Exit code 0, 19 passed tests (3 + 8 + 8).

6. **Verify Production Build Artifact**:
   ```bash
   npm run build
   ```
   *Expected*: Exit code 0, clean ESM compilation in `dist/` with vanilla SPA public assets copied.

### Invalidation Conditions
This investigation report is invalidated if:
- `tsconfig.json` compiler options (`target`, `module`, `moduleResolution`, `strict`) are altered without testing downstream compatibility.
- Vitest configuration is modified to disable `globals: true`.
- Node.js runtime is downgraded below v22.
