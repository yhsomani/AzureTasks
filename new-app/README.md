# 3in1 Task Studio

Maintained Azure DevOps **3in1 Task Studio**. Plans and creates
daily work items from each member's independently validated source task, copies
fields and relations safely, prevents duplicates, and keeps a verifiable audit
log. Ships as a CLI + web dashboard + weekday scheduler.

- **Stack:** TypeScript (ESM, Node ≥ 22), Express 5, vanilla SPA. Three runtime
  dependencies: `express`, `cors`, `dotenv`.
- **Architecture:** hexagonal (ports & adapters) — pure domain, application use
  cases, infrastructure adapters, presentation.
- **Verification:** Run the unit/integration suites and CI checks locally; historical passing counts are documented separately.

---

## Quick start

```bash
cd new-app
npm ci

# 1. Configure the connection (never commit this file)
cp .env.example .env
# for local development, supply a newly issued Azure PAT through .env;
# production secrets come from the approved external secret store.

# 2. Optional: edit people.json (team members + org/project)

# 3. Run (preview before any intentional mutation)
npm run dev -- plan         # preview task creation, writes nothing
npm run dev -- run          # creates remote tasks; use explicit selection and confirmation
npm run dev -- close-today --dry-run  # inspect real read-only EOD candidates
npm run dev                 # web dashboard on http://localhost:3000
```

The server reads `AZURE_DEVOPS_PAT` and optional `GITHUB_TOKEN` from the environment. Required PAT scope for mutations:
**Work Items: Read & Write**.

## Documentation and navigation

See [Documentation index](docs/README.md) and [release acceptance ledger](docs/RELEASE_VERIFICATION.md) first. Historical documents may describe superseded behavior.
See [Product vision and scope](docs/PRODUCT_DIRECTION.md), [Security and mutation safety](docs/SECURITY.md), [UI redesign audit and user journeys](docs/UX_REDESIGN.md), [Feature inventory](docs/FEATURE_INVENTORY.md), [Architecture](docs/ARCHITECTURE.md), [Workflows](docs/WORKFLOWS.md), [Design system](docs/DESIGN_SYSTEM.md), and [Production readiness](docs/PRODUCTION_READINESS.md).

This directory is the **only supported application** in the repository. No other application subtree is needed to build, test, or run it.

## Commands

| Command | Action |
|---|---|
| `serve` (default) | Start the web dashboard + API |
| `plan` | Preview what would be created (dry-run) |
| `run` | Create tasks now |
| `daemon` | Start the opt-in weekday scheduler; EOD automation remains independently disabled unless configured |
| `close-today` | Close today's eligible tasks via Azure workflow; recorded effort and descriptions are preserved |
| `repair` | Re-copy missing relations on partially created tasks (idempotent) |
| `help` | Usage |

Common options: `--all`, `--person <key,key>`, `--dry-run`, `--yes`,
`--as-of YYYY-MM-DD`, `--thursday-mode CURRENT|FOLLOWING`, `--config <file>`,
`--port <n>`, `--verbose`.

```bash
npm run dev -- run --all --yes
npm run dev -- close-today --dry-run
npm run dev -- close-today --all --yes
npm run dev -- plan --person member_key
npm run dev -- serve --port 8080
```

**Safety:** Fresh-install defaults keep unattended scheduling and automatic EOD closure disabled. This repository previously contained a tracked team configuration with enabled automation; review the config in every deployment. Production requires `API_AUTH_TOKEN` and HTTPS through a trusted reverse proxy. When a proxy changes the scheme or Host, set `PUBLIC_ORIGIN` to its external origin so unsafe browser API requests can be checked. See [Security](docs/SECURITY.md).

## Build & run (production)

```bash
npm run build      # tsc -> dist/, copies the web UI
npm start          # node dist/index.js (serve)
npm start -- run --all --yes
npm start -- daemon
```

## Configuration

Precedence (lowest → highest):

1. Built-in defaults (`file-config-repo.ts`)
2. `people.json` (or `--config <file>`)
3. Environment variables (`AZURE_DEVOPS_ORG`, `AZURE_DEVOPS_PROJECT`,
   `AZURE_DEVOPS_TIMEZONE`, `PORT`)
4. `.env` (loaded by `dotenv`)

`people.json` shape:

```json
{
  "organization": "BFLDevOpsOrg",
  "project": "3in1_Agile_Projects",
  "timezone": "Asia/Kolkata",
  "thursdayMode": "CURRENT",
  "people": [
    { "key": "member_key", "name": "Example Member",
      "assignedTo": "member@example.invalid",
      "role": "Developer", "enabled": true }
  ]
}
```

Every person's `assignedTo` **must be unique** — duplicate identities are
rejected at load and at save time.

## Operations

- **Lock:** `.execution-lock.json` uses a PID and per-run ownership token.
  A live owning process retains the lock; a dead PID can be recovered. Malformed
  lock files require operator review. Multi-host deployments are unsupported.
