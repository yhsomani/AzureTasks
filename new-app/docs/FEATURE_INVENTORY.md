# Feature inventory and navigation

This document describes the **current supported application**. Feature availability is based on the repository's code and API routes; assertions about production behavior still require verification against a configured Azure DevOps environment.

## Recommended user journey

1. **Settings and Team** — configure Azure DevOps connectivity, secure access, unique member identities, and per-person task prefixes.
2. **Dashboard** — check connection, task coverage, planned work, and scheduler state.
3. **Task Explorer** — inspect actual assignments by date and team member; investigate missing or duplicate tasks.
4. **Planner** — preview intended creations for the configured window; inspect targets before executing.
5. **Execute** — confirm the exact user/date scope, create only missing tasks, then inspect the response and audit record.
6. **My Work / Daily Burndown** — review assignments, task status, and workload trends.
7. **Audit Log / Logs** — diagnose failures, review execution history, export records, and repair missing relations where appropriate.
8. **Scheduler** — separately enable unattended execution only after validating the manual journey.

## Views and responsibilities

| UI view | User goal | Main action | Key states to validate |
|---|---|---|---|
| Dashboard | Understand connection and plan health | Inspect / open Planner | Disconnected, loading, ready, stale |
| My Work | Review a selected person's tasks | Select member / refresh | No member, empty tasks, error |
| Task Explorer | Inspect tasks and date coverage | Filter / inspect / create missing | No results, duplicates, insufficient permissions |
| Planner | Preview and create eligible tasks | Preview / confirm / execute | Zero missing, conflicting runs, partial success |
| Team | Maintain roster and per-member rules | Add / edit / disable member | Invalid identity, save failure |
| Daily Burndown | Review effort and completion | Select month | No data, loading, error |
| Scheduler | Configure recurring creation / closure | Configure / enable / run now | Disabled, invalid schedule, next run, failure |
| Audit Log | Investigate task mutations | Filter / export / repair | Empty journal, partial relation copy |
| Logs | Understand operational events | Read live/recent logs | Disconnected stream, no logs |
| Settings | Manage connections and defaults | Save configuration | Missing credential, validation error |

## Implemented layers

- **Web UI:** `src/presentation/web/public/index.html`, `app.js`, `styles.css`
- **HTTP API:** `src/presentation/api/routes.ts` and `server.ts`
- **Use cases:** `src/application/use-cases/` (planning, creating, exploring, closing, repairing, configuration)
- **Domain rules:** `src/domain/` (identity, date windows, duplication checks, title parsing, relation/field policies)
- **External adapters:** `src/infrastructure/azure/`, `src/infrastructure/github/`, `src/infrastructure/scheduler/`
- **Audit and runtime state:** `src/infrastructure/journal/`, `src/infrastructure/lock/`, `src/infrastructure/config/`
- **Automated tests:** `tests/unit/` and `tests/integration/`

## API surface to keep covered

`/api/health`, `/api/status`, `/api/config`, `/api/config/people`, `/api/config/settings`, `/api/config/pat`, `/api/tasks/plan`, `/api/tasks/execute`, `/api/explorer`, `/api/explorer/create-missing`, `/api/journal`, `/api/journal/export`, `/api/scheduler`, `/api/scheduler/toggle`, `/api/logs/recent`, `/api/logs/stream`, and task repair.

## Validation policy

A feature being present in source code is not evidence that it is working in a particular tenant. Report validation status separately as **code inspected**, **automated tests passed**, **browser verified**, and **real integration verified**. Never claim real task creation or security readiness without execution evidence.
