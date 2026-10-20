# Comprehensive Audit Report: Operational Safety, Security Guardrails & Web SPA Interface

**Explorer Agent**: Survey Explorer 3 (Operational Safety, Security Guardrails & Web SPA Interface)  
**Target Codebase**: `/Users/yashsomani/Desktop/Asure Bord Project/new-app`  
**Date**: 2026-10-19T16:38:00Z  
**Integrity Mode**: Read-Only Survey & Diagnostic Audit  

---

## 1. Observation

### 1.1 Concurrency Lock Architecture (`FileLockRepository`)
- **File**: `src/infrastructure/lock/file-lock-repo.ts`
- **Lock File**: Default `.execution-lock.json` in process working directory (lines 20–22).
- **Atomic Creation**: Uses `fs.writeFileSync(this.lockPath, JSON.stringify(info, null, 2), { encoding: 'utf-8', flag: 'wx' })` (line 37) where flag `'wx'` specifies `O_CREAT | O_EXCL`.
- **Token Ownership**: Generates a UUID token (`ownerToken = randomUUID()`) stored in `.execution-lock.json` (lines 27–33). During `release()` (lines 64–75), reads file and unlinks only if `current.ownerToken === this.ownerToken && current.pid === process.pid`.
- **Stale Detection**: Lines 99–107 use `process.kill(pid, 0)` to detect if the lock owner is still alive. Catches `EPERM` (indicating process exists under another UID) and treats as alive.
- **Stale Reclamation & TOCTOU Race Condition**:
  ```typescript
  // src/infrastructure/lock/file-lock-repo.ts:53-61
  try {
    const current = this.getLockInfo();
    if (!current?.stale || current.pid !== existing.pid ||
        current.acquiredAt !== existing.acquiredAt) return false;
    fs.unlinkSync(this.lockPath);
    return writeExclusive();
  } catch {
    return false;
  }
  ```
  Unlinking the stale lock file before calling `writeExclusive()` creates a non-atomic gap between check and file removal.
- **Unparseable / Corrupt Lock Fail-Closed Wedge**:
  ```typescript
  // src/infrastructure/lock/file-lock-repo.ts:48-49 & 80-81
  const existing = this.getLockInfo();
  if (!existing?.stale) return false;
  ...
  isLocked(): boolean {
    if (!fs.existsSync(this.lockPath)) return false;
    const info = this.getLockInfo();
    return info === null || !info.stale;
  }
  ```
  If a write is interrupted leaving a 0-byte or corrupted JSON file, `getLockInfo()` catches the parse error and returns `null` (line 95). Since `null?.stale` is `undefined`, `!existing?.stale` evaluates to `true`, causing `acquire()` to return `false` indefinitely. Furthermore, `isLocked()` returns `true` when `info === null`. This permanently wedges the lock until manual filesystem deletion.
- **Lock Omission in Repair Use Case**:
  In `src/container.ts` (lines 85–98), `CreateTasksUseCase` and `CloseDailyTasksUseCase` receive `lockRepo` and acquire the lock before remote writes (e.g. `create-tasks.ts:175`, `close-daily-tasks.ts:91`). However, `RepairRelationsUseCase` (in `src/application/use-cases/repair-relations.ts:28-36`) does not accept `lockRepo` and executes work item link patches (`this.relationCopy.repairRelations`) without acquiring an execution lock.

### 1.2 Atomic File Persistence
- **Config Persistence**:
  `src/infrastructure/config/file-config-repo.ts` lines 146–161:
  ```typescript
  private writeAtomically(filename: string, content: string): void {
    const temp = path.join(path.dirname(filename), `.${path.basename(filename)}.${crypto.randomUUID()}.tmp`);
    let fd: number | undefined;
    try {
      fd = fs.openSync(temp, 'wx', 0o600);
      fs.writeFileSync(fd, content, 'utf-8');
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      fd = undefined;
      fs.renameSync(temp, filename);
    } catch (err) {
      if (fd !== undefined) fs.closeSync(fd);
      try { fs.unlinkSync(temp); } catch { /* no temporary file to clean */ }
      throw err;
    }
  }
  ```
  Guarantees: Same-directory temporary file (guarantees same filesystem partition for POSIX atomic rename), restrictive permissions (`0o600`), explicit flush to disk (`fs.fsyncSync`), descriptor closure, atomic rename (`fs.renameSync`), and error recovery with temp cleanup.
