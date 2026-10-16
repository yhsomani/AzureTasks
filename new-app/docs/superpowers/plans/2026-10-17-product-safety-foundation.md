# Product safety foundation — implementation plan
> **For agentic workers:** REQUIRED SUB-SKILL: use superpowers:executing-plans. Checkpoints track test evidence rather than intention.

**Goal:** Prevent cross-origin browser requests from triggering Azure DevOps mutations through the HTTP Basic-authenticated server, and ground the product direction in actual code behavior.

**Architecture:** Keep the single Express app and existing API. Add a narrow guard for unsafe /api methods after authentication and before JSON parsing/routes, with strict Origin/Fetch Metadata checking, avoiding new dependencies. Requests with no Origin (CLI, server-to-server) remain supported unless their `Sec-Fetch-Site` explicitly signals cross-site. A configured origin is a deliberate deployment exception, not a wildcard.

**Tech Stack:** TypeScript/Express 5, Vitest, Node 22, GitHub Actions.

**Spec:** `docs/PRODUCT_DIRECTION.md`

## Global constraints
- No remote Azure mutations during verification.
- Do not alter tracked team identities, stored secrets, or historical closure records. The tracked scheduler enabled/autoclose flags may be disabled as a reversible, reviewed safety migration; never automatically overwrite a deployed machine's local config.
- Preserve existing API endpoints, success envelopes, and Basic authentication.
- Never accept wildcard Origin or a cross-site browser mutation by default.
- Deployment behind a proxy must preserve `Host` or explicitly configure `PUBLIC_ORIGIN`.

## Review focus
1. Credentialed POST from attacker.example.test is denied **before** calling any mutation use case.
2. Malformed/null Origin is denied, not parsed as a trusted host.
3. Legitimate same-origin browser POST is accepted.
4. CLI POST without Origin remains supported.
5. Cross-site `Sec-Fetch-Site` is rejected even without Origin.

### Task 1 — Regression coverage
**Files:** modify `tests/integration/api-routes.test.ts` or add `tests/integration/http-origin.test.ts`; test AppServer using mocked API dependencies and an ephemeral port.

- [x] Add tests demonstrating #1–5, including an intentional `PUBLIC_ORIGIN` behind proxy.
- [x] Run CI and inspect that test failures are caused by the missing guard (red; CI run 38954218774).
- [x] Commit test-only change.

### Task 2 — Boundary fix
**Files:** add `src/presentation/api/request-origin.ts`; modify `src/presentation/api/server.ts`.
**Interfaces:** `unsafeRequestOriginGuard(options: { publicOrigin?: string; allowedOrigin?: string }): express.RequestHandler`.

- [x] Implement exact-origin check for unsafe /api methods and reject wildcard trusted hosts. Permit cross-site Fetch Metadata only for an explicitly configured exact trusted `CORS_ORIGIN`; block it by default.
- [x] Install after Basic auth and before body parsing / API.
- [x] Run tests + CI build, browser and HTTP smoke checks (green at 38954403165); rerun and inspect final PR head before merge.
- [x] Commit isolated fix.

### Task 3 — Documentation and evidence
**Files:** update `.env.example`, `docs/SECURITY.md`, `docs/PRODUCT_DIRECTION.md`, `docs/PRODUCTION_READINESS.md`.

- [x] Document `PUBLIC_ORIGIN` behind reverse proxy and the no-Origin CLI allowance.
- [x] Update tracker with red/green CI runs and remaining tenant verification.
- [ ] Review diff, check PR status and merge only after passing tests and review.

## Decision ledger
- Ruling: avoid a full frontend stack rewrite until tenant and safety-critical workflows are verified. Rebuild cost and regressions currently outweigh unproven benefits.
- Ruling: retain tracked `people.json` identities and `lastAutoClose` history; switch only the tracked automation enabled flags to false in a reviewable branch, along with defaults. Existing operators must explicitly review/merge/deploy this behavior change.

## New verification evidence

- Browser origin red test: [38954218774](https://github.com/yhsomani/AzureTasks/actions/runs/38954218774), three failures as expected.
- Green origin guard: [38954403165](https://github.com/yhsomani/AzureTasks/actions/runs/38954403165).
- Fresh-config closure red test: [38954582908](https://github.com/yhsomani/AzureTasks/actions/runs/38954582908), one failure as expected.
- Trusted origin wildcard red test: [38955233381](https://github.com/yhsomani/AzureTasks/actions/runs/38955233381), one failure as expected; fixed in subsequent commit.
