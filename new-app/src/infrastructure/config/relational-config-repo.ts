/**
 * Relational Configuration Repository
 * Persists and loads application configuration, people, teams, and work calendar
 * using relational database tables (canonical_identities, team_members, app_settings,
 * work_calendars, calendar_exceptions).
 */

import * as fs from 'fs';
import * as path from 'path';
import crypto from 'node:crypto';
import { parse as parseDotenv } from 'dotenv';
import {
  ConfigRepository,
  AppConfig,
  PersonConfig,
} from '../../domain/ports/repositories.js';
import { WorkOpsDb } from '../persistence/database.js';
import { WorkCalendar, CalendarException } from '../../domain/services/work-calendar.js';
import { AtomicFileWriter } from '../persistence/atomic-file-writer.js';

const STOP_DAY_NAMES: Record<string, number> = {
  SUNDAY: 0, MONDAY: 1, TUESDAY: 2, WEDNESDAY: 3,
  THURSDAY: 4, FRIDAY: 5, SATURDAY: 6,
};

const DEFAULT_ORG_ID = 'org-default';
const DEFAULT_DEPT_ID = 'dept-default';
const DEFAULT_TEAM_ID = 'team-default';

export class RelationalConfigRepository implements ConfigRepository {
  private readonly envPath: string;

  constructor(
    private readonly db: WorkOpsDb,
    configFilePath?: string
  ) {
    this.envPath = configFilePath
      ? path.join(path.dirname(path.resolve(process.cwd(), configFilePath)), '.env')
      : path.resolve(process.cwd(), '.env');
  }

  /**
   * Ensure default tenant hierarchy exists so foreign key constraints succeed.
   */
  private async ensureTenantHierarchy(): Promise<void> {
    const nowIso = new Date().toISOString();
    if (this.db.engine === 'sqlite') {
      this.db.sqlite.prepare(`
        INSERT OR IGNORE INTO organizations (id, name, slug, created_at, updated_at)
        VALUES (?, 'Default Organization', 'default', ?, ?)
      `).run(DEFAULT_ORG_ID, nowIso, nowIso);

      this.db.sqlite.prepare(`
        INSERT OR IGNORE INTO departments (id, org_id, name, created_at)
        VALUES (?, ?, 'Engineering', ?)
      `).run(DEFAULT_DEPT_ID, DEFAULT_ORG_ID, nowIso);

      this.db.sqlite.prepare(`
        INSERT OR IGNORE INTO teams (id, dept_id, name, description, is_active, created_at, updated_at)
        VALUES (?, ?, 'Default Team', 'Primary team', 1, ?, ?)
      `).run(DEFAULT_TEAM_ID, DEFAULT_DEPT_ID, nowIso, nowIso);
    } else {
      await this.db.pool.query(`
        INSERT INTO organizations (id, name, slug, created_at, updated_at)
        VALUES ($1, 'Default Organization', 'default', $2, $3)
        ON CONFLICT (id) DO NOTHING
      `, [DEFAULT_ORG_ID, nowIso, nowIso]);

      await this.db.pool.query(`
        INSERT INTO departments (id, org_id, name, created_at)
        VALUES ($1, $2, 'Engineering', $3)
        ON CONFLICT (id) DO NOTHING
      `, [DEFAULT_DEPT_ID, DEFAULT_ORG_ID, nowIso]);

      await this.db.pool.query(`
        INSERT INTO teams (id, dept_id, name, description, is_active, created_at, updated_at)
        VALUES ($1, $2, 'Default Team', 'Primary team', 1, $3, $4)
        ON CONFLICT (id) DO NOTHING
      `, [DEFAULT_TEAM_ID, DEFAULT_DEPT_ID, nowIso, nowIso]);
    }
  }

