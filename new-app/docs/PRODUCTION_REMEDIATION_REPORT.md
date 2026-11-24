# Production Remediation Report

## Scope

The repository was reviewed across the React frontend, Express API, application/domain layers, SQLite/PostgreSQL persistence, Azure DevOps/GitHub integrations, exporter scripts, Helm chart, tests, generated files, and secret handling. Changes were made in the existing architecture without introducing a new framework.

## Problems discovered

- Production still wrote configuration, journals, and auto-closure state through JSON shadow repositories.
- Relational identity aliases existed but were not loaded into runtime `Person` records.
- Azure WIQL prefilters used only email/display name; descriptor/GUID/renamed-UPN tasks could be omitted before local matching.
- Exact display-name matches could duplicate or misattribute tasks when people shared a name.
- Explorer, team, and daily UI hooks consumed response fields that did not match the backend DTOs.
- Immutable plan execution used a reduced patch, swallowed Azure failures, fabricated IDs, and marked unverified work successful.
- Relational journals persisted many reporting columns only inside `details_json`.
- The Azure exporter did not retry 429/5xx responses, did not reject incomplete batches, and wrote `parent_id` as null.
- GitHub daily summaries converted upstream failures into zero-PR evidence.
- Production plan signing had a checked-in fallback secret.
- Helm environment names and bind/probe settings did not match runtime behavior.
- Hidden legacy markup remained in the live DOM and duplicated React IDs/landmarks.
- A tracked debug fetch script exposed raw Azure-oriented diagnostics.

## Architecture and source-of-truth decisions

- Runtime flow remains: Azure/GitHub integrations → normalization/identity resolution → relational repository → use cases → API → React.
- SQLite/PostgreSQL is authoritative in production for configuration, journals, auto-closure configuration, and audit state.
- Legacy JSON files are migration/recovery inputs only for one-time seeding and remain available for local development fallback.
- Azure DevOps remains authoritative for projects, people/work-item assignments, task state, iterations, and parent relations.
- GitHub remains authoritative for PR/commit evidence; upstream failures and unresolved identities are explicit statuses.
- Secrets remain external in production; tokens are never application-table data.

## Database and migration changes

- Existing normalized schema is reused rather than creating a blind table per JSON file.
- All configured identity aliases are now persisted and hydrated from `identity_aliases`.
- Relational journal writes now populate `run_id`, target date, title, copy status, and verification columns.
- Production startup fails if database initialization fails instead of silently using JSON.
- Empty relational storage is seeded from legacy JSON before DB-only production runtime selection.
- Existing `bin/migrate.ts` / `MigrationService` remains the explicit migration and count-validation path.
- Azure export normalization now extracts parent IDs from `System.LinkTypes.Hierarchy-Reverse`.

## Identity and task-recognition fixes

- WIQL candidate filters now include assigned UPN, person key, GitHub login, canonical ID, and all aliases.
- Duplicate detection receives the complete `Person` profile.
- Stable email/descriptor/GUID matches take precedence over display-name-only matching.
- Explorer assigns a task to exactly one person; unresolved and ambiguous assignments are returned as diagnostics.
- Relational reloads include canonical IDs and all persisted aliases.
- API Explorer accepts the modern `personKeys` query while retaining `users` compatibility.

## Feature improvements

- React consumes real `matrix`, `detailedTasks`, person, and PR-summary shapes.
- Team-member save payloads now use backend `assignedTo` semantics.
- Thursday planning sends `CURRENT`/`FOLLOWING` rather than a boolean.
- EOD preview/execution sends an explicit all-members scope.
- Immutable execution uses full source field/relation copy, read-back verification, hash verification, and never fabricates IDs or success.
- GitHub evidence summaries distinguish `OK`, `UNRESOLVED_IDENTITY`, and `UPSTREAM_ERROR`.
- The hidden legacy UI is stored in an inert HTML template, eliminating duplicate live IDs/landmarks.
- Mobile navigation state now matches the existing responsive CSS `open` contract.

## Synchronization and deployment improvements

- Azure exporter retries 429/5xx with bounded backoff and `Retry-After`.
- Incomplete work-item batches are rejected rather than publishing a partial snapshot.
- Exported work-item parent relations are normalized.
- Helm emits runtime-compatible Azure/timezone names plus `LISTEN_HOST=0.0.0.0`.
- Kubernetes readiness uses the unauthenticated health endpoint; dependency readiness remains an authenticated application concern.
- Production requires an external `PLAN_SIGNING_SECRET`.
- Offline GitHub mode is explicit and observable for deterministic/disconnected operation.

## Cleanup

Removed:

- `scripts/debug-fetch.mjs` (orphaned raw Azure diagnostic script).
- Generated Playwright/test report directories created during validation.

Updated ignore/build-context rules for audit archives, browser artifacts, test environments, backups, private keys, local runtime JSON, databases, and sensitive dumps.

## Validation results

- TypeScript source check: passed.
- Test TypeScript check: passed.
- Vitest: 90 files, 1211 tests passed.
- Production build: passed.
- Custom E2E tiers 1–4: 236 passed.
- Azure exporter tests: 4 passed.
- Database/schema/identity/work-item script tests: 21 passed in total.
- Chromium Playwright: 14 passed.
- WebKit: 14 passed during the Safari matrix.
- Mobile Safari: 14 passed.
- Lint: 0 errors, 4 pre-existing warnings outside the changed behavior.

Firefox could not launch in this macOS environment: the downloaded Playwright Nightly bundle repeatedly exited with `Could not find profile folder`, including after a forced clean reinstall and direct headless launch with a pre-created profile. This occurred before application code loaded and is recorded as an environment/browser-binary issue, not an application test failure.

## Remaining technical debt

- `azure-data.db` and `workops.db` still represent separate analytical and operational stores; a scheduled, incremental exporter-to-operational sync adapter is not wired.
- Export resume cursors are scaffolding rather than true resume behavior.
- Iteration/team-capacity metadata is fetched in raw datasets but not normalized into operational dashboard tables.
- Multi-replica Helm defaults require PostgreSQL, externally coordinated scheduling, and distributed locking rather than SQLite/local locks.
- Legacy `app.js` and its source-inspection tests remain for compatibility, although it is no longer in the live DOM.
- The real local `.env` must have both Azure and GitHub credentials rotated because live-looking credentials were detected; values were not reproduced or modified.
