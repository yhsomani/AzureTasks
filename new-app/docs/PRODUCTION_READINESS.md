# Production readiness assessment

**Target:** deployable single-host service (CLI + web + scheduler) for the Azure
DevOps 3in1 task automation.

## Scorecard

| Area | Status | Evidence |
|---|---|---|
| Build | ✅ | `npm run build` → `dist/` clean |
| Type safety | ✅ | `npx tsc --noEmit` clean (strict) |
| Tests | ✅ | 104 passing; domain ~100% covered |
| Business-rule correctness | ✅ | Pure, tested; 3 regression tests for real bugs |
| Error isolation | ✅ | Per-item failures don't abort a run |
| Concurrency safety | ✅ | File lock + stale reclamation |
| Audit trail | ✅ | Journal, exportable, rotating |
| Observability | ✅ | Structured logs + SSE + `/api/health` |
| Security | ⚠️ | PAT scrubbed, TLS on; **no built-in API auth**, plaintext `.env` |
| Deployment docs | ✅ | README + architecture + this doc |
| Rollback | ✅ | Stateless; previous `dist/` or commit |
| Accessibility | ⚠️ | Good basics; no automated a11y audit yet |
| Multi-host scheduler | ⚠️ | Per-host lock only |

## Quality gates — all met

- [x] `npm run typecheck` passes
- [x] `npm test` all green
- [x] `npm run build` succeeds and copies the UI
- [x] Server boots, serves UI + API (smoke-tested)
- [x] No secrets in logs (scrubbing verified by code + smoke test)
- [x] TLS verification enabled
- [x] Legacy untouched and independently runnable

## Go / no-go

**GO** for internal, single-host deployment, provided:

1. The service is bound to a trusted network **or** placed behind an
   authenticating reverse proxy (no built-in auth).
2. Only one scheduler instance runs (or a shared lock is introduced).
3. For corporate TLS inspection, the corporate root CA is installed rather than
   disabling verification.

**NO-GO** for a public, unauthenticated endpoint; for multi-host scheduling
without a shared lock; or where plaintext PAT-on-disk is disallowed.

## Deployment checklist

```bash
# 1. Build
cd new-app && npm ci && npm test && npm run build

# 2. Configure
cp .env.example .env            # set AZURE_DEVOPS_PAT
chmod 600 .env
# edit people.json: organization, project, roster (unique assignedTo each)

# 3. Dry run
node dist/index.js plan --all

# 4a. Serve (behind proxy)
PORT=8080 node dist/index.js serve

# 4b. Or schedule
node dist/index.js daemon
```

Post-deploy verification:
- `GET /api/health` → `healthy`
- `GET /api/status` → `connected: true`, `projectValid: true`
- Explorer shows coverage and `Create missing` produces a real work item
- Audit log gains a row; export works

## Operational runbook

| Symptom | Action |
|---|---|
| `connected: false` | Check `AZURE_DEVOPS_PAT` scope (Work Items: R/W) and org/project |
| Run aborted "another execution in progress" | Wait for the other run; a stale lock (>5 min, dead PID) self-reclaims |
| Task created but relations failed | Check journal `relationCopyStatus`; run `repair` to re-copy the missing relations (idempotent) |
| Journal grows | Auto-rotates at 10 MB; archives in `.journal-archives/` |
| Unexpected timezone | Set `timezone`/`startTime`; scheduler uses the IANA zone |

## Rollback

1. Stop the process.
2. `git checkout <previous-tag-or-commit> -- new-app && npm ci && npm run build`
   (or restore the previous `dist/`).
3. Restart. No state migration is required — `people.json`, `.env`,
   `.task-journal.json` are forward/backward compatible JSON/plain text.

## Residual risks & recommended next steps

| Risk | Mitigation | Priority |
|---|---|---|
| Unauthenticated API | Add auth (reverse proxy or token) before broader exposure | High |
| Plaintext PAT in `.env` | Move to OS keychain / secret manager | Medium |
| No automated HTTP/a11y tests | Add route smoke tests + axe in CI | Medium |
| Per-host lock | Shared lock if multi-host scheduling | Low (only if needed) |
| Runtime source (`src/`) shells out to real Azure on `repair` | Dry-run via `plan` first; `repair` only touches already-created tasks | Low |
