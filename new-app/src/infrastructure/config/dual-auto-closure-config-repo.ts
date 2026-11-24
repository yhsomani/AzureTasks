/**
 * Dual Auto-Closure Configuration Repository
 * Implements AutoClosureConfigRepository with relational database as primary storage
 * and automatic fallback to JSON file storage (.auto-closure-config.json).
 */

import {
  AutoClosureConfigRepository,
  AutoClosureConfig,
  AutoClosureValidationResult,
} from '../../domain/ports/repositories.js';
import { RelationalAutoClosureConfigRepository } from './relational-auto-closure-config-repo.js';
import { FileAutoClosureConfigRepository } from './file-auto-closure-config-repo.js';
import { logger } from '../logging/logger.js';

export class DualAutoClosureConfigRepository implements AutoClosureConfigRepository {
  private seeded = false;

  constructor(
    public readonly relational: RelationalAutoClosureConfigRepository | undefined,
    public readonly file: FileAutoClosureConfigRepository
  ) {}

  private async autoSeedIfEmpty(): Promise<void> {
    if (this.seeded || !this.relational) return;
    try {
      const relConfig = await this.relational.load();
      if (!relConfig.enabled && (!relConfig.rules || relConfig.rules.length === 0)) {
        const fileConfig = await this.file.load();
        if (fileConfig && (fileConfig.enabled || (fileConfig.rules && fileConfig.rules.length > 0))) {
          logger.info('Auto-seeding empty database with auto-closure configuration from file...');
          await this.relational.save(fileConfig);
        }
      }
      this.seeded = true;
    } catch {
      this.seeded = true;
    }
  }

  async load(): Promise<AutoClosureConfig> {
    if (this.relational) {
      await this.autoSeedIfEmpty();
      try {
        const config = await this.relational.load();
        if (config.enabled || (config.rules && config.rules.length > 0)) {
          return config;
        }
      } catch (err: any) {
        logger.warn(`Database load failed; falling back to JSON auto-closure config: ${err.message}`);
      }
    }
    return this.file.load();
  }

  async save(config: AutoClosureConfig): Promise<void> {
    if (this.relational) {
      try {
        await this.relational.save(config);
      } catch (err: any) {
        logger.warn(`Relational auto-closure config save failed; falling back to file: ${err.message}`);
      }
    }
    await this.file.save(config);
  }

  async validate(config: AutoClosureConfig): Promise<AutoClosureValidationResult> {
    if (this.relational) {
      try {
        return await this.relational.validate(config);
      } catch (err: any) {
        logger.warn(`Relational auto-closure validate failed; falling back to file: ${err.message}`);
      }
    }
    return this.file.validate(config);
  }

  async getVersion(): Promise<number> {
    if (this.relational) {
      try {
        return await this.relational.getVersion();
      } catch (err: any) {
        logger.warn(`Relational auto-closure getVersion failed; falling back to file: ${err.message}`);
      }
    }
    return this.file.getVersion();
  }
}
