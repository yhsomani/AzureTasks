/**
 * Relational Auto-Closure Configuration Repository
 * Persists and loads auto-closure configuration and rules using relational tables
 * (app_settings with key 'auto_closure_config', and auto_closure_rules).
 */

import {
  AutoClosureConfigRepository,
  AutoClosureConfig,
  AutoClosureValidationResult,
  AutoClosureRule,
} from '../../domain/ports/repositories.js';
import { WorkOpsDb } from '../persistence/database.js';

const DEFAULT_CONFIG: AutoClosureConfig = {
  enabled: false,
  version: 1,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  createdBy: 'system',
  lastModifiedBy: 'system',
  rules: [],
  retentionDays: 90,
};

const DEFAULT_ORG_ID = 'org-default';
const DEFAULT_DEPT_ID = 'dept-default';
const DEFAULT_TEAM_ID = 'team-default';

export class RelationalAutoClosureConfigRepository implements AutoClosureConfigRepository {
  constructor(private readonly db: WorkOpsDb) {}

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

  async load(): Promise<AutoClosureConfig> {
    // 1. Primary: read full JSON from app_settings
    let settingRow: any = null;
    if (this.db.engine === 'sqlite') {
      settingRow = this.db.sqlite
        .prepare("SELECT value_json FROM app_settings WHERE key = 'auto_closure_config'")
        .get();
    } else {
      const res = await this.db.pool.query(
        "SELECT value_json FROM app_settings WHERE key = 'auto_closure_config'"
      );
      if (res.rows.length > 0) settingRow = res.rows[0];
    }

    if (settingRow && settingRow.value_json) {
      try {
        const config: AutoClosureConfig = JSON.parse(settingRow.value_json);
        this.validateConfigStructure(config);
        return config;
      } catch {
        // Corrupted settings JSON; fall back to inspecting auto_closure_rules
      }
    }

    // 2. Secondary: reconstruct from auto_closure_rules
    let ruleRows: any[] = [];
    if (this.db.engine === 'sqlite') {
      ruleRows = this.db.sqlite.prepare('SELECT * FROM auto_closure_rules WHERE is_active = 1').all() as any[];
    } else {
      const res = await this.db.pool.query('SELECT * FROM auto_closure_rules WHERE is_active = 1');
      ruleRows = res.rows;
    }

    if (ruleRows.length > 0) {
      const rules: AutoClosureRule[] = ruleRows.map(r => ({
        ruleId: r.id,
        type: 'inclusion',
        filterType: 'teams',
        filters: [{ id: r.team_id, name: 'Default Team' }],
        description: r.rule_name,
        createdBy: 'system',
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      }));

      return {
        enabled: true,
        version: 1,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        createdBy: 'system',
        lastModifiedBy: 'system',
        rules,
        retentionDays: 90,
      };
    }

    return { ...DEFAULT_CONFIG };
  }