- **Journal:** `.task-journal.json` — preserved audit history; rotates at 10 MB
  or the entry limit into `.journal-archives/` without silently deleting older
  archives. Backups and explicit retention are the operator's responsibility.
  Export as CSV/JSON from the UI or
  `GET /api/journal/export?format=csv`.
- **Health:** `GET /api/health` is process liveness only; authenticated `GET /api/ready`
  checks live Azure DevOps project and type readability.
- **Logs:** `GET /api/logs/recent` and live SSE at `GET /api/logs/stream`. Secrets
  are scrubbed (literal and base64) before they reach any sink.

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Liveness |
| GET | `/api/ready` | Read-only Azure DevOps readiness (503 when unavailable) |
| GET | `/api/session` | Authenticated role: operator or viewer |
| GET | `/api/status` | Connection + config health |
| GET/POST | `/api/config`, `/api/config/people`, `/api/config/settings`, `/api/config/pat` | Configuration |
| POST | `/api/tasks/plan` | Dry-run plan |
| POST | `/api/tasks/execute` | Create tasks |
| GET | `/api/journal`, `/api/journal/export` | Audit trail |
| GET/POST | `/api/scheduler`, `/api/scheduler/toggle` | Scheduler |
| GET | `/api/logs/recent`, `/api/logs/stream` | Logs |

## Deployment & rollback

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md#deployment) and
[`docs/PRODUCTION_READINESS.md`](docs/PRODUCTION_READINESS.md).

Quick version:

```bash
git archive --format=tar HEAD new-app | (cd /opt && tar xf -)
cd /opt/new-app && npm ci && npm run build
AZURE_DEVOPS_PAT=... node dist/index.js daemon   # or serve behind a reverse proxy
```

Rollback: keep the previous `dist/` (or previous commit) and restart; the app is
stateless except `people.json`, `.env`, `.task-journal.json`.

## Security notes

- The PAT is read from the environment and scrubbed from all logs.
- The UI writes a new PAT to `.env` with `chmod 0600` (best effort).
- TLS certificate verification must stay enabled. Use a trusted corporate root CA where required; do not use TLS-bypass startup flags.
- **HTTP Basic auth** protects the web UI and API when `API_AUTH_TOKEN` is set
  (the browser prompts once and reuses the session credentials; the PAT is never
  involved). Without TLS the credentials are only base64-encoded, so run behind
  HTTPS or on a trusted network. `/api/health` stays public for probes.
- Without `API_AUTH_TOKEN` the server is unauthenticated and can create work
  items — bind it to localhost/trusted network or put an authenticating proxy in
  front.

## Repository layout

```
new-app/
├─ src/
│  ├─ domain/          # entities, value objects, domain services, ports (pure)
│  ├─ application/     # use cases (create, plan, status, config)
│  ├─ infrastructure/  # Azure client, file repos, scheduler, logger
│  ├─ presentation/    # HTTP API + web SPA
│  ├─ container.ts     # composition root
│  └─ index.ts         # CLI entry point
├─ tests/              # unit + integration
├─ people.json         # team + connection config
└─ docs/               # architecture, parity, workflows, tests, readiness
```

## Runtime configuration and audit integrity

The checked-in `people.json` is intentionally an **empty team configuration**. Add your real Azure DevOps identities through the Team UI or your private runtime configuration; do not commit employee identifiers or credentials. Scheduling and EOD auto-close remain opt-in. The UI never supplies sample work items as a replacement for a failed live request.

EOD closure preserves the Azure DevOps values for Completed Work and Remaining Work instead of asserting an unverified eight-hour workday. Closing a task does not prove work was completed or that GitHub evidence was sufficient; operators remain responsible for validating the work. The server reports a requested scheduler run as queued, not as completed. Verify the outcome in Logs.

The local audit journal now fails visibly if its JSON is corrupt, instead of overwriting it with empty history. Archived partial relation records remain discoverable and repairable. Keep and back up journal archives; repair status is not proof of an independent Azure DevOps read-back.

**Release limitations:** Production HTTPS/reverse-proxy authentication, credential rotation, live Azure DevOps write verification, GitHub evidence completeness, and production scheduler recovery still require environment-specific testing. Passing isolated CI tests does not establish those release gates. Never commit PATs.

## Audit history retention (additional hardening)

Rotated journals remain available to the audit UI, exports and relation-repair discovery. At the 10 MB or 10,000-entry threshold the active file is archived, not silently truncated. Archives are not automatically deleted: back them up and apply an explicit retention policy. A relation-repair PATCH by itself is **not** an independent verification of the final Azure work-item relations. An API error, missing identity, or journal write failure must remain visible, not become a fabricated success.

## Live health probes

`GET /api/health` is a web-process **liveness** check only; it deliberately does not assert that Azure DevOps or GitHub is online. `GET /api/ready` checks Azure DevOps project/type access using the current credentials and returns HTTP 503 if the integration is unavailable. Readiness is subject to normal API authentication. A successful readiness response is not proof that Azure write permissions or EOD transitions have been exercised.

