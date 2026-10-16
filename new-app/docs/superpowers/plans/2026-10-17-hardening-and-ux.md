# AzureTasks hardening plan — October 2026

## Goal and design constraints
Continue the existing approved `new-app` redesign with behavior-preserving improvements, focusing first on irreversible actions and exposed credentials. Preserve working Azure DevOps integration, task planning rules, date windows, local-first deployment and all ten supported screens. Do not use live tenant credentials during development.

## Release slices
1. **Critical security/scope:** Mask saved GitHub credentials in every API response, reject implicit all-person creation requests, and prohibit TLS certificate bypass. Tests first. No change to explicitly scoped or explicitly all-user task execution.
2. **Safety and operational resilience:** Check CORS/origin/auth deployments, scheduler state/rollback, task idempotency, API error consistency, timezone correctness, duplicate-detection races, and logfile treatment. Add failing regression tests before fixes.
3. **Frontend finish:** Evaluate browser screenshots and UX journeys; fix responsive layout, loading/empty/error states, form accessibility and re-render focus; implement structural improvements only where observable problems justify them.
4. **Verification/release:** Run unit/integration tests, lint, typecheck, build, HTTP startup smoke, Chromium tests with synthetic data and API authorization negative tests. Reconcile CI results with docs. Real Azure DevOps writes must be explicitly authorized and run only with newly issued credentials.

## Slice 1 acceptance criteria
- A settings save with `githubToken` still persists the credential through existing repository behavior but never serializes the raw value into its HTTP return payload.
- `POST /api/tasks/execute` and `POST /api/explorer/create-missing` cannot create all members' tasks accidentally from omitted or empty `personKeys`; `all: true` continues to work intentionally, and a non-empty `personKeys` array continues to work.
- `POST /api/tasks/plan` remains backward compatible for an omitted filter but does not treat an explicitly empty filter as all without intent.
- Startup refuses both `ALLOW_INSECURE_TLS=true` and `NODE_TLS_REJECT_UNAUTHORIZED=0`, and documentation recommends trusting the corporate CA.
- Tests are added before implementation, show failure before fixes, then pass in a fresh CI run.
- Completion report separates source review, CI/browser verification and untested live-tenant workflows.

## Architectural rulings
- Preserve existing API paths and JSON success envelope to avoid disrupting the frontend.
- No new dependencies, databases, mock production data or silent remote mutations.
- Use isolated remote branches and PRs; no direct writes to `main` while implementation is under review.
