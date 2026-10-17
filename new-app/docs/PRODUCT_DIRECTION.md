# Product direction — Workday Task Studio
**Decision date:** 2026-10-17 · **Status:** Target direction, not a production-readiness claim.

## Who it serves and why
Workday Task Studio helps small engineering teams using Azure DevOps avoid missing, duplicated, incorrectly assigned, or prematurely closed daily work items. The buyer/user is an operator or developer who needs a trustworthy, inspectable sequence rather than an opaque autonomous bot. The primary value is **safe task coverage with human-readable evidence**.

This direction is grounded in the current Task Planner, Task Explorer, multi-person date windows, journal, GitHub evidence integration, and scheduler. **Assumption:** manual review before mutation is preferable to unconditional automation. Existing automation is preserved but must be clearly opted into and independently verified.

## The core product loop
1. Configure least-privilege Azure and GitHub credentials, valid team identities, timezone and schedule.
2. Inspect tasks already present, missing and duplicated for each person and date.
3. Generate a *read-only* preview, retaining scope and timestamp so stale data cannot be executed silently.
4. Confirm the exact member/date set and mutate only intended work items.
5. Show created, skipped, partially failed, and failed outcomes with links and journal evidence.
6. Recover from partial failures safely; schedule recurring creation only after the manual loop is tested.
7. Close tasks **manually by default**. Automatic closure is a separate opt-in with its own dry-run, explicit limits, and verification.

## What belongs in the product
| Capability | Decision | Reason / evidence / validation |
|---|---|---|
| Task planning, member/date scope, duplicate detection | KEEP + HARDEN | Essential core value; API and domain tests exist; tenant accuracy requires validation |
| Task Explorer coverage | KEEP + IMPROVE | Key read-only discovery; tests cover empty selection and no-data honesty |
| Manual creation, ad-hoc task, source copying | KEEP + HARDEN | Useful but remote mutations; verify relations and ensure server-side constraints |
| Journal, logs, export, repair | KEEP + IMPROVE | Traceability and recovery; export and redaction require continued review |
| Team and connection settings | KEEP + SIMPLIFY | Necessary prerequisites; no built-in enterprise RBAC today |
| Scheduler and automated creation | DEFER BY DEFAULT, RETAIN OPT-IN | Avoid unreviewed automation on fresh installs; requires failure/restart/identity checks |
| Automatic EOD closure | OPT-IN ONLY | Irreversible work-item state changes; should not occur just because a developer opened the app |
| Daily burndown and workload charts | IMPROVE / LOW PRIORITY | Valuable only when backed by actual fetched records; no invented statistics |
| GitHub PR evidence | KEEP + HARDEN | Useful source for task descriptions, but optional and subject to org permission |
| New database, framework, microservices, OAuth platform | DEFER | No current evidence they improve this single-host app enough to justify migration cost |
| Legacy code or parallel application | REMOVED / DO NOT RESTORE | Only `new-app/` is supported |
| Cosmetic widgets and fabricated KPIs | DO NOT ADD | Distract from task coverage and trust |

## Intended information architecture
**Overview** (status/my work), **Inspect** (Explorer/burndown), **Plan & Create** (preview/confirm/ad-hoc), **Automate** (optional scheduler), **Manage** (team/settings), **Activity & Recovery** (audit/logs/repair). The current ten routes remain while inner navigation is simplified in future targeted increments; migration is not required for this safety release.

## Architectural decisions
- **Retain:** TypeScript, Node 22, Express, no database, domain services + adapters, HTML/JS SPA, audit journal. Keep deployment dependencies minimal and license-compatible.
- **Protect server-side:** HTTP Basic is a single shared credential, not authorization per employee. Treat it as a narrowly scoped administrative app; never suggest it has per-user RBAC.
- **Boundary:** Require specific member scope for mutations, browser-origin verification for unsafe HTTP methods, runtime token redaction, TLS and production authentication.
- **Safety defaults:** Any unattended remote mutation requires an explicit opt-in, even on a new install. Existing persisted installations must be migrated thoughtfully; do not silently overwrite local `people.json` or user schedules.
- **Availability:** Browser E2E fixtures and CI validate UI mechanics, not production Azure connectivity. No real org-specific mutation without separately controlled authorization.

## Outcomes and measurement
Measure: task coverage (% expected person-days with exactly one task), accidental/unintended work-item changes (target zero), duplicate count, partial failures/recovery time, preview→confirmation drop-off, and time-to-complete a routine task. **Do not display targets as achieved statistics without real evidence.**

## Feature reality / open gates
- **Verified in CI:** Typecheck, lint, unit/integration suites, server smoke, Chromium navigation/fixture flows (see current GitHub Actions for commit-level evidence).
- **Source inspected:** Service orchestration, scheduling and local config; no tenant-level runtime proof.
- **Not verified:** Live Azure task fidelity, identity/permission mapping, concurrency across multiple hosts, tenant-specific field schemas, permission boundaries, full screen-reader support, or actual unattended restart recovery under failure conditions.
- **Risk discovered:** Tracked `people.json` sets `schedulerEnabled=true`, `schedulerAutoStart=true`, `autoClose=true` and persists `lastAutoClose`. This is not a safe fresh-install sample; changing a deployed config could be disruptive, so separate sample defaults from explicit operator config in a subsequent migration.
- **Risk discovered:** HTTP Basic may be reused automatically by a browser in cross-site requests; the prior server had no unsafe-method Origin guard. Test the boundary before enabling further remote actions.

## Release definition
A release is not "done" because CI is green. Require source review, targeted red→green tests, deployment sign-off, protected credentials, live read-only tenant checks, manual verified plan, and explicitly approved bounded write tests, plus rollback evidence.

**Scope of first foundation change:** introduce a same-origin check for browser-initiated unsafe HTTP requests, add HTTP regression tests, document safe deployment, and preserve CLI access without an Origin header. No live tasks or stored data are changed.
