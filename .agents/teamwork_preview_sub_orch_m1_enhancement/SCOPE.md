# Scope: Milestone 1 — Codebase Health, Test Type Safety & Lint Diagnostics

## Mission & Boundaries
- Goal: Align TypeScript and ESLint static analysis to cover test code, eliminate all latent test type errors in test doubles and configurations, fix `FakeClient` mock field handling in `tests/unit/work-item-service.test.ts`, and clean up test lint warnings.
- Boundaries: Must not break existing production code or test pass rates (`npm test` and Node native tests must continue to pass 100%).
- Status: **DONE** (Gate Passed: Reviewer 1 & 2 APPROVE, Challenger 1 & 2 APPROVE, Auditor CLEAN).

## Work Items
1. [x] Add `tsconfig.test.json` so `tests/**/*.ts` typecheck cleanly, resolving all latent TypeScript errors in test code.
2. [x] Update `package.json` lint script to `"lint": "eslint \"{src,tests}/**/*.ts\""` and add `typecheck:tests` script.
3. [x] Fix test doubles and type drift in:
   - `tests/unit/repositories.test.ts` (AppConfig pick type, vi import)
   - `tests/unit/work-item-service.test.ts` (FakeClient fields forwarding and typing)
   - `tests/integration/create-tasks.test.ts` (FakeWorkItemRepo implementing missing methods)
   - Other test files identified during test typechecking (`get-status.test.ts`, `explore-tasks.test.ts`, `api-routes.test.ts`, `server-security.test.ts`).
4. [x] Remove unused `beforeEach` import in `tests/unit/get-status.test.ts`.
5. [x] Verify `npm run typecheck`, `npm run lint`, `npm test`, and `npm run build` pass with zero errors.

## Execution Pattern
Iteration loop: Explorer -> Worker -> Reviewers (2) -> Challengers (2) -> Forensic Auditor -> Gate
Gate evaluation: PASS (Iteration 1)
