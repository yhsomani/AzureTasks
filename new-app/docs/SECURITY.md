# Security and mutation safety

This document applies to the supported `new-app/` application. It records verified safeguards and controls that still depend on deployment.

## Trust boundaries

- **Browser → application:** The web dashboard and API are same-origin by default. CORS browser access is disabled unless an explicit trusted `CORS_ORIGIN` is configured. Cross-origin restrictions are not a substitute for authentication.
- **API → Azure DevOps:** API calls can create and update real Azure DevOps work items. The task-creation API requires a non-empty `personKeys` array or an intentional `all: true` marker. Empty arrays and omitted scopes on mutation routes must be rejected.
- **API → GitHub Enterprise:** Token is used for reads of PR/commit evidence. Avoid broad token scopes where narrower supported permissions suffice.
- **Service → local files:** `.env`, journal and config files may contain sensitive organizational data. Protect runtime directories and backups, set restrictive filesystem permissions, and never commit credentials.

## Deployment controls

1. Create a newly rotated Azure DevOps PAT and GitHub token with only the necessary read/write scopes.
2. Provide a long, randomly generated `API_AUTH_TOKEN` before starting the web server with `NODE_ENV=production`. Production server startup refuses to run if absent.
3. Terminate HTTPS at a trusted reverse proxy (or equivalent TLS-enabled network boundary). HTTP Basic authentication is not sufficient over plaintext public networks.
4. Keep `NODE_TLS_REJECT_UNAUTHORIZED` enabled and do not enable `ALLOW_INSECURE_TLS`. Use `NODE_EXTRA_CA_CERTS` for a trusted corporate CA where appropriate.
5. Restrict CORS to an explicit origin only when the web client must be served from a different origin. Normal application use requires no CORS configuration.
6. Start one scheduler instance per lock domain; coordinate shared locks if deploying multiple hosts.
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
| Startup with global insecure TLS bypass | Startup error, not an insecure network client |

## Verified versus unverified

The source/API regression suite, headless Chromium UX checks and authenticated HTTP smoke tests run in CI. They do **not** prove secure deployment architecture, correct organizational policy, live Azure permissions, credential rotation, audit logging of every failure, penetration test coverage or authorization between multiple independent app users.

**Remaining security work:** Replace plaintext on-disk credentials with an approved OS/enterprise secret store where required; review CSRF and proxy origin settings for your deployment; perform a managed dependency scan and verify server logs never disclose secret material; do a tenant-scoped, explicitly authorized integration test. Historical credentials posted in conversations must be revoked and replaced.
