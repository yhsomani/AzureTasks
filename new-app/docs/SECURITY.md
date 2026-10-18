# Security and mutation safety

This document applies to the supported `new-app/` application. It records verified safeguards and controls that still depend on deployment.

## Trust boundaries

- **Browser → application:** The web dashboard and API are same-origin by default. The server rejects unsafe cross-origin browser API requests before their handlers execute, even if HTTP Basic credentials were supplied. CORS browser access is disabled unless an explicit trusted `CORS_ORIGIN` is configured. CORS alone is not protection against CSRF.
- **API → Azure DevOps:** API calls can create and update real Azure DevOps work items. The task-creation API requires a non-empty `personKeys` array or an intentional `all: true` marker. Empty arrays and omitted scopes on mutation routes must be rejected.
- **API → GitHub Enterprise:** Token is used for reads of PR/commit evidence. Avoid broad token scopes where narrower supported permissions suffice.
- **Service → local files:** `.env`, journal and config files may contain sensitive organizational data. Protect runtime directories and backups, set restrictive filesystem permissions, and never commit credentials.

## Deployment controls

1. Create a newly rotated Azure DevOps PAT and GitHub token with only the necessary read/write scopes.
2. Provide a long, randomly generated `API_AUTH_TOKEN` before starting the web server with `NODE_ENV=production`. Production server startup refuses to run if absent.
3. Terminate HTTPS at a trusted reverse proxy (or equivalent TLS-enabled network boundary). HTTP Basic authentication is not sufficient over plaintext public networks. **Node's backend now binds to `127.0.0.1` by default even when authentication is enabled**, preventing a direct network path around a local reverse proxy. If your container or separate-host proxy needs a reachable interface, explicitly configure `LISTEN_HOST=0.0.0.0` (or a specific numeric IP address), restrict that port to the trusted ingress network with firewall/security-group rules, and verify direct public access is impossible. Merely setting `LISTEN_HOST` is never TLS, multi-host locking or ingress approval.
4. Keep `NODE_TLS_REJECT_UNAUTHORIZED` enabled and do not enable `ALLOW_INSECURE_TLS`. Use `NODE_EXTRA_CA_CERTS` for a trusted corporate CA where appropriate.
5. Restrict CORS to an explicit origin only when the web client must be served from a different origin. Normal application use requires no CORS configuration. For a TLS-terminating proxy that changes the scheme or Host seen by Node, set `PUBLIC_ORIGIN=https://your-public-host.example.com` (exact origin; no trailing slash/path), or preserve Host and configure the proxy correctly. The API checks browser `Origin` for POST/PUT/PATCH/DELETE and denies `Sec-Fetch-Site: cross-site` unless from an explicitly trusted CORS origin. It also denies `Sec-Fetch-Site: same-site` when the Origin header is absent (a sibling-domain browser request must not become a trusted CLI request merely because a proxy stripped Origin). Truly headerless CLI clients and same-origin requests without Origin remain supported but still require authentication.
6. Keep automatic scheduling and auto-closure disabled on initial setup. A persisted deployment with automation enabled should be migrated explicitly, after reviewing its intended behavior. Start one scheduler instance per lock domain; coordinate shared locks if deploying multiple hosts.
7. Test a **read-only plan** and inspect identities, date window, duplicate coverage and source work-item relationships before any actual task creation or closure.

## Expected HTTP behavior

| Request | Expectation |
|---|---|
| `POST /api/tasks/plan` with no member filter | Read-only all-member preview permitted for backward compatibility |
| `POST /api/tasks/plan` with `personKeys: []` | HTTP 400; not all members |
| `POST /api/tasks/execute` with no member scope | HTTP 400 |
| `POST /api/tasks/execute` with `personKeys: []` | HTTP 400 |
| `POST /api/tasks/execute` with `all: true` | Explicit all-member mutation permitted |
| `POST /api/explorer/create-missing` without member scope | HTTP 400 |
| `POST /api/config/settings` containing `githubToken` | Persisted by existing configuration repository; response returns masked token |
| Unknown `/api/*` path | HTTP 404 with JSON failure object |
| Production startup without `API_AUTH_TOKEN` | Startup error, not an exposed mutation service |
| Authenticated startup with default `LISTEN_HOST` | Bind to `127.0.0.1`; do not expose a direct public HTTP port |
| Browser `Sec-Fetch-Site: same-site` with no `Origin` on unsafe APIs | HTTP 403, regardless of valid Basic credentials |
| Headerless authenticated CLI call to unsafe APIs | Can reach route-level authorization and explicit confirmation checks |
| Startup with global insecure TLS bypass | Startup error, not an insecure network client |

## Verified versus unverified

The source/API regression suite, headless Chromium UX checks and authenticated HTTP smoke tests run in CI. They do **not** prove secure deployment architecture, correct organizational policy, live Azure permissions, credential rotation, audit logging of every failure, penetration test coverage or authorization between multiple independent app users.

