# Release acceptance ledger — AzureTasks

**Updated: 18 October 2026.** This ledger is the release acceptance authority; older audit, PRD and plan documents are **historical**, not evidence that release conditions passed.

## Evidence levels

- **Implemented:** code exists; behavior is not independently proven.
- **CI tested:** unit/integration and browser checks run with controlled fixtures. CI is not access to real Azure DevOps or its corporate proxy.
- **Environment verified:** dated trace from the intended deployment, real configured integration, and authorized operator.
- **Blocked:** cannot verify with repository access alone.

## Implemented or CI-covered safeguards

- Strict member source ownership and duplicate-detection checks; reject incomplete Azure result batches.
- Task creation requires explicit confirmation; ad-hoc duplicate bypass is prohibited.
- EOD closure changes task state through Azure rules without fabricating timestamps, work hours or descriptions; it requires explicit confirmation for the current configured workday.
- Audit journal preserves archived evidence and surfaces corruption; creation result and audit/read-back result are separate.
- Unattended EOD defaults disabled; only one automatic attempt per date/window, with a persisted attempt timestamp. Requires real restart testing.
- GitHub PR evidence is date-scoped and exhaustively paginated; configured members can additionally query scoped repository/branch **commit authorship**. GitHub activity is not a timesheet and derived GitHub usernames remain unverified identity guesses.
- Production now defaults to `SECRET_STORAGE_MODE=external`; web-submitted tokens cannot be written to a local plaintext `.env` unless `local-file` is explicitly selected. Existing files are **not** migrated or deleted.
- CSP forbids inline scripts, the Chart.js version is pinned; inline CSS styles and external CDN remain deployment concerns.
- CI: TypeScript, lint, tests, build, HTTP auth/origin smoke, browser flows, production dependency audit, plus Windows/macOS core suites.

## Release blockers — external evidence needed

| Gate | Status | Required proof |
|---|---|---|
| Azure DevOps credentials rotated | **BLOCKED** | Operator revokes all previously exposed PATs, provisions a least-privilege replacement, verifies no copies remain in logs or artifacts |
| Production HTTPS, proxy and Origin/CSRF | **BLOCKED** | Real production FQDN/CA, auth, `PUBLIC_ORIGIN`, optional `CORS_ORIGIN`; exercise same-origin and hostile-origin requests through actual proxy |
| Correct live members, per-person source prefix and dates | **BLOCKED** | Read-only scoped WIQL and identities compared with expected results; reject ambiguous names |
| Bounded real task creation | **BLOCKED** | Explicit operator approval for one test member/date, verify idempotency, relations/fields, journal and safe reconciliation |
| Relation recovery and EOD closure | **BLOCKED** | Permissioned test instance, dry-run then explicit authorized single task transition, verify actual Azure fields and relations by read-back |
| Scheduler crash/restart / lock recovery | **BLOCKED** | Single host and cold restart, simulate missed window, failed checkpoint and concurrent operator, confirm zero surprise writes |
| Secret manager | **BLOCKED** | Provision external vault, remove any old plaintext secret copies safely, rehearse backup/restore and rotation |
| Authentication policy | **OPEN** | Shared Basic auth has no per-user accountability; require RBAC/SSO and operator attribution if more than one operator administers writes |
| Accessibility | **OPEN** | Screen reader + keyboard + touch at 375/768/desktop on real browser and genuine error states |
| Production source data/analytics | **BLOCKED** | Compare dashboard and burndown against live Azure totals; never infer missing work tracking values as zero |
| Exact release SHA signoff | **BLOCKED** | Record SHA, date, CI run, deployment URL, restore rehearsal, signed operator approval |

**No-go rule:** any blocked production/tenant gate above prevents a claim of production-ready deployment, even when GitHub Actions is green. Do not run production mutations without explicit authorization.

## Minimal staged verification

