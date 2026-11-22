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
  // Fallback to ISO format
  try {
    const d = new Date(trimmed);
    if (!isNaN(d.getTime())) {
      return d.toISOString().slice(0, 10);
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

    // 2. Migrate People / Members
    if (fs.existsSync(peoplePath)) {
      try {
        const raw = fs.readFileSync(peoplePath, 'utf8');
        let peopleData: any = JSON.parse(raw);
        const peopleList: any[] = Array.isArray(peopleData)
          ? peopleData
          : peopleData.people || [];

        report.sourceMembers = peopleList.length;

        // Deduplicate members by email
        const deduplicated = new Map<string, any>();
        for (const person of peopleList) {
          const email = (person.email || person.assignedTo || `${person.key}@workops.test`).toLowerCase();
          deduplicated.set(email, person);
        }

        for (const [email, person] of deduplicated.entries()) {
          const memberId = person.id || `member-${person.key || crypto.randomUUID()}`;
          const displayName = person.name || person.displayName || person.key || email;
          const role = person.role || 'Developer';

          if (this.db.engine === 'sqlite') {
            this.db.sqlite
              .prepare(
                `INSERT OR REPLACE INTO members (id, team_id, email, display_name, role)
                 VALUES (?, ?, ?, ?, ?)`
              )
              .run(memberId, teamId, email, displayName, role);
          } else {
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
        const timezone = cal.timezone || 'UTC';
        const cycleAnchorDay = Number(cal.cycleAnchorDay ?? cal.cycle_anchor_day ?? 4);

        if (this.db.engine === 'sqlite') {
          this.db.sqlite
            .prepare(
              `INSERT OR REPLACE INTO work_calendars (id, team_id, timezone, cycle_anchor_day)
               VALUES (?, ?, ?, ?)`
            )
            .run(calId, teamId, timezone, cycleAnchorDay);
        } else {
          await this.db.pool.query(
            `INSERT INTO work_calendars (id, team_id, timezone, cycle_anchor_day)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (id) DO UPDATE SET
               timezone = EXCLUDED.timezone,
               cycle_anchor_day = EXCLUDED.cycle_anchor_day`,
            [calId, teamId, timezone, cycleAnchorDay]
          );
        }

        // Migrate exceptions
        const exceptions: any[] = cal.exceptions || [];
        for (const exc of exceptions) {
          const excId = `exc-${crypto.randomUUID()}`;
          const normalizedDate = normalizeDateFormat(exc.date);
          const isWorkingDay = exc.isWorkingDay ? 1 : 0;
          const description = exc.description || null;

          if (this.db.engine === 'sqlite') {
            this.db.sqlite
              .prepare(
                `INSERT OR REPLACE INTO calendar_exceptions (id, calendar_id, date, is_working_day, description)
                 VALUES (?, ?, ?, ?, ?)`
              )
              .run(excId, calId, normalizedDate, isWorkingDay, description);
          } else {
            await this.db.pool.query(
              `INSERT INTO calendar_exceptions (id, calendar_id, date, is_working_day, description)
               VALUES ($1, $2, $3, $4, $5)`,
              [excId, calId, normalizedDate, isWorkingDay, description]
            );
          }
        }
      } catch (err: any) {
        report.errors.push(`Error migrating work calendar: ${err.message}`);
      }
    }

    // 4. Migrate Task Journal
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
                id, team_id, action_type, operator_email, work_item_id, details_json, created_at
              ) VALUES (?, ?, ?, ?, ?, ?, ?)
            `);
            for (const entry of batch) {
              const id = entry.id || entry.runId || `j-${crypto.randomUUID()}`;
              const actionType = entry.action || entry.action_type || 'TASK_CREATED';
              const operatorEmail = entry.operator_email || entry.assignedTo || 'admin@workops.test';
              const workItemId = entry.createdWorkItemId ?? entry.taskId ?? null;
              const detailsJson = JSON.stringify(entry);
              const createdAt = entry.timestamp ? normalizeDateFormat(entry.timestamp) : new Date().toISOString();

              stmt.run(id, teamId, actionType, operatorEmail, workItemId, detailsJson, createdAt);
              report.migratedJournalEntries++;
            }
            this.db.sqlite.exec('COMMIT;');
          } else {
            for (const entry of batch) {
              const id = entry.id || entry.runId || `j-${crypto.randomUUID()}`;
              const actionType = entry.action || entry.action_type || 'TASK_CREATED';
              const operatorEmail = entry.operator_email || entry.assignedTo || 'admin@workops.test';
              const workItemId = entry.createdWorkItemId ?? entry.taskId ?? null;
              const detailsJson = JSON.stringify(entry);
              const createdAt = entry.timestamp ? normalizeDateFormat(entry.timestamp) : new Date().toISOString();

              await this.db.pool.query(
                `INSERT INTO journal_entries (
                  id, team_id, action_type, operator_email, work_item_id, details_json, created_at
                ) VALUES ($1, $2, $3, $4, $5, $6, $7)
                ON CONFLICT (id) DO UPDATE SET
                  details_json = EXCLUDED.details_json`,
                [id, teamId, actionType, operatorEmail, workItemId, detailsJson, createdAt]
              );
              report.migratedJournalEntries++;
            }
          }
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

    // 5. Migrate Auto-Closure Rules
    if (fs.existsSync(autoClosureConfigPath)) {
      try {
        const raw = fs.readFileSync(autoClosureConfigPath, 'utf8');
        const autoConfig: any = JSON.parse(raw);
        const rules: any[] = autoConfig.rules || [];

        report.sourceAutoClosureRules = rules.length;

        for (const rule of rules) {
          const ruleId = rule.id || `rule-${crypto.randomUUID()}`;
          const cutoffTime = rule.cutoffTime || '18:00';
          const minHours = Number(rule.minHours ?? 8.0);
          const requirePrEvidence = rule.requirePrEvidence !== false ? 1 : 0;

          if (this.db.engine === 'sqlite') {
            this.db.sqlite
              .prepare(
                `INSERT OR REPLACE INTO auto_closure_rules (
                  id, team_id, cutoff_time, min_hours, require_pr_evidence
                ) VALUES (?, ?, ?, ?, ?)`
              )
              .run(ruleId, teamId, cutoffTime, minHours, requirePrEvidence);
          } else {
            await this.db.pool.query(
              `INSERT INTO auto_closure_rules (
                id, team_id, cutoff_time, min_hours, require_pr_evidence
              ) VALUES ($1, $2, $3, $4, $5)
              ON CONFLICT (id) DO UPDATE SET
                cutoff_time = EXCLUDED.cutoff_time,
                min_hours = EXCLUDED.min_hours,
                require_pr_evidence = EXCLUDED.require_pr_evidence`,
              [ruleId, teamId, cutoffTime, minHours, requirePrEvidence]
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