- **Journal Persistence & Rotation**:
  `src/infrastructure/journal/file-journal-repo.ts`:
  - `writeEntriesAtomically` (lines 158–174) replicates identical `.tmp` + `0o600` + `fsyncSync` + `renameSync` architecture.
  - `rotateIfNeeded` (lines 176–190) checks `MAX_JOURNAL_SIZE` (10MB) or 10,000 entries and moves active journal to `.journal-archives/task-journal-${timestamp}.json` via `fs.renameSync`.
  - `getEntries()` (lines 60–70) queries active journal plus all archived history files newest-first, preventing loss of historical audit trail.
  - `exportCsv` (lines 125–133) sanitizes spreadsheet formula injection (DDE attacks) by prepending `'` to values beginning with `=`, `+`, `-`, `@`, `\t`, `\r`, or `\n`.

### 1.3 Strict TLS Checks
- **File**: `src/infrastructure/security/tls-safety.ts`
  ```typescript
  export function assertTlsSafety(environment: NodeJS.ProcessEnv = process.env): void {
    if (environment.ALLOW_INSECURE_TLS?.trim().toLowerCase() === 'true' ||
        environment.NODE_TLS_REJECT_UNAUTHORIZED?.trim() === '0') {
      throw new Error(
        'TLS certificate verification must remain enabled. Remove ALLOW_INSECURE_TLS=true ' +
        'and NODE_TLS_REJECT_UNAUTHORIZED=0; configure a trusted CA via NODE_EXTRA_CA_CERTS.'
      );
    }
  }
  ```
- **Invocation Location**: Called unconditionally at startup in CLI entrypoint `src/index.ts:16`.
- **Certificate Integration**: Corporate root CA bundle is configured in `package.json` scripts (`NODE_EXTRA_CA_CERTS="${NODE_EXTRA_CA_CERTS:-$(pwd)/certs/zscaler.pem}"`). Physical certificate exists at `certs/zscaler.pem` (1,732 bytes).
- **Architectural Boundary Observation**: `assertTlsSafety()` is NOT invoked in `src/container.ts` (`buildApp()`) or `src/presentation/api/server.ts` (`AppServer`). Programmatic server invocations bypass this assertion if not starting through `src/index.ts`.

### 1.4 Secret Scrubbing Architecture (`Logger.ts`)
- **File**: `src/infrastructure/logging/logger.ts`
- **Masking Scope**: Registers plaintext PAT, GitHub tokens, and API auth tokens via `logger.registerSecret(secret)` (lines 28–45).
- **Derived Encodings**: Automatically registers `token ${trimmed}`, `Bearer ${trimmed}`, Base64 of token (`Buffer.from(trimmed).toString('base64')`), Base64 with leading colon (`Buffer.from(:${trimmed}).toString('base64')`), and Base64 with admin user (`Buffer.from(admin:${trimmed}).toString('base64')`).
- **Sorting**: Sorts registered secrets descending by length (`b.length - a.length`) to prevent partial replacement.
- **Sinks**: Scrubs across `console.log`, `console.warn`, `console.error`, unformatted CLI output (`raw()`), in-memory ring buffer of 500 entries (`recentLogs`), and the Server-Sent Events live stream (`/api/logs/stream`).
- **Dynamic Updates**: `src/presentation/api/routes.ts` lines 144 and 156 immediately call `logger.registerSecret()` upon saving updated GitHub tokens or Azure PATs via settings.
- **Boundary Weakness**: Scrubbing is exact-string-match only. Un-registered bearer tokens or unexpected token formats (such as fine-grained GitHub tokens or third-party auth errors echoing headers) are not matched by general regex. Furthermore, newly registered secrets are not applied retroactively to already-buffered entries in `recentLogs`.

### 1.5 RBAC, Anti-CSRF & Ingress Protection
- **Role-Based Access Control (`server.ts` & `routes.ts`)**:
  - Implements HTTP Basic Auth in `server.ts:23-56`.
  - Constant-time secret comparison: Uses `crypto.timingSafeEqual` with candidate buffer length check.
  - Production enforcement: If `NODE_ENV === 'production'`, `API_AUTH_TOKEN` is mandatory; server refuses to boot without it (lines 90–92).
  - Role differentiation:
    - `operator`: Full read/write access.
    - `viewer`: Read-only access. Allowed HTTP methods: `GET`, `HEAD`, `OPTIONS`. Allowed `POST` routes: exclusively `/api/tasks/plan` and `/api/tasks/close-today` with `dryRun: true`.
    - Any other `POST`, `PUT`, `PATCH`, `DELETE` from a viewer returns `403 Forbidden` (`server.ts:47` and `routes.ts:276-280`).
  - Surfaced to UI: `GET /api/session` returns `{ role: 'viewer' | 'operator' }`.