  async load(): Promise<AppConfig> {
    const defaultConfig = this.getDefaultConfig();
    const settingsMap = new Map<string, any>();

    // 1. Load app_settings
    if (this.db.engine === 'sqlite') {
      const rows = this.db.sqlite.prepare('SELECT key, value_json FROM app_settings').all() as Array<{
        key: string;
        value_json: string;
      }>;
      for (const row of rows) {
        try {
          settingsMap.set(row.key, JSON.parse(row.value_json));
        } catch {
          // ignore corrupted single keys
        }
      }
    } else {
      const res = await this.db.pool.query('SELECT key, value_json FROM app_settings');
      for (const row of res.rows) {
        try {
          settingsMap.set(row.key, JSON.parse(row.value_json));
        } catch {
          // ignore
        }
      }
    }

    // 2. Load people from relational tables
    let people: PersonConfig[] = [];
    if (this.db.engine === 'sqlite') {
      const peopleRows = this.db.sqlite.prepare(`
        SELECT 
          ci.id as canonical_id,
          ci.canonical_email,
          ci.display_name,
          ci.primary_username,
          ci.is_active as ci_active,
          tm.role,
          tm.pod,
          tm.title_prefix,
          tm.auto_close_enabled,
          tm.enabled,
          tm.source_task_id,
          tm.github_repositories_json,
          tm.github_branches_json,
          ia.alias_value as upn_key
        FROM canonical_identities ci
        LEFT JOIN team_members tm ON tm.canonical_id = ci.id
        LEFT JOIN identity_aliases ia ON ia.canonical_id = ci.id AND ia.identity_type = 'upn_alias'
        ORDER BY ci.display_name ASC
      `).all() as any[];

      if (peopleRows.length > 0) {
        people = peopleRows.map((r) => {
          let repos: string[] = [];
          let branches: string[] = [];
          try {
            if (r.github_repositories_json) repos = JSON.parse(r.github_repositories_json);
          } catch {
            repos = [];
          }
          try {
            if (r.github_branches_json) branches = JSON.parse(r.github_branches_json);
          } catch {
            branches = [];
          }

          const person: PersonConfig = {
            key: r.upn_key || r.primary_username || (r.canonical_email ? r.canonical_email.split('@')[0] : r.canonical_id),
            name: r.display_name,
            assignedTo: r.canonical_email,
            role: r.role || 'Developer',
            enabled: r.enabled !== 0 && r.ci_active !== 0,
            autoCloseEnabled: r.auto_close_enabled !== 0,
          };
          if (r.pod) person.pod = r.pod;
          if (r.title_prefix) person.titlePrefix = r.title_prefix;
          if (r.source_task_id) person.sourceTaskId = Number(r.source_task_id);
          if (r.primary_username) person.githubUsername = r.primary_username;
          if (repos.length > 0) person.githubRepositories = repos;
          if (branches.length > 0) person.githubBranches = branches;
          return person;
        });
      }
    } else {
      const res = await this.db.pool.query(`
        SELECT 
          ci.id as canonical_id,
          ci.canonical_email,
          ci.display_name,
          ci.primary_username,
          ci.is_active as ci_active,
          tm.role,
          tm.pod,
          tm.title_prefix,
          tm.auto_close_enabled,
          tm.enabled,
          tm.source_task_id,
          tm.github_repositories_json,
          tm.github_branches_json,
          ia.alias_value as upn_key
        FROM canonical_identities ci
        LEFT JOIN team_members tm ON tm.canonical_id = ci.id
        LEFT JOIN identity_aliases ia ON ia.canonical_id = ci.id AND ia.identity_type = 'upn_alias'
        ORDER BY ci.display_name ASC
      `);
      if (res.rows.length > 0) {
        people = res.rows.map((r) => {
          let repos: string[] = [];
          let branches: string[] = [];
          try {
            if (r.github_repositories_json) repos = JSON.parse(r.github_repositories_json);
          } catch {
            repos = [];
          }
          try {
            if (r.github_branches_json) branches = JSON.parse(r.github_branches_json);
          } catch {
            branches = [];
          }

          const person: PersonConfig = {
            key: r.upn_key || r.primary_username || (r.canonical_email ? r.canonical_email.split('@')[0] : r.canonical_id),
            name: r.display_name,
            assignedTo: r.canonical_email,
            role: r.role || 'Developer',
            enabled: r.enabled !== 0 && r.ci_active !== 0,
            autoCloseEnabled: r.auto_close_enabled !== 0,
          };
          if (r.pod) person.pod = r.pod;
          if (r.title_prefix) person.titlePrefix = r.title_prefix;
          if (r.source_task_id) person.sourceTaskId = Number(r.source_task_id);
          if (r.primary_username) person.githubUsername = r.primary_username;
          if (repos.length > 0) person.githubRepositories = repos;
          if (branches.length > 0) person.githubBranches = branches;
          return person;
        });
      }
    }

    // Fall back to people cached in settings if relational table has 0 rows
    if (people.length === 0 && settingsMap.has('people') && Array.isArray(settingsMap.get('people'))) {
      people = settingsMap.get('people');
    }

    // 3. Load work calendar
    let calendar: WorkCalendar | undefined = settingsMap.get('calendar');
    if (!calendar) {
      calendar = await this.loadCalendarFromTables();
    }

    // 4. Validate people keys and identities
    const seenKeys = new Set<string>();
    const seenIdentities = new Set<string>();
    for (const person of people) {
      if (!person || typeof person.key !== 'string' || !person.key.trim()) {
        throw new Error('Configuration Error: Every person must have a non-empty key.');
      }
      const key = person.key.trim();
      if (seenKeys.has(key)) {
        throw new Error(`Configuration Error: Duplicate person key "${key}". Keys must be unique.`);
      }
      seenKeys.add(key);
      if (!person.assignedTo) continue;
      const lower = person.assignedTo.trim().toLowerCase();
      if (seenIdentities.has(lower)) {
        throw new Error(
          `Configuration Error: Duplicate identity found for "${person.assignedTo}". ` +
          `Multiple people cannot map to the same Azure DevOps identity.`
        );
      }
      seenIdentities.add(lower);
    }

    // 5. Merge settings overrides
    const overrides: Record<string, any> = {};
    for (const [k, v] of settingsMap.entries()) {
      if (k !== 'people' && k !== 'calendar') {
        overrides[k] = v;
      }
    }

    const namedStopDay = STOP_DAY_NAMES[String(overrides.stopDay ?? '').toUpperCase()];
    const stopDayOfWeek = namedStopDay !== undefined
      ? namedStopDay
      : typeof overrides.stopDayOfWeek === 'number'
        ? overrides.stopDayOfWeek
        : defaultConfig.stopDayOfWeek;

    const thursdayMode = overrides.thursdayMode?.toUpperCase() === 'FOLLOWING'
      ? ('FOLLOWING' as const)
      : ('CURRENT' as const);

    const envOverrides = this.loadEnvOverrides();

    return {
      ...defaultConfig,
      ...overrides,
      ...envOverrides,
      ...(process.env.GITHUB_TOKEN || process.env.GH_PAT
        ? { githubToken: process.env.GITHUB_TOKEN || process.env.GH_PAT }
        : {}),
      stopDayOfWeek,
      thursdayMode,
      calendar,
      people,
    };
  }

