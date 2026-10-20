# Investigation & Handoff Report: Milestone 3 — Operational Safety, Security Guardrails & Concurrency Hardening

**Explorer Agent**: Teamwork Explorer M3-1 (`teamwork_preview_explorer_m3_1`)  
**Target Codebase**: `/Users/yashsomani/Desktop/Asure Bord Project/new-app`  
**Date**: 2026-10-19T20:13:00Z  
**Parent Orchestrator ID**: `24358d22-854f-4308-b445-c598cac2e141`  
**Integrity Mode**: Read-Only Analysis & Architectural Formulation  

---

## 1. Observation

A comprehensive code-level inspection was conducted across the concurrency locking layer, container composition root, logging system, and associated test suites.

### 1.1 Concurrency Lock Architecture (`src/infrastructure/lock/file-lock-repo.ts`)
- **File Location**: `src/infrastructure/lock/file-lock-repo.ts` (109 lines).
- **Core Methods**:
  - `acquire(): boolean` (lines 25–62): Generates a random UUID `ownerToken`, prepares `OwnedLockInfo` (`{ pid: process.pid, acquiredAt: new Date().toISOString(), stale: false, ownerToken: token }`), attempts exclusive creation via `writeExclusive()` (`flag: 'wx'`). If that fails, calls `getLockInfo()`. If stale, attempts reclamation.
  - `release(): void` (lines 64–75): Reads `this.lockPath`, parses JSON, verifies `current.ownerToken === this.ownerToken && current.pid === process.pid`, and unlinks `this.lockPath`.
  - `isLocked(): boolean` (lines 77–82):
    ```typescript
    isLocked(): boolean {
      if (!fs.existsSync(this.lockPath)) return false;
      const info = this.getLockInfo();
      // Fail closed when metadata is malformed.
      return info === null || !info.stale;
    }
    ```
  - `getLockInfo(): LockInfo | null` (lines 84–97):
    ```typescript
    getLockInfo(): LockInfo | null {
      if (!fs.existsSync(this.lockPath)) return null;
      try {
        const value: unknown = JSON.parse(fs.readFileSync(this.lockPath, 'utf-8'));
        if (!value || typeof value !== 'object') return null;
        const info = value as OwnedLockInfo;
        if (!Number.isSafeInteger(info.pid) || info.pid <= 0 ||
            typeof info.acquiredAt !== 'string' ||
            !Number.isFinite(new Date(info.acquiredAt).getTime())) return null;
        return { ...info, stale: !this.isProcessAlive(info.pid) };
      } catch {
        return null;
      }
    }
    ```
- **Observed Defect 1: Fail-Closed Permanent Wedging on Corrupt / 0-Byte Lock**:
  - When `.execution-lock.json` is a 0-byte file (e.g., from an interrupted write, power loss, or sudden crash) or contains invalid JSON (`{corrupt`), `JSON.parse` throws `SyntaxError`.
  - The `catch` block catches this error and returns `null`.
  - In `isLocked()`: `info === null` evaluates to `true`. The repository reports that the file is locked.
  - In `acquire()`: `writeExclusive()` throws `EEXIST` (file already exists on disk). Line 48 calls `existing = this.getLockInfo()`, which returns `null`. Line 49 checks `if (!existing?.stale) return false`. Because `existing` is `null`, `existing?.stale` is `undefined`, and `!undefined` evaluates to `true`. `acquire()` immediately returns `false`.
  - Because `release()` requires `ownerToken` and `pid` to match, and no live process owns this corrupted file, the lock is permanently wedged. Subsequent executions fail closed indefinitely until manual file removal.
