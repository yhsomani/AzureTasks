# Engineering council review

> **Honesty note.** These reviews were performed as **sequential specialist
> passes by a single agent** (me), not by twelve independently executing
> agents. I adopt each role's lens and evaluate the new code against it. Where a
> role would need a runtime or human I cannot provide (real Azure tenant,
> screen-reader audit, load test at scale), that is called out as a limit rather
> than asserted as passed.

Reviewed artifact: `new-app/` at the time of writing (112 tests green, build
clean, UI smoke-tested). Each role gives findings and a verdict.

## 1. Principal Architect

- **Sees:** Hexagonal layout with a pure domain, application use cases, and
  adapters. Dependency rule holds: `domain` imports nothing outward;
  `container.ts` is the only composition root.
- **Checks:** No cycles. The former 400-line `TaskOrchestrator` is split into
  pure domain services and a thin use case. Big win.
- **Concern:** `application/use-cases/config.ts` and `get-status.ts` are only
  lightly tested (0% coverage). Not architectural, but note it.
- **Verdict:** ✅ Approved. Boundaries are clean.

## 2. Product Strategist

- **Sees:** All legacy user-facing capabilities preserved (status, plan, execute,
  explorer, journal, scheduler, logs, settings). Duplicate prevention and audit
  are first-class.
- **Concern:** CLI lost the interactive "proceed? [y/N]" prompt in favor of
  `--yes`. For an operation that writes to a shared Azure project, a confirm
  step is good UX. In the UI there *is* a confirm dialog; the CLI is automation
  oriented, so `--yes` is defensible.
- **Verdict:** ✅ Parity met; document `--yes` prominently (done in README).

## 3. Backend Engineer

- **Sees:** Pure, tested rules engine — duplicate detection scoped per
  person+date, field-copy overrides, relation whitelist.
- **Findings fixed during review:**
  1. **Discovery key mismatch** — results keyed by Azure identity, lookups by
     `person.key`. Fixed + regression test.
  2. **Relation whitelist wrong** — `AttachedFile` was copied and `Parent`
     (`Hierarchy-Reverse`) was blocked. Aligned to the verified legacy rule
     (copy Parent, exclude Child + AttachedFile).
  3. **Config saves were fake** — only mutated memory. Now persist via
     `ConfigRepository`.
  4. **Timezone ignored by scheduler** — now computes the next 09:30 in the
     configured IANA zone.
  5. **Azure client retried auth failures** — 401/403 were retried with backoff
     and a missing PAT produced an unhelpful "fetch failed" after ~10 s. Now
     fails fast with a clear message; network errors are normalized.
- **Verdict:** ✅ Approved after fixes.

## 4. Frontend Engineer

- **Sees:** Dependency-free ES-module SPA. `app.js` is a small state object +
  fetch calls + DOM builders; no framework, no bundler.
- **Concern:** DOM is built imperatively via an `el()` helper — fine at this
  size. If the UI grows 3–4×, a tiny render helper or framework would pay off.
  Not now.
- **Verdict:** ✅ Approved. Every control calls a real endpoint.

## 5. UX Designer

- **Sees:** Clear information architecture, dark/light themes, toasts, spinners,
  disabled-in-flight buttons, responsive sidebar.
- **Concern:** The Explorer "Create missing" reuses the Planner's people
  selection implicitly (all enabled). Acceptable; labeled clearly.
- **Verdict:** ✅ Approved.

## 6. QA / Test Engineer

- **Sees:** 112 tests across unit + integration, including eight regression
  tests for real bugs. Domain + value objects ~100% covered.
- **Concern:** No automated test drives the HTTP layer or the SPA; those were
  smoke-tested manually. Recommend a `supertest`-style route test if the API
  surface grows.
- **Verdict:** ✅ Approved, with the coverage caveat documented in
  `TEST_RESULTS.md`.

## 7. DevOps / SRE

- **Sees:** Single-binary build, health endpoint, file journal with rotation,
  file lock with stale reclamation, structured logs, SSE.
- **Concern:** The file lock is per-host; running the scheduler on two hosts
  would double-create unless a shared lock is used. Documented as a known limit.
- **Verdict:** ✅ Approved for single-host deployment behind a reverse proxy.

## 8. Security Engineer

- **Sees:** PAT from environment, masked in status, scrubbed from logs
  (literal + base64), TLS verification **on**. `NODE_TLS_REJECT_UNAUTHORIZED=0`
  removed.
- **Concern:** `POST /api/config/pat` writes the PAT to `.env` (mode `0600`).
  Plaintext-on-disk remains a residual risk; acceptable for a self-hosted tool,
  and documented.
- **Concern:** The API has no built-in authentication. It can create work items.
  Must be bound to a trusted network or fronted by an authenticating proxy —
  documented in README/architecture.
- **Verdict:** ⚠️ Approved **with the deployment constraints above enforced**.

## 9. Data / Persistence Engineer

- **Sees:** JSON config, JSON journal (append + rotate), CSV/JSON export. No DB.
- **Concern:** Journal loads fully into memory; fine to ~10k entries, then
  rotation caps growth. Move to SQLite/Postgres only if query volume grows.
- **Verdict:** ✅ Approved for current scale.

## 10. Performance Engineer

- **Sees:** One WIQL query + one batch work-item fetch per run (not N+1). HTTP
  client has exponential-backoff retries.
- **Concern:** Sequential per-person/per-date creation. Azure rate limits make
  concurrency risky; sequential is the safe default. Revisit only if runs become
  slow at large team sizes.
- **Verdict:** ✅ Approved.

## 11. Technical Writer

- **Sees:** README + `docs/` (architecture, parity, workflows, design system,
  test results, legacy recovery, readiness). Commands, API, config, and
  deployment all documented.
- **Verdict:** ✅ Approved.

## 12. Accessibility & Compliance Reviewer

- **Sees:** Skip link, semantic landmarks, `aria-live` for toasts and logs,
  visible focus, `prefers-reduced-motion`, keyboard-operable controls, adequate
  contrast tokens.
- **Concern:** No automated axe/Lighthouse run was performed — flagged as a
  limit, not a pass.
- **Compliance:** Journal provides the audit trail; export supports retention
  needs.
- **Verdict:** ✅ Approved, pending a real accessibility audit in CI.

## Consolidated outcome

| # | Role | Verdict |
|---|---|---|
| 1 | Principal Architect | ✅ |
| 2 | Product Strategist | ✅ |
| 3 | Backend Engineer | ✅ (4 fixes) |
| 4 | Frontend Engineer | ✅ |
| 5 | UX Designer | ✅ |
| 6 | QA / Test Engineer | ✅ (caveat) |
| 7 | DevOps / SRE | ✅ (single-host) |
| 8 | Security Engineer | ⚠️ (deploy constraints) |
| 9 | Data / Persistence | ✅ |
| 10 | Performance | ✅ |
| 11 | Technical Writer | ✅ |
| 12 | Accessibility / Compliance | ✅ (pending real audit) |

Four real defects were found and fixed *because* of this review (discovery key
mapping, relation whitelist, fake config persistence, timezone-blind scheduler),
each now covered by a test or a documented behavior.