  async save(config: AutoClosureConfig): Promise<void> {
    const validation = await this.validate(config);
    if (!validation.isValid) {
      throw new Error(`Configuration validation failed: ${validation.errors.join('; ')}`);
    }

    await this.ensureTenantHierarchy();

    const updated: AutoClosureConfig = {
      ...config,
      updatedAt: new Date().toISOString(),
      version: (config.version || 0) + 1,
    };

    const configJson = JSON.stringify(updated);
    const nowIso = updated.updatedAt;

    // 1. Save to app_settings
    if (this.db.engine === 'sqlite') {
      this.db.sqlite.prepare(`
        INSERT OR REPLACE INTO app_settings (key, value_json, category, description, updated_at)
        VALUES ('auto_closure_config', ?, 'autoclosure', 'Auto-closure engine configuration', ?)
      `).run(configJson, nowIso);
    } else {
      await this.db.pool.query(`
        INSERT INTO app_settings (key, value_json, category, description, updated_at)
        VALUES ('auto_closure_config', $1, 'autoclosure', 'Auto-closure engine configuration', $2)
        ON CONFLICT (key) DO UPDATE SET
          value_json = EXCLUDED.value_json,
          category = EXCLUDED.category,
          description = EXCLUDED.description,
          updated_at = EXCLUDED.updated_at
      `, [configJson, nowIso]);
    }

    // 2. Synchronize auto_closure_rules table
    if (this.db.engine === 'sqlite') {
      this.db.sqlite.prepare('DELETE FROM auto_closure_rules WHERE team_id = ?').run(DEFAULT_TEAM_ID);
      const ruleStmt = this.db.sqlite.prepare(`
        INSERT INTO auto_closure_rules (
          id, team_id, rule_name, cutoff_time, min_hours, require_pr_evidence, require_git_commits, is_active, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      for (const rule of updated.rules) {
        const ruleAny = rule as any;
        const ruleId = rule.ruleId || `rule-${crypto.randomUUID()}`;
        const ruleName = ruleAny.name || ruleAny.ruleName || rule.description || 'Default Auto-Closure Rule';
        const cutoffTime = ruleAny.cutoffTime || ruleAny.conditions?.cutoffTime || '18:00';
        const minHours = Number(ruleAny.minHours ?? ruleAny.conditions?.minHours ?? 8.0);
        const requirePrEvidence = ruleAny.requirePrEvidence !== false && ruleAny.conditions?.requirePrEvidence !== false ? 1 : 0;
        const requireGitCommits = ruleAny.requireGitCommits || ruleAny.conditions?.requireGitCommits ? 1 : 0;
        const isActive = updated.enabled ? 1 : 0;
        const createdAt = rule.createdAt || nowIso;
        const updatedAtStr = rule.updatedAt || nowIso;

        ruleStmt.run(
          ruleId,
          DEFAULT_TEAM_ID,
          ruleName,
          cutoffTime,
          minHours,
          requirePrEvidence,
          requireGitCommits,
          isActive,
          createdAt,
          updatedAtStr
        );
      }
    } else {
      await this.db.pool.query('DELETE FROM auto_closure_rules WHERE team_id = $1', [DEFAULT_TEAM_ID]);

      for (const rule of updated.rules) {
        const ruleAny = rule as any;
        const ruleId = rule.ruleId || `rule-${crypto.randomUUID()}`;
        const ruleName = ruleAny.name || ruleAny.ruleName || rule.description || 'Default Auto-Closure Rule';
        const cutoffTime = ruleAny.cutoffTime || ruleAny.conditions?.cutoffTime || '18:00';
        const minHours = Number(ruleAny.minHours ?? ruleAny.conditions?.minHours ?? 8.0);
        const requirePrEvidence = ruleAny.requirePrEvidence !== false && ruleAny.conditions?.requirePrEvidence !== false ? 1 : 0;
        const requireGitCommits = ruleAny.requireGitCommits || ruleAny.conditions?.requireGitCommits ? 1 : 0;
        const isActive = updated.enabled ? 1 : 0;
        const createdAt = rule.createdAt || nowIso;
        const updatedAtStr = rule.updatedAt || nowIso;

        await this.db.pool.query(`
          INSERT INTO auto_closure_rules (
            id, team_id, rule_name, cutoff_time, min_hours, require_pr_evidence, require_git_commits, is_active, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        `, [
          ruleId,
          DEFAULT_TEAM_ID,
          ruleName,
          cutoffTime,
          minHours,
          requirePrEvidence,
          requireGitCommits,
          isActive,
          createdAt,
          updatedAtStr,
        ]);
      }
    }
  }

  async validate(config: AutoClosureConfig): Promise<AutoClosureValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!config || typeof config !== 'object' || !Array.isArray(config.rules)) {
      errors.push('rules must be an array');
      return { isValid: false, errors, warnings };
    }

    if (!config.enabled && config.rules.length === 0) {
      // Valid: disabled with no rules
    } else {
      const inclusionRules = config.rules.filter(r => r.type === 'inclusion');
      const exclusionRules = config.rules.filter(r => r.type === 'exclusion');

      if (inclusionRules.length > 0 && exclusionRules.length > 0) {
        warnings.push(
          'Configuration mixes inclusion and exclusion rules. ' +
          'This may lead to unexpected behavior. Ensure your rules do not conflict.'
        );
      }

      if (config.enabled && inclusionRules.length === 0 && exclusionRules.length === 0) {
        errors.push('Auto-closure is enabled but no rules are defined');
      }

      for (const rule of config.rules) {
        const ruleErrors = this.validateRule(rule);
        errors.push(...ruleErrors);
      }

      const ruleIds = new Set<string>();
      for (const rule of config.rules) {
        if (ruleIds.has(rule.ruleId)) {
          errors.push(`Duplicate rule ID: ${rule.ruleId}`);
        }
        ruleIds.add(rule.ruleId);
      }
    }

    if (config.retentionDays !== undefined) {
      if (!Number.isInteger(config.retentionDays) || config.retentionDays < 1) {
        errors.push('retentionDays must be a positive integer');
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    };
  }

  private validateRule(rule: AutoClosureRule): string[] {
    const errors: string[] = [];

    if (!rule.ruleId || typeof rule.ruleId !== 'string') {
      errors.push('Each rule must have a ruleId');
    }

    if (!['inclusion', 'exclusion'].includes(rule.type)) {
      errors.push(`Invalid rule type: ${rule.type}. Must be 'inclusion' or 'exclusion'.`);
    }

    if (!['users', 'teams', 'roles'].includes(rule.filterType)) {
      errors.push(`Invalid filterType: ${rule.filterType}. Must be 'users', 'teams', or 'roles'.`);
    }

    if (!Array.isArray(rule.filters) || rule.filters.length === 0) {
      errors.push(`Rule ${rule.ruleId}: filters must be a non-empty array`);
    }

    if (rule.filters.some(f => !f.id || !f.name)) {
      errors.push(`Rule ${rule.ruleId}: all filters must have id and name`);
    }

    if (!rule.createdBy || typeof rule.createdBy !== 'string') {
      errors.push(`Rule ${rule.ruleId}: createdBy must be set`);
    }

    return errors;
  }

  private validateConfigStructure(config: any): void {
    if (!config || typeof config !== 'object') {
      throw new Error('Configuration must be an object');
    }

    const required = ['enabled', 'version', 'createdAt', 'updatedAt', 'createdBy', 'lastModifiedBy', 'rules'];
    for (const field of required) {
      if (!(field in config)) {
        throw new Error(`Configuration missing required field: ${field}`);
      }
    }

    if (typeof config.enabled !== 'boolean') {
      throw new Error('enabled must be a boolean');
    }

    if (!Number.isInteger(config.version) || config.version < 1) {
      throw new Error('version must be a positive integer');
    }

    if (!Array.isArray(config.rules)) {
      throw new Error('rules must be an array');
    }
  }

  async getVersion(): Promise<number> {
    const config = await this.load();
    return config.version;
  }
}
