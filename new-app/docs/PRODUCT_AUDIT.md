# Product audit and feature reality map
**Reviewed:** 2026-10-17 · **Baseline:** `main` at `92f7ed4` · **Scope:** `new-app/` · **Evidence:** source inspection and cited GitHub Actions workflows. A checked source feature is NOT a live-tenant verification.

## Actual system and data journey
```
Browser SPA (app.js, index.html, styles.css)
    ↓ /api, HTTP Basic auth + browser Origin guard for writes
Express server (presentation/api/server.ts)
    ↓ API routes (presentation/api/routes.ts)
Use cases (application/use-cases/)
    ↓ ports / domain services
Azure DevOps work-item adapter (infrastructure/azure/)
GitHub PR evidence adapter (infrastructure/github/)
Local persisted config (people.json / .env)
Local journal, lock and scheduler state
    ↓
API result → browser feedback + journal / operational logs
```
There is no relational database or enterprise user identity provider in this repository. A shared Basic credential authenticates the service; it does not prove who initiated a change or grant member-scoped authorization.

## Existing product surface
| Screen / area | Core intent | Source evidence | Current evidence classification | Decision |
|---|---|---|---|---|
| Dashboard | Overview of status and coverage | `presentation/web/public/app.js`; `/api/status` | Synthetic browser checks; live data unverified | IMPROVE |
| My Work | Personal assigned items | `app.js`, `/api/explorer` | Source present; tenant data unverified | KEEP + VERIFY |
| Task Explorer | Per-date/per-member coverage | `explore-tasks.ts`, `ui-explorer-selection.test.ts` | Unit/fixture verified, tenant unverified | KEEP |
| Daily Burndown | Workload trends | `app.js`, domain metrics | Source present; real analytics unverified | DEFER VISUAL EXPANSION |
| Planner | Preview and scoped creation | `plan-tasks.ts`, `create-tasks.ts`, browser tests | Synthetic flow verified; live create unverified | KEEP + HARDEN |
| Scheduler | Planned unattended creation/closure | `node-scheduler-repo.ts`, config repo | Unit-tested timing/persistence logic; failure/restart in real deployment unverified | RETAIN OPT-IN |
| Team | Roster, identity and prefix mapping | `config.ts`, `file-config-repo.ts` | Validation/unit tests; live identity mapping unverified | KEEP |
| Settings | Org/project, API credentials, policy | `config.ts`, `server.ts` | Unit/API tests; corporate deployment unverified | KEEP + HARDEN |
| Audit Log | Operation trace and repairs | `file-journal-repo.ts`, `repair-relations.ts` | Unit/integration test evidence; recovery in tenant unverified | KEEP |
| Logs | Operational telemetry and stream | `logger.ts`, SSE route | API tests; long-running/reconnection characteristics not established | KEEP |

## Feature → subsystem breakdown
```
Workday Task Studio
├── Inspect
│   ├── Server health / auth status
│   ├── Person/date window filters
│   ├── Existing/missing/duplicate task matrix
│   └── Workload and burndown views
├── Plan
│   ├── Selection / timezone / Thursday policy
│   ├── Source task discovery
│   ├── Duplicate detector
│   ├── Field/relation policy
│   └── Read-only preview with current selection signature
├── Execute (remote side effects)
│   ├── Explicit person/all scope
│   ├── Ad-hoc task creation and source copying
│   ├── Per-task results and partial-failure handling
│   ├── Idempotency / lock scope
│   └── Audit record + recovery
├── Automate (opt-in)
│   ├── Persist schedule / enable state
│   ├── Manual run-now control
│   ├── EOD dry-run and explicit closure
│   └── Restart/failure recovery
└── Admin / Reliability
    ├── Config and secrets
    ├── HTTP origin and auth controls
    ├── Logs / journal export
    └── Health, build, tests, rollback
```

## Prioritized findings and next verification gates
| Priority | Finding | Observed basis | Mitigation / next gate |
|---|---|---|---|
| Critical | A credentialed browser POST from an untrusted Origin reached scheduler mutation | Failing three-case test on test-first branch `b8a76b9`; HTTP 200 before fix | Exact Origin / Fetch Metadata boundary guard; confirm CI and reverse proxy configuration |
| High | Fresh config enabled auto closure; tracked config enabled scheduler auto-start and auto closure | `file-config-repo.ts` default and tracked `people.json` | Change safe defaults on PR; preserve historical data; require explicit rollout review |
| High | Shared Basic auth lacks per-user RBAC | `server.ts` + API routes | Keep administrative single-operator scope; enterprise RBAC is a separate product decision |
| High | Mutation effects cannot be proven in test tenant by code/synthetic browser checks | Azure adapter and CI fixtures | Explicit, least-privilege live read-only smoke, then approved bounded write |
| High | File-based locks cannot guarantee cross-host exclusivity | `file-lock-repo.ts` local lock | Keep single-host support; shared coordination required for multi-host |
| High | PAT/GitHub tokens persist in local plaintext config | `file-config-repo.ts` | Approved enterprise secret-store migration with backup, policy and access review |
| Medium | SPA controller is large (~100KB) | `presentation/web/public/app.js` | Extract only bounded features with browser regression and no visual surprises |
| Medium | Existing historical PRD claimed live Azure tests as completed | `PRD.md` previous checkboxes | Historical labeling and removal of unverified completion claims |
| Medium | CSP permits unsafe inline scripts and remote script source | `server.ts` content security policy | Inventory actual inline/remote dependencies before hardening CSP |
| Medium | Cross-origin proxy hosts may differ from Node's internal scheme | `server.ts` / ingress | Document explicit `PUBLIC_ORIGIN`; verify deployed proxy host+TLS |
| Low | More framework/dependency complexity is unproven value | Existing Node/TypeScript SPA and clean CI | Defer framework rewrite pending measurable benefit |

## Quality ledger
- **Test-first security evidence:** [failing CI run 38954218774](https://github.com/yhsomani/AzureTasks/actions/runs/38954218774) (three expected cross-origin request failures), followed by [fixed implementation CI run 38954403165](https://github.com/yhsomani/AzureTasks/actions/runs/38954403165).
- **Default-safety evidence:** [failing CI run 38954582908](https://github.com/yhsomani/AzureTasks/actions/runs/38954582908) (fresh auto-close default), followed by green runs on the changed branch.
- **Previous stable main:** [successful CI run 38950986850](https://github.com/yhsomani/AzureTasks/actions/runs/38950986850).
- **Unknown until final branch check:** Final branch verification and merge status; refer to current GitHub Actions, not historical claims.
- **Deliberately not executed:** Any real Azure DevOps create/close/repair, GitHub token rotation, secrets migration or production deployment.

## Release gates not satisfied by this audit
1. Real API integration and task relation fidelity tested in an explicitly approved, bounded test scope.
2. Security review including proxy/auth/CSRF settings, CSRF defenses with external trusted origin configuration and key rotation.
3. Deterministic scheduler restart, failure and concurrency tests under realistic deployment.
4. Visual and assistive-technology accessibility review across all views and devices.
5. Repeatable backup/rollback test for persisted configuration and journal.

A clean code review or passing CI is insufficient to mark those gates complete.