- **Observed Defect 2: Time-of-Check to Time-of-Use (TOCTOU) Race Condition in Stale Reclamation**:
  - Lines 53–61 implement stale lock reclamation:
    ```typescript
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
  - If Process A and Process B both detect a stale lock from a dead PID:
    1. Process A checks `current?.stale` -> `true`.
    2. Process A executes `fs.unlinkSync(this.lockPath)` and then `writeExclusive()`.
    3. Process A successfully creates a brand-new live lock with Process A's PID and token.
    4. Process B evaluated `current?.stale` just prior to Process A's unlink, or before re-check. Process B then executes `fs.unlinkSync(this.lockPath)`.
    5. Process B's unlink unlinks Process A's brand-new live lock file!
    6. Process B calls `writeExclusive()` and creates Process B's lock.
    7. Result: Both Process A and Process B believe they hold exclusive execution locks concurrently.

### 1.2 Defense-in-Depth TLS Safety Enforcement (`src/container.ts`)
- **File Location**: `src/container.ts` (155 lines) & `src/infrastructure/security/tls-safety.ts` (15 lines).
- **Existing TLS Check**:
  ```typescript
  // src/infrastructure/security/tls-safety.ts:6-14
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
- **Observed Defect / Gap**:
  - `assertTlsSafety()` is called in `src/index.ts:16`, but is NOT called anywhere inside `buildApp()` in `src/container.ts`.
  - When `buildApp()` is invoked programmatically (in automated tests, integration runners, or alternative entry points), `assertTlsSafety()` is bypassed.
  - Furthermore, `buildApp()` loads an adjacent `.env` file at line 53 (`dotenv.config({ path: ... })`), which could inject `ALLOW_INSECURE_TLS=true` or `NODE_TLS_REJECT_UNAUTHORIZED=0` after `index.ts` has already performed its initial check.

### 1.3 Secret Scrubbing Architecture (`src/infrastructure/logging/logger.ts`)
- **File Location**: `src/infrastructure/logging/logger.ts` (111 lines).
- **Current Scrubbing Logic**:
  ```typescript
  registerSecret(secret: string): void {
    if (!secret) return;
    const trimmed = secret.trim();
    if (!trimmed) return;
    this.secrets.push(trimmed);
    this.secrets.push(`token ${trimmed}`);
    this.secrets.push(`Bearer ${trimmed}`);
    try {
      this.secrets.push(Buffer.from(trimmed).toString('base64'));
      this.secrets.push(Buffer.from(`:${trimmed}`).toString('base64'));
      this.secrets.push(Buffer.from(`admin:${trimmed}`).toString('base64'));
    } catch { }
    this.secrets.sort((a, b) => b.length - a.length);
  }

  private scrub(message: string): string {
    let out = message;
    for (const secret of this.secrets) {
      if (secret) out = out.split(secret).join('***');
    }
    return out;
  }
  ```
- **Observed Defect / Gap**:
  - Secret scrubbing is strictly exact-string-match based against `this.secrets`.
  - If a secret is echoed in an unexpected format, or if an ad-hoc token, bearer token, GitHub PAT, or Azure PAT appears in an API error body or exception message without having been explicitly registered via `registerSecret()`, it leaks directly to console, in-memory buffers (`recentLogs`), and SSE stream payloads (`/api/logs/stream`).
  - There is no pattern-based fallback for standard secret formats.
  - Newly registered secrets are not applied retroactively to already-buffered entries in `recentLogs`.

### 1.4 Test Suites & Baseline Health
- Existing test suites executed:
  - `npm run typecheck` passed (0 errors).
  - `npm run typecheck:tests` passed (0 errors).
  - `npm run lint` passed (0 warnings, 0 errors).
  - `npm test` passed: 36 test files, 468 tests passed, 0 failures.
- Dedicated test suites inspected:
  - `tests/unit/repositories.test.ts`: Covers `FileLockRepository`, `FileJournalRepository`, `FileConfigRepository`, `NodeSchedulerRepository`. Contains test line 64: `"does not reclaim a malformed lock file without ownership evidence"`.
  - `tests/unit/logger.test.ts`: Only 1 test (`"redacts secrets even in raw console output"`).
  - `tests/integration/server-security.test.ts`: Covers production auth, viewer role restrictions, port collision, CSP headers, and CSRF protection. Does not currently test `buildApp()` TLS safety checks.

---

## 2. Logic Chain

