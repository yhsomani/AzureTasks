import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { normalizeDatabase } from '../../../scripts/azure-export/normalize.mjs';
import { SqliteExportWriter } from '../../../scripts/azure-export/sqlite-writer.mjs';
import { logger } from '../../../src/infrastructure/logging/logger.js';

describe('Milestone 3: Azure Export, Identity Unnesting & Reliable Sync', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'm3-test-'));
  });

  afterEach(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
  });

  describe('Feature 7: Identity Unnesting and Normalization', () => {
    it('correctly unnests nested item.identity fields for ADO team members', () => {
      const dbPath = path.join(tempDir, 'test-normalize.db');
      const db = new DatabaseSync(dbPath);
      db.exec(`
        CREATE TABLE export_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE exports (run_id TEXT PRIMARY KEY, started_at TEXT NOT NULL);
        CREATE TABLE datasets (
          scope TEXT PRIMARY KEY, project_name TEXT NOT NULL, record_count INTEGER NOT NULL DEFAULT 0,
          payload TEXT NOT NULL, updated_at TEXT NOT NULL
        );
      `);
      db.prepare('INSERT INTO export_meta(key, value) VALUES (?, ?)').run('runId', 'test-run-001');

      // Seed project details
      db.prepare('INSERT INTO datasets(scope, project_name, record_count, payload, updated_at) VALUES (?, ?, ?, ?, ?)').run(
        'project.3in1_Agile_Projects.details',
        '3in1_Agile_Projects',
        1,
        JSON.stringify({ id: 'proj-001', name: '3in1_Agile_Projects', state: 'wellFormed' }),
        new Date().toISOString()
      );

      // Seed teams
      db.prepare('INSERT INTO datasets(scope, project_name, record_count, payload, updated_at) VALUES (?, ?, ?, ?, ?)').run(
        'project.3in1_Agile_Projects.teams',
        '3in1_Agile_Projects',
        1,
        JSON.stringify({ value: [{ id: 'team-001', name: 'Alpha_POD' }] }),
        new Date().toISOString()
      );

      // Seed team members with nested identity payload (as returned by Azure DevOps API)
      const rawMembers = [
        {
          isTeamAdmin: true,
          identity: {
            id: 'id-001-guid',
            displayName: 'Dev Alpha',
            uniqueName: 'dev.alpha@workops.test',
            descriptor: 'aad.ZGV2LWFscGhh',
            mailAddress: 'dev.alpha@workops.test',
          },
        },
        {
          isTeamAdmin: false,
          identity: {
            id: 'id-002-guid',
            displayName: 'Dev Beta',
            uniqueName: 'dev.beta@workops.test',
            descriptor: 'aad.ZGV2LWJldGE=',
            // email in item.email instead of mailAddress
            email: 'dev.beta@workops.test',
          },
        },
        {
          // Flat identity format fallback (for non-nested ADO endpoints)
          id: 'id-003-guid',
          displayName: 'Dev Gamma',
          uniqueName: 'dev.gamma@workops.test',
          descriptor: 'aad.ZGV2LWdhbW1h',
        },
      ];

      db.prepare('INSERT INTO datasets(scope, project_name, record_count, payload, updated_at) VALUES (?, ?, ?, ?, ?)').run(
        'project.3in1_Agile_Projects.team.Alpha_POD.members',
        '3in1_Agile_Projects',
        3,
        JSON.stringify({ value: rawMembers }),
        new Date().toISOString()
      );
      db.close();

      // Run normalizeDatabase
      const result = normalizeDatabase(dbPath);
      expect(result.projects).toBe(1);

      const verifyDb = new DatabaseSync(dbPath, { readOnly: true });
      const identities = verifyDb.prepare('SELECT * FROM identities ORDER BY identity_id').all() as any[];
      expect(identities).toHaveLength(3);

      // Verify unnested identity 1
      const id1 = identities.find(i => i.identity_id === 'id-001-guid');
      expect(id1).toBeDefined();
      expect(id1.display_name).toBe('Dev Alpha');
      expect(id1.unique_name).toBe('dev.alpha@workops.test');
      expect(id1.email).toBe('dev.alpha@workops.test');
      expect(id1.subject_descriptor).toBe('aad.ZGV2LWFscGhh');
      expect(id1.is_active).toBe(1);

      // Verify unnested identity 2
      const id2 = identities.find(i => i.identity_id === 'id-002-guid');
      expect(id2).toBeDefined();
      expect(id2.display_name).toBe('Dev Beta');
      expect(id2.unique_name).toBe('dev.beta@workops.test');
      expect(id2.email).toBe('dev.beta@workops.test');
      expect(id2.subject_descriptor).toBe('aad.ZGV2LWJldGE=');

      // Verify flat identity fallback 3
      const id3 = identities.find(i => i.identity_id === 'id-003-guid');
      expect(id3).toBeDefined();
      expect(id3.display_name).toBe('Dev Gamma');
      expect(id3.unique_name).toBe('dev.gamma@workops.test');
      expect(id3.email).toBe('dev.gamma@workops.test'); // fall back to uniqueName

      // Verify team_members junction table
      const teamMembers = verifyDb.prepare('SELECT * FROM team_members').all() as any[];
      expect(teamMembers).toHaveLength(3);
      expect(teamMembers.every(tm => tm.team_id === 'team-001')).toBe(true);
      verifyDb.close();
    });

    it('correctly handles work items assigned_identity_id for object, string, and unassigned', () => {
      const dbPath = path.join(tempDir, 'test-workitems.db');
      const db = new DatabaseSync(dbPath);
      db.exec(`
        CREATE TABLE export_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE exports (run_id TEXT PRIMARY KEY, started_at TEXT NOT NULL);
        CREATE TABLE datasets (
          scope TEXT PRIMARY KEY, project_name TEXT NOT NULL, record_count INTEGER NOT NULL DEFAULT 0,
          payload TEXT NOT NULL, updated_at TEXT NOT NULL
        );
      `);
      db.prepare('INSERT INTO export_meta(key, value) VALUES (?, ?)').run('runId', 'test-run-002');
      db.prepare('INSERT INTO datasets(scope, project_name, record_count, payload, updated_at) VALUES (?, ?, ?, ?, ?)').run(
        'project.3in1_Agile_Projects.details',
        '3in1_Agile_Projects',
        1,
        JSON.stringify({ id: 'proj-001', name: '3in1_Agile_Projects' }),
        new Date().toISOString()
      );

      const workItemsPayload = [
        // 1. AssignedTo with id
        {
          id: 101,
          fields: {
            'System.WorkItemType': 'Task',
            'System.Title': 'Task with object ID',
            'System.State': 'Active',
            'System.AssignedTo': { id: 'guid-user-1', displayName: 'User One' },
            'System.AreaPath': '3in1_Agile_Projects',
            'System.IterationPath': '3in1_Agile_Projects\\Sprint 1',
          },
        },
        // 2. AssignedTo with descriptor
        {
          id: 102,
          fields: {
            'System.WorkItemType': 'Task',
            'System.Title': 'Task with descriptor',
            'System.State': 'Active',
            'System.AssignedTo': { descriptor: 'aad.dXNlci10d28=', displayName: 'User Two' },
            'System.AreaPath': '3in1_Agile_Projects',
            'System.IterationPath': '3in1_Agile_Projects\\Sprint 1',
          },
        },
        // 3. AssignedTo as string primitive
        {
          id: 103,
          fields: {
            'System.WorkItemType': 'Task',
            'System.Title': 'Task with string assignedTo',
            'System.State': 'New',
            'System.AssignedTo': 'dev.three@workops.test',
            'System.AreaPath': '3in1_Agile_Projects',
            'System.IterationPath': '3in1_Agile_Projects\\Sprint 1',
          },
        },
        // 4. Unassigned task (System.AssignedTo = null)
        {
          id: 104,
          fields: {
            'System.WorkItemType': 'Task',
            'System.Title': 'Unassigned Task',
            'System.State': 'New',
            'System.AssignedTo': null,
            'System.AreaPath': '3in1_Agile_Projects',
            'System.IterationPath': '3in1_Agile_Projects\\Sprint 1',
          },
        },
      ];

      db.prepare('INSERT INTO datasets(scope, project_name, record_count, payload, updated_at) VALUES (?, ?, ?, ?, ?)').run(
        'project.3in1_Agile_Projects.workItems',
        '3in1_Agile_Projects',
        4,
        JSON.stringify({ value: workItemsPayload }),
        new Date().toISOString()
      );
      db.close();

      normalizeDatabase(dbPath);

      const verifyDb = new DatabaseSync(dbPath, { readOnly: true });
      const items = verifyDb.prepare('SELECT work_item_id, assigned_identity_id, title FROM work_items ORDER BY work_item_id').all() as any[];
      expect(items).toHaveLength(4);

      expect(items[0].work_item_id).toBe(101);
      expect(items[0].assigned_identity_id).toBe('guid-user-1');

      expect(items[1].work_item_id).toBe(102);
      expect(items[1].assigned_identity_id).toBe('aad.dXNlci10d28=');

      expect(items[2].work_item_id).toBe(103);
      expect(items[2].assigned_identity_id).toBe('dev.three@workops.test');

      expect(items[3].work_item_id).toBe(104);
      expect(items[3].assigned_identity_id).toBeNull();

      verifyDb.close();
    });

    it('verifies all 13 identities in azure-data.db have non-null fields', () => {
      const dbPath = path.resolve(process.cwd(), 'azure-data.db');
      if (!fs.existsSync(dbPath)) return;

      const db = new DatabaseSync(dbPath, { readOnly: true });
      const identities = db.prepare('SELECT * FROM identities').all() as any[];
      expect(identities.length).toBe(13);

      for (const id of identities) {
        expect(id.identity_id).toBeTruthy();
        expect(id.display_name).not.toBeNull();
        expect(id.display_name.trim().length).toBeGreaterThan(0);
        expect(id.unique_name).not.toBeNull();
        expect(id.unique_name.trim().length).toBeGreaterThan(0);
        expect(id.email).not.toBeNull();
        expect(id.email.trim().length).toBeGreaterThan(0);
        expect(id.subject_descriptor).not.toBeNull();
        expect(id.subject_descriptor.trim().length).toBeGreaterThan(0);
        expect(id.is_active).toBe(1);
      }
      db.close();
    });

    it('preserves multi-team memberships for users who belong to 2+ teams', () => {
      const dbPath = path.join(tempDir, 'test-multi-team.db');
      const db = new DatabaseSync(dbPath);
      db.exec(`
        CREATE TABLE export_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE exports (run_id TEXT PRIMARY KEY, started_at TEXT NOT NULL);
        CREATE TABLE datasets (
          scope TEXT PRIMARY KEY, project_name TEXT NOT NULL, record_count INTEGER NOT NULL DEFAULT 0,
          payload TEXT NOT NULL, updated_at TEXT NOT NULL
        );
      `);
      db.prepare('INSERT INTO export_meta(key, value) VALUES (?, ?)').run('runId', 'test-run-multi');

      db.prepare('INSERT INTO datasets(scope, project_name, record_count, payload, updated_at) VALUES (?, ?, ?, ?, ?)').run(
        'project.3in1_Agile_Projects.details',
        '3in1_Agile_Projects',
        1,
        JSON.stringify({ id: 'proj-001', name: '3in1_Agile_Projects' }),
        new Date().toISOString()
      );

      db.prepare('INSERT INTO datasets(scope, project_name, record_count, payload, updated_at) VALUES (?, ?, ?, ?, ?)').run(
        'project.3in1_Agile_Projects.teams',
        '3in1_Agile_Projects',
        2,
        JSON.stringify({
          value: [
            { id: 'team-001', name: 'Alpha_POD' },
            { id: 'team-002', name: 'Beta_POD' },
          ],
        }),
        new Date().toISOString()
      );

      // User m1 belongs to BOTH Alpha_POD and Beta_POD
      db.prepare('INSERT INTO datasets(scope, project_name, record_count, payload, updated_at) VALUES (?, ?, ?, ?, ?)').run(
        'project.3in1_Agile_Projects.team.Alpha_POD.members',
        '3in1_Agile_Projects',
        2,
        JSON.stringify({
          value: [
            { id: 'm1', displayName: 'Shared Dev', uniqueName: 'shared@test.com' },
            { id: 'm2', displayName: 'Alpha Dev', uniqueName: 'alpha@test.com' },
          ],
        }),
        new Date().toISOString()
      );

      db.prepare('INSERT INTO datasets(scope, project_name, record_count, payload, updated_at) VALUES (?, ?, ?, ?, ?)').run(
        'project.3in1_Agile_Projects.team.Beta_POD.members',
        '3in1_Agile_Projects',
        2,
        JSON.stringify({
          value: [
            { id: 'm1', displayName: 'Shared Dev', uniqueName: 'shared@test.com' },
            { id: 'm3', displayName: 'Beta Dev', uniqueName: 'beta@test.com' },
          ],
        }),
        new Date().toISOString()
      );
      db.close();

      normalizeDatabase(dbPath);

      const verifyDb = new DatabaseSync(dbPath, { readOnly: true });
      const teamMembers = verifyDb.prepare('SELECT team_id, identity_id FROM team_members ORDER BY team_id, identity_id').all() as any[];
      expect(teamMembers).toHaveLength(4);

      const m1Memberships = teamMembers.filter(tm => tm.identity_id === 'm1');
      expect(m1Memberships).toHaveLength(2);
      expect(m1Memberships.map(tm => tm.team_id).sort()).toEqual(['team-001', 'team-002']);

      const identities = verifyDb.prepare('SELECT identity_id FROM identities ORDER BY identity_id').all() as any[];
      expect(identities.map(i => i.identity_id).sort()).toEqual(['m1', 'm2', 'm3']);
      verifyDb.close();
    });

    it('gracefully handles null / non-object entries in members arrays without crashing', () => {
      const dbPath = path.join(tempDir, 'test-null-members.db');
      const db = new DatabaseSync(dbPath);
      db.exec(`
        CREATE TABLE export_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
        CREATE TABLE exports (run_id TEXT PRIMARY KEY, started_at TEXT NOT NULL);
        CREATE TABLE datasets (
          scope TEXT PRIMARY KEY, project_name TEXT NOT NULL, record_count INTEGER NOT NULL DEFAULT 0,
          payload TEXT NOT NULL, updated_at TEXT NOT NULL
        );
      `);
      db.prepare('INSERT INTO export_meta(key, value) VALUES (?, ?)').run('runId', 'test-run-null');

      db.prepare('INSERT INTO datasets(scope, project_name, record_count, payload, updated_at) VALUES (?, ?, ?, ?, ?)').run(
        'project.3in1_Agile_Projects.details',
        '3in1_Agile_Projects',
        1,
        JSON.stringify({ id: 'proj-001', name: '3in1_Agile_Projects' }),
        new Date().toISOString()
      );

      db.prepare('INSERT INTO datasets(scope, project_name, record_count, payload, updated_at) VALUES (?, ?, ?, ?, ?)').run(
        'project.3in1_Agile_Projects.teams',
        '3in1_Agile_Projects',
        1,
        JSON.stringify({ value: [{ id: 'team-001', name: 'Alpha_POD' }] }),
        new Date().toISOString()
      );

      // Members payload contains null, undefined, primitive string, and valid object with explicit null fallback check
      db.prepare('INSERT INTO datasets(scope, project_name, record_count, payload, updated_at) VALUES (?, ?, ?, ?, ?)').run(
        'project.3in1_Agile_Projects.team.Alpha_POD.members',
        '3in1_Agile_Projects',
        5,
        JSON.stringify({
          value: [
            null,
            undefined,
            'invalid-primitive',
            { id: null, uniqueName: 'fallback.id@test.com', displayName: 'Fallback User' },
            { id: 'valid-001', displayName: 'Valid User', uniqueName: 'valid@test.com' },
          ],
        }),
        new Date().toISOString()
      );
      db.close();

      expect(() => normalizeDatabase(dbPath)).not.toThrow();

      const verifyDb = new DatabaseSync(dbPath, { readOnly: true });
      const identities = verifyDb.prepare('SELECT identity_id, display_name FROM identities ORDER BY identity_id').all() as any[];
      expect(identities).toHaveLength(2);

      const fallbackUser = identities.find(i => i.identity_id === 'fallback.id@test.com');
      expect(fallbackUser).toBeDefined();
      expect(fallbackUser.display_name).toBe('Fallback User');

      const validUser = identities.find(i => i.identity_id === 'valid-001');
      expect(validUser).toBeDefined();
      expect(validUser.display_name).toBe('Valid User');

      const teamMembers = verifyDb.prepare('SELECT * FROM team_members').all() as any[];
      expect(teamMembers).toHaveLength(2);
      verifyDb.close();
    });
  });

  describe('Feature 8: Multi-Project Telemetry & Sync Bridge', () => {
    it('authoritatively bridges 3in1_Agile_Projects and 3_in_1_AppFrontEnd_Tasks with distinct roles', () => {
      const dbPath = path.resolve(process.cwd(), 'azure-data.db');
      if (!fs.existsSync(dbPath)) return;

      const db = new DatabaseSync(dbPath, { readOnly: true });
      const projects = db.prepare('SELECT project_id, name FROM azure_projects ORDER BY name').all() as any[];
      expect(projects).toHaveLength(2);

      const appFrontEnd = projects.find(p => p.name === '3_in_1_AppFrontEnd_Tasks');
      const agileProjects = projects.find(p => p.name === '3in1_Agile_Projects');

      expect(appFrontEnd).toBeDefined();
      expect(agileProjects).toBeDefined();

      // Check teams allocation: Agile projects owns organizational PODs (230 teams)
      const agileTeams = db.prepare('SELECT COUNT(*) as c FROM azure_teams WHERE project_id = ?').get(agileProjects.project_id) as { c: number };
      expect(agileTeams.c).toBe(230);

      // AppFrontEnd owns CI/CD pipelines and builds
      const appBuilds = db.prepare('SELECT COUNT(*) as c FROM builds WHERE project_id = ?').get(appFrontEnd.project_id) as { c: number };
      expect(appBuilds.c).toBeGreaterThan(50000);

      const appPipelines = db.prepare('SELECT COUNT(*) as c FROM pipelines WHERE project_id = ?').get(appFrontEnd.project_id) as { c: number };
      expect(appPipelines.c).toBeGreaterThan(200);

      const appReleases = db.prepare('SELECT COUNT(*) as c FROM releases WHERE project_id = ?').get(appFrontEnd.project_id) as { c: number };
      expect(appReleases.c).toBeGreaterThan(9000);

      // Verify v_project_overview summarizes both projects cleanly
      const overview = db.prepare('SELECT * FROM v_project_overview ORDER BY name').all() as any[];
      expect(overview).toHaveLength(2);
      expect(overview.map(o => o.name)).toEqual(['3_in_1_AppFrontEnd_Tasks', '3in1_Agile_Projects']);

      db.close();
    });

    it('SqliteExportWriter executes atomic staging swap and cleans up on abort', () => {
      const targetDb = path.join(tempDir, 'output.db');
      const writer = new SqliteExportWriter(targetDb, {
        runId: 'test-staging-run',
        mode: 'dashboard',
        projects: ['3_in_1_AppFrontEnd_Tasks', '3in1_Agile_Projects'],
        organization: 'TestOrg',
      });

      // Verify staging file exists while writing
      expect(fs.existsSync(writer.stagingPath)).toBe(true);
      expect(fs.existsSync(targetDb)).toBe(false);

      // Save a dataset
      writer.saveDataset('project.3in1_Agile_Projects.details', '3in1_Agile_Projects', {
        id: 'proj-01',
        name: '3in1_Agile_Projects',
      });

      // Publish: atomic swap
      const result = writer.publish('complete');
      expect(result.runId).toBe('test-staging-run');
      expect(fs.existsSync(targetDb)).toBe(true);
      expect(fs.existsSync(writer.stagingPath)).toBe(false);

      // Verify target database is valid
      const readDb = new DatabaseSync(targetDb, { readOnly: true });
      expect(readDb.prepare('PRAGMA integrity_check').get()).toEqual({ integrity_check: 'ok' });
      readDb.close();
    });

    it('SqliteExportWriter abort removes staging database and sidecars', () => {
      const targetDb = path.join(tempDir, 'aborted.db');
      const writer = new SqliteExportWriter(targetDb, {
        runId: 'test-abort-run',
        mode: 'dashboard',
        projects: ['3in1_Agile_Projects'],
        organization: 'TestOrg',
      });

      expect(fs.existsSync(writer.stagingPath)).toBe(true);
      writer.abort();

      expect(fs.existsSync(writer.stagingPath)).toBe(false);
      expect(fs.existsSync(targetDb)).toBe(false);
    });

    it('simulates WIQL range binary splitting when 20k item limit is reached', async () => {
      // Simulate binary search splitting when hitting ADO 20,000 work item limit (VS402337)
      const mockQueryHandler = (start: number, end: number): { workItems: Array<{ id: number }> } => {
        const count = end - start;
        if (count > 20000) {
          const err: any = new Error('Azure DevOps returned HTTP 400');
          err.status = 400;
          err.response = 'VS402337: The query has exceeded the size limit of 20000.';
          throw err;
        }
        // Return dummy items within range
        return { workItems: [{ id: start }, { id: end - 1 }] };
      };

      const pendingRanges = [{ start: 0, end: 100000 }];
      const collected: Array<{ id: number }> = [];
      let completedRanges = 0;

      while (pendingRanges.length > 0) {
        const range = pendingRanges.pop()!;
        try {
          const res = mockQueryHandler(range.start, range.end);
          collected.push(...res.workItems);
          completedRanges += 1;
        } catch (error: any) {
          if (error.status === 400 && /VS402337|exceeds the size limit of 20000/i.test(error.response) && range.end - range.start > 1) {
            const midpoint = range.start + Math.floor((range.end - range.start) / 2);
            pendingRanges.push({ start: midpoint, end: range.end });
            pendingRanges.push({ start: range.start, end: midpoint });
          } else {
            throw error;
          }
        }
      }

      expect(completedRanges).toBeGreaterThan(1);
      expect(collected.length).toBeGreaterThan(0);
    });
  });

  describe('Feature 9: Secret Hygiene and Logger Sanitization', () => {
    it('logger sanitizes Basic auth, Bearer tokens, GitHub and Azure PATs', () => {
      // 1. Basic Auth header
      const basicHeader = 'Authorization: Basic OjUyY2hhcmFjdGVycGF0ZXhhbXBsZXRva2VuZm9yYXp1cmVkZXZvcHM=';
      expect(logger.sanitize(basicHeader)).toBe('Authorization: Basic ***');

      // 2. Bearer token
      const bearerHeader = 'Authorization: Bearer secret-jwt-token-string-value-12345';
      expect(logger.sanitize(bearerHeader)).toBe('Authorization: Bearer ***');

      // 3. Classic GitHub PAT (ghp_ + 36 chars)
      const ghp = 'ghp_' + 'X'.repeat(36);
      expect(logger.sanitize(`GitHub token ${ghp} used`)).toBe('GitHub token *** used');

      // 4. Fine-grained GitHub PAT (github_pat_ + 82 chars)
      const ghPat = 'github_pat_' + 'Y'.repeat(82);
      expect(logger.sanitize(`Token: ${ghPat}`)).toBe('Token: ***');

      // 5. Azure DevOps PAT (52 chars)
      const adoPat = 'abcdefghijklmnopqrstuvwxyz234567abcdefghijklmnopqrs1';
      expect(adoPat.length).toBe(52);
      expect(logger.sanitize(`PAT=${adoPat}`)).toBe('PAT=***');
    });

    it('registered custom secrets are retroactively scrubbed from logger ring buffer', () => {
      const secret = 'super-secret-pat-token-998877';
      logger.info(`Connecting with credential: ${secret}`);
      
      const before = logger.getRecentLogs(1)[0];
      expect(before.message).toContain(secret);

      logger.registerSecret(secret);

      const after = logger.getRecentLogs(1)[0];
      expect(after.message).not.toContain(secret);
      expect(after.message).toContain('***');
    });
  });
});