## EOD scheduler safety

Automatic EOD closure is opt-in. When enabled, the scheduler makes at most **one automatic closure attempt per configured workday** within the configured time window. Empty scans, Azure failures and partial results are surfaced rather than retried silently into repeated remote patches; the attempt timestamp is persisted to prevent automatic replay after restart. An authorized operator may manually trigger another run after inspecting the result. The task state transition is subject to Azure DevOps workflow validation, and work hours/descriptions are not invented.

## Release acceptance authority

[Release acceptance ledger](docs/RELEASE_VERIFICATION.md) is the up-to-date separation between implemented code/CI and externally verified production readiness. Older implementation checklists are historical and should not be marked done from synthetic tests alone.

### CLI EOD closure safety

Live `close-today` requires `--all` or `--person` and `--yes`; `--as-of` is allowed only for dry-run previews. CLI, web, and scheduler closure operations always use Azure DevOps workflow rules and never bypass them. They do not fabricate completed hours, remaining work, actual work times, descriptions, or close timestamps.

## Safe deployment topology verification

After authorized staging deployment, run the **read-only** staging diagnostics against your real, HTTPS application:

```bash
export RELEASE_BASE_URL=https://your-trusted-task-studio.example
export API_AUTH_USER=admin
# Inject API_AUTH_TOKEN from your approved secret manager (never commit it).
npm run verify:staging:readonly
```

The script reads `/api/health`, `/api/ready`, configuration and the journal, then sends POSTs **only to a nonexistent API route** to test same-origin and hostile-origin rejection. It does not create, close or repair Azure work items. It fails if read-only Azure readiness is unavailable. For a local host-only test, `ALLOW_LOCAL_HTTP=1` permits HTTP on localhost; never enable that for a remote deployment. This is not a substitute for operator-approved tenant write tests, SSO review, or restoration rehearsal.

## Read-only identity lookup preflight (issue #11)

After provisioning a **new** PAT with Azure DevOps **Identity (Read)** scope (`vso.identity`) from an approved secret store, run from `new-app/`:

```bash
# Do not reuse any previously exposed PAT.
# Inject a dedicated AZURE_DEVOPS_IDENTITY_PAT securely; never commit or echo it.
npm run verify:identities:readonly
# To restrict a larger team to only two enabled member keys:
RELEASE_PERSON_KEYS=member1,member2 npm run verify:identities:readonly
```

The tool uses only `GET https://vssps.dev.azure.com/<org>/_apis/identities` and verifies that each configured, enabled member's `assignedTo` exactly resolves to **one active, non-group identity**, with no duplicated member key/account/Azure identity. It requires an email/UPN or an Azure **subject descriptor**; ambiguous display names fail closed. Per-member `titlePrefix` is checked for presence, but **not** proven against live work items. Output includes only ordinal member numbers and statuses, not employee emails or credentials. A nonzero exit status blocks the gate.

This is read-only account resolution, **not proof** of project membership, work-item assignability, tenant process rules, source task ownership, correct prefixes, or safe task creation. Follow with authorized read-only WIQL/work-item comparison and separately approved bounded staging operations. Automated fixture tests run via `npm run test:identities`; production identity verification remains blocked until an operator records dated live-tenant evidence.


### Scoped work-item prefix preflight (repository implementation, tenant verification pending)

To compare configured per-person title prefixes with actual Azure DevOps work items created since a known date, provision a **new, work-item read-only** token (`vso.work`) from your approved vault. Run from `new-app/` after populating private `people.json` with real validated email/UPN identities:

```bash
# Provision AZURE_DEVOPS_WORK_READ_PAT securely (do not echo or check in).
RELEASE_FROM_DATE=2026-10-01 npm run verify:workitems:readonly
# Optional: scope to up to 20 enabled people by their local config keys:
RELEASE_FROM_DATE=2026-10-01 RELEASE_PERSON_KEYS=member1,member2 npm run verify:workitems:readonly
```

The tool performs **Azure WIQL POST for a read-only SELECT query**, followed by **GET work-item details**; there are no item create, update, transition or delete calls. It filters each member's task type, project, *exact configured UPN*, and `System.CreatedDate >= RELEASE_FROM_DATE`. Every returned ID must have a matching read-back, project, type and assignee. A bounded query (maximum 200 work items per member and 20 selected members) fails closed on truncation, ambiguity, missing/mismatched identities, empty coverage or a missing configured series prefix. No titles, PATs or employee identifiers are printed.

**Limitations:** `PREFIX_OBSERVED` means at least one recent title in the configured series was independently observed. It does **not** establish that all historical tasks, intended work dates, source-task ownership, assignment permissions or per-day deduplication are correct. It does not validate tasks created before the chosen creation-date bound. Human review of the actual person/date evidence and separately authorized staging writes are still required; issue #11's live tenant checklist stays open until dated evidence is recorded.

Offline tests: `npm run test:workitems`.