### 2.1 Logic Chain for Corrupted / 0-Byte Lock Recovery
```
1. [Observation 1.1] getLockInfo() returns null on SyntaxError or invalid structure.
2. [Observation 1.1] isLocked() returns true when getLockInfo() returns null (fail-closed).
3. [Observation 1.1] acquire() returns false when getLockInfo() returns null.
4. --> INFERENCE: Any corrupted or 0-byte lock file permanently wedges the system.
5. [Observation 1.1] A 0-byte file cannot represent an active, healthy process lock.
6. [Observation 1.1] A freshly corrupted file (<60s) might belong to an active write in flight.
7. --> INFERENCE: Inspecting file metadata via fs.statSync():
   - If stat.size === 0: immediately mark as stale (stale: true).
   - If stat.size > 0 and JSON parse fails / fields malformed:
     Check age = Date.now() - stat.mtimeMs.
     If age >= 60_000 ms: mark as stale (stale: true).
     If age < 60_000 ms: mark as not stale (stale: false, preserving fail-closed safety for 60s).
8. --> CONCLUSION: Returning { pid: 0, acquiredAt: new Date(stat.mtimeMs).toISOString(), stale: isStale }
   allows acquire() to reclaim stale/corrupted files while isLocked() accurately reflects
   lock availability. Existing test line 64 (fresh malformed lock <60s) continues to pass.
```

### 2.2 Logic Chain for Stale Lock Reclamation TOCTOU Race Mitigation
```
1. [Observation 1.1] Current reclamation checks staleness, unlinks this.lockPath, then calls writeExclusive().
2. [Observation 1.1] Between the check and unlinkSync, or between unlinkSync and writeExclusive, another process can run.
3. [Observation 1.1] If Process B unlinks this.lockPath after Process A has written a new live lock, Process A's lock is destroyed.
4. --> INFERENCE: Direct unlinking of this.lockPath is the root cause of the race condition.
5. In POSIX/Node.js, fs.renameSync(src, dst) in the same directory is an atomic filesystem operation.
6. If two processes attempt to rename this.lockPath to their own unique ephemeral paths:
   - Exactly one process will succeed in fs.renameSync(this.lockPath, reclaimTemp).
   - The second process will immediately receive ENOENT and fail cleanly (return false).
7. The winning process inspects the moved file (reclaimTemp) to verify that it is indeed the expected stale lock.
8. If verified, the winning process unlinks its private reclaimTemp and executes writeExclusive().
9. If unverified (e.g. state changed unexpectedly), it restores the file or aborts.
10. --> CONCLUSION: Atomic rename completely eliminates the TOCTOU race condition. No process can ever unlink a concurrent process's newly acquired lock.
```

### 2.3 Logic Chain for Defense-in-Depth TLS Safety in `src/container.ts`
```
1. [Observation 1.2] assertTlsSafety() is called only in src/index.ts, not in src/container.ts.
2. [Observation 1.2] Any code importing buildApp() directly bypasses index.ts.
3. [Observation 1.2] buildApp() loads .env adjacent to configFilePath at runtime.
4. --> INFERENCE: Insecure TLS flags could be introduced via .env or ambient environment in embedded runners.
5. --> CONCLUSION: Invoking assertTlsSafety() at the beginning of buildApp() (immediately after dotenv loading)
   enforces strict TLS safety across all application instantiations.
```

### 2.4 Logic Chain for Pattern-Based Secret Scrubbing in `src/infrastructure/logging/logger.ts`
```
1. [Observation 1.3] Logger secret scrubbing only redacts strings registered via registerSecret().
2. [Observation 1.3] External API error bodies, stack traces, and unhandled exceptions can echo Bearer tokens, GitHub PATs, and Azure PATs that were never registered.
3. --> INFERENCE: Exact-match scrubbing must be augmented with deterministic regex patterns matching standard token shapes:
   - Bearer tokens: /\bBearer\s+[A-Za-z0-9_\-.]+/gi -> Bearer ***
   - GitHub classic PAT: /\bghp_[A-Za-z0-9]{36}\b/g -> ***
   - GitHub fine-grained PAT: /\bgithub_pat_[A-Za-z0-9_]{82}\b/g -> ***
   - Azure Basic auth header: /\bBasic\s+[A-Za-z0-9+/=]{10,}/gi -> Basic ***
   - Azure DevOps PAT (52-char base32): /\b[a-z2-7]{52}\b/gi -> ***
   - Azure DevOps PAT (52-char alphanumeric): /\b[A-Za-z0-9]{52}\b/g -> ***
4. --> INFERENCE: Placing regex replacement inside scrub() automatically guarantees scrubbing across:
   - console.log, console.warn, console.error
   - logger.raw()
   - in-memory buffer (recentLogs)
   - Server-Sent Events stream (/api/logs/stream)
5. Adding retroactive scrubbing in registerSecret() cleans any pre-existing buffer entries upon new token registration.
```

