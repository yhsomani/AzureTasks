## 2026-10-19T20:14:23Z
You are a Worker for Milestone 3: Operational Safety, Security Guardrails & Concurrency Hardening.
Working directory: `/Users/yashsomani/Desktop/Asure Bord Project/.agents/teamwork_preview_worker_m3_1`
Target codebase directory: `/Users/yashsomani/Desktop/Asure Bord Project/new-app`
Parent Orchestrator Conversation ID: `24358d22-854f-4308-b445-c598cac2e141`

You MUST read the following authoritative files first:
1. `/Users/yashsomani/Desktop/Asure Bord Project/.agents/ORIGINAL_REQUEST.md` (specifically `## 2026-10-19T16:11:51Z`)
2. `/Users/yashsomani/Desktop/Asure Bord Project/PROJECT.md`
3. `/Users/yashsomani/Desktop/Asure Bord Project/.agents/teamwork_preview_sub_orch_m3_enhancement/SCOPE.md`
4. `/Users/yashsomani/Desktop/Asure Bord Project/.agents/teamwork_preview_explorer_m3_1/handoff.md`

MANDATORY INTEGRITY WARNING:
DO NOT CHEAT. All implementations must be genuine. DO NOT hardcode test results, create dummy/facade implementations, or circumvent the intended task. An auditor will independently verify your work. Integrity violations WILL be detected and your work WILL be rejected.

Your Exclusive Write Boundaries:
- `src/infrastructure/lock/file-lock-repo.ts`
- `src/container.ts`
- `src/infrastructure/logging/logger.ts`
- `tests/unit/repositories.test.ts`
- `tests/unit/logger.test.ts`
- `tests/integration/server-security.test.ts`

Detailed Implementation Instructions (refer to Explorer's handoff.md for code specifications):
1. `src/infrastructure/lock/file-lock-repo.ts`:
   - In `readLockInfo(targetPath)` (or `getLockInfo()`):
     * Check `stat.size === 0`: return `{ pid: 0, acquiredAt: new Date(stat.mtimeMs).toISOString(), stale: true }`.
     * If JSON parse fails or required fields are missing: check file age `Date.now() - stat.mtimeMs`. If age >= 60_000 ms, mark as stale (`stale: true`); if age < 60_000 ms, mark as not stale (`stale: false`, failing closed for 60s).
   - In `acquire()`:
     * Eliminate TOCTOU race during stale reclamation by atomically moving the stale lock file out of the way before removing it:
       `const reclaimTemp = `${this.lockPath}.${process.pid}.${randomUUID()}.stale`;`
       `fs.renameSync(this.lockPath, reclaimTemp);`
       Read `reclaimTemp`, verify that it is still stale and matches `existing` pid/acquiredAt, unlink `reclaimTemp`, and call `writeExclusive()`.
       If rename or verification fails, return `false` cleanly.
2. `src/container.ts`:
   - Import `assertTlsSafety` from `./infrastructure/security/tls-safety.js`.
   - Call `assertTlsSafety()` at the beginning of `buildApp()` (after loading `.env`).
3. `src/infrastructure/logging/logger.ts`:
   - Add regex pattern scrubbing in `scrub(message: string)` for:
     * Bearer tokens (`/\bBearer\s+[A-Za-z0-9_\-.]+/gi`, replacing value with `***`)
     * HTTP Basic authorization headers (`/\bBasic\s+[A-Za-z0-9+/=]{10,}/gi`, replacing value with `***`)
     * GitHub classic PATs (`/\bghp_[A-Za-z0-9]{36}\b/g`, replacing with `***`)
     * GitHub fine-grained PATs (`/\bgithub_pat_[A-Za-z0-9_]{82}\b/g`, replacing with `***`)
     * Azure DevOps PATs (`/\b[a-z2-7]{52}\b/gi` and `/\b[A-Za-z0-9]{52}\b/g`, replacing with `***`)
   - Add public methods `sanitize(message: string): string` and `mask(secret: string): string` that delegate to `this.scrub()`.
   - In `registerSecret()`, retroactively scrub existing in-memory buffer entries (`for (const entry of this.recentLogs) entry.message = this.scrub(entry.message)`).
4. Automated Test Suites:
   - In `tests/unit/repositories.test.ts`:
     * Add tests for 0-byte lock file immediate reclamation.
     * Add tests for corrupted lock file older than 60 seconds reclamation.
     * Add tests for corrupted lock file younger than 60 seconds failing closed.
     * Add tests for concurrent stale reclamation TOCTOU race mitigation.
   - In `tests/unit/logger.test.ts`:
     * Add tests for Bearer tokens, GitHub classic PATs (`ghp_`), GitHub fine-grained PATs (`github_pat_`), Azure PATs (52-char base32 & alphanumeric), HTTP Basic auth headers, and buffer/listener scrubbing.
   - In `tests/integration/server-security.test.ts`:
     * Add integration tests verifying `buildApp()` rejects initialization when `ALLOW_INSECURE_TLS=true` or `NODE_TLS_REJECT_UNAUTHORIZED=0`.

Verification Requirements:
Run and verify in `new-app/`:
- `npm run typecheck`
- `npm run typecheck:tests`
- `npm run lint`
- `npm test`
- `npm run build`

When all verification passes cleanly, write your handoff report to:
`/Users/yashsomani/Desktop/Asure Bord Project/.agents/teamwork_preview_worker_m3_1/handoff.md`
Report your status and verification results back to parent orchestrator (`24358d22-854f-4308-b445-c598cac2e141`) via `send_message`.
