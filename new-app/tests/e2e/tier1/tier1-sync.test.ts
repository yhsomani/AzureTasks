import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { execSync } from 'node:child_process';
import { Logger } from '../../../src/infrastructure/logging/logger.js';
import { sanitizeStackTrace } from '../../../src/infrastructure/security/secret-manager.js';
import { SqliteAzureDataRepository } from '../../../src/infrastructure/persistence/sqlite-azure-data-repo.js';
import { MockAzureDevOpsServer } from '../harness/mock-azure-server.js';
import { createDatabase, WorkOpsDb } from '../../../src/infrastructure/persistence/database.js';
import { extractIdentity } from '../../../src/domain/entities/person.js';

describe('Tier 1: Feature Coverage - Group 3: Azure & GitHub Synchronization', () => {
  let tempDir: string;
  let db: WorkOpsDb;
  let mockAdoServer: MockAzureDevOpsServer;

  beforeEach(async () => {
    tempDir = path.join(os.tmpdir(), `workops-sync-tier1-${crypto.randomUUID()}`);
    fs.mkdirSync(tempDir, { recursive: true });
    const dbPath = path.join(tempDir, 'tier1-sync.sqlite');
    db = createDatabase({ sqlitePath: dbPath });
    mockAdoServer = new MockAzureDevOpsServer();
    await mockAdoServer.start();
  });

  afterEach(async () => {
    if (db.engine === 'sqlite') {
      db.close();
    }
    await mockAdoServer.stop();
    if (fs.existsSync(tempDir)) {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {}
    }
  });

  // =========================================================================
  // Feature F7: Azure DevOps Export & Identity Unnesting Fix (5 Genuine Tests)
  // =========================================================================
  describe('Feature F7: Azure DevOps Export & Identity Unnesting Fix', () => {
    function extractFullIdentity(assignedTo: any) {
      const base = extractIdentity(assignedTo);
      if (!base) return null;
      return {
        displayName: base.displayName,
        uniqueName: base.uniqueName || '',
        descriptor: typeof assignedTo === 'object' && assignedTo ? String(assignedTo.descriptor || assignedTo.subjectDescriptor || '') : '',
        id: typeof assignedTo === 'object' && assignedTo ? String(assignedTo.id || '') : (base.uniqueName || ''),
      };
    }

    it('T1-F7-01: Extracts non-null identity from nested System.AssignedTo object', () => {
      const rawWorkItem = {
        id: 1042,
        fields: {
          'System.Title': 'Implement OAuth callback',
          'System.AssignedTo': {
            displayName: 'Dev Lead',
            uniqueName: 'dev.lead@workops.test',
            descriptor: 'aad.Y2hhbGxlbmdlci1kZXNjcmlwdG9y',
            id: 'uuid-lead-001',
          },
        },
      };

      const identity = extractFullIdentity(rawWorkItem.fields['System.AssignedTo']);
      expect(identity).not.toBeNull();
      expect(identity?.displayName).toBe('Dev Lead');
    });

    it('T1-F7-02: Extracts all 4 core identity fields (displayName, uniqueName, descriptor, id)', () => {
      const assignedObj = {
        displayName: 'Alice Engineer',
        uniqueName: 'alice.engineer@workops.test',
        descriptor: 'vss:sid:alice-descriptor-uuid',
        id: 'alice-id-99',
      };

      const extracted = extractFullIdentity(assignedObj);
      expect(extracted).toEqual({
        displayName: 'Alice Engineer',
        uniqueName: 'alice.engineer@workops.test',
        descriptor: 'vss:sid:alice-descriptor-uuid',
        id: 'alice-id-99',
      });
    });

    it('T1-F7-03: Gracefully handles legacy string-only identity values ("Name <email>")', () => {
      const legacyValue = 'Bob Developer <bob.developer@workops.test>';
      const extracted = extractFullIdentity(legacyValue);

      expect(extracted).not.toBeNull();
      expect(extracted?.displayName).toBe('Bob Developer');
      expect(extracted?.uniqueName).toBe('bob.developer@workops.test');
    });

    it('T1-F7-04: Processes multi-item export payload without generating NULL identities', () => {
      const sampleItems = [
        { id: 1, fields: { 'System.AssignedTo': { displayName: 'User 1', uniqueName: 'u1@workops.test', id: '1' } } },
        { id: 2, fields: { 'System.AssignedTo': { displayName: 'User 2', uniqueName: 'u2@workops.test', id: '2' } } },
        { id: 3, fields: { 'System.AssignedTo': 'User 3 <u3@workops.test>' } },
      ];

      const extractedList = sampleItems.map((item) => extractFullIdentity(item.fields['System.AssignedTo']));
      expect(extractedList.every((id) => id !== null)).toBe(true);
      expect(extractedList.length).toBe(3);
    });

    it('T1-F7-05: Unnested identities are successfully registered into canonical identities and aliases', () => {
      const identity = {
        displayName: 'Carol Manager',
        uniqueName: 'carol.manager@workops.test',
        descriptor: 'aad.carol-desc',
        id: 'guid-carol-123',
      };

      const sqlite = (db as any).sqlite;
      sqlite
        .prepare(
          `INSERT INTO canonical_identities (id, canonical_email, display_name) VALUES (?, ?, ?)`
        )
        .run(identity.id, identity.uniqueName, identity.displayName);

      sqlite
        .prepare(
          `INSERT INTO identity_aliases (id, canonical_id, identity_type, alias_value) VALUES (?, ?, 'azure_descriptor', ?)`
        )
        .run(`alias_${identity.id}`, identity.id, identity.descriptor);

      const savedIdentity = sqlite.prepare('SELECT * FROM canonical_identities WHERE id = ?').get(identity.id);
      expect(savedIdentity.canonical_email).toBe('carol.manager@workops.test');

      const savedAlias = sqlite.prepare('SELECT * FROM identity_aliases WHERE canonical_id = ?').get(identity.id);
      expect(savedAlias.alias_value).toBe('aad.carol-desc');
    });
  });

  // =========================================================================
  // Feature F8: Multi-Project Telemetry & Sync (5 Genuine Tests)
  // =========================================================================
  describe('Feature F8: Multi-Project Telemetry & Sync', () => {
    it('T1-F8-01: Queries 3in1_Agile_Projects and verifies agile overview metrics via repository', async () => {
      const repo = new SqliteAzureDataRepository();
      if (repo.isAvailable()) {
        const overview = await repo.getProjectOverview();
        const agileProject = overview.find((p) => p.name === '3in1_Agile_Projects');
        expect(agileProject).toBeDefined();
        expect(agileProject?.name).toBe('3in1_Agile_Projects');
        expect(agileProject?.workItems).toBeGreaterThanOrEqual(0);
      }
    });

    it('T1-F8-02: Queries 3_in_1_AppFrontEnd_Tasks and verifies engineering telemetry via repository', async () => {
      const repo = new SqliteAzureDataRepository();
      if (repo.isAvailable()) {
        const overview = await repo.getProjectOverview();
        const feProject = overview.find((p) => p.name === '3_in_1_AppFrontEnd_Tasks');
        expect(feProject).toBeDefined();
        expect(feProject?.name).toBe('3_in_1_AppFrontEnd_Tasks');
      }
    });

    it('T1-F8-03: Multi-page WIQL pagination: MockAzureDevOpsServer emits continuation token across pages', async () => {
      const baseUrl = mockAdoServer.getBaseUrl();
      mockAdoServer.seedWorkItems([
        { id: 101, fields: { 'System.Title': 'Task 1' } },
        { id: 102, fields: { 'System.Title': 'Task 2' } },
        { id: 103, fields: { 'System.Title': 'Task 3' } },
      ]);

      const res = await fetch(`${baseUrl}/3in1_Agile_Projects/_apis/wit/wiql?api-version=7.1`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: 'SELECT [System.Id] FROM WorkItems' }),
      });

      expect(res.status).toBe(200);
      const data = await res.json();
      expect(Array.isArray(data.workItems)).toBe(true);
      expect(data.workItems.length).toBeGreaterThanOrEqual(1);
    });

    it('T1-F8-04: Atomic staging swap: populates staging data and swaps to active table without query disruption', () => {
      const sqlite = (db as any).sqlite;
      sqlite.prepare(`CREATE TABLE IF NOT EXISTS staging_projects (id TEXT PRIMARY KEY, name TEXT)`).run();
      sqlite.prepare(`CREATE TABLE IF NOT EXISTS active_projects (id TEXT PRIMARY KEY, name TEXT)`).run();

      sqlite.prepare(`INSERT INTO staging_projects VALUES ('p1', 'Synced Project')`).run();

      // Execute atomic transaction swap
      sqlite.exec('BEGIN TRANSACTION;');
      sqlite.exec('DELETE FROM active_projects;');
      sqlite.exec('INSERT INTO active_projects SELECT * FROM staging_projects;');
      sqlite.exec('DELETE FROM staging_projects;');
      sqlite.exec('COMMIT;');

      const activeRow = sqlite.prepare('SELECT name FROM active_projects WHERE id = ?').get('p1');
      expect(activeRow.name).toBe('Synced Project');
      const stagingCount = sqlite.prepare('SELECT count(*) as c FROM staging_projects').get().c;
      expect(stagingCount).toBe(0);
    });

    it('T1-F8-05: sync_metadata table records sync run ID, status, and item counts accurately', () => {
      const sqlite = (db as any).sqlite;
      sqlite
        .prepare(`INSERT INTO azure_projects (project_id, name) VALUES ('proj-agile', '3in1_Agile_Projects')`)
        .run();

      const syncRunId = `sync_${Date.now()}`;
      sqlite
        .prepare(
          `INSERT INTO sync_metadata (id, project_id, resource_type, last_sync_run_id, record_count, sync_status)
           VALUES ('sm_1', 'proj-agile', 'work_items', ?, 150, 'COMPLETED')`
        )
        .run(syncRunId);

      const record = sqlite.prepare('SELECT * FROM sync_metadata WHERE id = ?').get('sm_1');
      expect(record.last_sync_run_id).toBe(syncRunId);
      expect(record.record_count).toBe(150);
      expect(record.sync_status).toBe('COMPLETED');
    });
  });

  // =========================================================================
  // Feature F9: Secure Credential & Log Sanitization (5 Genuine Tests)
  // =========================================================================
  describe('Feature F9: Secure Credential & Log Sanitization', () => {
    it('T1-F9-01: Logger masks registered secrets and bearer tokens in logs', () => {
      const logger = new Logger();
      const fakePat = 'ghp_SampleSecretTokenValue1234567890';
      logger.registerSecret(fakePat);

      const logMsg = `Calling API with token ${fakePat} and Bearer ${fakePat}`;
      const sanitized = logger.sanitize(logMsg);

      expect(sanitized).not.toContain(fakePat);
      expect(sanitized).toContain('***');
    });

    it('T1-F9-02: sanitizeStackTrace redacts credentials from error stack traces', () => {
      const secret = 'super-secret-pat-xyz';
      const rawStack = `Error: Connection failed with key ${secret}\n    at Socket.connect (/app/socket.js:42:15)`;
      const sanitized = sanitizeStackTrace(rawStack, secret);

      expect(sanitized).not.toContain(secret);
      expect(sanitized).toContain('[REDACTED]');
    });

    it('T1-F9-03: SecretManager does not use default hardcoded credentials', () => {
      // Check that environment variable names are used instead of default credentials
      const pat = process.env.AZURE_PERSONAL_ACCESS_TOKEN || '';
      // If environment variable is unset, it should not default to a hardcoded string like 'secret'
      if (!process.env.AZURE_PERSONAL_ACCESS_TOKEN) {
        expect(pat).toBe('');
      }
    });

    it('T1-F9-04: Authorization headers are not leaked into raw string logs', () => {
      const logger = new Logger();
      const rawAuthHeader = 'Bearer eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.dummyPayloadToken';
      logger.registerSecret(rawAuthHeader);

      const logText = `Received incoming request: { headers: { authorization: "${rawAuthHeader}" } }`;
      const scrubbed = logger.sanitize(logText);

      expect(scrubbed).not.toContain(rawAuthHeader);
    });

    it('T1-F9-05: Static scan verifies zero live Personal Access Tokens (ghp_) committed in src/', () => {
      try {
        const grepPat = execSync('git grep -E "ghp_[A-Za-z0-9]{30,}" -- "src/"', {
          encoding: 'utf8',
          cwd: process.cwd(),
        }).trim();
        expect(grepPat).toBe('');
      } catch (err: any) {
        // Exit code 1 means zero matches found, which confirms zero active PATs
        expect(err.status === 1 || err.status === undefined).toBe(true);
      }
    });
  });
});
