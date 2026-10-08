# Feature parity matrix

Legacy reference: `../Legacy/src`. New implementation: `src`.

Legend: ✅ implemented · 🔁 implemented differently (equivalent capability) ·
🟡 partially covered · ➖ intentionally dropped.

## HTTP API

| Legacy endpoint | New endpoint | Status | Notes |
|---|---|---|---|
| `GET /status` | `GET /api/status` | ✅ | Adds `baseUrl`, `patMasked` |
| `GET /config` | `GET /api/config` | ✅ | |
| `POST /config/people` | `POST /api/config/people` | ✅ | Now **persists** to `people.json` |
| `POST /config/settings` | `POST /api/config/settings` | ✅ | Now **persists** |
| `POST /config/pat` | `POST /api/config/pat` | ✅ | Persists to `.env` with `chmod 0600`; returns masked PAT |
| `GET /tasks/live` | — | ➖ | Historical listing dropped; window plan/explorer covers the operation |
| `POST /tasks/plan` | `POST /api/tasks/plan` | ✅ | |
| `POST /tasks/execute` | `POST /api/tasks/execute` | ✅ | |
| `GET /explorer` | Explorer view (`/tasks/plan`) | 🔁 | Per-person × date coverage grid from the same plan data |
| `POST /explorer/create-missing` | Explorer "Create missing" (`/tasks/execute`) | 🔁 | Executes the standard creation window |
| `GET /journal` | `GET /api/journal` | ✅ | Adds `?limit` |
| `GET /journal/export` | `GET /api/journal/export` | ✅ | `format=csv\|json` |
| `GET /scheduler` | `GET /api/scheduler` | ✅ | |
| `POST /scheduler/toggle` | `POST /api/scheduler/toggle` | ✅ | |
| `GET /logs` | `GET /api/logs/recent` | ✅ | Adds `?limit` |
| `GET /logs/stream` | `GET /api/logs/stream` | ✅ | SSE, replays recent history |
| — | `GET /api/health` | ✅ | New liveness probe |

## Business capabilities

| Capability | Status | Where |
|---|---|---|
| Multi-person daily 3in1 creation | ✅ | `application/use-cases/create-tasks.ts` |
| Single WIQL discovery + batch fetch | ✅ | `infrastructure/azure/work-item-service.ts` |
| Title parsing (`prefix \| date`) | ✅ | `domain/entities/task.ts::parseTitleDate` |
| Date window today → next Thursday | ✅ | `domain/value-objects/date-window.ts` |
| Thursday modes `CURRENT` / `FOLLOWING` | ✅ | `getNextThursdayIso` |
| Weekend skipping | ✅ | `planCreationDates(skipWeekends)` |
| Stop day of week | ✅ | `planCreationDates(stopDayOfWeek)` |
| Duplicate prevention (person + date scoped) | ✅ | `domain/services/task-services.ts::DuplicateDetector` |
| Multiple-existing-tasks warning | ✅ | `MULTIPLE_EXISTING_TASKS` / `FUTURE_TASK_WARN` |
| Field copy from source, mandatory overrides | ✅ | `FieldCopyService` |
| Start date = 09:30 configured timezone | ✅ | `zonedTimeToUtcIso` |
| Relation copy whitelist | ✅ | `COPYABLE_RELATION_TYPES` |
| Exclude Child (`Hierarchy-Forward`) | ✅ | `EXCLUDED_RELATION_TYPES` |
| Exclude `AttachedFile` | ✅ | `EXCLUDED_RELATION_TYPES` |
| Per-person source task override | ✅ | `PersonConfig.sourceTaskId` |
| Default source task fallback | ✅ | `discoverLatestTasksForPeople(..., defaultSourceTaskId)` |
| Creation reconciliation (avoid duplicate on retry) | ✅ | `createWorkItemWithReconciliation` |
| Journal (audit trail) | ✅ | `infrastructure/journal/file-journal-repo.ts` |
| Journal rotation | ✅ | Legacy **gap fixed**: 10 MB + 10 archives |
| File PID lock + stale reclaim | ✅ | `infrastructure/lock/file-lock-repo.ts` |
| Weekday 09:30 scheduler | ✅ | `infrastructure/scheduler/node-scheduler-repo.ts` |
| Scheduler respects configured timezone | ✅ | Legacy **gap fixed** (was server-local) |
| Secret scrubbing in logs | ✅ | `infrastructure/logging/logger.ts` |
| Web dashboard (status/plan/journal/scheduler/logs) | ✅ | `presentation/web/public` |
| Config save actually persists | ✅ | Legacy **gap fixed** (was in-memory) |
| TLS verification | ✅ | Legacy disabled TLS; new app never does |
| Interactive CLI confirm prompt | 🟡 | Replaced by `--yes` + UI confirmation dialog |

## Config fields

| Field | Legacy | New |
|---|---|---|
| `organization` | ✅ | ✅ |
| `project` | ✅ | ✅ |
| `workItemType` | ✅ | ✅ |
| `titlePrefix` | ✅ | ✅ |
| `timezone` | ✅ | ✅ |
| `startTime` | ✅ | ✅ (drives scheduler) |
| `thursdayMode` | ✅ | ✅ |
| `skipWeekends` | ✅ | ✅ |
| `stopDayOfWeek` | ✅ | ✅ |
| `people[].key/name/assignedTo/enabled` | ✅ | ✅ |
| `people[].pod/role` | ✅ | ✅ |
| `people[].sourceTaskId` | ✅ | ✅ |
| `defaultSourceTaskId` | ✅ | ✅ |

## Intentional differences

1. **No `NODE_TLS_REJECT_UNAUTHORIZED=0`.** Install the corporate root CA instead.
2. **No in-memory-only config saves.** All writes persist.
3. **Explorer is window-scoped**, not an unbounded historical browser. Re-add
   historical listing only if a reporting need appears.
4. **Dependency-free SPA** instead of React — no build step, no bundled deps.
5. **`repair` CLI** reports incomplete relation copies (read-only). Automatic
   repair is deferred until a real need is demonstrated.
