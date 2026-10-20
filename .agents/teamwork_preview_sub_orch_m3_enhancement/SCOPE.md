# Scope: Milestone 3 — Operational Safety, Security Guardrails & Concurrency Hardening

## Mission & Boundaries
- Goal: Harden system operational safety, concurrency controls, and security guardrails:
  1. `FileLockRepository` corrupt/0-byte lock recovery and stale lock TOCTOU race mitigation.
  2. Defense-in-depth TLS safety enforcement: invoke `assertTlsSafety()` in `src/container.ts` (`buildApp()`).
  3. Pattern-based regex secret scrubbing in `src/infrastructure/logging/logger.ts` for Bearer tokens, GitHub personal access tokens, and Azure PATs.
  4. Concurrency lock acquisition verification across all mutation use cases.
  5. Comprehensive automated tests for corrupt lock recovery, TLS safety assertions, regex secret scrubbing, and concurrency protection.
- Boundaries: Must maintain strict zero-mutation guardrails, zero dummy/facade implementations, and pass all quality gates (`npm run typecheck`, `npm run typecheck:tests`, `npm run lint`, `npm test`, `npm run build`).

## Work Items
1. **FileLockRepository Corrupt Lock Recovery & Hardening**:
   - In `src/infrastructure/lock/file-lock-repo.ts`, when `getLockInfo()` encounters an unparseable or 0-byte `.execution-lock.json`, check file age via `fs.statSync()`. If the corrupt lock is older than 60 seconds (or 0-byte), treat as stale and allow automatic reclamation rather than permanently wedging in fail-closed locked state.
   - Harden stale lock reclamation to prevent race conditions during unlinking.
2. **Defense-in-Depth TLS Safety Enforcement**:
   - In `src/container.ts` (`buildApp()`), import and invoke `assertTlsSafety()` at the beginning of application initialization.
3. **Pattern-Based Regex Secret Scrubbing**:
   - In `src/infrastructure/logging/logger.ts`, add regex patterns to sanitize bearer tokens (`Bearer [A-Za-z0-9_\-\.]+`), classic GitHub tokens (`ghp_[A-Za-z0-9]{36}`), fine-grained GitHub PATs (`github_pat_[A-Za-z0-9_]{82}`), and Azure PAT formats across console, buffers, and SSE streams.
4. **Automated Unit & Integration Tests**:
   - Add unit tests in `tests/unit/repositories.test.ts` for 0-byte and corrupt lock file recovery.
   - Add unit tests in `tests/unit/logger.test.ts` for pattern-based regex secret scrubbing.
   - Add integration tests for `buildApp()` TLS safety checks.
   - Verify all tests pass 100%, typecheck passes, lint passes, and production build succeeds.

## Execution Pattern
Direct iteration loop:
Explorer -> Worker -> Reviewers (2) -> Challengers (2) -> Forensic Auditor -> Gate
Strict pass criteria: All review APPROVE, all challengers APPROVE, Auditor CLEAN.

## Status: DONE
- Iteration 1: Gate FAIL (stale lock race condition identified by Reviewers and Forensic Auditor)
- Iteration 2: Gate PASS (Reviewer 3 APPROVE, Reviewer 4 APPROVE, Challenger 3 APPROVE, Challenger 4 APPROVE, Forensic Auditor 2 CLEAN)
- Key Outputs:
  * `src/infrastructure/lock/file-lock-repo.ts`: Race-free atomic companion reclamation lock (`.reclaim.lock`) with flag `'wx'`, atomic staging replacement, `ENOENT` error discrimination, fail-closed <60s corrupt lock recovery.
  * `src/container.ts`: Defense-in-depth `assertTlsSafety()` invoked at start of `buildApp()`.
  * `src/infrastructure/logging/logger.ts`: Linear ReDoS-safe regex scrubbing for Bearer, Basic, GitHub classic/fine-grained PATs, Azure 52-char PATs across all sinks, plus retroactive buffer scrubbing.
  * Verified 100% Quality Gates: `npm run typecheck` (0 errors), `npm run typecheck:tests` (0 errors), `npm run lint` (0 errors, 0 warnings), `npm run build` (success), `npm test` (38/38 suites, 547/547 tests pass), Node native suites (19/19 tests pass).