- **Anti-CSRF & Origin Guard (`request-origin.ts`)**:
  - `unsafeRequestOriginGuard` intercepts all mutating methods (`POST`, `PUT`, `PATCH`, `DELETE`) targeting `/api/*`.
  - Evaluates Fetch Metadata `Sec-Fetch-Site`: Rejects `cross-site` (unless matching `CORS_ORIGIN`), rejects unknown values, and rejects `same-site` without origin.
  - Evaluates `Origin`: Requires exact match against `publicOrigin` or `${req.protocol}://${req.get('host')}` or `allowedOrigin`.
  - Normal CLI / headless requests without browser metadata pass through.
- **Ingress Binding (`server.ts:150-178`)**:
  - Defaults `LISTEN_HOST` to loopback `127.0.0.1`.
  - Validates `listenHost === 'localhost' || isIP(listenHost) !== 0`. Rejects arbitrary hostnames.
  - Port collision handling: In production, fails immediately on `EADDRINUSE` rather than auto-incrementing ports.
  - Strict Security Headers: Emits `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy`, and strict `Content-Security-Policy`.

### 1.6 Strict Zero-Mutation Guardrails
- **GitHub Client (`github-client.ts`)**: Implements exclusively HTTP GET requests (`/search/users`, `/search/commits`, `/search/issues`, `/repos/*`, `/pulls/*`). No mutating HTTP verbs exist in the client.
- **Azure DevOps Client (`azure/client.ts`)**:
  - Non-replayable writes: Lines 77–78 identify `replaySafe = method === 'GET' || (method === 'POST' && /\/_apis\/wit\/wiql/i.test(path))`.
  - Write isolation: When `!replaySafe`, any HTTP 429, HTTP 500+, or network/timeout failure throws `AzureClientError` with `retryable: false` (lines 114–116, 130–132, 182–184), completely preventing duplicate remote task creation.
  - Plan / Dry-Run isolation: `CreateTasksUseCase` (line 227) and `CloseDailyTasksUseCase` (line 306) branch on `dryRun === true` before executing any Azure mutations, returning simulated plans without touching remote work items.
  - Confirmation requirement: Mutating API endpoints require explicit `confirm: true` in the JSON request body.
  - Read-back verification: After work item creation or closure, reads back Azure work items to verify field states and links before writing `verified: true` to the local journal.

### 1.7 Web SPA Interface (`src/presentation/web/public/`)
- **Architecture**:
  - Dependency-free vanilla JavaScript (ESM) controller in `app.js` (3,016 lines, 117KB).
  - 10 functional views: `dashboard`, `mywork`, `explorer`, `burndown`, `planner`, `people`, `journal`, `scheduler`, `logs`, `settings`.
  - 6 modal overlays: `dateInspectModal`, `userInspectModal`, `confirmModal`, `personModal`, `adHocModal`, `eodModal`.
  - 1 slide-out execution console drawer: `#executionDrawer` (`.drawer`).
  - SWR Client Cache: `api.get()` implements Stale-While-Revalidate caching with per-key `AbortController` cancellation for responsive navigation.
  - Viewer Mode Fail-Closed: `applyViewerMode()` disables 15 mutation buttons and renders a top warning notification. If `GET /api/session` fails, defaults to read-only viewer mode.
- **Accessibility & Design System (`styles.css`, `index.html`)**:
  - Keyboard navigation: Full tab order, modal focus trap (`trapModalFocus`), skip-to-content link, `:focus-visible` with 3px `--focus-ring`.
  - Screen reader announcements: Dynamic `#viewStatus` element with `role="status"` and `aria-live="polite"`.
  - Responsive layout: Grid/Flexbox breakpoints at 1100px, 860px (mobile off-canvas sidebar with backdrop), and 600px; respects `prefers-reduced-motion`.
- **Live Logging**:
  - Server-Sent Events via `EventSource('/api/logs/stream')`.
  - Replays initial 100 historical entries; listens to real-time `logger` events.
  - Console drawer automatically opens when task execution begins (`openConsoleDrawer()`).

