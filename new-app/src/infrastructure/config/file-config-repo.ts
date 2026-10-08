/**
 * File-based Configuration Repository
 * Loads/saves configuration from people.json and .env
 */

import * as fs from 'fs';
import * as path from 'path';
import { ConfigRepository, AppConfig, PersonConfig } from '../../domain/ports/repositories.js';

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

    try {
      const raw = fs.readFileSync(this.configPath, 'utf-8');
      const parsed = JSON.parse(raw);

      let people: PersonConfig[] = [];
      let overrides: Partial<AppConfig> = {};

      if (Array.isArray(parsed)) {
        people = parsed;
      } else if (parsed && typeof parsed === 'object') {
        people = Array.isArray(parsed.people) ? parsed.people : defaultConfig.people;
        overrides = { ...parsed };
        delete overrides.people;
      }

      const stopDayOfWeek = parsed.stopDay?.toUpperCase() === 'THURSDAY'
        ? 4
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
        stopDayOfWeek,
        thursdayMode,
        people,
      };
    } catch (err: any) {
      if (err.message?.includes('Configuration Error')) {
        throw err;
      }
      console.warn('Failed to load config file, using defaults:', err.message);
      return defaultConfig;
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
      copyEstimates: config.copyEstimates,
      resetActualWork: config.resetActualWork,
      maxRetries: config.maxRetries,
      initialRetryDelayMs: config.initialRetryDelayMs,
      defaultSourceTaskId: config.defaultSourceTaskId,
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

    if (settings.timezone) currentData.timezone = settings.timezone;
    if (settings.thursdayMode) currentData.thursdayMode = settings.thursdayMode;
    if (settings.startTime) currentData.startTime = settings.startTime;
    if (settings.organization) currentData.organization = settings.organization;
    if (settings.project) currentData.project = settings.project;
    if (settings.workItemType) currentData.workItemType = settings.workItemType;
    if (settings.titlePrefix) currentData.titlePrefix = settings.titlePrefix;

    fs.writeFileSync(this.configPath, JSON.stringify(currentData, null, 2), 'utf-8');
  }

  async savePat(pat: string): Promise<void> {
    let envContent = '';
    if (fs.existsSync(this.envPath)) {
      envContent = fs.readFileSync(this.envPath, 'utf-8');
    }

    const lines = envContent.split('\n');
    let found = false;
    const newLines = lines.map(l => {
      if (l.trim().startsWith('AZURE_DEVOPS_PAT=')) {
        found = true;
        return `AZURE_DEVOPS_PAT="${pat}"`;
      }
      return l;
    });

    if (!found) {
      newLines.push(`AZURE_DEVOPS_PAT="${pat}"`);
    }

    fs.writeFileSync(this.envPath, newLines.join('\n').trim() + '\n', 'utf-8');
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
      autoClose: false,
      copyEstimates: true,
      resetActualWork: true,
      maxRetries: 3,
      initialRetryDelayMs: 1000,
      people: [
        { key: 'person1', name: 'Person 1', assignedTo: 'person1@company.com', enabled: true },
        { key: 'person2', name: 'Person 2', assignedTo: 'person2@company.com', enabled: true },
        { key: 'person3', name: 'Person 3', assignedTo: 'person3@company.com', enabled: true },
      ],
    };
  }
}