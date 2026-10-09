# 3in1 Task Studio

Production-grade rebuild of the Azure DevOps **3in1 Task Creator**. Creates the
daily "3in1" task series for every team member from a single source task, copies
fields and relations safely, prevents duplicates, and keeps a verifiable audit
log. Ships as a CLI + web dashboard + weekday scheduler.

- **Stack:** TypeScript (ESM, Node ≥ 22), Express 5, vanilla SPA. Three runtime
  dependencies: `express`, `cors`, `dotenv`.
- **Architecture:** hexagonal (ports & adapters) — pure domain, application use
  cases, infrastructure adapters, presentation.
- **Tests:** 76 passing (9 files) — unit + integration with in-memory fakes.

> Legacy implementation is preserved untouched in [`../Legacy`](../Legacy).
> See [`docs/LEGACY_RECOVERY.md`](docs/LEGACY_RECOVERY.md).

---

## Quick start

```bash
cd new-app
npm install

# 1. Configure the connection (never commit this file)
cp .env.example .env
# edit .env and set AZURE_DEVOPS_PAT

# 2. Optional: edit people.json (team members + org/project)

# 3. Run
npm run dev -- plan     # preview, writes nothing
npm run dev -- run      # create tasks
npm run dev             # web dashboard on http://localhost:3000
```

The server reads `AZURE_DEVOPS_PAT` from the environment. Required PAT scope:
**Work Items: Read & Write**.

## Commands

| Command | Action |
|---|---|
| `serve` (default) | Start the web dashboard + API |
| `plan` | Preview what would be created (dry-run) |
| `run` | Create tasks now |
| `daemon` | Start the weekday 09:30 scheduler |
| `repair` | Re-copy missing relations on partially created tasks (idempotent) |
| `help` | Usage |

Common options: `--all`, `--person <key,key>`, `--dry-run`, `--yes`,
`--as-of YYYY-MM-DD`, `--thursday-mode CURRENT|FOLLOWING`, `--config <file>`,
`--port <n>`, `--verbose`.

```bash
npm run dev -- run --all --yes
npm run dev -- plan --person yash_somani --as-of 2026-10-08
npm run dev -- serve --port 8080
```

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
    { "key": "yash_somani", "name": "Yash Somani",
      "assignedTo": "yash.somani@bajajfinserv.in",
      "pod": "108_My Account Part 2", "role": "Dev On-Role", "enabled": true }
  ]
}
```

Every person's `assignedTo` **must be unique** — duplicate identities are
rejected at load and at save time.

## Operations

- **Lock:** `.execution-lock.json` (PID + timestamp, stale after 5 min). Prevents
  concurrent runs; stale locks are reclaimed automatically.
- **Journal:** `.task-journal.json` — append-only audit trail; rotates at 10 MB
  into `.journal-archives/` (keeps the last 10). Export as CSV/JSON from the UI or
  `GET /api/journal/export?format=csv`.
- **Health:** `GET /api/health`.
- **Logs:** `GET /api/logs/recent` and live SSE at `GET /api/logs/stream`. Secrets
  are scrubbed (literal and base64) before they reach any sink.

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Liveness |
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
- The client does **not** disable TLS verification. (The legacy app set
  `NODE_TLS_REJECT_UNAUTHORIZED=0`; that was deliberately dropped. For corporate
  interception, install the corporate root CA instead.)
- Bind the server to a trusted network or put it behind an authenticating proxy;
  the API has no built-in auth and can create work items.

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
