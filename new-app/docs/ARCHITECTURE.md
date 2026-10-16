# Architecture

## 1. Style: hexagonal (ports & adapters) + DDD

```
┌─────────────────────────────────────────────────────────────┐
│ presentation   HTTP API (/api/*)  ·  Web SPA  ·  CLI         │
│                depends on → application                      │
├─────────────────────────────────────────────────────────────┤
│ application    use cases: CreateTasks · PlanTasks ·          │
│                GetSystemStatus · ConfigUseCases              │
│                depends on → domain (+ domain ports)          │
├─────────────────────────────────────────────────────────────┤
│ domain         entities · value objects · domain services ·  │
│                PORTS (interfaces). Pure, no I/O.             │
│                depends on nothing outward                   │
├─────────────────────────────────────────────────────────────┤
│ infrastructure adapters implement domain ports:              │
│   AzureWorkItemService, AzureDevOpsClient,                   │
│   FileConfigRepository, FileJournalRepository,               │
│   FileLockRepository, NodeSchedulerRepository, Logger        │
└─────────────────────────────────────────────────────────────┘
```

**Dependency rule:** arrows point inward. `domain` imports nothing from the
other layers; `application` depends only on `domain`; `infrastructure`
implements `domain` ports; `presentation` calls `application`. The composition
root (`container.ts`) is the only place that knows concrete adapters.

### Layer contents

| Layer | Files |
|---|---|
| domain / entities | `person.ts` (Person, identity matching), `task.ts` (WorkItem, `parseTitleDate`, relation filtering) |
| domain / value objects | `date-window.ts` (date arithmetic, `planCreationDates`, `zonedTimeToUtcIso`) |
| domain / services | `task-services.ts` (Discovery, DuplicateDetector, FieldCopy, RelationCopy, DatePlanning, TaskExecution) |
| domain / ports | `ports/repositories.ts` (WorkItemRepository, ConfigRepository, JournalRepository, LockRepository, SchedulerRepository) |
| application | `create-tasks.ts`, `plan-tasks.ts`, `get-status.ts`, `config.ts` |
| infrastructure | `azure/client.ts`, `azure/work-item-service.ts`, `config/file-config-repo.ts`, `journal/file-journal-repo.ts`, `lock/file-lock-repo.ts`, `scheduler/node-scheduler-repo.ts`, `logging/logger.ts` |
| presentation | `api/routes.ts`, `api/server.ts`, `web/public/{index.html,styles.css,app.js}` |

### Current architecture rationale

| Design concern | Current solution |
|---|---|
| Separate task planning from side effects | Pure domain services and a thin `CreateTasksUseCase` |
| Isolate external Azure calls | `WorkItemRepository` port with test doubles |
| Centralize HTTP request handling | Express Router in the presentation layer |
| Make configuration deterministic | `FileConfigRepository.load()` with documented precedence |
| Keep UI lightweight | Dependency-free SPA and shared design-system stylesheet |
| Limit journal growth | Rotation at 10 MB with a bounded archive count |
| Preserve transport security | Standard TLS verification and trusted CA roots |
| Respect local working hours | Scheduler uses the configured IANA timezone |

## 2. Key domain decisions

- **Pure functions for verified behavior.** Date planning, duplicate detection,
  title parsing, field-copy exclusion and relation filtering are pure and unit
  tested against the application's documented domain rules.
- **UTC-safe date math.** All ISO date helpers parse with `T00:00:00Z` and use
  `getUTC*`/`setUTC*`. Mixing local parsing with `toISOString()` was a real bug
  (off-by-one in IST) and is guarded by tests.
- **Wall-clock → instant.** `zonedTimeToUtcIso('2026-10-08','09:30','Asia/Kolkata')`
  = `2026-10-08T04:00:00.000Z`. Task `StartDate` is 09:30 local, stored as UTC.
- **Relation whitelist.** Copy Parent (`Hierarchy-Reverse`), Related,
  Dependency/Duplicate (both directions), Hyperlink, ArtifactLink. Exclude Child
  (`Hierarchy-Forward`) and `AttachedFile`. Deduplicated.
- **Identity mapping.** Azure returns `uniqueName`/`displayName`; discovery maps
  them back to the configured `person.key` (matching email, display name, or
  configured name).

## 3. Runtime flows

**CreateTasksUseCase.execute(input, onProgress)**
1. Acquire lock (skipped for dry-run).
2. Select enabled people (all, or `personKeys`).
3. Validate project + work item type.
4. Resolve today (config timezone) and the window end (Thursday).
5. Discover one source task per person (single WIQL + batch fetch).
6. Build per-person plans; populate duplicate maps; recalculate plans.
7. Dry-run → return. No work → return.
8. Execute per person-date: build field ops → create (with reconciliation) →
   copy relations → journal. Failures are isolated per item.
9. Release lock; return aggregated `CreateTasksOutput`.

## 4. Configuration precedence

1. Defaults in `getDefaultConfig()`
2. `people.json` (or `--config`)
3. `AZURE_DEVOPS_ORG` / `AZURE_DEVOPS_PROJECT` / `AZURE_DEVOPS_TIMEZONE` / `PORT`
4. `.env`

Later sources override earlier ones. `people.json` `people` always wins for the
roster; `.env` supplies the secret PAT.

## 5. Deployment {#deployment}

Single-process Node app; no database. State is files in the working directory.

```bash
# build an artifact
git archive --format=tar HEAD new-app | (cd /opt && tar xf -)
cd /opt/new-app
npm ci
npm run build

# run the API/UI
AZURE_DEVOPS_PAT=... PORT=8080 node dist/index.js serve

# or run the scheduler (one instance only — the file lock is per-host)
AZURE_DEVOPS_PAT=... node dist/index.js daemon
```

Run as a systemd/launchd service. Set `API_AUTH_TOKEN` and use HTTPS or put `serve` behind an authenticating reverse
proxy. Endpoints can mutate Azure DevOps work items; do not expose them publicly without protection. Back up
`people.json`, `.env`, `.task-journal.json`.

### Rollback

1. Stop the process.
2. Restore the previous `dist/` (or `git checkout <prev-commit> -- new-app && npm ci && npm run build`).
3. Restart. No schema migrations; the journal format is append-only JSON.

## 6. Observability

- Structured in-process logger with an in-memory ring buffer (500 lines) and
  secret scrubbing; SSE stream to the UI.
- `GET /api/health` for liveness probes.
- Journal provides a durable, queryable, exportable audit trail.

## 7. Known limits (deliberate)

- File lock is per-host (`# ponytail:` note in code). Use a DB/Redis lock only if
  multiple hosts ever run the scheduler.
- Journal is JSON loaded into memory; fine to ~10k entries, then rotation
  applies. Move to SQLite/Postgres if query volume grows.
- WIQL is not paginated; adequate to tens of thousands of items.
