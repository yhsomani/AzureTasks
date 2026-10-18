/**
 * File-based Configuration Repository
 * Loads/saves configuration from people.json and .env
 */

import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'node:crypto';
import { parse as parseDotenv } from 'dotenv';
import { ConfigRepository, AppConfig, PersonConfig } from '../../domain/ports/repositories.js';

const STOP_DAY_NAMES: Record<string, number> = {
  SUNDAY: 0, MONDAY: 1, TUESDAY: 2, WEDNESDAY: 3,
  THURSDAY: 4, FRIDAY: 5, SATURDAY: 6,
};

export class FileConfigRepository implements ConfigRepository {
  private readonly configPath: string;
  private readonly envPath: string;

  constructor(configFilePath?: string) {
    this.configPath = configFilePath 
      ? path.resolve(process.cwd(), configFilePath)
      : path.resolve(process.cwd(), 'people.json');
    this.envPath = configFilePath
      ? path.join(path.dirname(this.configPath), '.env')
      : path.resolve(process.cwd(), '.env');
  }

  async load(): Promise<AppConfig> {
    const defaultConfig = this.getDefaultConfig();
    
    if (!fs.existsSync(this.configPath)) {
      return defaultConfig;
    }

    let parsed: any = null;
    let lastError: any = null;
    const maxRetries = 3;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const raw = fs.readFileSync(this.configPath, 'utf-8');
        parsed = JSON.parse(raw);
        lastError = null;
        break;
      } catch (err: any) {
        lastError = err;
        if (attempt < maxRetries) {
          await new Promise((resolve) => setTimeout(resolve, 50));
        }
      }
    }

    if (lastError) {
      console.error(`Failed to load existing config file "${this.configPath}" after ${maxRetries} attempts:`, lastError.message);
      throw new Error(`Configuration Error: Could not read or parse "${this.configPath}": ${lastError.message}`);
    }

    try {
      let people: PersonConfig[] = [];
      let overrides: Partial<AppConfig> = {};

      if (Array.isArray(parsed)) {
        people = parsed;
      } else if (parsed && typeof parsed === 'object') {
        people = Array.isArray(parsed.people) ? parsed.people : [];
        overrides = { ...parsed };
        delete overrides.people;
      }

      const namedStopDay = STOP_DAY_NAMES[String(parsed.stopDay ?? '').toUpperCase()];
      const stopDayOfWeek = namedStopDay !== undefined
        ? namedStopDay
        : typeof parsed.stopDayOfWeek === 'number'
          ? parsed.stopDayOfWeek
          : defaultConfig.stopDayOfWeek;

      const thursdayMode = parsed.thursdayMode?.toUpperCase() === 'FOLLOWING'
        ? 'FOLLOWING' as const
        : 'CURRENT' as const;

      // Validate duplicate identities
      const seenIdentities = new Set<string>();
      for (const person of people) {
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

      // Merge with env overrides
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
        lastAutoClose: parsed.lastAutoClose,
        people,
      };
    } catch (err: any) {
      if (err.message?.includes('Configuration Error')) {
        throw err;
      }
      console.warn('Failed to load config file:', err.message);
      throw err;
    }
  }


  /**
   * Never replace an unreadable persisted configuration with an empty one.
   * Legacy people-only arrays are migrated without dropping their members.
   */
  private readConfigForUpdate(): Record<string, any> {
    if (!fs.existsSync(this.configPath)) return {};
    let data: unknown;
    try {
      data = JSON.parse(fs.readFileSync(this.configPath, 'utf-8'));
    } catch {
      throw new Error('Configuration Error: Refusing to overwrite unreadable people.json. Restore from backup first.');
    }
    if (Array.isArray(data)) return { people: data };
    if (data === null || typeof data !== 'object') {
      throw new Error('Configuration Error: Refusing to overwrite invalid people.json.');
    }
    return data as Record<string, any>;
  }

  /**
   * Replace a file through a same-directory temporary file. Sync before rename,
   * clean up failed temp writes, and restrict access to persisted config/secrets.
   * This protects against partial writes, not concurrent multi-host writers.
   */
  private writeAtomically(filename: string, content: string): void {
    const temp = path.join(path.dirname(filename), `.${path.basename(filename)}.${crypto.randomUUID()}.tmp`);
    let fd: number | undefined;
    try {
      fd = fs.openSync(temp, 'wx', 0o600);
      fs.writeFileSync(fd, content, 'utf-8');
      fs.fsyncSync(fd);
      fs.closeSync(fd);
      fd = undefined;
      fs.renameSync(temp, filename);
    } catch (err) {
      if (fd !== undefined) fs.closeSync(fd);
      try { fs.unlinkSync(temp); } catch { /* no temporary file to clean */ }
      throw err;
    }
  }

  private saveConfigObject(data: Record<string, any>): void {
    // Old configurations sometimes included a GitHub token. Never write it
    // back to people.json, which may be version-controlled.
    delete data.githubToken;
    this.writeAtomically(this.configPath, JSON.stringify(data, null, 2) + '\n');
  }

  async save(config: AppConfig): Promise<void> {
    const existing = this.readConfigForUpdate();
    // Migrate only a legacy on-disk token to the local secrets file.
    // A token injected by an enterprise secret manager must not be copied to disk.
    if (typeof existing.githubToken === 'string' && existing.githubToken) {
      this.saveEnvVariable('GITHUB_TOKEN', existing.githubToken);
    }
    const data: Record<string, any> = {
      ...existing,
      organization: config.organization,
      project: config.project,
      baseUrl: config.baseUrl,
      workItemType: config.workItemType,
      taskSeries: config.taskSeries,
      titlePrefix: config.titlePrefix,
      startTime: config.startTime,
      timezone: config.timezone,
      skipWeekends: config.skipWeekends,
      stopDay: config.stopDay,
      stopDayOfWeek: config.stopDayOfWeek,
      thursdayMode: config.thursdayMode,
      defaultState: config.defaultState,
      autoClose: config.autoClose,
      autoCloseStartTime: config.autoCloseStartTime ?? '18:15',
      autoCloseEndTime: config.autoCloseEndTime ?? '18:45',
      copyEstimates: config.copyEstimates,
      resetActualWork: config.resetActualWork,
      maxRetries: config.maxRetries,
      initialRetryDelayMs: config.initialRetryDelayMs,
      defaultSourceTaskId: config.defaultSourceTaskId,
      schedulerEnabled: config.schedulerEnabled ?? false,
      schedulerAutoStart: config.schedulerAutoStart ?? false,
      scheduleTime: config.scheduleTime ?? config.startTime ?? '09:30',
      githubOrg: config.githubOrg,
      githubUserSuffix: config.githubUserSuffix,
      githubApiUrl: config.githubApiUrl,
      people: config.people,
    };
    if (config.lastAutoClose !== undefined) data.lastAutoClose = config.lastAutoClose;
    this.saveConfigObject(data);
  }

  async savePeople(people: PersonConfig[]): Promise<void> {
    const data = this.readConfigForUpdate();
    if (typeof data.githubToken === 'string' && data.githubToken) {
      this.saveEnvVariable('GITHUB_TOKEN', data.githubToken);
    }
    data.people = people;
    this.saveConfigObject(data);
  }

  async saveSettings(settings: Partial<AppConfig>): Promise<void> {
    const data = this.readConfigForUpdate();
    if (typeof data.githubToken === 'string' && data.githubToken) {
      this.saveEnvVariable('GITHUB_TOKEN', data.githubToken);
    }

    const keys = [
      'timezone', 'thursdayMode', 'startTime', 'organization', 'project',
      'workItemType', 'titlePrefix', 'schedulerEnabled', 'schedulerAutoStart',
      'scheduleTime', 'autoClose', 'autoCloseStartTime', 'autoCloseEndTime',
      'lastAutoClose', 'githubOrg', 'githubUserSuffix', 'githubApiUrl',
    ] as const;
    for (const key of keys) {
      if (settings[key] !== undefined) data[key] = settings[key];
    }
    // Write the token before committing settings to avoid a settings success
    // response when the explicitly requested credential update has failed.
    if (settings.githubToken) {
      this.saveEnvVariable('GITHUB_TOKEN', settings.githubToken.trim());
    }
    this.saveConfigObject(data);
  }

  async savePat(pat: string): Promise<void> {
    this.saveEnvVariable('AZURE_DEVOPS_PAT', pat);
  }

  private saveEnvVariable(key: string, value: string): void {
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
    this.writeAtomically(this.envPath, newLines.join('\n').trim() + '\n');
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
      copyEstimates: true,
      resetActualWork: true,
      maxRetries: 3,
      initialRetryDelayMs: 1000,
      schedulerEnabled: false,
      schedulerAutoStart: false,
      scheduleTime: '09:30',
      // No synthetic identities: all team members must be explicitly configured.
      people: [],
    };
  }
}