  private async loadCalendarFromTables(): Promise<WorkCalendar | undefined> {
    const calId = `cal-${DEFAULT_TEAM_ID}`;
    let calRow: any = null;
    let exceptions: CalendarException[] = [];

    if (this.db.engine === 'sqlite') {
      calRow = this.db.sqlite.prepare('SELECT * FROM work_calendars WHERE id = ?').get(calId);
      if (!calRow) return undefined;
      const excRows = this.db.sqlite.prepare('SELECT * FROM calendar_exceptions WHERE calendar_id = ?').all(calId) as any[];
      exceptions = excRows.map(r => ({
        id: r.id,
        label: r.description || '',
        kind: r.is_working_day ? 'holiday' : 'leave',
        startDate: r.date,
        endDate: r.date,
        memberKeys: r.canonical_id ? [r.canonical_id.replace(/^usr_/, '')] : [],
        availableHours: Number(r.available_hours ?? 0),
      }));
    } else {
      const res = await this.db.pool.query('SELECT * FROM work_calendars WHERE id = $1', [calId]);
      if (res.rows.length === 0) return undefined;
      calRow = res.rows[0];
      const excRes = await this.db.pool.query('SELECT * FROM calendar_exceptions WHERE calendar_id = $1', [calId]);
      exceptions = excRes.rows.map(r => ({
        id: r.id,
        label: r.description || '',
        kind: r.is_working_day ? 'holiday' : 'leave',
        startDate: r.date,
        endDate: r.date,
        memberKeys: r.canonical_id ? [r.canonical_id.replace(/^usr_/, '')] : [],
        availableHours: Number(r.available_hours ?? 0),
      }));
    }

    return {
      version: 1,
      defaultHours: Number(calRow.default_hours ?? 8.0),
      memberHours: {},
      exceptions,
    };
  }