1. Provision short-lived, least-privilege test credentials using the organization's approved secret manager. Confirm production rejects plaintext UI token persistence and fails startup without `API_AUTH_TOKEN`.
2. Deploy to HTTPS behind a trusted reverse proxy with exact `PUBLIC_ORIGIN`; test `GET /api/health` (liveness) and authenticated `GET /api/ready` (read-only Azure connectivity).
3. Use read-only task/identity queries, Explorer, Plan and EOD dry-run. Compare exact member identities and dates against Azure DevOps; capture request IDs and sanitized logs.
4. **Only after operator authorization**, create one bounded work item in an isolated project; assert exact title/date/assignee/type, links, journal, deduplication and no second item on retry.
5. In staging, test EOD transition and relation repair, deliberate failure, process restart, missed scheduler window, backup/restore and one-host lock behavior.
6. Perform screen-reader, Windows/macOS and dependency reviews; record evidence, successful restore and signoff against the exact release SHA.

## Operational notes

- `SECRET_STORAGE_MODE=external` is default **in production only**. Development can use a restricted local `.env`; production `local-file` requires an explicit security-approved override.
- Configure a person's `githubRepositories` as explicit `owner/repo` values and optional `githubBranches`. No repos means PR-only evidence; no dummy commits. If scope exceeds GitHub's trustworthy pagination limits, fail with an error rather than displaying a false zero.
- Deployment is **single-host** until a shared distributed lock, scheduler leader election and atomic multi-writer storage have been built and tested.
- Archive/audit data is sensitive, must be backed up and access controlled, and must never be silently discarded.

## Automated deployment topology diagnostics

Use `npm run verify:staging:readonly` with `RELEASE_BASE_URL`, `API_AUTH_USER` and an operator `API_AUTH_TOKEN` provided by your secrets manager. The script validates the HTTPS origin, unauthenticated liveness semantics, authenticated live Azure readiness, readable configuration/journal, and hostile/same-origin behavior **on a nonexistent POST endpoint**. It never creates or closes work items. Record the operator, timestamp, sanitized command output, deployment URL, and release SHA as evidence. Manual production gates remain open until explicitly verified.

## Historical CI snapshot — PR #26 (18 October 2026)

