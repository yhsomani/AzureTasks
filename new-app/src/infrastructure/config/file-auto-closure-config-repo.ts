/**
 * File-based Auto-Closure Configuration Repository
 * Manages auto-closure rules stored in auto-closure-config.json
 */

import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'node:crypto';
import {
  AutoClosureConfigRepository,
  AutoClosureConfig,
  AutoClosureValidationResult,
  AutoClosureRule,
} from '../../domain/ports/repositories.js';

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

export class FileAutoClosureConfigRepository implements AutoClosureConfigRepository {
  private readonly configPath: string;
  private cache: AutoClosureConfig | null = null;
  private cacheTimestamp: number = 0;
  private readonly cacheTtlMs: number = 5000;  // 5 second cache

  constructor(configFilePath?: string) {
    this.configPath = configFilePath
      ? path.resolve(process.cwd(), configFilePath)
      : path.resolve(process.cwd(), '.auto-closure-config.json');
  }

  async load(): Promise<AutoClosureConfig> {
    const now = Date.now();
    if (this.cache && (now - this.cacheTimestamp) < this.cacheTtlMs) {
      return this.cache;
    }

    if (!fs.existsSync(this.configPath)) {
      this.cache = { ...DEFAULT_CONFIG };
      this.cacheTimestamp = now;
      return this.cache;
    }

    try {
      const raw = fs.readFileSync(this.configPath, 'utf-8');
      const parsed: AutoClosureConfig = JSON.parse(raw);
      this.validateConfigStructure(parsed);
      this.cache = parsed;
      this.cacheTimestamp = now;
      return parsed;
    } catch (err: any) {
      throw new Error(
        `Failed to load auto-closure config from "${this.configPath}": ${err.message}`
      );
    }
  }

  async save(config: AutoClosureConfig): Promise<void> {
    const validation = await this.validate(config);
    if (!validation.isValid) {
      throw new Error(
        `Configuration validation failed: ${validation.errors.join('; ')}`
      );
    }

    const updated = {
      ...config,
      updatedAt: new Date().toISOString(),
      version: (config.version || 0) + 1,
    };

    try {
      // Write atomically to temp file first, then rename
      const tempPath = `${this.configPath}.tmp`;
      fs.writeFileSync(tempPath, JSON.stringify(updated, null, 2), 'utf-8');
      fs.renameSync(tempPath, this.configPath);
      this.cache = updated;
      this.cacheTimestamp = Date.now();
    } catch (err: any) {
      throw new Error(
        `Failed to save auto-closure config to "${this.configPath}": ${err.message}`
      );
    }
  }

  async validate(config: AutoClosureConfig): Promise<AutoClosureValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (!config.enabled && config.rules.length === 0) {
      // Valid: disabled with no rules
    } else {
      // Validate rules structure
      if (!Array.isArray(config.rules)) {
        errors.push('rules must be an array');
        return { isValid: false, errors, warnings };
      }

      // Check for conflicting inclusion/exclusion rules
      const inclusionRules = config.rules.filter(r => r.type === 'inclusion');
      const exclusionRules = config.rules.filter(r => r.type === 'exclusion');

      if (inclusionRules.length > 0 && exclusionRules.length > 0) {
        // Both types present - warn but allow
        warnings.push(
          'Configuration mixes inclusion and exclusion rules. ' +
          'This may lead to unexpected behavior. Ensure your rules do not conflict.'
        );
      }

      if (config.enabled && inclusionRules.length === 0 && exclusionRules.length === 0) {
        errors.push('Auto-closure is enabled but no rules are defined');
      }

      // Validate individual rules
      for (const rule of config.rules) {
        const ruleErrors = this.validateRule(rule);
        errors.push(...ruleErrors);
      }

      // Check for duplicate rule IDs
      const ruleIds = new Set<string>();
      for (const rule of config.rules) {
        if (ruleIds.has(rule.ruleId)) {
          errors.push(`Duplicate rule ID: ${rule.ruleId}`);
        }
        ruleIds.add(rule.ruleId);
      }
    }

    // Validate retention days
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
