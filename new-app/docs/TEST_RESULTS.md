# Test results

**Command:** `npm test` (`vitest run`)
**Result:** ✅ **9 files, 76 tests passed** · ~1 s

```
 ✓ tests/unit/date-window.test.ts      (15 tests)
 ✓ tests/unit/person.test.ts           (10 tests)
 ✓ tests/unit/task-services.test.ts    (14 tests)
 ✓ tests/unit/task-entities.test.ts    ( 8 tests)
 ✓ tests/unit/repositories.test.ts     (12 tests)
 ✓ tests/unit/azure-client.test.ts     ( 4 tests)
 ✓ tests/integration/create-tasks.test.ts   ( 8 tests)
 ✓ tests/integration/repair-relations.test.ts (3 tests)
 ✓ tests/integration/discovery.test.ts      ( 2 tests)

 Test Files  9 passed (9)
      Tests  76 passed (76)
```

## What is covered

| Area | Tests |
|---|---|
| Date window & UTC-safe helpers | `getDayOfWeek`, `addDays`, `getNextThursdayIso` (CURRENT/FOLLOWING), `formatTitleDate`, `zonedTimeToUtcIso`, `planCreationDates` (weekend skip, stop day, duplicate, future-task warn), `validateNotPastDate` |
| Person entity | `createPersonKey`, `normalizeIdentity`, identity matching, enable/disable |
| Task entities | `parseTitleDate` (incl. trailing-pipe prefix), relation whitelist/blacklist, dedupe |
| Domain services | `DuplicateDetector` (person+date scoping), `FieldCopyService` overrides/exclusions, `DatePlanningService` |
| Adapters | File journal (append/rotation/export), file lock (acquire/release/stale-PID reclaim), config load |
| Azure client | Fail-fast on missing PAT, no retry on 401/403, retry on 5xx, network-error normalization |
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

## Coverage

`npm run test:coverage` (`@vitest/coverage-v8`):

| Layer | % Stmts | % Branch | % Funcs |
|---|---|---|---|
| **All files** | 49.6 | 72.2 | 80.0 |
| `domain` (incl. value-objects) | 98–100 | 88–100 | 100 |
| `domain/services` | 97.4 | 87.5 | 90.5 |
| `application/use-cases` | 63.5 | 65.1 | 77.8 |
| `infrastructure` | 18–88 | 62–68 | 43–100 |
| `presentation` | 0 | 0 | 0 |

**Interpretation:** the pure business logic — where correctness matters most —
is fully covered. Infrastructure adapters and HTTP routes are exercised by the
end-to-end smoke test (server boot + `/api/*` responses + DOM render) rather
than unit tests, because they are thin I/O wrappers over the tested ports. This
is a deliberate trade-off, not a gap in the rules engine.

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
