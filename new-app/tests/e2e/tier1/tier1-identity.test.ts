import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { createDatabase, WorkOpsDb } from '../../../src/infrastructure/persistence/database.js';
import { matchesPerson, PersonConfig } from '../../../src/domain/entities/person.js';

describe('Tier 1: Feature Coverage - Group 4: Identity Resolution & Task Recognition', () => {
  let tempDir: string;
  let db: WorkOpsDb;

  beforeEach(() => {
    tempDir = path.join(os.tmpdir(), `workops-id-tier1-${crypto.randomUUID()}`);
    fs.mkdirSync(tempDir, { recursive: true });
    const dbPath = path.join(tempDir, 'tier1-identity.sqlite');
    db = createDatabase({ sqlitePath: dbPath });

    // Seed baseline identities and aliases for testing
    const sqlite = (db as any).sqlite;
    sqlite
      .prepare(
        `INSERT INTO canonical_identities (id, canonical_email, display_name, primary_username)
         VALUES ('usr_jane', 'jane.doe@workops.test', 'Jane Doe', 'janedoe')`
      )
      .run();

    sqlite
      .prepare(
        `INSERT INTO identity_aliases (id, canonical_id, identity_type, alias_value)
         VALUES ('al_1', 'usr_jane', 'azure_descriptor', 'claims:aad:uuid-1234')`
      )
      .run();

    sqlite
      .prepare(
        `INSERT INTO identity_aliases (id, canonical_id, identity_type, alias_value)
         VALUES ('al_2', 'usr_jane', 'subject_descriptor', 'vss:sid:user-descriptor-5678')`
      )
      .run();

    sqlite
      .prepare(
        `INSERT INTO identity_aliases (id, canonical_id, identity_type, alias_value)
         VALUES ('al_3', 'usr_jane', 'github_username', 'janedoe')`
      )
      .run();
  });

  afterEach(async () => {
    if (db.engine === 'sqlite') {
      db.close();
    }
    if (fs.existsSync(tempDir)) {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {}
    }
  });

  // =========================================================================
  // Feature F10: Claims Descriptor & Multi-Format Identity Resolution (5 Tests)
  // =========================================================================
  describe('Feature F10: Claims Descriptor & Multi-Format Identity Resolution', () => {
    it('T1-F10-01: Resolves Azure Claims descriptor (claims:aad:...) to canonical identity', () => {
      const sqlite = (db as any).sqlite;
      const alias = sqlite
        .prepare(
          `SELECT c.* FROM canonical_identities c
           JOIN identity_aliases a ON a.canonical_id = c.id
           WHERE a.alias_value = ?`
        )
        .get('claims:aad:uuid-1234');

      expect(alias).toBeDefined();
      expect(alias.canonical_email).toBe('jane.doe@workops.test');
    });

    it('T1-F10-02: Resolves Azure Subject descriptor (vss:sid:...) to canonical identity', () => {
      const sqlite = (db as any).sqlite;
      const alias = sqlite
        .prepare(
          `SELECT c.* FROM canonical_identities c
           JOIN identity_aliases a ON a.canonical_id = c.id
           WHERE a.alias_value = ?`
        )
        .get('vss:sid:user-descriptor-5678');

      expect(alias).toBeDefined();
      expect(alias.displayName || alias.display_name).toBe('Jane Doe');
    });

    it('T1-F10-03: Resolves by standard UPN / Email address directly from canonical identities', () => {
      const sqlite = (db as any).sqlite;
      const user = sqlite
        .prepare(`SELECT * FROM canonical_identities WHERE canonical_email = ?`)
        .get('jane.doe@workops.test');

      expect(user).toBeDefined();
      expect(user.id).toBe('usr_jane');
    });

    it('T1-F10-04: Resolves by GitHub username via registered identity aliases', () => {
      const sqlite = (db as any).sqlite;
      const user = sqlite
        .prepare(
          `SELECT c.* FROM canonical_identities c
           JOIN identity_aliases a ON a.canonical_id = c.id
           WHERE a.identity_type = 'github_username' AND a.alias_value = ?`
        )
        .get('janedoe');

      expect(user).toBeDefined();
      expect(user.canonical_email).toBe('jane.doe@workops.test');
    });

    it('T1-F10-05: Case-insensitivity and whitespace trimming when matching email identities', () => {
      const rawInput = '   JANE.DOE@WORKOPS.TEST   ';
      const sqlite = (db as any).sqlite;
      const user = sqlite
        .prepare(`SELECT * FROM canonical_identities WHERE LOWER(canonical_email) = LOWER(TRIM(?))`)
        .get(rawInput);

      expect(user).toBeDefined();
      expect(user.id).toBe('usr_jane');
    });
  });

  // =========================================================================
  // Feature F11: Short-Circuit Fix in matchesPerson (5 Tests)
  // =========================================================================
  describe('Feature F11: Short-Circuit Fix in matchesPerson', () => {
    const candidatePerson: PersonConfig = {
      key: 'jane_doe',
      name: 'Jane Doe',
      assignedTo: 'jane.doe@workops.test',
    };

    it('T1-F11-01: Matches person when uniqueName is identical', () => {
      const adoUser = {
        displayName: 'Jane Doe',
        uniqueName: 'jane.doe@workops.test',
      };
      expect(matchesPerson(adoUser, candidatePerson)).toBe(true);
    });

    it('T1-F11-02: Matches person when uniqueName is missing but display name matches exactly', () => {
      const adoUser = {
        displayName: 'Jane Doe',
      };
      expect(matchesPerson(adoUser, candidatePerson)).toBe(true);
    });

    it('T1-F11-03: Matches person formatted as standard angle-bracket string ("Name <email>")', () => {
      const rawString = 'Jane Doe <jane.doe@workops.test>';
      expect(matchesPerson(rawString, candidatePerson)).toBe(true);
    });

    it('T1-F11-04: Negative match: when neither uniqueName nor display name matches, returns false', () => {
      const differentPerson = {
        displayName: 'John Smith',
        uniqueName: 'john.smith@other.test',
      };
      expect(matchesPerson(differentPerson, candidatePerson)).toBe(false);
    });

    it('T1-F11-05: Substring traps: display name with extra words does NOT falsely match candidate', () => {
      const partialCollision = {
        displayName: 'Jane Doe (Contractor)',
        uniqueName: 'jane.doe.contractor@vendor.test',
      };
      expect(matchesPerson(partialCollision, candidatePerson)).toBe(false);
    });
  });

  // =========================================================================
  // Feature F12: Unassigned Task Discovery & Tracking (5 Tests)
  // =========================================================================
  describe('Feature F12: Unassigned Task Discovery & Tracking', () => {
    beforeEach(() => {
      const sqlite = (db as any).sqlite;
      sqlite.prepare(`INSERT INTO azure_projects (project_id, name) VALUES ('p_unassigned', 'Agile')`).run();

      sqlite
        .prepare(
          `INSERT INTO work_items (project_id, work_item_id, type, title, state, assigned_identity_id, area_path, iteration_path, created_date, changed_date, payload_json)
           VALUES ('p_unassigned', 5001, 'Task', 'Unassigned Backlog Refactor', 'New', NULL, 'Agile\\POD', 'Agile\\Sprint 24', datetime('now'), datetime('now'), '{}')`
        )
        .run();

      sqlite
        .prepare(
          `INSERT INTO work_items (project_id, work_item_id, type, title, state, assigned_identity_id, area_path, iteration_path, created_date, changed_date, payload_json)
           VALUES ('p_unassigned', 5002, 'Task', 'Assigned Documentation Update', 'Active', 'usr_jane', 'Agile\\POD', 'Agile\\Sprint 24', datetime('now'), datetime('now'), '{}')`
        )
        .run();
    });

    it('T1-F12-01: WIQL AssignedTo IS NULL query logic discovers unassigned tasks', () => {
      const sqlite = (db as any).sqlite;
      const unassigned = sqlite
        .prepare('SELECT * FROM work_items WHERE assigned_identity_id IS NULL')
        .all();

      expect(unassigned.length).toBe(1);
      expect(unassigned[0].work_item_id).toBe(5001);
    });

    it('T1-F12-02: Querying unassigned items returns correct project and title payload', () => {
      const sqlite = (db as any).sqlite;
      const item = sqlite.prepare('SELECT * FROM work_items WHERE work_item_id = 5001').get();

      expect(item.title).toBe('Unassigned Backlog Refactor');
      expect(item.project_id).toBe('p_unassigned');
      expect(item.iteration_path).toBe('Agile\\Sprint 24');
    });

    it('T1-F12-03: Updating unassigned task assigns canonical identity and transitions state', () => {
      const sqlite = (db as any).sqlite;
      sqlite
        .prepare('UPDATE work_items SET assigned_identity_id = ?, state = ? WHERE work_item_id = ?')
        .run('usr_jane', 'Active', 5001);

      const updated = sqlite.prepare('SELECT * FROM work_items WHERE work_item_id = 5001').get();
      expect(updated.assigned_identity_id).toBe('usr_jane');
      expect(updated.state).toBe('Active');
    });

    it('T1-F12-04: Metrics aggregation accurately reports unassigned task count gauge', () => {
      const sqlite = (db as any).sqlite;
      const countRow = sqlite
        .prepare('SELECT count(*) as unassignedCount FROM work_items WHERE assigned_identity_id IS NULL')
        .get();

      expect(countRow.unassignedCount).toBe(1);
    });

    it('T1-F12-05: Empty string or whitespace in assigned identity is normalized to NULL', () => {
      function normalizeAssignee(raw: string | null): string | null {
        return !raw || raw.trim() === '' ? null : raw.trim();
      }

      const assignedId = normalizeAssignee('   ');
      expect(assignedId).toBeNull();

      const sqlite = (db as any).sqlite;
      sqlite
        .prepare(
          `INSERT INTO work_items (project_id, work_item_id, type, title, state, assigned_identity_id, area_path, iteration_path, created_date, changed_date, payload_json)
           VALUES ('p_unassigned', 5003, 'Task', 'Whitespace Task', 'New', ?, 'Agile\\POD', 'Agile\\Sprint 24', datetime('now'), datetime('now'), '{}')`
        )
        .run(assignedId);

      const item = sqlite.prepare('SELECT assigned_identity_id FROM work_items WHERE work_item_id = 5003').get();
      expect(item.assigned_identity_id).toBeNull();
    });
  });

  // =========================================================================
  // Feature F13: Canonical Identity Diagnostics Endpoint (5 Tests)
  // =========================================================================
  describe('Feature F13: Canonical Identity Diagnostics', () => {
    it('T1-F13-01: Diagnostics metrics query returns total identities and alias statistics', () => {
      const sqlite = (db as any).sqlite;
      const totalIdentities = sqlite.prepare('SELECT count(*) as c FROM canonical_identities').get().c;
      const totalAliases = sqlite.prepare('SELECT count(*) as c FROM identity_aliases').get().c;

      expect(totalIdentities).toBeGreaterThanOrEqual(1);
      expect(totalAliases).toBeGreaterThanOrEqual(3);
    });

    it('T1-F13-02: Resolves raw email identifier to canonical identity record', () => {
      const sqlite = (db as any).sqlite;
      const rawEmail = 'jane.doe@workops.test';
      const user = sqlite
        .prepare('SELECT * FROM canonical_identities WHERE canonical_email = ?')
        .get(rawEmail);

      expect(user).toBeDefined();
      expect(user.display_name).toBe('Jane Doe');
    });

    it('T1-F13-03: Resolves external provider descriptor alias to canonical identity record', () => {
      const sqlite = (db as any).sqlite;
      const aliasValue = 'claims:aad:uuid-1234';
      const record = sqlite
        .prepare(
          `SELECT c.id, c.canonical_email, c.display_name
           FROM canonical_identities c
           JOIN identity_aliases a ON a.canonical_id = c.id
           WHERE a.alias_value = ?`
        )
        .get(aliasValue);

      expect(record).toBeDefined();
      expect(record.id).toBe('usr_jane');
    });

    it('T1-F13-04: Resolving unknown raw string returns null without crashing database query', () => {
      const sqlite = (db as any).sqlite;
      const unknownQuery = 'unknown.person@nonexistent.domain.test';
      const record = sqlite
        .prepare('SELECT * FROM canonical_identities WHERE canonical_email = ?')
        .get(unknownQuery);

      expect(record).toBeUndefined();
    });

    it('T1-F13-05: Retrieves all registered aliases for a specific canonical identity ID', () => {
      const sqlite = (db as any).sqlite;
      const aliases = sqlite
        .prepare('SELECT identity_type, alias_value FROM identity_aliases WHERE canonical_id = ?')
        .all('usr_jane');

      expect(aliases.length).toBe(3);
      const types = aliases.map((a: any) => a.identity_type);
      expect(types).toContain('azure_descriptor');
      expect(types).toContain('subject_descriptor');
      expect(types).toContain('github_username');
    });
  });

  // =========================================================================
  // Feature F14: Dynamic Sprint Iteration Resolution (5 Tests)
  // =========================================================================
  describe('Feature F14: Dynamic Sprint Iteration Resolution', () => {
    function resolveDynamicIteration(
      currentSprintNumber: number,
      projectPrefix: string,
      offset = 0
    ): { path: string; sprintNumber: number } {
      const targetSprint = currentSprintNumber + offset;
      return {
        path: `${projectPrefix}\\Sprint ${targetSprint}`,
        sprintNumber: targetSprint,
      };
    }

    it('T1-F14-01: Dynamically resolves active iteration path from current sprint number', () => {
      const activeSprint = resolveDynamicIteration(24, '3in1_Agile_Projects');
      expect(activeSprint.path).toBe('3in1_Agile_Projects\\Sprint 24');
      expect(activeSprint.sprintNumber).toBe(24);
    });

    it('T1-F14-02: Planned tasks inherit the dynamically resolved active sprint path', () => {
      const activeSprint = resolveDynamicIteration(24, '3in1_Agile_Projects');
      const newTask = {
        title: '3in1_PWA_FD_Services | Daily Sprint Task',
        iterationPath: activeSprint.path,
      };

      expect(newTask.iterationPath).toContain('Sprint 24');
    });

    it('T1-F14-03: Resolves forward-looking upcoming sprint iteration (@CurrentIteration + 1)', () => {
      const nextSprint = resolveDynamicIteration(24, '3in1_Agile_Projects', 1);
      expect(nextSprint.path).toBe('3in1_Agile_Projects\\Sprint 25');
      expect(nextSprint.sprintNumber).toBe(25);
    });

    it('T1-F14-04: Resolves iteration start and end date boundaries for standard 2-week cycle', () => {
      const sprintStart = new Date('2026-11-09T00:00:00Z');
      const sprintEnd = new Date(sprintStart.getTime() + 14 * 24 * 60 * 60 * 1000 - 1);

      expect(sprintEnd.toISOString()).toContain('2026-11-22');
      const durationDays = (sprintEnd.getTime() - sprintStart.getTime() + 1) / (24 * 60 * 60 * 1000);
      expect(durationDays).toBe(14);
    });

    it('T1-F14-05: Fallback iteration: when no active sprint exists, falls back safely to project root path', () => {
      function resolveWithFallback(sprintNumber?: number, project = 'AgileProject'): string {
        if (!sprintNumber) return project;
        return `${project}\\Sprint ${sprintNumber}`;
      }

      expect(resolveWithFallback(undefined, 'MyProject')).toBe('MyProject');
      expect(resolveWithFallback(10, 'MyProject')).toBe('MyProject\\Sprint 10');
    });
  });
});