---

## 2. Logic Chain

```
[Observation 1.1: FileLockRepository unlinks before writeExclusive()]
  ──> If Process A and Process B concurrently detect stale PID
  ──> Process A unlinks and creates lock with flag 'wx'
  ──> Process B (having checked staleness prior to A's unlink) unlinks Process A's live lock
  ──> Process B creates lock with flag 'wx'
  ──> CONCLUSION: Single-host stale reclamation contains a TOCTOU race condition.

[Observation 1.1: getLockInfo() returns null on corrupt JSON; acquire() checks !existing?.stale]
  ──> If a crash or power cut leaves a 0-byte or truncated .execution-lock.json
  ──> getLockInfo() returns null
  ──> !null?.stale is true; acquire() returns false
  ──> isLocked() returns true
  ──> CONCLUSION: The system permanently wedges into a locked state on corrupted lock files.

[Observation 1.1: RepairRelationsUseCase does not accept or acquire LockRepository]
  ──> POST /api/tasks/repair can execute concurrently with CLI create/close or web create
  ──> Both processes modify Azure work item relations and update the local journal
  ──> CONCLUSION: Operational concurrency safety boundary is missing for relation repair workflows.

[Observation 1.3: assertTlsSafety() is called only in src/index.ts, not in container.ts]
  ──> Programmatic initialization via buildApp() in tests or embedded runners bypasses assertTlsSafety()
  ──> CONCLUSION: TLS safety assertions lack defense-in-depth across application entry points.

[Observation 1.4: Logger secret scrubbing relies on exact string equality]
  ──> Any token not registered via registerSecret (e.g. ad-hoc tokens or URL parameters) is not scrubbed
  ──> CONCLUSION: Pattern-based regex scrubbing is needed to supplement exact token scrubbing.

[Observation 1.7: SSE log listener unconditionally executes scrollTop = scrollHeight]
  ──> While tasks are executing, incoming log events stream continuously
  ──> An operator attempting to scroll up to inspect a stack trace or warning is repeatedly yanked to the bottom
  ──> Neither view-logs nor executionDrawer provides level filtering, text search, or pause controls
  ──> CONCLUSION: Live logging UI suffers from usability friction during high-frequency execution.

[Observation 1.7: index.html:814 text vs close-daily-tasks.ts:289]
  ──> UI modal text promises "Completed work is set to 8h and Remaining work to 0h"
  ──> Actual backend code preserves existing recorded work hours and does not fabricate 8h
  ──> CONCLUSION: UI copy creates misleading operational expectations regarding Azure work tracking.
```

---

## 3. Caveats
1. **Single-Host Limitation**: `FileLockRepository` is explicitly documented as a single-host lock utilizing local PID inspection (`process.kill(pid, 0)`). In a multi-container or clustered deployment (e.g. Kubernetes with multiple replicas), local PID checks are invalid across container boundaries; a distributed lock (e.g. Redis, Azure Blob lease, or database lock) would be required.
2. **PID Reuse in Long-Lived OS**: On operating systems where process IDs cycle, a dead process PID could theoretically be reassigned to an unrelated system daemon. In such cases, `isProcessAlive` would evaluate to `true`, preventing automatic reclamation until that unrelated process exits.
3. **External CA Installation**: Corporate proxy inspection (Zscaler) relies on the presence of `certs/zscaler.pem`. If that file is missing in an unmanaged environment, Node.js network calls to Azure DevOps or GitHub will fail with certificate trust errors unless `NODE_EXTRA_CA_CERTS` is explicitly directed to the host OS trust store.

---

## 4. Conclusion

The 3in1 Task Studio exhibits a mature, defense-in-depth architecture with rigorous security boundaries:
- **Zero-Mutation Integrity**: GitHub is strictly read-only. Azure DevOps mutations are isolated behind mandatory confirmation flags, dry-run simulations, non-replayable error boundaries, and post-write read-back verifications.
- **Durability & Secret Hygiene**: Config and audit journals use exemplary `.tmp` + `0o600` + `fsync` + rename patterns. Secret scrubbing redacts credentials across all console, buffer, and SSE log sinks.
- **Access & Origin Guardrails**: Production startup enforces constant-time HTTP Basic Auth with strict role separation (`operator` vs read-only `viewer`), CSRF Origin / Sec-Fetch-Site validation, and loopback ingress binding.
- **Web SPA Quality**: A clean, accessible, dependency-free vanilla SPA with responsive layouts, modal focus trapping, SWR caching, and fail-closed viewer restrictions.

