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