---

## 3. Caveats

1. **Single-Host Concurrency Scope**: `FileLockRepository` uses local process PID checks (`process.kill(pid, 0)`). In a clustered or containerized multi-host deployment (e.g. multi-replica Kubernetes pod), PID checks are not valid across container boundaries. A shared distributed coordination store (Redis, Azure Blob lease, or database row lock) is required for multi-host deployments.
2. **Clock Skew / System Time Manipulation**: The 60-second corruption age threshold relies on `stat.mtimeMs` compared to `Date.now()`. Significant backward system clock adjustments could delay corrupt lock reclamation until the clock catches up.
3. **52-Character Alphanumeric Pattern Matching**: A generic 52-character alphanumeric regex `/\b[A-Za-z0-9]{52}\b/g` could theoretically match an arbitrary 52-character hash. However, standard SHA-1 is 40 hex characters, SHA-256 is 64 hex characters, MD5 is 32 hex characters, and UUIDs are 36 characters with hyphens. 52 characters specifically matches Azure DevOps PAT token architecture without colliding with common checksums.

---

## 4. Conclusion & Concrete Implementation Specifications

### 4.1 Specification 1: `src/infrastructure/lock/file-lock-repo.ts`

Replace `FileLockRepository` implementation with the following hardened logic:

```typescript
/**
 * Single-host exclusive file lock.
 * A live owner never expires by elapsed time alone. A release from another
 * instance cannot remove the owner's lock.
 *
 * Not a distributed lock: use shared coordination for multi-host deployments.
 */
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'node:crypto';
import { LockRepository, LockInfo } from '../../domain/ports/repositories.js';

type OwnedLockInfo = LockInfo & { ownerToken?: string };

export class FileLockRepository implements LockRepository {
  private readonly lockPath: string;
  private ownerToken: string | null = null;

  constructor(lockPath?: string) {
    this.lockPath = lockPath
      ? path.resolve(process.cwd(), lockPath)
      : path.resolve(process.cwd(), '.execution-lock.json');
  }

  acquire(): boolean {
    if (this.ownerToken) return false;
    const token = randomUUID();
    const info: OwnedLockInfo = {
      pid: process.pid,
      acquiredAt: new Date().toISOString(),
      stale: false,
      ownerToken: token,
    };

    const writeExclusive = (): boolean => {
      try {
        fs.writeFileSync(this.lockPath, JSON.stringify(info, null, 2), { encoding: 'utf-8', flag: 'wx' });
        this.ownerToken = token;
        return true;
      } catch {
        return false;
      }
    };

    if (writeExclusive()) return true;

    const existing = this.getLockInfo();
    if (!existing?.stale) return false;

    // Best-effort single-host stale reclamation with TOCTOU race mitigation.
    // Atomically move the suspected stale lock out of the way before removing it.
    // If another process already moved, reclaimed, or removed it, renameSync throws ENOENT.
    const reclaimTemp = `${this.lockPath}.${process.pid}.${randomUUID()}.stale`;
    try {
      fs.renameSync(this.lockPath, reclaimTemp);
    } catch {
      return false;
    }

    try {
      const moved = this.readLockInfo(reclaimTemp);
      if (!moved?.stale || moved.pid !== existing.pid || moved.acquiredAt !== existing.acquiredAt) {
        // State changed between check and rename; attempt restoration
        try {
          fs.renameSync(reclaimTemp, this.lockPath);
        } catch {
          try { fs.unlinkSync(reclaimTemp); } catch {}
        }
        return false;
      }
      fs.unlinkSync(reclaimTemp);
      return writeExclusive();
    } catch {
      try { fs.unlinkSync(reclaimTemp); } catch {}
      return false;
    }
  }

  release(): void {
    if (!this.ownerToken) return;
    try {
      const current = JSON.parse(fs.readFileSync(this.lockPath, 'utf-8')) as OwnedLockInfo;
      if (current.ownerToken !== this.ownerToken || current.pid !== process.pid) return;
      fs.unlinkSync(this.lockPath);
    } catch {
      // A disappeared/replaced lock is not ours to remove.
    } finally {
      this.ownerToken = null;
    }
  }

  isLocked(): boolean {
    if (!fs.existsSync(this.lockPath)) return false;
    const info = this.getLockInfo();
    // Fail closed when metadata is malformed and not yet stale.
    return info === null || !info.stale;
  }

  getLockInfo(): LockInfo | null {
    return this.readLockInfo(this.lockPath);
  }

  private readLockInfo(targetPath: string): LockInfo | null {
    if (!fs.existsSync(targetPath)) return null;
    let stat: fs.Stats;
    try {
      stat = fs.statSync(targetPath);
    } catch {
      return null;
    }

    // 0-byte lock files are immediately considered stale
    if (stat.size === 0) {
      return {
        pid: 0,
        acquiredAt: new Date(stat.mtimeMs).toISOString(),
        stale: true,
      };
    }

    try {
      const content = fs.readFileSync(targetPath, 'utf-8');
      const value: unknown = JSON.parse(content);
      if (value && typeof value === 'object') {
        const info = value as OwnedLockInfo;
        if (Number.isSafeInteger(info.pid) && info.pid > 0 &&
            typeof info.acquiredAt === 'string' &&
            Number.isFinite(new Date(info.acquiredAt).getTime())) {
          return { ...info, stale: !this.isProcessAlive(info.pid) };
        }
      }
    } catch {
      // JSON parse error or read failure: fall through to age-based corruption check
    }

    // Unparseable / corrupted lock: allow reclamation if older than 60 seconds
    const ageMs = Date.now() - stat.mtimeMs;
    return {
      pid: 0,
      acquiredAt: new Date(stat.mtimeMs).toISOString(),
      stale: ageMs >= 60_000,
    };
  }

  private isProcessAlive(pid: number): boolean {
    try {
      process.kill(pid, 0);
      return true;
    } catch (error: unknown) {
      // EPERM means that a process exists but is not visible to our user.
      return (error as NodeJS.ErrnoException)?.code === 'EPERM';
    }
  }
}
```

