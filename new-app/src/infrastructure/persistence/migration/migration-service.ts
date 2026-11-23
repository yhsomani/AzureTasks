import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { WorkOpsDb } from '../database.js';

export interface MigrationOptions {
  peoplePath?: string;
  journalPath?: string;
  autoClosureConfigPath?: string;
  calendarPath?: string;
  organizationId?: string;
  organizationName?: string;
  departmentName?: string;
  teamName?: string;
}

export interface MigrationReport {
  success: boolean;
  sourceMembers: number;
  migratedMembers: number;
  sourceJournalEntries: number;
  migratedJournalEntries: number;
  sourceAutoClosureRules: number;
  migratedAutoClosureRules: number;
  migratedAppSettings?: number;
  dbJournalCount?: number;
  errors: string[];
}

export function normalizeDateFormat(dateStr: string): string {
  if (!dateStr) return dateStr;
  const trimmed = dateStr.trim();
  // Check if DD/MM/YYYY
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(trimmed)) {
    const parts = trimmed.split('/');
    const day = parts[0].padStart(2, '0');
    const month = parts[1].padStart(2, '0');
    const year = parts[2];
    return `${year}-${month}-${day}`;
  }
  // Check if already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return trimmed;
  }
  // Fallback to ISO format: retain full ISO 8601 UTC with millisecond precision
  try {
    const d = new Date(trimmed);
    if (!isNaN(d.getTime())) {
      return d.toISOString();
    }
  } catch {
    // ignore
  }
  return trimmed;
}

export class MigrationService {
  constructor(private readonly db: WorkOpsDb) {}

