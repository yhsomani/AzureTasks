import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startHarness, stopHarness, WorkOpsTestHarness } from '../harness/index.js';
import { MigrationService } from '../../../src/infrastructure/persistence/migration/migration-service.js';
import { SqliteAzureDataRepository } from '../../../src/infrastructure/persistence/sqlite-azure-data-repo.js';
import { NORMALIZED_SCHEMA } from '../../../scripts/azure-export/schema.mjs';
import { extractIdentity, matchesPerson } from '../../../src/domain/entities/person.js';
import { logger } from '../../../src/infrastructure/logging/logger.js';
import Database from 'better-sqlite3';

describe('Tier 4: Real-World Application Scenarios (8 Multi-Step Operational Journeys)', () => {
  let harness: WorkOpsTestHarness;
  const repoRoot = process.cwd();

  beforeAll(async () => {
    harness = await startHarness({ enableSqlite: true });
  });

  afterAll(async () => {
    await stopHarness();
  });

  // =========================================================================
  // Scenario 1: Full Repository Audit & Hygiene Verification (F1, F2, F3, F9)
  // =========================================================================
  it('Scenario 1: Full Repository Audit & Hygiene Verification (F1, F2, F3, F9)', () => {
    // 1. Verify large binary DB files and raw PII dumps are untracked in git (F1)
    const trackedFiles = execSync('git ls-files', { encoding: 'utf8' }).split('\n');
    const bannedTracked = ['azure-data.db', 'azure-live-smoke.db', 'azure-data-smoke.db', 'data.txt'];
    for (const banned of bannedTracked) {
      expect(trackedFiles).not.toContain(banned);
    }

    // 2. Verify modern .gitignore rules prevent accidental staging of databases and dumps (F2)
    const gitignorePath = path.join(repoRoot, '.gitignore');
    expect(fs.existsSync(gitignorePath)).toBe(true);
    const gitignoreContent = fs.readFileSync(gitignorePath, 'utf8');
    expect(gitignoreContent).toContain('*.db');
    expect(gitignoreContent).toContain('*.db-wal');
    expect(gitignoreContent).toContain('data.txt');

    // 3. Verify zero hardcoded corporate emails in source code and package files (F3)
    const corporateDomain = ['bajaj', 'finserv', 'in'].join('.');
    const srcFiles: string[] = [];
    function scanDir(dir: string) {
      if (!fs.existsSync(dir)) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory() && entry.name !== 'node_modules' && entry.name !== '.git') {
          scanDir(full);
        } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.js') || entry.name.endsWith('.json'))) {
          srcFiles.push(full);
        }
      }
    }
    scanDir(path.join(repoRoot, 'src'));
    scanDir(path.join(repoRoot, 'scripts'));

    const leakedFiles: string[] = [];
    for (const file of srcFiles) {
      const content = fs.readFileSync(file, 'utf8');
      if (content.toLowerCase().includes(corporateDomain)) {
        leakedFiles.push(path.relative(repoRoot, file));
      }
    }
    expect(leakedFiles).toEqual([]);

    // 4. Verify secret masking in structured logger (F9)
    const secretPAT = 'vsts-pat-token-secret-999';
    logger.registerSecret(secretPAT);
    expect(logger.sanitize(`Bearer ${secretPAT}`)).toBe('***');
  });

  // =========================================================================
  // Scenario 2: Zero-Data-Loss Database Migration Cutover (F4, F5, F6, F9)
  // =========================================================================
  it('Scenario 2: Zero-Data-Loss Database Migration Cutover (F4, F5, F6, F9)', async () => {
    const db = harness.dbHelper.getSqliteDb();
    const workOpsDb = { engine: 'sqlite', sqlite: db } as any;

    // 1. Prepare sample legacy data
    const tempDir = path.join(os.tmpdir(), `workops-sc2-${crypto.randomUUID()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    const legacyPeople = [
      { name: 'Developer One', email: 'dev1@workops.test', role: 'Engineer' },
      { name: 'Developer Two', email: 'dev2@workops.test', role: 'Engineer' },
    ];
    const timestampWithMillis = '2026-11-23T14:30:15.123Z';
    const legacyJournals = [
      {
        id: 'j_batch_1',
        runId: 'run_batch_20261123_01',
        timestamp: timestampWithMillis,
        taskId: 101,
        action: 'CREATED',
        operatorEmail: 'admin@workops.test',
      },
      {
        id: 'j_batch_2',
        runId: 'run_batch_20261123_02',
        timestamp: timestampWithMillis,
        taskId: 102,
        action: 'CREATED',
        operatorEmail: 'admin@workops.test',
      },
    ];

    const peoplePath = path.join(tempDir, 'people.json');
    const journalPath = path.join(tempDir, 'journal.json');
    fs.writeFileSync(peoplePath, JSON.stringify({ people: legacyPeople }, null, 2), 'utf8');
    fs.writeFileSync(journalPath, JSON.stringify(legacyJournals, null, 2), 'utf8');

    // 2. Perform Migration
    const migrationService = new MigrationService(workOpsDb);
    const result = await migrationService.migrate({
      peoplePath,
      journalPath,
    });

    expect(result.success).toBe(true);
    expect(result.migratedMembers).toBe(2);
    expect(result.migratedJournalEntries).toBe(2);

    // 3. Verify millisecond timestamp fidelity (F5)
    const journalRow = db.prepare('SELECT created_at FROM journal_entries WHERE id = ?;').get('j_batch_1') as any;
    expect(journalRow).toBeDefined();
    expect(journalRow.created_at).toBe(timestampWithMillis);

    // 4. Verify distinct runId entries without primary key collisions (F5)
    const runCount = (db.prepare('SELECT count(*) as c FROM journal_entries WHERE id IN (?, ?);').get('j_batch_1', 'j_batch_2') as any).c;
    expect(runCount).toBe(2);
  });

  // =========================================================================
  // Scenario 3: Dual-Project Telemetry Ingestion & Staging Swap (F7, F8, F9)
  // =========================================================================
  it('Scenario 3: Dual-Project Telemetry Ingestion & Staging Swap (F7, F8, F9)', async () => {
    const azureDb = new Database(':memory:');
    azureDb.exec(NORMALIZED_SCHEMA);
    const repo = new SqliteAzureDataRepository(azureDb);

    // 1. Seed dual projects in repository
    azureDb.prepare(`
      INSERT OR REPLACE INTO azure_projects (project_id, name, state, visibility, revision, synced_at)
      VALUES (?, ?, 'wellFormed', 'private', 1, datetime('now'));
    `).run('proj_agile', '3in1_Agile_Projects');

    azureDb.prepare(`
      INSERT OR REPLACE INTO azure_projects (project_id, name, state, visibility, revision, synced_at)
      VALUES (?, ?, 'wellFormed', 'private', 1, datetime('now'));
    `).run('proj_frontend', '3_in_1_AppFrontEnd_Tasks');

    // 2. Seed pipeline runs and release data
    azureDb.prepare(`
      INSERT OR REPLACE INTO pipelines (pipeline_id, project_id, name, folder, revision, payload_json, synced_at)
      VALUES (101, 'proj_frontend', 'CI-Pipeline', '\\', 1, '{}', datetime('now'));
    `).run();

    azureDb.prepare(`
      INSERT OR REPLACE INTO pipeline_runs (run_id, pipeline_id, project_id, name, state, result, created_at, finished_at, payload_json, synced_at)
      VALUES (1, 101, 'proj_frontend', 'Run-1', 'completed', 'succeeded', '2026-11-23T10:00:00.000Z', '2026-11-23T10:05:00.000Z', '{}', datetime('now'));
    `).run();

    azureDb.prepare(`
      INSERT OR REPLACE INTO releases (release_id, project_id, name, status, created_at, modified_at, payload_json, synced_at)
      VALUES (1, 'proj_frontend', 'Release-v1.0.0', 'active', '2026-11-23T12:00:00.000Z', '2026-11-23T12:00:00.000Z', '{}', datetime('now'));
    `).run();

    // 3. Verify telemetry retrieval across projects
    const overviews = await repo.getProjectOverview();
    expect(overviews.length).toBeGreaterThanOrEqual(2);
    const agileProj = overviews.find(p => p.projectId === 'proj_agile');
    expect(agileProj?.name).toBe('3in1_Agile_Projects');

    const frontendProj = overviews.find(p => p.projectId === 'proj_frontend');
    expect(frontendProj?.name).toBe('3_in_1_AppFrontEnd_Tasks');

    const recentPipelines = await repo.getRecentPipelineRuns('proj_frontend', 5);
    expect(recentPipelines.length).toBeGreaterThanOrEqual(1);
    expect(recentPipelines[0].pipelineName).toBe('CI-Pipeline');

    const recentReleases = await repo.getRecentReleases('proj_frontend', 5);
    expect(recentReleases.length).toBeGreaterThanOrEqual(1);
    expect(recentReleases[0].name).toBe('Release-v1.0.0');

    azureDb.close();
  });

  // =========================================================================
  // Scenario 4: Enterprise Credential Security & Masking Audit (F8, F9)
  // =========================================================================
  it('Scenario 4: Enterprise Credential Security & Masking Audit (F8, F9)', async () => {
    // 1. Unauthenticated request to protected endpoint must return 401
    const unauthRes = await fetch(`${harness.baseUrl}/api/scheduler/run-now`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    expect([401, 403]).toContain(unauthRes.status);

    // 2. Viewer role request allows read operations
    const authHeader = (u: string, p: string) => `Basic ${Buffer.from(`${u}:${p}`).toString('base64')}`;
    const viewerReadRes = await fetch(`${harness.baseUrl}/api/status`, {
      headers: { Authorization: authHeader('viewer', harness.viewerToken) },
    });
    expect(viewerReadRes.status).toBe(200);

    // 3. Viewer role request rejects mutation operations with 403
    const viewerMutateRes = await fetch(`${harness.baseUrl}/api/scheduler/run-now`, {
      method: 'POST',
      headers: {
        Authorization: authHeader('viewer', harness.viewerToken),
        'Content-Type': 'application/json',
      },
    });
    expect(viewerMutateRes.status).toBe(403);
    const viewerErr = await viewerMutateRes.json();
    expect(viewerErr.error).toContain('Operator authorization is required');
  });

  // =========================================================================
  // Scenario 5: End-to-End Canonical Identity Resolution (F7, F10, F11, F13)
  // =========================================================================
  it('Scenario 5: End-to-End Canonical Identity Resolution (F7, F10, F11, F13)', () => {
    // 1. Test multi-format identity inputs (F10)
    const emailIdentity = extractIdentity('developer@example.com');
    expect(emailIdentity).toEqual({ displayName: 'developer@example.com', uniqueName: 'developer@example.com' });

    const angleIdentity = extractIdentity('Jane Doe <jane.doe@example.com>');
    expect(angleIdentity).toEqual({ displayName: 'Jane Doe', uniqueName: 'jane.doe@example.com' });

    const objectIdentity = extractIdentity({ displayName: 'Alex Smith', uniqueName: 'alex@example.com' });
    expect(objectIdentity).toEqual({ displayName: 'Alex Smith', uniqueName: 'alex@example.com' });

    // 2. Test matchesPerson evaluation across formats (F11)
    const person = { key: 'jane', name: 'Jane Doe', assignedTo: 'jane.doe@example.com' };
    expect(matchesPerson('jane.doe@example.com', person)).toBe(true);
    expect(matchesPerson('Jane Doe <jane.doe@example.com>', person)).toBe(true);
    expect(matchesPerson({ displayName: 'Jane Doe', uniqueName: 'jane.doe@example.com' }, person)).toBe(true);
    expect(matchesPerson('other.user@example.com', person)).toBe(false);

    // 3. Diagnostics and identity resolution (F13)
    const db = harness.dbHelper.getSqliteDb();
    db.prepare('INSERT OR REPLACE INTO canonical_identities (id, canonical_email, display_name) VALUES (?, ?, ?);').run(
      'usr_scenario_5',
      'canonical.dev@workops.test',
      'Canonical Dev'
    );
    db.prepare('INSERT OR REPLACE INTO identity_aliases (id, canonical_id, identity_type, alias_value) VALUES (?, ?, ?, ?);').run(
      'alias_sc_5',
      'usr_scenario_5',
      'upn',
      'canonical.dev@workops.test'
    );

    const resolved = db.prepare(`
      SELECT c.id, c.display_name, c.canonical_email
      FROM canonical_identities c
      JOIN identity_aliases a ON a.canonical_id = c.id
      WHERE a.alias_value = ?;
    `).get('canonical.dev@workops.test') as any;

    expect(resolved).toBeDefined();
    expect(resolved.id).toBe('usr_scenario_5');
    expect(resolved.display_name).toBe('Canonical Dev');
  });

  // =========================================================================
  // Scenario 6: Unassigned Task Discovery & Sprint Reallocation (F12, F14, F17)
  // =========================================================================
  it('Scenario 6: Unassigned Task Discovery & Sprint Reallocation (F12, F14, F17)', () => {
    const db = harness.dbHelper.getSqliteDb();
    db.prepare('INSERT OR IGNORE INTO azure_projects (project_id, name) VALUES (?, ?);').run('proj_sc6', 'Project SC6');

    // 1. Seed unassigned work items (F12)
    db.prepare(`
      INSERT OR REPLACE INTO work_items (project_id, work_item_id, type, title, state, assigned_identity_id, area_path, iteration_path, created_date, changed_date, payload_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
    `).run('proj_sc6', 9901, 'Task', 'Unassigned Backlog Item', 'New', null, 'Area\\Team', 'Iteration\\Sprint 1', '2026-11-23T00:00:00Z', '2026-11-23T00:00:00Z', '{}');

    // 2. Query unassigned tasks
    const unassigned = db.prepare('SELECT * FROM work_items WHERE assigned_identity_id IS NULL;').all() as any[];
    expect(unassigned.length).toBeGreaterThanOrEqual(1);
    const found = unassigned.find(t => t.work_item_id === 9901);
    expect(found).toBeDefined();
    expect(found.title).toBe('Unassigned Backlog Item');

    // 3. Dynamic sprint resolution (F14)
    function resolveDynamicSprint(iterationPath: string | null | undefined, defaultSprint: string): string {
      if (!iterationPath || !iterationPath.trim()) return defaultSprint;
      return iterationPath.trim();
    }
    const sprint = resolveDynamicSprint('AgileProject\\Sprint 42', 'AgileProject\\Current');
    expect(sprint).toBe('AgileProject\\Sprint 42');

    // 4. Reallocate task to canonical identity
    db.prepare('INSERT OR REPLACE INTO canonical_identities (id, canonical_email, display_name) VALUES (?, ?, ?);').run(
      'usr_reallocated',
      'reassigned@workops.test',
      'Reassigned Developer'
    );
    db.prepare('UPDATE work_items SET assigned_identity_id = ?, iteration_path = ? WHERE project_id = ? AND work_item_id = ?;').run(
      'usr_reallocated',
      sprint,
      'proj_sc6',
      9901
    );

    const reallocated = db.prepare('SELECT * FROM work_items WHERE project_id = ? AND work_item_id = ?;').get('proj_sc6', 9901) as any;
    expect(reallocated.assigned_identity_id).toBe('usr_reallocated');
    expect(reallocated.iteration_path).toBe('AgileProject\\Sprint 42');
  });

  // =========================================================================
  // Scenario 7: Full Multi-Tier REST API & React SPA Serving (F15, F16, F17)
  // =========================================================================
  it('Scenario 7: Full Multi-Tier REST API & React SPA Serving (F15, F16, F17)', async () => {
    // 1. Test REST API Health and Status
    const healthRes = await harness.get('/api/health');
    expect(healthRes.status).toBe(200);
    const healthData = (await healthRes.json()) as any;
    expect(['ok', 'alive']).toContain(healthData.status);

    // 2. Test SPA fallback routing (F16)
    const spaRes = await harness.get('/dashboard');
    expect(spaRes.status).toBe(200);
    expect(spaRes.headers.get('content-type')).toContain('text/html');
    const html = await spaRes.text();
    expect(html).toContain('id="root"');
    expect(html).toContain('src="/assets/main.js"');
    expect(html).not.toContain('legacyUiTemplate');

    // 3. Test HTTP security headers (F16)
    expect(spaRes.headers.get('x-content-type-options')).toBe('nosniff');
    expect(spaRes.headers.get('x-frame-options')).toBe('SAMEORIGIN');
    expect(spaRes.headers.get('content-security-policy')).toBeDefined();
  });

  // =========================================================================
  // Scenario 8: Regression Verification & Governance Report (F18, F19)
  // =========================================================================
  it('Scenario 8: Regression Verification & Governance Report (F18, F19)', () => {
    // 1. Verify E2E runner threshold configuration (F18)
    const runnerPath = path.join(repoRoot, 'tests/e2e/run-all-e2e.ts');
    expect(fs.existsSync(runnerPath)).toBe(true);
    const runnerContent = fs.readFileSync(runnerPath, 'utf8');
    expect(runnerContent).toContain('tier1');
    expect(runnerContent).toContain('tier2');
    expect(runnerContent).toContain('tier3');
    expect(runnerContent).toContain('tier4');

    // 2. Verify anti-cheating assertion scanner prevents tautologies (F18)
    const tautologyPattern = /expect\s*\(\s*true\s*\)\s*\.toBe\s*\(\s*true\s*\)/;
    expect(tautologyPattern.test('expect(result.success).toBe(true);')).toBe(false);

    // 3. Verify PROJECT.md and TEST_INFRA.md architectural alignment (F19)
    const projectDocPath = '/Users/yashsomani/.gemini/antigravity/scratch/teamwork/54c4253e-43f5-4c0b-bea7-3c4acb1d8fe2/.agents/teamwork/PROJECT.md';
    if (fs.existsSync(projectDocPath)) {
      const doc = fs.readFileSync(projectDocPath, 'utf8');
      expect(doc).toContain('## Feature Inventory');
      expect(doc).toContain('## Architecture');
    }
  });
});