  async save(config: AppConfig): Promise<void> {
    await this.ensureTenantHierarchy();

    // 1. Save settings
    const settingsToSave: Partial<AppConfig> = { ...config };
    delete (settingsToSave as any).githubToken;
    await this.saveSettings(settingsToSave);

    // 2. Save people
    if (config.people) {
      await this.savePeople(config.people);
    }

    // 3. Save work calendar
    if (config.calendar) {
      await this.saveWorkCalendar(config.calendar);
    }
  }

  async savePeople(people: PersonConfig[]): Promise<void> {
    await this.ensureTenantHierarchy();
    const nowIso = new Date().toISOString();

    // Mirror in app_settings for full round-trip fidelity
    await this.upsertAppSetting('people', people, 'general', 'Cached people configuration');

    const incomingEmails = new Set<string>();

    for (const person of people) {
      const memberKey = person.key || person.assignedTo.split('@')[0];
      const canonicalId = `usr_${memberKey}`;
      const memberId = `member-${memberKey}`;
      const teamMemberId = `tm_${DEFAULT_TEAM_ID}_${memberKey}`;
      const email = ((person as any).email || person.assignedTo || `${memberKey}@workops.test`).toLowerCase();
      incomingEmails.add(email);
      const displayName = person.name || memberKey;
      const role = person.role || 'Developer';
      const pod = person.pod || null;
      const titlePrefix = person.titlePrefix || null;
      const autoCloseEnabled = person.autoCloseEnabled !== false ? 1 : 0;
      const enabled = person.enabled !== false ? 1 : 0;
      const sourceTaskId = person.sourceTaskId ? Number(person.sourceTaskId) : null;
      const githubUsername = person.githubUsername || null;
      const githubRepositoriesJson = JSON.stringify(person.githubRepositories || []);
      const githubBranchesJson = JSON.stringify(person.githubBranches || []);

      if (this.db.engine === 'sqlite') {
        this.db.sqlite.prepare(`
          INSERT OR REPLACE INTO canonical_identities (
            id, canonical_email, display_name, primary_username, avatar_url, is_active, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(canonicalId, email, displayName, githubUsername || memberKey, null, enabled, nowIso, nowIso);

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

        this.db.sqlite.prepare(`
          INSERT OR REPLACE INTO team_members (
            id, team_id, canonical_id, role, pod, title_prefix, auto_close_enabled, enabled, source_task_id, github_repositories_json, github_branches_json, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          teamMemberId,
          DEFAULT_TEAM_ID,
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

        this.db.sqlite.prepare(`
          INSERT OR REPLACE INTO members (id, team_id, email, display_name, role)
          VALUES (?, ?, ?, ?, ?)
        `).run(memberId, DEFAULT_TEAM_ID, email, displayName, role);
      } else {
        await this.db.pool.query(`
          INSERT INTO canonical_identities (
            id, canonical_email, display_name, primary_username, avatar_url, is_active, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          ON CONFLICT (canonical_email) DO UPDATE SET
            display_name = EXCLUDED.display_name,
            primary_username = EXCLUDED.primary_username,
            is_active = EXCLUDED.is_active,
            updated_at = EXCLUDED.updated_at
        `, [canonicalId, email, displayName, githubUsername || memberKey, null, enabled, nowIso, nowIso]);

        await this.db.pool.query(`
          INSERT INTO identity_aliases (id, canonical_id, identity_type, alias_value, is_verified, created_at)
          VALUES ($1, $2, $3, $4, $5, $6)
          ON CONFLICT (identity_type, alias_value) DO NOTHING
        `, [`ia_${canonicalId}_email`, canonicalId, 'azure_email', email, 1, nowIso]);

        if (githubUsername) {
          await this.db.pool.query(`
            INSERT INTO identity_aliases (id, canonical_id, identity_type, alias_value, is_verified, created_at)
            VALUES ($1, $2, $3, $4, $5, $6)
            ON CONFLICT (identity_type, alias_value) DO NOTHING
          `, [`ia_${canonicalId}_gh`, canonicalId, 'github_username', githubUsername, 1, nowIso]);
        }

        await this.db.pool.query(`
          INSERT INTO team_members (
            id, team_id, canonical_id, role, pod, title_prefix, auto_close_enabled, enabled, source_task_id, github_repositories_json, github_branches_json, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
          ON CONFLICT (id) DO UPDATE SET
            role = EXCLUDED.role,
            pod = EXCLUDED.pod,
            title_prefix = EXCLUDED.title_prefix,
            auto_close_enabled = EXCLUDED.auto_close_enabled,
            enabled = EXCLUDED.enabled,
            source_task_id = EXCLUDED.source_task_id,
            github_repositories_json = EXCLUDED.github_repositories_json,
            github_branches_json = EXCLUDED.github_branches_json,
            updated_at = EXCLUDED.updated_at
        `, [
          teamMemberId,
          DEFAULT_TEAM_ID,
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
        ]);

        await this.db.pool.query(`
          INSERT INTO members (id, team_id, email, display_name, role)
          VALUES ($1, $2, $3, $4, $5)
          ON CONFLICT (email) DO UPDATE SET
            display_name = EXCLUDED.display_name,
            role = EXCLUDED.role
        `, [memberId, DEFAULT_TEAM_ID, email, displayName, role]);
      }
    }
  }

  async saveSettings(settings: Partial<AppConfig>): Promise<void> {
    await this.ensureTenantHierarchy();

    const keys = [
      'timezone', 'thursdayMode', 'startTime', 'organization', 'project',
      'workItemType', 'titlePrefix', 'schedulerEnabled', 'schedulerAutoStart',
      'scheduleTime', 'autoClose', 'autoCloseStartTime', 'autoCloseEndTime',
      'lastAutoClose', 'autoActive', 'autoActiveTime', 'lastAutoActive',
      'githubOrg', 'githubUserSuffix', 'githubApiUrl', 'calendar',
      'skipWeekends', 'stopDay', 'stopDayOfWeek', 'defaultState',
      'copyEstimates', 'resetActualWork', 'maxRetries', 'initialRetryDelayMs',
      'defaultSourceTaskId', 'taskSeries', 'baseUrl',
    ] as const;

    for (const key of keys) {
      if (settings[key] !== undefined) {
        let category = 'general';
        if (['githubOrg', 'githubUserSuffix', 'githubApiUrl'].includes(key)) {
          category = 'github';
        } else if (['schedulerEnabled', 'scheduleTime', 'schedulerAutoStart'].includes(key)) {
          category = 'scheduler';
        } else if (['autoClose', 'autoCloseStartTime', 'autoCloseEndTime', 'autoActive', 'autoActiveTime', 'lastAutoClose', 'lastAutoActive'].includes(key)) {
          category = 'autoclosure';
        } else if (['organization', 'project', 'workItemType', 'titlePrefix', 'startTime', 'timezone', 'thursdayMode', 'taskSeries', 'baseUrl'].includes(key)) {
          category = 'azure';
        }

        await this.upsertAppSetting(key, settings[key], category, `Configuration setting: ${key}`);
      }
    }

    if (settings.calendar) {
      await this.saveWorkCalendar(settings.calendar);
    }

    if (settings.githubToken) {
      this.saveEnvVariable('GITHUB_TOKEN', settings.githubToken.trim());
    }
  }

  private async saveWorkCalendar(calendar: WorkCalendar): Promise<void> {
    await this.ensureTenantHierarchy();
    const calId = `cal-${DEFAULT_TEAM_ID}`;
    const timezone = 'Asia/Kolkata';
    const cycleAnchorDay = 4;
    const defaultHours = Number(calendar.defaultHours ?? 8.0);

    // Upsert into app_settings
    await this.upsertAppSetting('calendar', calendar, 'calendar', 'Work calendar configuration');

    // Upsert into work_calendars
    if (this.db.engine === 'sqlite') {
      this.db.sqlite.prepare(`
        INSERT OR REPLACE INTO work_calendars (id, team_id, timezone, cycle_anchor_day, default_hours)
        VALUES (?, ?, ?, ?, ?)
      `).run(calId, DEFAULT_TEAM_ID, timezone, cycleAnchorDay, defaultHours);

      // Clean existing exceptions for this calendar to prevent stale records
      this.db.sqlite.prepare('DELETE FROM calendar_exceptions WHERE calendar_id = ?').run(calId);

      const excStmt = this.db.sqlite.prepare(`
        INSERT INTO calendar_exceptions (id, calendar_id, date, is_working_day, available_hours, canonical_id, description)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);

      for (const exc of calendar.exceptions || []) {
        const isWorkingDay = exc.kind === 'holiday' ? 1 : 0;
        const availableHours = Number(exc.availableHours ?? 0.0);
        const excId = exc.id || `exc-${crypto.randomUUID()}`;
        let canonicalId: string | null = null;
        if (exc.memberKeys && exc.memberKeys.length > 0) {
          const candidateId = `usr_${exc.memberKeys[0]}`;
          const exists = this.db.sqlite.prepare('SELECT 1 FROM canonical_identities WHERE id = ?').get(candidateId);
          if (exists) canonicalId = candidateId;
        }
        excStmt.run(excId, calId, exc.startDate, isWorkingDay, availableHours, canonicalId, exc.label || null);
      }
    } else {
      await this.db.pool.query(`
        INSERT INTO work_calendars (id, team_id, timezone, cycle_anchor_day, default_hours)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (id) DO UPDATE SET
          default_hours = EXCLUDED.default_hours
      `, [calId, DEFAULT_TEAM_ID, timezone, cycleAnchorDay, defaultHours]);

      await this.db.pool.query('DELETE FROM calendar_exceptions WHERE calendar_id = $1', [calId]);

      for (const exc of calendar.exceptions || []) {
        const isWorkingDay = exc.kind === 'holiday' ? 1 : 0;
        const availableHours = Number(exc.availableHours ?? 0.0);
        const excId = exc.id || `exc-${crypto.randomUUID()}`;
        let canonicalId: string | null = null;
        if (exc.memberKeys && exc.memberKeys.length > 0) {
          const candidateId = `usr_${exc.memberKeys[0]}`;
          const res = await this.db.pool.query('SELECT 1 FROM canonical_identities WHERE id = $1', [candidateId]);
          if (res.rows.length > 0) canonicalId = candidateId;
        }
        await this.db.pool.query(`
          INSERT INTO calendar_exceptions (id, calendar_id, date, is_working_day, available_hours, canonical_id, description)
          VALUES ($1, $2, $3, $4, $5, $6, $7)
        `, [excId, calId, exc.startDate, isWorkingDay, availableHours, canonicalId, exc.label || null]);
      }
    }
  }

  private async upsertAppSetting(
    key: string,
    value: any,
    category: string,
    description: string
  ): Promise<void> {
    const valueJson = JSON.stringify(value);
    const updatedAt = new Date().toISOString();

    if (this.db.engine === 'sqlite') {
      this.db.sqlite.prepare(`
        INSERT OR REPLACE INTO app_settings (key, value_json, category, description, updated_at)
        VALUES (?, ?, ?, ?, ?)
      `).run(key, valueJson, category, description, updatedAt);
    } else {
      await this.db.pool.query(`
        INSERT INTO app_settings (key, value_json, category, description, updated_at)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (key) DO UPDATE SET
          value_json = EXCLUDED.value_json,
          category = EXCLUDED.category,
          description = EXCLUDED.description,
          updated_at = EXCLUDED.updated_at
      `, [key, valueJson, category, description, updatedAt]);
    }
  }

  async savePat(pat: string): Promise<void> {
    this.saveEnvVariable('AZURE_DEVOPS_PAT', pat);
  }

  private saveEnvVariable(key: string, value: string): void {
    const mode = process.env.SECRET_STORAGE_MODE ||
      (process.env.NODE_ENV === 'production' ? 'external' : 'local-file');
    if (mode !== 'local-file' && mode !== 'external') {
      throw new Error('SECRET_STORAGE_MODE must be external or local-file.');
    }
    if (mode === 'external') {
      throw new Error(`Cannot save ${key} via the application while SECRET_STORAGE_MODE=external. Provision the secret through an approved deployment secret manager and restart the service.`);
    }
    const existing = fs.existsSync(this.envPath) ? fs.readFileSync(this.envPath, 'utf-8') : '';
    const prefix = `${key}=`;
    const updated = `${key}=${JSON.stringify(value)}`;
    const lines = existing.split('\n');
    let found = false;
    const newLines = lines.map(line => {
      if (line.trim().startsWith(prefix)) {
        found = true;
        return updated;
      }
      return line;
    });
    if (!found) newLines.push(updated);
    AtomicFileWriter.writeText(this.envPath, newLines.join('\n').trim() + '\n', { mode: 0o600 });
    process.env[key] = value;
  }

  private loadEnvOverrides(): Partial<AppConfig> {
    const overrides: Partial<AppConfig> = {};
    const entries = fs.existsSync(this.envPath)
      ? parseDotenv(fs.readFileSync(this.envPath, 'utf-8'))
      : {};
    if (entries.AZURE_DEVOPS_ORG) overrides.organization = entries.AZURE_DEVOPS_ORG;
    if (entries.AZURE_DEVOPS_PROJECT) overrides.project = entries.AZURE_DEVOPS_PROJECT;
    if (entries.AZURE_DEVOPS_TIMEZONE) overrides.timezone = entries.AZURE_DEVOPS_TIMEZONE;
    if (entries.GITHUB_TOKEN || entries.GH_PAT) overrides.githubToken = entries.GITHUB_TOKEN || entries.GH_PAT;
    if (entries.GITHUB_ORG) overrides.githubOrg = entries.GITHUB_ORG;
    if (entries.GITHUB_USER_SUFFIX) overrides.githubUserSuffix = entries.GITHUB_USER_SUFFIX;
    if (entries.AUTO_CLOSE !== undefined) overrides.autoClose = entries.AUTO_CLOSE.toLowerCase() === 'true';
    if (entries.AUTO_CLOSE_START_TIME) overrides.autoCloseStartTime = entries.AUTO_CLOSE_START_TIME;
    if (entries.AUTO_CLOSE_END_TIME) overrides.autoCloseEndTime = entries.AUTO_CLOSE_END_TIME;
    return overrides;
  }

  private getDefaultConfig(): AppConfig {
    return {
      organization: process.env.AZURE_DEVOPS_ORG || 'BFLDevOpsOrg',
      project: process.env.AZURE_DEVOPS_PROJECT || '3in1_Agile_Projects',
      baseUrl: 'https://dev.azure.com',
      workItemType: '3in1 Task',
      taskSeries: '3in1_PWA_MyAccount',
      titlePrefix: '3in1_PWA_MyAccount |',
      startTime: '09:30',
      timezone: process.env.AZURE_DEVOPS_TIMEZONE || 'Asia/Kolkata',
      skipWeekends: true,
      stopDay: 'THURSDAY',
      stopDayOfWeek: 4,
      thursdayMode: 'CURRENT',
      defaultState: 'New',
      autoClose: false,
      autoCloseStartTime: '18:15',
      autoCloseEndTime: '18:45',
      autoActive: false,
      autoActiveTime: '17:30',
      copyEstimates: true,
      resetActualWork: true,
      maxRetries: 3,
      initialRetryDelayMs: 1000,
      schedulerEnabled: false,
      schedulerAutoStart: false,
      scheduleTime: '09:30',
      people: [],
    };
  }
}