### 4.2 Specification 2: `src/container.ts`

Import and invoke `assertTlsSafety()` at the start of `buildApp()`:

```typescript
// Add import at src/container.ts:25
import { assertTlsSafety } from './infrastructure/security/tls-safety.js';

// Inside buildApp() at src/container.ts:48-56:
export async function buildApp(
  configFilePath?: string,
  options: { autoStartScheduler?: boolean } = {}
): Promise<App> {
  // A user-supplied --config may live outside the current working directory.
  // Load its adjacent .env before constructing clients, while preserving
  // explicitly injected deployment environment variables.
  if (configFilePath) {
    const resolved = path.resolve(process.cwd(), configFilePath);
    dotenv.config({ path: path.join(path.dirname(resolved), '.env'), override: false, quiet: true });
  }

  // Defense-in-depth: enforce strict TLS safety regardless of invocation pathway
  assertTlsSafety();

  const configRepo = new FileConfigRepository(configFilePath);
  const config = await configRepo.load();
  ...
```

### 4.3 Specification 3: `src/infrastructure/logging/logger.ts`

Augment `Logger` with regex pattern scrubbing, public `sanitize()`/`mask()` helpers, and buffer re-scrubbing:

```typescript
export class Logger {
  private verbose = false;
  private secrets: string[] = [];
  private recentLogs: LogEntry[] = [];
  private listeners: Set<LogListener> = new Set();
  private readonly maxRecent = 500;

  setVerbose(verbose: boolean): void {
    this.verbose = verbose;
  }

  registerSecret(secret: string): void {
    if (!secret) return;
    const trimmed = secret.trim();
    if (!trimmed) return;
    this.secrets.push(trimmed);
    this.secrets.push(`token ${trimmed}`);
    this.secrets.push(`Bearer ${trimmed}`);
    // Also scrub base64 encodings (used in auth headers)
    try {
      this.secrets.push(Buffer.from(trimmed).toString('base64'));
      this.secrets.push(Buffer.from(`:${trimmed}`).toString('base64'));
      this.secrets.push(Buffer.from(`admin:${trimmed}`).toString('base64'));
    } catch {
      // ignore
    }
    // Sort longer patterns first to prevent partial token scrubbing
    this.secrets.sort((a, b) => b.length - a.length);

    // Retroactively scrub existing in-memory buffer
    for (const entry of this.recentLogs) {
      entry.message = this.scrub(entry.message);
    }
  }

  sanitize(message: string): string {
    return this.scrub(message);
  }

  mask(secret: string): string {
    if (!secret) return '';
    return this.scrub(secret);
  }

  private scrub(message: string): string {
    let out = message;

    // 1. Exact-match registered secrets (including base64 encodings)
    for (const secret of this.secrets) {
      if (secret) out = out.split(secret).join('***');
    }

    // 2. Pattern-based regex scrubbing for standard credentials and authorization headers
    // Bearer tokens
    out = out.replace(/\bBearer\s+[A-Za-z0-9_\-.]+/gi, 'Bearer ***');

    // HTTP Basic Authorization headers (e.g. Azure DevOps base64 PAT credentials)
    out = out.replace(/\bBasic\s+[A-Za-z0-9+/=]{10,}/gi, 'Basic ***');

    // GitHub classic Personal Access Tokens (ghp_ prefix + 36 alphanumeric characters)
    out = out.replace(/\bghp_[A-Za-z0-9]{36}\b/g, '***');

    // GitHub fine-grained Personal Access Tokens (github_pat_ prefix + 82 chars)
    out = out.replace(/\bgithub_pat_[A-Za-z0-9_]{82}\b/g, '***');

    // Azure DevOps Personal Access Tokens (standard 52-char base32 / alphanumeric format)
    out = out.replace(/\b[a-z2-7]{52}\b/gi, '***');
    out = out.replace(/\b[A-Za-z0-9]{52}\b/g, '***');

    return out;
  }
...
```