  public async migrate(options: MigrationOptions = {}): Promise<MigrationReport> {
    const report: MigrationReport = {
      success: true,
      sourceMembers: 0,
      migratedMembers: 0,
      sourceJournalEntries: 0,
      migratedJournalEntries: 0,
      sourceAutoClosureRules: 0,
      migratedAutoClosureRules: 0,
      migratedAppSettings: 0,
      dbJournalCount: 0,
      errors: [],
    };

    const cwd = process.cwd();
    const peoplePath = options.peoplePath || path.resolve(cwd, 'people.json');
    const journalPath = options.journalPath || path.resolve(cwd, '.task-journal.json');
    const autoClosureConfigPath =
      options.autoClosureConfigPath || path.resolve(cwd, '.auto-closure-config.json');
    const calendarPath =
      options.calendarPath || path.resolve(cwd, '.work-calendar.json');

    // 1. Ensure default Organization, Department, and Team exist
    const orgId = options.organizationId || 'org-default';
    const orgName = options.organizationName || 'Default Organization';
    const orgSlug = 'default-org';
    const deptId = 'dept-default';
    const deptName = options.departmentName || 'Engineering';
    const teamId = 'team-default';
    const teamName = options.teamName || 'Core Team';

    try {
      if (this.db.engine === 'sqlite') {
        this.db.sqlite.exec('BEGIN TRANSACTION;');
        this.db.sqlite
          .prepare(
            `INSERT OR IGNORE INTO organizations (id, name, slug) VALUES (?, ?, ?)`
          )
          .run(orgId, orgName, orgSlug);

        this.db.sqlite
          .prepare(
            `INSERT OR IGNORE INTO departments (id, org_id, name) VALUES (?, ?, ?)`
          )
          .run(deptId, orgId, deptName);

        this.db.sqlite
          .prepare(
            `INSERT OR IGNORE INTO teams (id, dept_id, name) VALUES (?, ?, ?)`
          )
          .run(teamId, deptId, teamName);
        this.db.sqlite.exec('COMMIT;');
      } else {
        await this.db.pool.query(
          `INSERT INTO organizations (id, name, slug) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING`,
          [orgId, orgName, orgSlug]
        );
        await this.db.pool.query(
          `INSERT INTO departments (id, org_id, name) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING`,
          [deptId, orgId, deptName]
        );
        await this.db.pool.query(
          `INSERT INTO teams (id, dept_id, name) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING`,
          [teamId, deptId, teamName]
        );
      }
    } catch (err: any) {
      if (this.db.engine === 'sqlite') {
        try {
          this.db.sqlite.exec('ROLLBACK;');
        } catch {
          // ignore
        }
      }
      report.errors.push(`Failed to initialize default tenant hierarchy: ${err.message}`);
      report.success = false;
      return report;
    }

    // 2. Migrate People / Members & App Settings
    if (fs.existsSync(peoplePath)) {
      try {
        const raw = fs.readFileSync(peoplePath, 'utf8');
        let peopleData: any = JSON.parse(raw);
        const peopleList: any[] = Array.isArray(peopleData)
          ? peopleData
          : peopleData.people || [];

        report.sourceMembers = peopleList.length;

        // Ingest top-level system configuration settings into app_settings
        if (!Array.isArray(peopleData) && typeof peopleData === 'object') {
          for (const [key, val] of Object.entries(peopleData)) {
            if (key === 'people') continue;
            let category = 'general';
            if (['githubOrg', 'githubUserSuffix'].includes(key)) {
              category = 'github';
            } else if (['schedulerEnabled', 'scheduleTime', 'schedulerAutoStart'].includes(key)) {
              category = 'scheduler';
            } else if (
              ['autoClose', 'autoCloseStartTime', 'autoCloseEndTime', 'autoActive', 'autoActiveTime'].includes(key)
            ) {
              category = 'autoclosure';
            } else if (
              ['organization', 'project', 'workItemType', 'titlePrefix', 'startTime', 'timezone', 'thursdayMode'].includes(key)
            ) {
              category = 'azure';
            }

            const valueJson = JSON.stringify(val);
            const desc = `Global configuration setting: ${key}`;
            const updatedAt = new Date().toISOString();

            if (this.db.engine === 'sqlite') {
              this.db.sqlite
                .prepare(
                  `INSERT OR REPLACE INTO app_settings (key, value_json, category, description, updated_at)
                   VALUES (?, ?, ?, ?, ?)`
                )
                .run(key, valueJson, category, desc, updatedAt);
            } else {
              await this.db.pool.query(
                `INSERT INTO app_settings (key, value_json, category, description, updated_at)
                 VALUES ($1, $2, $3, $4, $5)
                 ON CONFLICT (key) DO UPDATE SET
                   value_json = EXCLUDED.value_json,
                   category = EXCLUDED.category,
                   description = EXCLUDED.description,
                   updated_at = EXCLUDED.updated_at`,
                [key, valueJson, category, desc, updatedAt]
              );
            }
            if (report.migratedAppSettings !== undefined) {
              report.migratedAppSettings++;
            }
          }
        }

        // Deduplicate members by email
        const deduplicated = new Map<string, any>();
        for (const person of peopleList) {
          const email = (person.email || person.assignedTo || `${person.key}@workops.test`).toLowerCase();
          deduplicated.set(email, person);
        }

        for (const [email, person] of deduplicated.entries()) {
          const memberKey = person.key || email.split('@')[0];
          const canonicalId = `usr_${memberKey}`;
          const memberId = person.id || `member-${memberKey}`;
          const teamMemberId = `tm_${teamId}_${memberKey}`;
          const displayName = person.name || person.displayName || person.key || email;
          const role = person.role || 'Developer';
          const pod = person.pod || null;
          const titlePrefix = person.titlePrefix || person.title_prefix || null;
          const autoCloseEnabled = person.autoCloseEnabled !== false ? 1 : 0;
          const enabled = person.enabled !== false ? 1 : 0;
          const sourceTaskId = person.sourceTaskId ? Number(person.sourceTaskId) : null;
          const githubUsername = person.githubUsername || null;
          const githubRepositoriesJson = JSON.stringify(person.githubRepositories || []);
          const githubBranchesJson = JSON.stringify(person.githubBranches || []);
          const nowIso = new Date().toISOString();

          if (this.db.engine === 'sqlite') {
            // Ingest into canonical_identities
            this.db.sqlite
              .prepare(
                `INSERT OR REPLACE INTO canonical_identities (
                  id, canonical_email, display_name, primary_username, avatar_url, is_active, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
              )
              .run(canonicalId, email, displayName, githubUsername || memberKey, null, enabled, nowIso, nowIso);

            // Ingest aliases into identity_aliases
            const aliasStmt = this.db.sqlite.prepare(`
              INSERT OR IGNORE INTO identity_aliases (
                id, canonical_id, identity_type, alias_value, is_verified, created_at
              ) VALUES (?, ?, ?, ?, ?, ?)
            `);
            aliasStmt.run(`ia_${canonicalId}_email`, canonicalId, 'azure_email', email, 1, nowIso);
            if (githubUsername) {
              aliasStmt.run(`ia_${canonicalId}_gh`, canonicalId, 'github_username', githubUsername, 1, nowIso);
            }
            if (person.key) {
              aliasStmt.run(`ia_${canonicalId}_key`, canonicalId, 'upn_alias', person.key, 1, nowIso);
            }
            aliasStmt.run(`ia_${canonicalId}_disp`, canonicalId, 'display_alias', displayName, 1, nowIso);

            // Ingest into team_members (preserving all 8 attributes)
            this.db.sqlite
              .prepare(
                `INSERT OR REPLACE INTO team_members (
                  id, team_id, canonical_id, role, pod, title_prefix, auto_close_enabled, enabled, source_task_id, github_repositories_json, github_branches_json, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
              )
              .run(
                teamMemberId,
                teamId,
                canonicalId,
                role,
                pod,
                titlePrefix,
                autoCloseEnabled,
                enabled,
                sourceTaskId,
                githubRepositoriesJson,
                githubBranchesJson,
                nowIso,
                nowIso
              );

            // Legacy members table insertion for backward compatibility
            this.db.sqlite
              .prepare(
                `INSERT OR REPLACE INTO members (id, team_id, email, display_name, role)
                 VALUES (?, ?, ?, ?, ?)`
              )
              .run(memberId, teamId, email, displayName, role);
          } else {
            // PostgreSQL
            await this.db.pool.query(
              `INSERT INTO canonical_identities (
                id, canonical_email, display_name, primary_username, avatar_url, is_active, created_at, updated_at
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
              ON CONFLICT (canonical_email) DO UPDATE SET
                display_name = EXCLUDED.display_name,
                primary_username = EXCLUDED.primary_username,
                is_active = EXCLUDED.is_active,
                updated_at = EXCLUDED.updated_at`,
              [canonicalId, email, displayName, githubUsername || memberKey, null, enabled, nowIso, nowIso]
            );

            // Aliases
            await this.db.pool.query(
              `INSERT INTO identity_aliases (id, canonical_id, identity_type, alias_value, is_verified, created_at)
               VALUES ($1, $2, $3, $4, $5, $6)
               ON CONFLICT (identity_type, alias_value) DO NOTHING`,
              [`ia_${canonicalId}_email`, canonicalId, 'azure_email', email, 1, nowIso]
            );
            if (githubUsername) {
              await this.db.pool.query(
                `INSERT INTO identity_aliases (id, canonical_id, identity_type, alias_value, is_verified, created_at)
                 VALUES ($1, $2, $3, $4, $5, $6)
                 ON CONFLICT (identity_type, alias_value) DO NOTHING`,
                [`ia_${canonicalId}_gh`, canonicalId, 'github_username', githubUsername, 1, nowIso]
              );
            }

            // Team Members
            await this.db.pool.query(
              `INSERT INTO team_members (
                id, team_id, canonical_id, role, pod, title_prefix, auto_close_enabled, enabled, source_task_id, github_repositories_json, github_branches_json, created_at, updated_at
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
              ON CONFLICT (team_id, canonical_id) DO UPDATE SET
                role = EXCLUDED.role,
                pod = EXCLUDED.pod,
                title_prefix = EXCLUDED.title_prefix,
                auto_close_enabled = EXCLUDED.auto_close_enabled,
                enabled = EXCLUDED.enabled,
                source_task_id = EXCLUDED.source_task_id,
                github_repositories_json = EXCLUDED.github_repositories_json,
                github_branches_json = EXCLUDED.github_branches_json,
                updated_at = EXCLUDED.updated_at`,
              [
                teamMemberId,
                teamId,
                canonicalId,
                role,
                pod,
                titlePrefix,
                autoCloseEnabled,
                enabled,
                sourceTaskId,
                githubRepositoriesJson,
                githubBranchesJson,
                nowIso,
                nowIso,
              ]
            );

            // Legacy members
            await this.db.pool.query(
              `INSERT INTO members (id, team_id, email, display_name, role)
               VALUES ($1, $2, $3, $4, $5)
               ON CONFLICT (email) DO UPDATE SET
                 team_id = EXCLUDED.team_id,
                 display_name = EXCLUDED.display_name,
                 role = EXCLUDED.role`,
              [memberId, teamId, email, displayName, role]
            );
          }
          report.migratedMembers++;
        }
      } catch (err: any) {
        report.errors.push(`Error migrating people: ${err.message}`);
        report.success = false;
      }
    }

    // 3. Migrate Calendar (if present)
    const calendarJsonPath = fs.existsSync(calendarPath) ? calendarPath : null;
    if (calendarJsonPath) {
      try {
        const raw = fs.readFileSync(calendarJsonPath, 'utf8');
        const cal = JSON.parse(raw);
        const calId = `cal-${teamId}`;
        const timezone = cal.timezone || 'Asia/Kolkata';
        const cycleAnchorDay = Number(cal.cycleAnchorDay ?? cal.cycle_anchor_day ?? 4);
        const defaultHours = Number(cal.defaultHours ?? cal.default_hours ?? 8.0);

        if (this.db.engine === 'sqlite') {
          this.db.sqlite
            .prepare(
              `INSERT OR REPLACE INTO work_calendars (id, team_id, timezone, cycle_anchor_day, default_hours)
               VALUES (?, ?, ?, ?, ?)`
            )
            .run(calId, teamId, timezone, cycleAnchorDay, defaultHours);
        } else {
          await this.db.pool.query(
            `INSERT INTO work_calendars (id, team_id, timezone, cycle_anchor_day, default_hours)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (id) DO UPDATE SET
               timezone = EXCLUDED.timezone,
               cycle_anchor_day = EXCLUDED.cycle_anchor_day,
               default_hours = EXCLUDED.default_hours`,
            [calId, teamId, timezone, cycleAnchorDay, defaultHours]
          );
        }

        // Migrate exceptions
        const exceptions: any[] = cal.exceptions || [];
        for (const exc of exceptions) {
          const excId = `exc-${crypto.randomUUID()}`;
          const normalizedDate = normalizeDateFormat(exc.date);
          const isWorkingDay = exc.isWorkingDay ? 1 : 0;
          const availableHours = Number(exc.availableHours ?? exc.available_hours ?? 0.0);
          const description = exc.description || null;

          if (this.db.engine === 'sqlite') {
            this.db.sqlite
              .prepare(
                `INSERT OR REPLACE INTO calendar_exceptions (id, calendar_id, date, is_working_day, available_hours, description)
                 VALUES (?, ?, ?, ?, ?, ?)`
              )
              .run(excId, calId, normalizedDate, isWorkingDay, availableHours, description);
          } else {
            await this.db.pool.query(
              `INSERT INTO calendar_exceptions (id, calendar_id, date, is_working_day, available_hours, description)
               VALUES ($1, $2, $3, $4, $5, $6)`,
              [excId, calId, normalizedDate, isWorkingDay, availableHours, description]
            );
          }
        }
      } catch (err: any) {
        report.errors.push(`Error migrating work calendar: ${err.message}`);
      }
    }

    // 4. Migrate Task Journal with Collision Fix & Full Millisecond Timestamp Preservation
    if (fs.existsSync(journalPath)) {
      try {
        const raw = fs.readFileSync(journalPath, 'utf8');
        const entries: any[] = JSON.parse(raw);
        if (!Array.isArray(entries)) {
          throw new Error('Corrupt source JSON syntax: expected array');
        }

        report.sourceJournalEntries = entries.length;

        // Process in batches
        const batchSize = 500;
        for (let i = 0; i < entries.length; i += batchSize) {
          const batch = entries.slice(i, i + batchSize);
          if (this.db.engine === 'sqlite') {
            this.db.sqlite.exec('BEGIN TRANSACTION;');
            const stmt = this.db.sqlite.prepare(`
              INSERT OR REPLACE INTO journal_entries (
                id, run_id, team_id, operator_id, operator_email, action_type, work_item_id, project_id, target_iso_date, title, field_copy_status, relation_copy_status, verified, details_json, created_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);
            for (let bIdx = 0; bIdx < batch.length; bIdx++) {
              const entryIndex = i + bIdx;
              const entry = batch[bIdx];

              // Collision-free deterministic ID generation
              const id =
                entry.id ||
                (entry.runId ? `j_${entry.runId}_${entryIndex}` : null) ||
                (entry.taskId ? `j_task_${entry.taskId}_${entryIndex}` : null) ||
                `j_${entryIndex}_${crypto.randomUUID()}`;

              const runId = entry.runId || (entry.action ? `run_${entry.action.toLowerCase()}_${entry.isoDate || 'legacy'}` : 'legacy');
              const actionType = entry.action || entry.action_type || entry.actionType || (entry.createdWorkItemId ? 'CREATED' : 'TASK_CREATED');
              const operatorEmail = entry.operator_email || entry.operatorEmail || entry.assignedTo || 'admin@workops.test';
              const workItemId = entry.createdWorkItemId ?? entry.taskId ?? entry.work_item_id ?? null;
              const projectId = entry.project_id || null;
              const targetIsoDate = entry.targetIsoDate || entry.isoDate || (entry.timestamp ? normalizeDateFormat(entry.timestamp).slice(0, 10) : null);
              const title = entry.title || null;
              const fieldCopyStatus = entry.fieldCopyStatus || null;
              const relationCopyStatus = entry.relationCopyStatus || null;
              const verified = entry.verified !== false ? 1 : 0;
              const detailsJson = JSON.stringify(entry);

              // Preserve full ISO 8601 UTC timestamp with millisecond precision
              const createdAt = entry.timestamp ? normalizeDateFormat(entry.timestamp) : new Date().toISOString();

              stmt.run(
                id,
                runId,
                teamId,
                null, // operator_id
                operatorEmail,
                actionType,
                workItemId,
                projectId,
                targetIsoDate,
                title,
                fieldCopyStatus,
                relationCopyStatus,
                verified,
                detailsJson,
                createdAt
              );
              report.migratedJournalEntries++;
            }
            this.db.sqlite.exec('COMMIT;');
          } else {
            const client = await this.db.pool.connect();
            try {
              await client.query('BEGIN');
              for (let bIdx = 0; bIdx < batch.length; bIdx++) {
                const entryIndex = i + bIdx;
                const entry = batch[bIdx];

                const id =
                  entry.id ||
                  (entry.runId ? `j_${entry.runId}_${entryIndex}` : null) ||
                  (entry.taskId ? `j_task_${entry.taskId}_${entryIndex}` : null) ||
                  `j_${entryIndex}_${crypto.randomUUID()}`;

                const runId = entry.runId || (entry.action ? `run_${entry.action.toLowerCase()}_${entry.isoDate || 'legacy'}` : 'legacy');
                const actionType = entry.action || entry.action_type || entry.actionType || (entry.createdWorkItemId ? 'CREATED' : 'TASK_CREATED');
                const operatorEmail = entry.operator_email || entry.operatorEmail || entry.assignedTo || 'admin@workops.test';
                const workItemId = entry.createdWorkItemId ?? entry.taskId ?? entry.work_item_id ?? null;
                const projectId = entry.project_id || null;
                const targetIsoDate = entry.targetIsoDate || entry.isoDate || (entry.timestamp ? normalizeDateFormat(entry.timestamp).slice(0, 10) : null);
                const title = entry.title || null;
                const fieldCopyStatus = entry.fieldCopyStatus || null;
                const relationCopyStatus = entry.relationCopyStatus || null;
                const verified = entry.verified !== false ? 1 : 0;
                const detailsJson = JSON.stringify(entry);
                const createdAt = entry.timestamp ? normalizeDateFormat(entry.timestamp) : new Date().toISOString();

                await client.query(
                  `INSERT INTO journal_entries (
                    id, run_id, team_id, operator_email, action_type, work_item_id, project_id, target_iso_date, title, field_copy_status, relation_copy_status, verified, details_json, created_at
                  ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
                  ON CONFLICT (id) DO UPDATE SET
                    run_id = EXCLUDED.run_id,
                    team_id = EXCLUDED.team_id,
                    operator_email = EXCLUDED.operator_email,
                    action_type = EXCLUDED.action_type,
                    work_item_id = EXCLUDED.work_item_id,
                    details_json = EXCLUDED.details_json,
                    created_at = EXCLUDED.created_at`,
                  [
                    id,
                    runId,
                    teamId,
                    operatorEmail,
                    actionType,
                    workItemId,
                    projectId,
                    targetIsoDate,
                    title,
                    fieldCopyStatus,
                    relationCopyStatus,
                    verified,
                    detailsJson,
                    createdAt,
                  ]
                );
                report.migratedJournalEntries++;
              }
              await client.query('COMMIT');
            } catch (err) {
              await client.query('ROLLBACK');
              throw err;
            } finally {
              client.release();
            }
          }
        }

        // Pre/Post Automated Record Count Assertion Gate
        let journalDbCount = 0;
        if (this.db.engine === 'sqlite') {
          const row = this.db.sqlite.prepare('SELECT count(*) as count FROM journal_entries').get() as { count: number };
          journalDbCount = row.count;
        } else {
          const res = await this.db.pool.query('SELECT count(*) as count FROM journal_entries');
          journalDbCount = Number(res.rows[0].count);
        }
        report.dbJournalCount = journalDbCount;

        if (journalDbCount < report.sourceJournalEntries) {
          throw new Error(
            `Data loss detected in journal migration: source has ${report.sourceJournalEntries} entries but database has only ${journalDbCount} rows (possible collision or silent drop)`
          );
        }
      } catch (err: any) {
        if (this.db.engine === 'sqlite') {
          try {
            this.db.sqlite.exec('ROLLBACK;');
          } catch {
            // ignore
          }
        }
        report.errors.push(`Error migrating journal: ${err.message}`);
        report.success = false;
      }
    }

    // 5. Migrate Auto-Closure Rules & Config
    if (fs.existsSync(autoClosureConfigPath)) {
      try {
        const raw = fs.readFileSync(autoClosureConfigPath, 'utf8');
        const autoConfig: any = JSON.parse(raw);
        const rules: any[] = autoConfig.rules || [];

        report.sourceAutoClosureRules = rules.length;

        // Persist auto-closure configuration in app_settings
        const configJson = JSON.stringify(autoConfig);
        const configUpdatedAt = new Date().toISOString();
        if (this.db.engine === 'sqlite') {
          this.db.sqlite
            .prepare(
              `INSERT OR REPLACE INTO app_settings (key, value_json, category, description, updated_at)
               VALUES (?, ?, ?, ?, ?)`
            )
            .run('auto_closure_config', configJson, 'autoclosure', 'Auto-closure engine configuration', configUpdatedAt);
        } else {
          await this.db.pool.query(
            `INSERT INTO app_settings (key, value_json, category, description, updated_at)
             VALUES ($1, $2, $3, $4, $5)
             ON CONFLICT (key) DO UPDATE SET
               value_json = EXCLUDED.value_json,
               category = EXCLUDED.category,
               description = EXCLUDED.description,
               updated_at = EXCLUDED.updated_at`,
            ['auto_closure_config', configJson, 'autoclosure', 'Auto-closure engine configuration', configUpdatedAt]
          );
        }
        if (report.migratedAppSettings !== undefined) {
          report.migratedAppSettings++;
        }

        for (const rule of rules) {
          const ruleId = rule.id || `rule-${crypto.randomUUID()}`;
          const ruleName = rule.name || rule.ruleName || 'Default Auto-Closure Rule';
          const cutoffTime = rule.cutoffTime || '18:00';
          const minHours = Number(rule.minHours ?? 8.0);
          const requirePrEvidence = rule.requirePrEvidence !== false ? 1 : 0;
          const requireGitCommits = rule.requireGitCommits ? 1 : 0;
          const isActive = rule.isActive !== false ? 1 : 0;
          const nowIso = new Date().toISOString();

          if (this.db.engine === 'sqlite') {
            this.db.sqlite
              .prepare(
                `INSERT OR REPLACE INTO auto_closure_rules (
                  id, team_id, rule_name, cutoff_time, min_hours, require_pr_evidence, require_git_commits, is_active, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
              )
              .run(ruleId, teamId, ruleName, cutoffTime, minHours, requirePrEvidence, requireGitCommits, isActive, nowIso, nowIso);
          } else {
            await this.db.pool.query(
              `INSERT INTO auto_closure_rules (
                id, team_id, rule_name, cutoff_time, min_hours, require_pr_evidence, require_git_commits, is_active, created_at, updated_at
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
              ON CONFLICT (id) DO UPDATE SET
                rule_name = EXCLUDED.rule_name,
                cutoff_time = EXCLUDED.cutoff_time,
                min_hours = EXCLUDED.min_hours,
                require_pr_evidence = EXCLUDED.require_pr_evidence,
                require_git_commits = EXCLUDED.require_git_commits,
                is_active = EXCLUDED.is_active,
                updated_at = EXCLUDED.updated_at`,
              [ruleId, teamId, ruleName, cutoffTime, minHours, requirePrEvidence, requireGitCommits, isActive, nowIso, nowIso]
            );
          }
          report.migratedAutoClosureRules++;
        }
      } catch (err: any) {
        report.errors.push(`Error migrating auto-closure rules: ${err.message}`);
      }
    }

    report.success = report.errors.length === 0;
    return report;
  }
}