### Actionable Enhancement Proposals

| # | Domain | Priority | Issue Description | Proposed Remediation |
|---|--------|----------|-------------------|----------------------|
| 1 | Operational Safety | High | `FileLockRepository` wedges permanently on 0-byte or corrupt lock file. | In `getLockInfo()`, if the file exists but JSON parsing fails, inspect file age (`fs.statSync`). If older than 60 seconds and size is 0 or invalid JSON, treat as stale/corrupted and allow reclamation. |
| 2 | Operational Safety | High | Concurrency lock missing from `RepairRelationsUseCase`. | Inject `LockRepository` into `RepairRelationsUseCase` and acquire lock before repairing relations. |
| 3 | Operational Safety | Medium | Stale lock reclamation TOCTOU race in `FileLockRepository`. | Use atomic file rename / swap or advisory file locking (`fs-ext` flock) to eliminate the gap between stale check and `writeExclusive`. |
| 4 | Security Guardrails | Medium | `assertTlsSafety()` omitted in `src/container.ts`. | Add `assertTlsSafety()` at the start of `buildApp()` in `src/container.ts` for defense-in-depth across all entry points. |
| 5 | Security Guardrails | Medium | Secret scrubbing lacks pattern-based regex fallback. | Add standard regex patterns in `Logger.ts` for `Bearer [A-Za-z0-9_\-\.]+`, `ghp_[A-Za-z0-9]{36}`, `github_pat_[A-Za-z0-9_]{82}`, and Azure PAT formats. |
| 6 | Web SPA UI/UX | Medium | Live logs unconditionally snap scroll to bottom on every SSE event. | Implement "sticky scroll": only auto-scroll if the user is already within 30px of the bottom (`scrollHeight - scrollTop - clientHeight < 30`). |
| 7 | Web SPA UI/UX | Medium | No log level filtering or keyword search in UI. | Add a log toolbar in `view-logs` and `executionDrawer` with Level filter pills (`ALL`, `INFO`, `WARN`, `ERROR`), search input, and "Clear" button. |
| 8 | Web SPA UI/UX | Low | Contradictory text in EOD Modal (`index.html:814`). | Update informational callout in `eodModal` to reflect that existing recorded hours are preserved rather than replaced with 8h. |
| 9 | Web SPA UI/UX | Low | Fixed 4s toast timeout for error notifications. | Allow toasts of type `'err'` to persist for 8–10 seconds with a close `✕` button to ensure operators have time to read complex error messages. |

---

## 5. Verification Method

To independently verify all observations and test suites:

1. **Verify Static Health & Test Suites**:
   Run the full diagnostic suite in `new-app/`:
   ```bash
   cd "/Users/yashsomani/Desktop/Asure Bord Project/new-app"
   npm run typecheck
   npm run lint
   npm test
   ```
   *Expected Result*: Clean typecheck (`tsc --noEmit`), clean linting (ESLint 10), and all 32 test suites (353 tests) passing with zero failures.

2. **Verify Security Access Controls**:
   Inspect and run the dedicated security integration test:
   ```bash
   npx vitest run tests/integration/server-security.test.ts
   ```
   *Expected Result*: Verifies production auth enforcement, viewer read-only restrictions, port collision failures, CSRF origin rejection, and CSP headers.

3. **Verify Concurrency Lock Stale Behavior**:
   Run the repository unit test suite:
   ```bash
   npx vitest run tests/unit/repositories.test.ts
   ```
   *Expected Result*: Verifies `FileLockRepository` dead PID reclamation and refusal to reclaim unparseable lock files without ownership evidence.

4. **Verify UI Shell & Accessibility Contracts**:
   ```bash
   npx vitest run tests/integration/ui-shell.test.ts
   ```
   *Expected Result*: Verifies all 10 views, accessible status elements, modal focus trapping, and safe navigation contracts.

5. **Verify Zero-Mutation Mode in GitHub & Azure Clients**:
   - Inspect `src/infrastructure/github/github-client.ts`: Confirm absence of any `POST`, `PUT`, `PATCH`, or `DELETE` requests.
   - Inspect `src/infrastructure/azure/client.ts:75-78`: Confirm `replaySafe` flag isolates all write operations against automatic retries.
