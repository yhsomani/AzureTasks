/**
 * Dual Configuration Repository
 * Implements ConfigRepository with relational database as primary storage
 * and automatic fallback to JSON file storage (people.json / .env).
 */

import {
  ConfigRepository,
  AppConfig,
  PersonConfig,
} from '../../domain/ports/repositories.js';
import { RelationalConfigRepository } from './relational-config-repo.js';
import { FileConfigRepository } from './file-config-repo.js';
import { logger } from '../logging/logger.js';

export class DualConfigRepository implements ConfigRepository {
  private seeded = false;

  constructor(
    public readonly relational: RelationalConfigRepository | undefined,
    public readonly file: FileConfigRepository
  ) {}

  /**
   * Auto-seed the database on startup if database has no records but file exists.
   */
  private async autoSeedIfEmpty(): Promise<void> {
    if (this.seeded || !this.relational) return;
    try {
      const relConfig = await this.relational.load();
      if ((!relConfig.people || relConfig.people.length === 0) && !relConfig.calendar) {
        // Relational DB appears empty; inspect file
        const fileConfig = await this.file.load();
        if ((fileConfig.people && fileConfig.people.length > 0) || fileConfig.calendar) {
          logger.info('Auto-seeding empty database from existing JSON configuration...');
          await this.relational.save(fileConfig);
        }
      }
      this.seeded = true;
    } catch {
      // If DB is closed or unreachable during auto-seed check, proceed without failing
      this.seeded = true;
    }
  }

  async load(): Promise<AppConfig> {
    if (this.relational) {
      await this.autoSeedIfEmpty();
      try {
        const config = await this.relational.load();
        // If DB has at least some people or calendar, return it
        if ((config.people && config.people.length > 0) || config.calendar) {
          return config;
        }
      } catch (err: any) {
        logger.warn(`Database load failed; falling back to JSON configuration: ${err.message}`);
      }
    }
    return this.file.load();
  }

  async save(config: AppConfig): Promise<void> {
    if (this.relational) {
      try {
        await this.relational.save(config);
      } catch (err: any) {
        logger.warn(`Relational config save failed; falling back to file: ${err.message}`);
      }
    }
    await this.file.save(config);
  }

  async savePeople(people: PersonConfig[]): Promise<void> {
    if (this.relational) {
      try {
        await this.relational.savePeople(people);
      } catch (err: any) {
        logger.warn(`Relational savePeople failed; falling back to file: ${err.message}`);
      }
    }
    await this.file.savePeople(people);
  }

  async saveSettings(settings: Partial<AppConfig>): Promise<void> {
    if (this.relational) {
      try {
        await this.relational.saveSettings(settings);
      } catch (err: any) {
        logger.warn(`Relational saveSettings failed; falling back to file: ${err.message}`);
      }
    }
    await this.file.saveSettings(settings);
  }

  async savePat(pat: string): Promise<void> {
    if (this.relational) {
      try {
        await this.relational.savePat(pat);
      } catch (err: any) {
        logger.warn(`Relational savePat failed; falling back to file: ${err.message}`);
      }
    }
    await this.file.savePat(pat);
  }
}
