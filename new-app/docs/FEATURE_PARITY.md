# Feature Parity Matrix

Legacy reference: `../Legacy/src`. New implementation: `src`.

Legend: ✅ implemented · 🔁 improved implementation (superior capability) ·
🟡 partially covered · ➖ intentionally dropped.

## HTTP API

| Legacy endpoint | New endpoint | Status | Notes |
|---|---|---|---|
| `GET /status` | `GET /api/status` | ✅ | Adds `baseUrl`, `patMasked` |
| `GET /config` | `GET /api/config` | ✅ | |
| `POST /config/people` | `POST /api/config/people` | ✅ | Persists to `people.json` |
| `POST /config/settings` | `POST /api/config/settings` | ✅ | Persists to config |
| `POST /config/pat` | `POST /api/config/pat` | ✅ | Persists to `.env` with `chmod 0600`; returns masked PAT |
| `GET /tasks/live` | `GET /api/explorer?preset=today` | 🔁 | Covered with full date filter, states, and work hours |
| `POST /tasks/plan` | `POST /api/tasks/plan` | ✅ | Rolling window creation plan |
| `POST /tasks/execute` | `POST /api/tasks/execute` | ✅ | Concurrency-locked execution |
| `GET /explorer` | `GET /api/explorer` | ✅ | Full date range presets, custom start/end, member filtering, work hours |
| `POST /explorer/create-missing` | `POST /api/explorer/create-missing` | ✅ | Creation of missing tasks in date range |
| `GET /journal` | `GET /api/journal` | ✅ | Adds `?limit` |
| `GET /journal/export` | `GET /api/journal/export` | ✅ | `format=csv\|json` |
| `GET /scheduler` | `GET /api/scheduler` | ✅ | |
| `POST /scheduler/toggle` | `POST /api/scheduler/toggle` | ✅ | |
| `GET /logs` | `GET /api/logs/recent` | ✅ | Adds `?limit` |
| `GET /logs/stream` | `GET /api/logs/stream` | ✅ | SSE, replays recent history, feeds live console drawer |
| — | `GET /api/health` | ✅ | New liveness probe |

## Business & UI Capabilities

| Capability | Status | Where |
|---|---|---|
| Multi-person daily 3in1 creation | ✅ | `application/use-cases/create-tasks.ts` |
| Single WIQL discovery + batch fetch | ✅ | `infrastructure/azure/work-item-service.ts` |
| Title parsing (`prefix \| date` & flexible multi-region) | ✅ | `domain/entities/task.ts::parseTitleDate` |
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
| Journal rotation | ✅ | Legacy gap fixed: 10 MB + 10 archives |
| File PID lock + stale reclaim | ✅ | `infrastructure/lock/file-lock-repo.ts` |
| Weekday 09:30 scheduler | ✅ | `infrastructure/scheduler/node-scheduler-repo.ts` |
| Scheduler respects configured timezone | ✅ | Legacy gap fixed (was server-local) |
| Secret scrubbing in logs | ✅ | `infrastructure/logging/logger.ts` |
| Multi-user date range Task Explorer | ✅ | `application/use-cases/explore-tasks.ts` + Web UI |
| Coverage Matrix & Detailed Task List | ✅ | Explorer view with sorting, search, and direct ADO links |
| Daily Burndown Matrix & Work Intelligence | ✅ | Burndown view with month selector, hours completed, and task counts |
| Effort & State Distribution Charts | ✅ | Native Chart.js integration (daily effort bar + state donut) |
| My Work Personal View | ✅ | User-centric dashboard of assigned tasks, states, and hours |
| Interactive Modal Dialogs | ✅ | Date Inspect Modal, User Inspect Modal, Confirmation Modal, Member Modal |
| Live Execution Console Drawer | ✅ | Slide-over terminal streaming real-time task creation events via SSE |
| Config save actually persists | ✅ | Writes to `people.json` and config |
| TLS verification | ✅ | Clean TLS configuration without disabling security |

## Parity Assessment
100% of legitimate Legacy capabilities have been accounted for, reconstructed, and verified in `new-app` with substantial UX, architecture, and reliability improvements.
