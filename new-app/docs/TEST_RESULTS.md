# Test results

**Command:** `npm test` (`vitest run`)
**Result:** ✅ **12 files, 112 tests passed** · ~5 s

```
 ✓ tests/unit/date-window.test.ts            (18 tests)
 ✓ tests/unit/person.test.ts                 (10 tests)
 ✓ tests/unit/task-services.test.ts          (16 tests)
 ✓ tests/unit/task-entities.test.ts          ( 9 tests)
 ✓ tests/unit/repositories.test.ts           (15 tests)
 ✓ tests/unit/azure-client.test.ts           ( 6 tests)
 ✓ tests/unit/config-use-cases.test.ts       ( 6 tests)
 ✓ tests/unit/work-item-service.test.ts      ( 2 tests)
 ✓ tests/integration/create-tasks.test.ts    (10 tests)
 ✓ tests/integration/repair-relations.test.ts (3 tests)
 ✓ tests/integration/discovery.test.ts        ( 3 tests)
 ✓ tests/integration/api-routes.test.ts      (14 tests)

 Test Files  12 passed (12)
      Tests  112 passed (112)
```

## What is covered

| Area | Tests |
|---|---|
| Date window & UTC-safe helpers | `getDayOfWeek`, `addDays`, `getNextThursdayIso` (CURRENT/FOLLOWING), `formatTitleDate`, `zonedTimeToUtcIso`, `planCreationDates` (weekend skip, stop day, duplicate, future-task warn), `validateNotPastDate` |
| Person entity | `createPersonKey`, `normalizeIdentity`, identity matching, enable/disable |
| Task entities | `parseTitleDate` (incl. trailing-pipe prefix), relation whitelist/blacklist, dedupe |
| Domain services | `DuplicateDetector` (person+date scoping), `FieldCopyService` overrides/exclusions, `DatePlanningService` |
| Adapters | File journal (append/rotation/export/repair), file lock (acquire/release/stale-PID reclaim), config load |
| Config use-cases | Roster validation (required key, duplicate key/identity), settings validation (IANA timezone, `HH:MM`), live config update |
| Azure client | Fail-fast on missing PAT, no retry on 401/403, retry on 5xx, network-error normalization, live org/PAT read |
| Work-item discovery | `getExistingTasksForPerson`: multiple tasks per date counted, timezone-widened StartDate bound; per-person `sourceTaskId` override beats discovery and the global override |
| API routes | Real ephemeral HTTP server: health/status, plan (default-all + 400 path), execute (progress + `yes`), journal list/export, scheduler toggle, SSE headers, SPA served |
| Auth | HTTP Basic gate: 401 + `WWW-Authenticate` when enabled, correct creds pass, wrong creds rejected, `/api/health` stays public |
| Create flow | Full `CreateTasksUseCase` with in-memory fakes: multi-person, duplicate skip, failure isolation, dry-run, output aggregation |
| Discovery mapping | Regression: Azure identity → `person.key` mapping + default-source fallback |
| Repair | `RelationCopyService.repairRelations` (idempotent missing-only copy), `FileJournalRepository.markRepaired`, `RepairRelationsUseCase` (isolation, skip, journal update) |

## Regression tests that lock in real bug fixes

1. **Date/UTC bug** — helpers previously mixed local parsing with
   `toISOString()`, shifting dates by a day in IST. Tests assert UTC-stable
   results and that `09:30` in `Asia/Kolkata` becomes `04:00Z`.
2. **`parseTitleDate` bug** — a configured prefix ending in `|` was rejected
   because the regex demanded two pipes. Test asserts the trailing pipe is
   stripped before matching.
3. **Discovery key bug** — results were keyed by Azure identity while callers
   looked up by `person.key`. `tests/integration/discovery.test.ts` asserts the
   map keys are the configured person keys.
4. **Auth-error retry loop bug** — 401/403 responses were retried with backoff
   and a missing PAT failed after ~10 s with "fetch failed".
   `tests/unit/azure-client.test.ts` asserts fail-fast behavior and clear
   messages.
5. **Read-only field copy bug** — copying derived fields such as
   `System.Watermark`, `System.TeamProject`, `System.AreaId` or
   `Microsoft.VSTS.Scheduling.TargetDate` made Azure reject the create patch.
   `tests/unit/task-services.test.ts` asserts they are never emitted.
6. **Ignored stop-day bug** — `stopDayOfWeek` was persisted and validated but
   never used, so the window always ended on Thursday. It is now threaded
   through `getNextThursdayIso`/`planCreationDates`/the use-cases, with tests
   for a non-Thursday window end and the request-level `thursdayMode` override.
7. **Silent January bug** — `parseTitleDate` mapped an unknown month
   abbreviation to January (`?? 0`). It now returns invalid, so a malformed
   title is skipped rather than dated wrongly.
8. **Per-person source override bug** — a person's configured `sourceTaskId` was
   ignored and the default source was applied as a global override for
   everyone. Overrides now resolve per person first (fetched once when shared),
   with discovery and the default fallback applied only to the rest.

## Coverage

`npm run test:coverage` (`@vitest/coverage-v8`):

| Layer | % Stmts | % Branch | % Funcs |
|---|---|---|---|
| **All files** | 74.4 | 73.7 | 81.3 |
| `domain` (incl. value-objects) | 100 | 97–100 | 100 |
| `domain/services` | 97.7 | 85.4 | 90.9 |
| `application/use-cases` | 74.0 | 68.9 | 80.8 |
| `presentation/api` | 74.7 | 66.7 | 100 |
| `infrastructure` | 34–88 | 53–88 | 46–100 |

**Interpretation:** the pure business logic — where correctness matters most —
is fully covered, and the HTTP layer is now covered by route smoke tests over a
real ephemeral server. Infrastructure adapters remain thinner (I/O wrappers over
the tested ports) and are exercised by end-to-end smoke runs. This is a
deliberate trade-off, not a gap in the rules engine.

## How to reproduce

```bash
cd new-app
npm install
npm test              # unit + integration
npm run test:coverage # coverage table
npm run typecheck     # tsc --noEmit (clean)
npm run build         # tsc + copy UI
node dist/index.js --help
```