**Remaining security work:** Replace plaintext on-disk credentials with an approved OS/enterprise secret store where required; review CSRF and proxy origin settings for your deployment; perform a managed dependency scan and verify server logs never disclose secret material; do a tenant-scoped, explicitly authorized integration test. Historical credentials posted in conversations must be revoked and replaced.

## File lock correctness (October 2026)

The single-host execution lock now records a random ownership token. Only the acquiring instance with the matching token and PID may release the active lock; a second instance's `release()` does nothing. A live owner no longer loses its lock after an arbitrary five-minute timeout; a terminated PID still permits stale-lock recovery. Unparseable lock files are treated as locked and require operator investigation rather than automatic destructive recovery.

**Limitations:** This is a single-host PID and filesystem lock, not a distributed lease. If two processes reclaim the same dead-PID lock simultaneously, there remains a reclamation race; multiple machines or shared/network filesystems are **not supported as a coordination mechanism**. Treat the app as a single-instance deployment until an external lease with fencing is designed and tested. A process with manual filesystem access can still delete its own lock, so the application's identity/auth controls remain essential.

Regression tests live in `tests/unit/repositories.test.ts`; inspect the CI run for the exact release commit. Live concurrent Azure mutations were deliberately not performed.


## Runtime and API safety improvements (17 October 2026)

- `POST /api/tasks/close-today` requires an explicit `personKeys` array or `all:true` for actual closure. A `dryRun:true` preview may omit scope for backward-compatible inspection. The browser explicitly sends `all:true` when choosing all members.
- `POST /api/tasks/repair` requires `confirm:true`.
- `POST /api/scheduler/run-now` and `POST /api/scheduler/trigger-autoclose` require **both** `confirm:true` and `all:true`. Legacy clients must add these body fields; Basic authentication by itself is not a per-person permission system.
- Invalid Explorer person keys and empty explicit selections are rejected instead of being expanded to the whole team.
- Automatic source discovery, duplicate detection, Explorer and EOD require the configured full task-series segment before the first `|`; task titles belonging to other streams do not count, even if their assignee and date match. If your tenant uses legacy date-first title formats, migrate/validate those records before enabling automation.
- With `--config /path/to/people.json`, the adjacent `/path/to/.env` is loaded without overwriting explicit deployment environment variables, so an existing PAT is found for custom-config launches.
- The CLI `close-today` command requires explicit `--all` or `--person` plus `--yes` for remote closure. CLI `repair` requires `--yes`. Preview with `--dry-run` remains non-mutating.
- Azure DevOps Explorer read failures now produce errors rather than fake zero-task coverage. Work-item details use available fields instead of assuming all tenants define the same `Custom.*` names. Source discovery no longer truncates to the first 100/200 candidates without warning; results over the bounded limit explicitly fail.
- GitHub PR search errors are distinguished from zero PRs. The system must not report that development/review work was performed merely because GitHub returned no PRs.
- The changes above have fixture/CI coverage only. They do not validate actual corporate identities, policies, remote work-item creation or closure, configured ingress/CSRF behavior, keychain storage or production restoration. Use the release gates in issue #11 before deployment.

## Operator versus read-only viewer access

The HTTP server can optionally accept a distinct `API_VIEWER_USER` / `API_VIEWER_TOKEN` Basic credential. Viewer credentials can inspect read-only views and API endpoints but are categorically forbidden from POST, PUT, PATCH and DELETE, including configuration and remote Azure mutations. The mandatory `API_AUTH_USER` / `API_AUTH_TOKEN` account remains the operator; viewer token must be distinct. Production refuses to silently increment a busy port.

**Limitation:** This is only a role separation for trusted single-host deployments. Shared viewer/operator credentials are **not** enterprise SSO, person-level RBAC or tamper-resistant audit attribution. Real multi-operator installations still need a trusted identity provider, per-user authorization and attributable mutation journaling. Test behind the actual production HTTPS proxy.

## Viewer and operator UI behavior

On a deployment with optional `API_VIEWER_USER` and `API_VIEWER_TOKEN`, authenticated `GET /api/session` returns a server-assigned role. The web UI displays an explicit read-only notice and disables common write controls for viewers. The server still independently denies every viewer POST/PUT/PATCH/DELETE, including scheduler and settings mutations. The browser must never be trusted as an authorization enforcement point. Per-user enterprise SSO/RBAC and attributable audit remain deployment decisions and are **not** implemented by shared Basic credentials.

**Read-only preview exception:** Viewer credentials can call the POST-based `/api/tasks/plan` preview and `/api/tasks/close-today` only with `dryRun:true`. The EOD route enforces the viewer role after parsing the body and returns 403 for `dryRun:false`. All other POST/PUT/PATCH/DELETE endpoints remain operator-only. Viewers are not authorized to mutate work items.
