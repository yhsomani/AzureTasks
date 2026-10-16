/**
 * File-based Configuration Repository
 * Loads/saves configuration from people.json and .env
 */

import * as fs from 'fs';
import * as path from 'path';
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
    this.envPath = path.resolve(process.cwd(), '.env');
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
        ...envOverrides,
        ...overrides,
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

  async save(config: AppConfig): Promise<void> {
    const data = {
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
      githubToken: config.githubToken,
      githubOrg: config.githubOrg,
      githubApiUrl: config.githubApiUrl,
      people: config.people,
    };

    fs.writeFileSync(this.configPath, JSON.stringify(data, null, 2), 'utf-8');
  }

  async savePeople(people: PersonConfig[]): Promise<void> {
    let currentData: any = {};
    if (fs.existsSync(this.configPath)) {
      try {
        currentData = JSON.parse(fs.readFileSync(this.configPath, 'utf-8'));
      } catch {
        currentData = {};
      }
    }
    currentData.people = people;
    fs.writeFileSync(this.configPath, JSON.stringify(currentData, null, 2), 'utf-8');
  }

  async saveSettings(settings: Partial<AppConfig>): Promise<void> {
    let currentData: any = {};
    if (fs.existsSync(this.configPath)) {
      try {
        currentData = JSON.parse(fs.readFileSync(this.configPath, 'utf-8'));
      } catch {
        currentData = {};
      }
    }

    if (settings.timezone !== undefined) currentData.timezone = settings.timezone;
    if (settings.thursdayMode !== undefined) currentData.thursdayMode = settings.thursdayMode;
    if (settings.startTime !== undefined) currentData.startTime = settings.startTime;
    if (settings.organization !== undefined) currentData.organization = settings.organization;
    if (settings.project !== undefined) currentData.project = settings.project;
    if (settings.workItemType !== undefined) currentData.workItemType = settings.workItemType;
    if (settings.titlePrefix !== undefined) currentData.titlePrefix = settings.titlePrefix;
    if (settings.schedulerEnabled !== undefined) currentData.schedulerEnabled = settings.schedulerEnabled;
    if (settings.schedulerAutoStart !== undefined) currentData.schedulerAutoStart = settings.schedulerAutoStart;
    if (settings.scheduleTime !== undefined) currentData.scheduleTime = settings.scheduleTime;
    if (settings.autoClose !== undefined) currentData.autoClose = settings.autoClose;
    if (settings.autoCloseStartTime !== undefined) currentData.autoCloseStartTime = settings.autoCloseStartTime;
    if (settings.autoCloseEndTime !== undefined) currentData.autoCloseEndTime = settings.autoCloseEndTime;
    if (settings.lastAutoClose !== undefined) currentData.lastAutoClose = settings.lastAutoClose;
    if (settings.githubOrg !== undefined) currentData.githubOrg = settings.githubOrg;
    if (settings.githubUserSuffix !== undefined) currentData.githubUserSuffix = settings.githubUserSuffix;
    if (settings.githubApiUrl !== undefined) currentData.githubApiUrl = settings.githubApiUrl;

    fs.writeFileSync(this.configPath, JSON.stringify(currentData, null, 2), 'utf-8');

    if (settings.githubToken) {
      this.saveEnvVariable('GITHUB_TOKEN', settings.githubToken.trim());
    }
  }

  async savePat(pat: string): Promise<void> {
    this.saveEnvVariable('AZURE_DEVOPS_PAT', pat);
  }

  private saveEnvVariable(key: string, value: string): void {
    let envContent = '';
    if (fs.existsSync(this.envPath)) {
      envContent = fs.readFileSync(this.envPath, 'utf-8');
    }

    const lines = envContent.split('\n');
    let found = false;
    const prefix = `${key}=`;
    const newLines = lines.map(l => {
      if (l.trim().startsWith(prefix)) {
        found = true;
        return `${key}="${value}"`;
      }
      return l;
    });

    if (!found) {
      newLines.push(`${key}="${value}"`);
    }

    fs.writeFileSync(this.envPath, newLines.join('\n').trim() + '\n', 'utf-8');
    process.env[key] = value;
    try {
      // Restrict permissions on the secret-bearing file (best effort; no-op on Windows)
      fs.chmodSync(this.envPath, 0o600);
    } catch {
      // ignore
    }
  }

  private loadEnvOverrides(): Partial<AppConfig> {
    const overrides: Partial<AppConfig> = {};
    
    if (fs.existsSync(this.envPath)) {
      const content = fs.readFileSync(this.envPath, 'utf-8');
      for (const line of content.split('\n')) {
        const [key, ...rest] = line.split('=');
        const value = rest.join('=').trim().replace(/^["']|["']$/g, '');
        
        switch (key.trim()) {
          case 'AZURE_DEVOPS_ORG':
            overrides.organization = value;
            break;
          case 'AZURE_DEVOPS_PROJECT':
            overrides.project = value;
            break;
          case 'AZURE_DEVOPS_TIMEZONE':
            overrides.timezone = value;
            break;
          case 'AZURE_DEVOPS_PAT':
            // PAT handled separately
            break;
          case 'GITHUB_TOKEN':
          case 'GH_PAT':
            overrides.githubToken = value;
            break;
          case 'GITHUB_ORG':
            overrides.githubOrg = value;
            break;
          case 'GITHUB_USER_SUFFIX':
            overrides.githubUserSuffix = value;
            break;
          case 'AUTO_CLOSE':
            overrides.autoClose = value.toLowerCase() === 'true';
            break;
          case 'AUTO_CLOSE_START_TIME':
            overrides.autoCloseStartTime = value;
            break;
          case 'AUTO_CLOSE_END_TIME':
            overrides.autoCloseEndTime = value;
            break;
        }
      }
    }

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
      autoClose: true,
      autoCloseStartTime: '18:15',
      autoCloseEndTime: '18:45',
      copyEstimates: true,
      resetActualWork: true,
      maxRetries: 3,
      initialRetryDelayMs: 1000,
      schedulerEnabled: false,
      schedulerAutoStart: false,
      scheduleTime: '09:30',
      people: [
        { key: 'person1', name: 'Person 1', assignedTo: 'person1@company.com', enabled: true },
        { key: 'person2', name: 'Person 2', assignedTo: 'person2@company.com', enabled: true },
        { key: 'person3', name: 'Person 3', assignedTo: 'person3@company.com', enabled: true },
      ],
    };
  }
}