- Branch: `fix/remaining-release-gates-20261018` (merged PR #26).
- Tested commit: `e0e91b1f5b6d2258554ed65d5dd901f7513e8719`.
- GitHub Actions CI run: [#39123868203](https://github.com/yhsomani/AzureTasks/actions/runs/39123868203), completed with conclusion **success**.
- Evidence scope: repository CI only; no live Azure mutations, restored production backup or deployment acceptance were established.
- Any subsequent commit requires a fresh exact-SHA CI run before release approval.

## Subsequent code-level hardening (pending release signoff)

- CLI EOD no longer bypasses Azure workflow rules or accepts an explicit historical/future date for live closure; unknown close timestamps remain unknown.
- Configurable read-only viewer Basic credentials and `GET /api/session` allow the UI to distinguish viewer and operator workflows. This is **not** individual operator SSO/RBAC.
- Explorer single-cell creation performs real confirmation, sends `confirm:true`, prevents overlapping writes and retains the modal when a request fails.
- Missing Azure completed/remaining hours are represented as *not recorded* rather than silently treated as zero; charts omit unrecorded daily data and indicate partial aggregation.
- Safe staging topology probe `npm run verify:staging:readonly` performs read-only checks and tests Origin using a **nonexistent** route, never an Azure mutation endpoint.
- CI succeeded on the historical tested commit above. Subsequent PR-head run #39128223792 failed two journal-pagination regressions, so it is not the release acceptance reference.
- PR #26 is merged; the post-merge defects are addressed in the follow-up PR #27. Environment-specific release gates remain open.

## Post-audit follow-up — PR #27 (18 October 2026)

- Repair the pagination regex and map invalid journal query limits to HTTP 400, preserving HTTP 500 for genuine storage failures.
- Reject disabled users from ad-hoc task creation and prevent fabricated end times for failed EOD transitions.
- Report partial EOD failures honestly, block execution after an incomplete preview, and invalidate stale frontend config caches.
- Strengthen independent create read-back checks to include title, assignee, type, state, configured planned start and copyable source relations. Read-back remains an observation at a point in time, not a transaction or full tenant acceptance.
- Add API, domain and UI regression tests. CI on the code commit `289a78b1` passed Linux, Windows and macOS ([run #39143692822](https://github.com/yhsomani/AzureTasks/actions/runs/39143692822)).
- The ledger update itself requires a newer exact-SHA CI run before merge/release signoff. No live Azure writes, PAT rotation, HTTPS deployment, scheduler restart, backup/restore or operator acceptance are established by CI.

## Current code audit remediation — PR #29 (18 October 2026)

Scope: [PR #29](https://github.com/yhsomani/AzureTasks/pull/29), based on the merged PR #28 main baseline. This is a **source and CI remediation**, not live Azure tenant certification.

### Repaired in this branch

- **Duplicate-prone Azure writes:** POST/PATCH mutations are never automatically replayed after a timeout, rate limit or ambiguous 5xx. Read-only GET and WIQL searches retain bounded retries. Duplicate-reconciliation conflicts must be replanned rather than silently counting an existing item as created.
- **Full workday gap recovery:** planned creation walks every eligible person/date from today through the configured stop day and skips only dates independently shown as existing, instead of assuming latest source date implies all earlier dates are present.
- **Date correctness:** yearless task titles resolve from recorded Azure planned/actual dates in the configured timezone when present; malformed dates and conflicting title/date evidence are rejected. Earlier records lacking trustworthy scheduling fields still require operator review.
- **Fail-closed Azure data:** read-back batches for latest-source search, team discovery, duplicate detection and Explorer/EOD candidates now require exact expected ID coverage.
- **Scheduler crash safety:** automatic EOD attempts must persist their checkpoint before an Azure mutation; failed checkpoint persistence prevents the remote call.
- **EOD/relations:** final Azure EOD state and repaired links get independent read-back. Accepted-but-unverified operations are not silently relabeled as failed writes or independently verified successes.
- **Security and feedback:** unauthenticated development binds to loopback; planner rejects disabled/unknown requested members, GitHub identity cache includes the configured derivation suffix and derived identities are labeled unverified, and browser creation feedback includes relation/audit failures.
- **Effort and HTTP behavior:** absence of an Azure original estimate no longer fabricates zero remaining work; Explorer distinguishes an upstream Azure failure from malformed client input.
- **Regression coverage:** gap backfill, write non-retry, incomplete batches, durable EOD checkpointing, year rollover/timezone, relation read-back, EOD state read-back, and work-hour omission.

### Still open — do not claim completed

1. **Production gates (operator-only):** rotate exposed PATs, configure approved secret storage, trusted HTTPS/proxy authentication, exact origin checks, and tenant-approved bounded staging create/repair/close read-backs.
2. **Workload and scalability:** `findCandidateTasks` does not query efficiently by scheduled workday because yearless titles and tenant-specific date fields make simple WIQL filtering unsafe; very large result sets intentionally fail closed above 5,000 candidates. Benchmark and design indexed/bounded discovery with authoritative dates.
3. **Yearless title ambiguity:** source work items without confirmed planned/actual dates use best-effort creation-date inference or legacy parsing; they cannot prove historical year for all migrated records. Require explicit resolution for ambiguous legacy history before bulk writes.
4. **Concurrency and recovery:** the current PID/file lock and JSON journal are single-host only. Prove real process restart, scheduler missed window, stale lock recovery and backup restoration. Multi-host requires distributed coordination.
5. **Tenant field schema:** validate mandatory `Custom.*` fields, process rules, Area/Iteration and date/estimate policies against the actual work item type. Do not assume CI fixtures prove tenant acceptance.
6. **Product decisions:** child work-item and binary attachment copying are deliberately excluded for safety; EOD does not overwrite Azure descriptions with inferred GitHub work evidence; per-operator RBAC/SSO is not implemented.
7. **Frontend and observability:** continue accessible real-device verification, break down the large `app.js` controller incrementally, and test browser against real but permissioned data.
8. **Exact revision:** run and record successful CI for the final PR head and again on the release merge SHA. CI alone is not staging/deployment signoff.


## PR #30 — coordinated follow-up repair workstreams

The follow-up integration review is [PR #30](https://github.com/yhsomani/AzureTasks/pull/30). Its workstreams use this PR as their shared contract: domain/date safety and EOD authorization; security of local exports and credential handling; state recovery and journal durability; and QA validation across supported operating systems. These are coordinated roles within one implementation session, not separately running autonomous AI agents.

### EOD and source date guardrails

- Date matching no longer falls back to the UTC date prefix of Azure scheduling fields after rejecting a conflicting task title.
- Legacy explicit-year task titles in `DD-MM-YYYY` or `DD Mon YYYY` format retain their declared year. A contradictory Azure planned/actual date is rejected.
- An explicit source-task override is accepted only after both ownership validation and recorded-date reconciliation.

### Operator state backup/restore

**Stop the application before backup or restore** and make sure the execution lock no longer exists. Run in `new-app`:

```bash
npm run state:backup -- --state-dir /absolute/path/to/private/app-state --backup-dir /absolute/path/to/new/secure-backup --offline-confirm
npm run state:verify -- --backup-dir /absolute/path/to/new/secure-backup
npm run state:restore -- --state-dir /absolute/path/to/empty-restore-target --backup-dir /absolute/path/to/new/secure-backup --offline-confirm
```

Backups contain only `people.json`, the active audit journal and rotated journal archives when present. The tool writes a SHA-256 manifest, refuses a destination that already exists for backup, refuses to overwrite populated restore state, validates the manifest before restore and excludes the `.env` file, access tokens and local lock state.

**Important:** A backup does NOT include PATs, secret-manager material or deployment settings. Restore into a new empty directory, inspect the restored records, provision fresh credentials separately, and only then reconfigure/restart the service in an approved maintenance window. Use externally managed, encrypted backups and scheduled retention for real production operations. `--offline-confirm` is an operator assertion, not proof that a process is stopped. A complete disaster-recovery signoff still requires a documented rehearsal in the deployed environment.

### Outstanding release gates

- Verify the updated work-item matchers against a real Azure staging project with authorized test identities and custom fields.
- Revoke any credentials previously shared or exposed; provision replacement credentials through approved external secret stores.
- Confirm HTTPS, exact origin/CORS, per-operator authentication and threat-model approval in the target deployment topology.
- Decide on historical tasks without authoritative dates, child/attachment copying, GitHub evidence policy and single-host versus distributed scheduling.
- Benchmark high-volume source discovery and document behavior at Azure's WIQL result limits.
- Confirm cross-platform CI on the exact PR head and merge SHA and repeat the offline restore drill under operational supervision.

### Read-only Azure DevOps work-item-type preflight

After installing the app and securely provisioning a **new** Azure DevOps PAT with read-only work-item access, supply the project and organization through an approved environment/secret manager:

```bash
AZURE_DEVOPS_ORG=<organization> AZURE_DEVOPS_PROJECT=<project> npm run verify:schema:readonly
```

The verifier calls only Azure DevOps work-item-type metadata endpoints using the token supplied by the environment. It never creates or modifies a work item and never prints the token. It checks fields that the current task creation logic writes unconditionally, as well as the `New` and `Closed` states. It reports an error rather than claiming compatibility when a required field or state is absent. This is a preflight only: workflow rule enforcement, write permissions, identity uniqueness, linked work items, and successful creation/closure still require specifically authorized staging tests.

Run `npm run test:schema` to test complete, incomplete and malformed process metadata without external connections.