### 4.4 Specification 4: Automated Test Additions

#### 4.4.1 `tests/unit/repositories.test.ts`
Add test cases to `describe('FileLockRepository', ...)`:
```typescript
  it('reclaims a 0-byte lock file immediately as stale', () => {
    const filename = path.join(dir, '.lock.json');
    fs.writeFileSync(filename, '');
    const lock = new FileLockRepository(filename);
    expect(lock.isLocked()).toBe(false);
    expect(lock.getLockInfo()?.stale).toBe(true);
    expect(lock.acquire()).toBe(true);
    expect(lock.isLocked()).toBe(true);
  });

  it('reclaims a corrupted lock file older than 60 seconds', () => {
    const filename = path.join(dir, '.lock.json');
    fs.writeFileSync(filename, '{"corrupted": true, incomplete');
    const past = new Date(Date.now() - 65_000);
    fs.utimesSync(filename, past, past);
    const lock = new FileLockRepository(filename);
    expect(lock.isLocked()).toBe(false);
    expect(lock.getLockInfo()?.stale).toBe(true);
    expect(lock.acquire()).toBe(true);
    expect(lock.isLocked()).toBe(true);
  });

  it('does not reclaim a corrupted lock file newer than 60 seconds (fails closed)', () => {
    const filename = path.join(dir, '.lock.json');
    fs.writeFileSync(filename, '{"corrupted": true, incomplete');
    const lock = new FileLockRepository(filename);
    expect(lock.isLocked()).toBe(true);
    expect(lock.getLockInfo()?.stale).toBe(false);
    expect(lock.acquire()).toBe(false);
  });

  it('handles concurrent stale reclamation without unlinking active locks (TOCTOU mitigation)', () => {
    const filename = path.join(dir, '.lock.json');
    fs.writeFileSync(filename, JSON.stringify({
      pid: 999999,
      acquiredAt: new Date(Date.now() - 100_000).toISOString(),
      stale: true,
    }));
    const lockA = new FileLockRepository(filename);
    const lockB = new FileLockRepository(filename);
    
    // Both observe stale
    expect(lockA.getLockInfo()?.stale).toBe(true);
    expect(lockB.getLockInfo()?.stale).toBe(true);

    // Lock A acquires successfully
    expect(lockA.acquire()).toBe(true);

    // Lock B must NOT overwrite or destroy Lock A's acquired lock
    expect(lockB.acquire()).toBe(false);
    expect(lockA.isLocked()).toBe(true);
  });
```

