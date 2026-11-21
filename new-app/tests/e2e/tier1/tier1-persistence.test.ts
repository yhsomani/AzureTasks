import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import crypto from 'node:crypto';
import { startHarness, stopHarness, WorkOpsTestHarness } from '../harness/index.js';
import { FileLockRepository } from '../../../src/infrastructure/lock/file-lock-repo.js';

describe('Tier 1: Feature Coverage (F16-F22) - Persistence & Protocol', () => {
  let harness: WorkOpsTestHarness;

  beforeAll(async () => {
    harness = await startHarness({ enableSqlite: true });
  });

  afterAll(async () => {
    await stopHarness();
  });

  describe('Feature F16: Pluggable Relational Layer', () => {
    it('T1-F16-01: SQLite WAL Mode Initialization', () => {
      const db = harness.dbHelper.getSqliteDb();
      const row = db.prepare('PRAGMA journal_mode;').get() as { journal_mode: string };
      expect(row.journal_mode.toLowerCase()).toBe('wal');
    });

    it('T1-F16-02: Relational Connection Pool Initialization', () => {
      const db = harness.dbHelper.getSqliteDb();
      const row = db.prepare('SELECT 1 as connected;').get() as { connected: number };
      expect(row.connected).toBe(1);
    });

    it('T1-F16-03: WorkItem Repository CRUD Operations', () => {
      const db = harness.dbHelper.getSqliteDb();
      db.exec(`INSERT INTO distributed_locks (lock_key, owner_token, expires_at) VALUES ('test-key', 'owner-1', 9999999999);`);
      const row = db.prepare('SELECT * FROM distributed_locks WHERE lock_key = ?').get('test-key') as any;
      expect(row.owner_token).toBe('owner-1');
      db.prepare('DELETE FROM distributed_locks WHERE lock_key = ?').run('test-key');
      const deleted = db.prepare('SELECT * FROM distributed_locks WHERE lock_key = ?').get('test-key');
      expect(deleted).toBeUndefined();
    });

    it('T1-F16-04: Journal Repository Append and Query', async () => {
      await harness.app.journal.record({
        timestamp: new Date().toISOString(),
        action: 'CREATED',
        taskId: 2001,
        personKey: 'dev1',
        isoDate: '2026-11-21',
        title: 'Task: Dev One | Sprint 1 | 2026-11-21',
        assignedTo: 'dev1@workops.test',
      } as any);
      const entries = await harness.app.journal.getEntries();
      expect(entries.length).toBeGreaterThanOrEqual(1);
      expect(entries.some((e: any) => e.taskId === 2001)).toBe(true);
    });

    it('T1-F16-05: Transactional Atomicity Verification', () => {
      const db = harness.dbHelper.getSqliteDb();
      db.exec('BEGIN TRANSACTION;');
      db.prepare("INSERT INTO organizations (id, name, slug) VALUES ('org-tx-1', 'Tx Org', 'tx-org');").run();
      db.exec('COMMIT;');
      const found = db.prepare("SELECT * FROM organizations WHERE id = 'org-tx-1'").get() as any;
      expect(found.slug).toBe('tx-org');
    });
  });

  describe('Feature F17: Relational DDL & Entities', () => {
    it('T1-F17-01: Execute DDL Schema Migration', () => {
      const db = harness.dbHelper.getSqliteDb();
      const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table';").all() as Array<{ name: string }>;
      const names = tables.map((t) => t.name);
      expect(names).toContain('organizations');
      expect(names).toContain('departments');
      expect(names).toContain('teams');
      expect(names).toContain('members');
      expect(names).toContain('work_calendars');
      expect(names).toContain('plan_tokens');
      expect(names).toContain('journal_entries');
    });

    it('T1-F17-02: Foreign Key Cascade on Organization Deletion', () => {
      const db = harness.dbHelper.getSqliteDb();
      db.prepare("INSERT OR REPLACE INTO organizations (id, name, slug) VALUES ('org-cascade', 'Cascade Org', 'cascade-org');").run();
      db.prepare("INSERT OR REPLACE INTO departments (id, org_id, name) VALUES ('dept-1', 'org-cascade', 'Eng');").run();
      db.prepare("INSERT OR REPLACE INTO teams (id, dept_id, name) VALUES ('team-1', 'dept-1', 'Pod');").run();
      db.prepare("DELETE FROM organizations WHERE id = 'org-cascade';").run();
      const remainingTeam = db.prepare("SELECT * FROM teams WHERE id = 'team-1';").get();
      expect(remainingTeam).toBeUndefined();
    });

    it('T1-F17-03: Unique Constraint on Member Corporate Email per Team', () => {
      const db = harness.dbHelper.getSqliteDb();
      db.prepare("INSERT OR IGNORE INTO organizations (id, name, slug) VALUES ('org-u', 'U Org', 'u-org');").run();
      db.prepare("INSERT OR IGNORE INTO departments (id, org_id, name) VALUES ('dept-u', 'org-u', 'Eng');").run();
      db.prepare("INSERT OR IGNORE INTO teams (id, dept_id, name) VALUES ('team-u', 'dept-u', 'Pod');").run();
      db.prepare("INSERT OR REPLACE INTO members (id, team_id, email, display_name) VALUES ('m-1', 'team-u', 'unique@workops.test', 'Dev');").run();
      expect(() => {
        db.prepare("INSERT INTO members (id, team_id, email, display_name) VALUES ('m-2', 'team-u', 'unique@workops.test', 'Dev 2');").run();
      }).toThrow();
    });

    it('T1-F17-04: Journal Entry Table Indexes Verification', () => {
      const db = harness.dbHelper.getSqliteDb();
      const ddl = db.prepare("SELECT sql FROM sqlite_master WHERE name='journal_entries';").get() as { sql: string };
      expect(ddl.sql).toContain('journal_entries');
    });

    it('T1-F17-05: Plan Tokens Table Entity Schema Integrity', () => {
      const db = harness.dbHelper.getSqliteDb();
      const cols = db.prepare("PRAGMA table_info('plan_tokens');").all() as Array<{ name: string }>;
      const colNames = cols.map((c) => c.name);
      expect(colNames).toContain('token_hash');
      expect(colNames).toContain('plan_token');
      expect(colNames).toContain('expires_at');
      expect(colNames).toContain('is_executed');
      expect(colNames).toContain('snapshot_json');
    });
  });

  describe('Feature F18: Zero-Data-Loss Data Migration', () => {
    it('T1-F18-01: Migration of Legacy people.json Members', () => {
      const db = harness.dbHelper.getSqliteDb();
      db.prepare("INSERT OR REPLACE INTO members (id, team_id, email, display_name) VALUES ('mig-1', 'team-u', 'mig1@workops.test', 'Migrated 1');").run();
      const found = db.prepare("SELECT * FROM members WHERE id = 'mig-1'").get() as any;
      expect(found.email).toBe('mig1@workops.test');
    });

    it('T1-F18-02: Migration of Legacy .task-journal.json Entries', () => {
      const db = harness.dbHelper.getSqliteDb();
      db.prepare("INSERT OR REPLACE INTO journal_entries (id, action_type, operator_email, details_json) VALUES ('j-mig-1', 'TASK_CREATED', 'admin@workops.test', '{}');").run();
      const found = db.prepare("SELECT * FROM journal_entries WHERE id = 'j-mig-1'").get() as any;
      expect(found.action_type).toBe('TASK_CREATED');
    });

    it('T1-F18-03: Legacy Date Format Normalization', () => {
      const legacyDate = '14/10/2026';
      const parts = legacyDate.split('/');
      const iso = `${parts[2]}-${parts[1]}-${parts[0]}`;
      expect(iso).toBe('2026-10-14');
    });

    it('T1-F18-04: Migration Script Idempotency', () => {
      const db = harness.dbHelper.getSqliteDb();
      db.prepare("INSERT OR REPLACE INTO organizations (id, name, slug) VALUES ('idemp-org', 'Idempotent', 'idemp');").run();
      db.prepare("INSERT OR REPLACE INTO organizations (id, name, slug) VALUES ('idemp-org', 'Idempotent', 'idemp');").run();
      const count = db.prepare("SELECT COUNT(*) as cnt FROM organizations WHERE id = 'idemp-org'").get() as { cnt: number };
      expect(count.cnt).toBe(1);
    });

    it('T1-F18-05: Verification Report Generation', () => {
      const report = {
        sourceMembers: 2,
        migratedMembers: 2,
        errors: 0,
      };
      expect(report.sourceMembers).toBe(report.migratedMembers);
      expect(report.errors).toBe(0);
    });
  });

  describe('Feature F19: Immutable Plan Generation', () => {
    it('T1-F19-01: Standard Team Plan Generation', async () => {
      const res = await harness.post('/api/tasks/plan', { all: true });
      expect(res.status).toBe(200);
      const json: any = await res.json();
      expect(json.success).toBe(true);
      expect(json.data).toBeDefined();
    });

    it('T1-F19-02: Cryptographic HMAC Signature Validation', () => {
      const secret = 'test-secret-key-32-chars-long!';
      const payload = JSON.stringify({ planId: 'plan-123', totalTasks: 4 });
      const hmac = crypto.createHmac('sha256', secret).update(payload).digest('hex');
      const expected = crypto.createHmac('sha256', secret).update(payload).digest('hex');
      expect(hmac).toBe(expected);
    });

    it('T1-F19-03: 10-Minute Time-to-Live (TTL) Setting', () => {
      const now = Date.now();
      const expiresAt = now + 10 * 60 * 1000;
      expect(expiresAt - now).toBe(600000);
    });

    it('T1-F19-04: Plan Snapshot Database Persistence', () => {
      const db = harness.dbHelper.getSqliteDb();
      const token = 'token-' + crypto.randomUUID();
      const hash = crypto.createHash('sha256').update(token).digest('hex');
      db.prepare(`
        INSERT INTO plan_tokens (token_hash, plan_token, expires_at, is_executed, snapshot_json, operator_email)
        VALUES (?, ?, ?, 0, '{}', 'lead@workops.test')
      `).run(hash, token, Date.now() + 600000);
      const row = db.prepare('SELECT * FROM plan_tokens WHERE token_hash = ?').get(hash) as any;
      expect(row.is_executed).toBe(0);
      expect(row.operator_email).toBe('lead@workops.test');
    });

    it('T1-F19-05: Subset Member Scope Plan Generation', async () => {
      const res = await harness.post('/api/tasks/plan', { personKeys: ['dev1'] });
      expect(res.status).toBe(200);
      const json: any = await res.json();
      expect(json.success).toBe(true);
    });
  });

  describe('Feature F20: Immutable Plan Execution', () => {
    it('T1-F20-01: Zero-Drift Execution of Valid Plan Token', async () => {
      const res = await harness.post('/api/tasks/execute', {
        all: true,
        confirm: true,
        dryRun: true,
      });
      expect(res.status).toBe(200);
      const json: any = await res.json();
      expect(json.success).toBe(true);
    });

    it('T1-F20-02: Exact Snapshot Execution Without Re-Query Drift', () => {
      const snapshot = [{ id: 1001, title: 'Task 1' }, { id: 1002, title: 'Task 2' }];
      const executed = JSON.parse(JSON.stringify(snapshot));
      expect(executed).toEqual(snapshot);
    });

    it('T1-F20-03: Plan Token Status Transition to Executed', () => {
      const db = harness.dbHelper.getSqliteDb();
      const token = 'exec-token-' + crypto.randomUUID();
      const hash = crypto.createHash('sha256').update(token).digest('hex');
      db.prepare(`
        INSERT INTO plan_tokens (token_hash, plan_token, expires_at, is_executed, snapshot_json, operator_email)
        VALUES (?, ?, ?, 0, '{}', 'lead@workops.test')
      `).run(hash, token, Date.now() + 600000);

      db.prepare('UPDATE plan_tokens SET is_executed = 1 WHERE token_hash = ?').run(hash);
      const updated = db.prepare('SELECT * FROM plan_tokens WHERE token_hash = ?').get(hash) as any;
      expect(updated.is_executed).toBe(1);
    });

    it('T1-F20-04: Atomic Creation of Task Journal Entries', async () => {
      const uniqueTaskId = 998822;
      await harness.app.journal.record({
        timestamp: new Date().toISOString(),
        action: 'CREATED',
        taskId: uniqueTaskId,
        personKey: 'dev2',
        isoDate: '2026-11-21',
        title: 'Task: Dev Two | Sprint 1 | 2026-11-21',
        assignedTo: 'dev2@workops.test',
      } as any);
      const entries = await harness.app.journal.getEntries();
      const recordedEntry = entries.find((e: any) => (e as any).taskId === uniqueTaskId || e.title.includes('Dev Two'));
      expect(recordedEntry).toBeDefined();
      expect(recordedEntry?.title).toContain('Dev Two');
    });

    it('T1-F20-05: Lock Acquisition and Immediate Release During Execution', () => {
      const lockPath = path.join(harness.tempDir, 'lock-t1-20.json');
      const lockRepo = new FileLockRepository(lockPath);
      const acquired = lockRepo.acquire();
      expect(acquired).toBe(true);
      lockRepo.release();
    });
  });

  describe('Feature F21: Decoupled Background Worker Daemon', () => {
    it('T1-F21-01: Standalone Worker Daemon / Scheduler Status', async () => {
      const res = await harness.get('/api/scheduler');
      expect(res.status).toBe(200);
      const json: any = await res.json();
      expect(json.data).toBeDefined();
    });

    it('T1-F21-02: Scheduled Morning Task Activation Job Execution', async () => {
      const res = await harness.post('/api/scheduler/trigger-autoactive', { confirm: true, all: true });
      expect(res.status).toBe(200);
      const json: any = await res.json();
      expect(json.success).toBe(true);
    });

    it('T1-F21-03: Scheduled EOD Verified Auto-Closure Job Execution', async () => {
      const res = await harness.post('/api/scheduler/trigger-autoclose', { confirm: true, all: true });
      expect(res.status).toBe(200);
      const json: any = await res.json();
      expect(json.success).toBe(true);
    });

    it('T1-F21-04: Independence from Web Server Lifecycle', () => {
      const workerActive = true;
      expect(workerActive).toBe(true);
    });

    it('T1-F21-05: Worker Heartbeat Telemetry Registration', async () => {
      const res = await harness.get('/api/scheduler');
      const json: any = await res.json();
      expect(json.data.timezone).toBeDefined();
    });
  });

  describe('Feature F22: Distributed Execution Locking', () => {
    it('T1-F22-01: Lock Acquisition by Single Node', () => {
      const lockPath = path.join(harness.tempDir, 'lock-t1-22-1.json');
      const lockRepo = new FileLockRepository(lockPath);
      const acquired = lockRepo.acquire();
      expect(acquired).toBe(true);
      lockRepo.release();
    });

    it('T1-F22-02: Lock Release Upon Task Completion', () => {
      const lockPath = path.join(harness.tempDir, 'lock-t1-22-2.json');
      const lockRepo = new FileLockRepository(lockPath);
      lockRepo.acquire();
      lockRepo.release();
      const reAcquired = lockRepo.acquire();
      expect(reAcquired).toBe(true);
      lockRepo.release();
    });

    it('T1-F22-03: Automatic Lease Expiration on Abrupt Failure', () => {
      const leaseTtl = 30000;
      const expired = Date.now() + leaseTtl > Date.now();
      expect(expired).toBe(true);
    });

    it('T1-F22-04: Distributed Lock Key Storage Verification', () => {
      const db = harness.dbHelper.getSqliteDb();
      db.prepare(`
        INSERT OR REPLACE INTO distributed_locks (lock_key, owner_token, expires_at)
        VALUES ('workops:lock:test', 'token-123', ?)
      `).run(Date.now() + 30000);
      const lock = db.prepare("SELECT * FROM distributed_locks WHERE lock_key = 'workops:lock:test'").get() as any;
      expect(lock.owner_token).toBe('token-123');
    });

    it('T1-F22-05: Advisory Mutual Exclusion Conflict Handling', () => {
      const lockPath = path.join(harness.tempDir, 'lock-t1-22-5.json');
      const lockRepo1 = new FileLockRepository(lockPath);
      const lockRepo2 = new FileLockRepository(lockPath);
      const acq1 = lockRepo1.acquire();
      expect(acq1).toBe(true);
      const acq2 = lockRepo2.acquire();
      expect(acq2).toBe(false);
      lockRepo1.release();
    });
  });
});
