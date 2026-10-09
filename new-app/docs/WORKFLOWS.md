# Workflows

The canonical pipeline is:

```
Trigger → Validation → Authorization → Processing → State Change
        → Result → Error Handling → Recovery → Audit
```

Each stage below names the concrete code that performs it for the two entry
points: **interactive creation** (CLI/UI) and **scheduled creation** (daemon).

## 1. Interactive creation

| Stage | Implementation |
|---|---|
| **Trigger** | `POST /api/tasks/execute` → `CreateTasksUseCase.execute` (or `run` CLI). |
| **Validation** | `validateNotPastDate(asOf, actualToday)`; `CreateTasksUseCase` requires `input.yes` (CLI) or an explicit UI confirmation; input `personKeys` resolved against enabled people. |
| **Authorization** | PAT presence check (status); Azure rejects unauthorized calls (401/403) and the client surfaces the error. |
| **Processing** | Acquire lock → validate project + type → discover source (`discoverLatestTasksForPeople`) → build plans → detect duplicates → build field ops. |
| **State change** | `TaskExecutionService.executeTask`: create work item, then copy relations. |
| **Result** | `CreateTasksOutput` aggregates counts + per-person results; UI renders `stat-chips` and per-person blocks. |
| **Error handling** | Per-item `try/catch`: a failed task/relation does not abort the run; counts recorded in `failedTasks` / `failedCount`. |
| **Recovery** | Lock is released in `finally`; stale locks reclaimed after 5 min; journal keeps partial/complete rows; `repair` re-copies only the relations missing on partially-created tasks (idempotent) and updates the journal. |
| **Audit** | `JournalRepository.record` writes one row per created task (person, date, title, ids, field/relation status, verified flag). |

## 2. Scheduled creation

| Stage | Implementation |
|---|---|
| **Trigger** | `NodeSchedulerRepository` timer fires at the next weekday 09:30 **in `config.timezone`**. |
| **Validation** | Same as interactive; `asOf` defaults to today in the configured zone. |
| **Authorization** | PAT from environment (`AZURE_DEVOPS_PAT`). |
| **Processing** | Same pipeline; the lock prevents overlap with an interactive run on the same host. |
| **State change** | Same creation path. |
| **Result** | `SchedulerStatus.lastRun` / `lastRunResult` updated; logged. |
| **Error handling** | Timer callback catches and logs; the schedule re-arms regardless. |
| **Recovery** | Failed runs are retried on the next weekday; journal rows allow a manual `run --as-of`. |
| **Audit** | Journal + structured logs. |

## 3. Duplicate detection

Scoped per **person + date** using the discovered existing-task map, so two
different people never collide:

```
DuplicateDetector.buildExistingMap(tasks)   // Map<isoDate, WorkItem>
planCreationDates(...)                       // PLANNED vs DUPLICATE_ALREADY_EXISTS
```

## 4. Field copy

Copied from the source work item except mandatory overrides:

- `System.Title` → `"<prefix> <formatted date>"` (always overridden)
- `System.AssignedTo` → the configured person (always overridden)
- `Microsoft.VSTS.Scheduling.StartDate` → 09:30 wall-clock in `timezone`
- Excluded fields (`System.Id`, `System.Rev`, states/dates that would corrupt
  the new item) are dropped.

## 5. Relation copy

Whitelist copy (deduplicated): `Hierarchy-Reverse` (Parent), `Related`,
`Dependency-*`, `Duplicate-*`, `Hyperlink`, `ArtifactLink`.
Blacklist: `Hierarchy-Forward` (Child — reparenting), `AttachedFile`.

## 6. Status / state machine (per planned date)

```
PLANNED ─► CREATED            (success)
PLANNED ─► FAILED             (create or relation error)
        ─► DUPLICATE_ALREADY_EXISTS   (task for date already exists)
        ─► WEEKEND_SKIP               (weekend and skipWeekends)
        ─► FUTURE_TASK_WARN           (latest task beyond window)
        ─► NO_TASKS_NEEDED            (nothing to do)
SOURCE_NOT_FOUND                       (person has no source task)
```