#### 4.4.2 `tests/unit/logger.test.ts`
Expand `describe('Logger secret scrubbing', ...)`:
```typescript
  it('redacts unregistered Bearer tokens via regex pattern', () => {
    const msg = 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.t-IDmLeq';
    expect(logger.sanitize(msg)).toBe('Authorization: Bearer ***');
  });

  it('redacts unregistered GitHub classic PATs (ghp_)', () => {
    const token = 'ghp_' + 'A'.repeat(36);
    const msg = `API call failed with token ${token} on repo`;
    expect(logger.sanitize(msg)).toBe('API call failed with token *** on repo');
  });

  it('redacts unregistered GitHub fine-grained PATs (github_pat_)', () => {
    const token = 'github_pat_' + '1'.repeat(82);
    const msg = `Remote URL: https://${token}@github.com/org/repo.git`;
    expect(logger.sanitize(msg)).toBe('Remote URL: https://***@github.com/org/repo.git');
  });

  it('redacts unregistered Azure DevOps PATs (52-char base32/alphanumeric)', () => {
    const pat = '4abcdefghijklmnopqrstuvwxyz234567abcdefghijklmnopqr';
    expect(pat.length).toBe(52);
    const msg = `Connected with Azure PAT ${pat} successfully`;
    expect(logger.sanitize(msg)).toBe('Connected with Azure PAT *** successfully');
  });

  it('redacts unregistered HTTP Basic Authorization headers (Azure DevOps PAT base64)', () => {
    const header = 'Authorization: Basic OjUyY2hhcmFjdGVycGF0ZXhhbXBsZXRva2VuZm9yYXp1cmVkZXZvcHM=';
    expect(logger.sanitize(header)).toBe('Authorization: Basic ***');
  });

  it('scrubs regex credentials across in-memory buffer and listeners', () => {
    const pat = 'ghp_' + 'B'.repeat(36);
    let captured: string | undefined;
    const unsub = logger.addListener(entry => { captured = entry.message; });
    try {
      logger.info(`Token emitted: ${pat}`);
      expect(captured).toBe('Token emitted: ***');
      const recent = logger.getRecentLogs(1);
      expect(recent[0].message).toBe('Token emitted: ***');
    } finally {
      unsub();
    }
  });
```

#### 4.4.3 `tests/integration/server-security.test.ts`
Add integration test block:
```typescript
describe('Defense-in-depth TLS safety assertions in buildApp()', () => {
  it('rejects buildApp() initialization when ALLOW_INSECURE_TLS is true', async () => {
    vi.stubEnv('ALLOW_INSECURE_TLS', 'true');
    await expect(buildApp()).rejects.toThrow(/TLS certificate verification must remain enabled/);
  });

  it('rejects buildApp() initialization when NODE_TLS_REJECT_UNAUTHORIZED is 0', async () => {
    vi.stubEnv('NODE_TLS_REJECT_UNAUTHORIZED', '0');
    await expect(buildApp()).rejects.toThrow(/TLS certificate verification must remain enabled/);
  });
});
```

---

## 5. Verification Method

To independently verify the proposed changes after implementation:

1. **Verify Static Health & Test Type Safety**:
   ```bash
   cd "/Users/yashsomani/Desktop/Asure Bord Project/new-app"
   npm run typecheck
   npm run typecheck:tests
   npm run lint
   ```
   *Expected Result*: Zero type errors across `src/` and `tests/`, zero ESLint errors or warnings.

2. **Verify Concurrency Lock Hardening**:
   ```bash
   npx vitest run tests/unit/repositories.test.ts
   ```
   *Expected Result*: All tests pass, including 0-byte recovery, 60s corrupted recovery, <60s malformed fail-closed behavior, and concurrent stale race mitigation.

3. **Verify Pattern-Based Secret Scrubbing**:
   ```bash
   npx vitest run tests/unit/logger.test.ts
   ```
   *Expected Result*: All regex token patterns (Bearer, Basic, GitHub classic, GitHub fine-grained, Azure 52-char PAT) are sanitized across console, buffers, and listeners.

4. **Verify Defense-in-Depth TLS Safety**:
   ```bash
   npx vitest run tests/integration/server-security.test.ts
   ```
   *Expected Result*: All server security tests pass, including the new `buildApp()` TLS rejection assertions for `ALLOW_INSECURE_TLS` and `NODE_TLS_REJECT_UNAUTHORIZED`.

5. **Full Regression & Build Gate**:
   ```bash
   npm test
   npm run build
   ```
   *Expected Result*: 100% test suites pass without regression; production build compiles cleanly.
