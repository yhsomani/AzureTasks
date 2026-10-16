/**
 * Configuration Use Cases
 * Manage application configuration
 */

import { ConfigRepository, AppConfig, PersonConfig } from '../../domain/ports/repositories.js';

export interface SavePeopleInput {
  people: PersonConfig[];
}

export interface SaveSettingsInput {
  timezone?: string;
  thursdayMode?: 'CURRENT' | 'FOLLOWING';
  startTime?: string;
  organization?: string;
  project?: string;
  workItemType?: string;
  titlePrefix?: string;
  githubToken?: string;
  githubOrg?: string;
  githubUserSuffix?: string;
  autoClose?: boolean;
  autoCloseStartTime?: string;
  autoCloseEndTime?: string;
}

export interface SavePatInput {
  pat: string;
}

export class ConfigUseCases {
  constructor(
    private readonly configRepo: ConfigRepository,
    private readonly config: AppConfig
  ) {}

  async getConfig(): Promise<AppConfig> {
    const ghToken = (this.config.githubToken || process.env.GITHUB_TOKEN || process.env.GH_PAT)?.trim() || '';
    const maskedGh = ghToken ? `${ghToken.slice(0, 4)}...${ghToken.slice(-4)}` : undefined;
    return {
      ...this.config,
      githubToken: maskedGh,
    };
  }

  async savePeople(input: SavePeopleInput): Promise<{ message: string; people: PersonConfig[] }> {
    // Validate
    if (!input.people || !Array.isArray(input.people)) {
      throw new Error('Expected { people: [...] } payload.');
    }

    const seenIdentities = new Set<string>();
    const seenKeys = new Set<string>();
    for (const p of input.people) {
      if (!p.name?.trim() || !p.assignedTo?.trim()) {
        throw new Error('Each person must have non-empty name and assignedTo fields.');
      }
      if (!p.key?.trim()) {
        p.key = (p.name || p.assignedTo).trim().toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
      }
      const key = p.key.trim();
      if (seenKeys.has(key)) {
        throw new Error(`Duplicate person key "${p.key}". Keys must be unique.`);
      }
      seenKeys.add(key);

      const lower = p.assignedTo.trim().toLowerCase();
      if (seenIdentities.has(lower)) {
        throw new Error(`Duplicate identity "${p.assignedTo}". Multiple people cannot map to the same identity.`);
      }
      seenIdentities.add(lower);
    }

    await this.configRepo.savePeople(input.people);
    this.config.people = input.people;

    return { message: 'People configuration updated successfully.', people: input.people };
  }

  async saveSettings(input: SaveSettingsInput): Promise<{ message: string; config: AppConfig }> {
    if (input.timezone !== undefined) {
      try {
        new Intl.DateTimeFormat('en-US', { timeZone: input.timezone });
      } catch {
        throw new Error(`Invalid timezone "${input.timezone}". Use an IANA name such as Asia/Kolkata.`);
      }
    }
    if (input.startTime !== undefined && !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.startTime)) {
      throw new Error(`Invalid startTime "${input.startTime}". Expected HH:MM (24-hour).`);
    }
    if (input.autoCloseStartTime !== undefined && !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.autoCloseStartTime)) {
      throw new Error(`Invalid autoCloseStartTime "${input.autoCloseStartTime}". Expected HH:MM (24-hour).`);
    }
    if (input.autoCloseEndTime !== undefined && !/^([01]\d|2[0-3]):[0-5]\d$/.test(input.autoCloseEndTime)) {
      throw new Error(`Invalid autoCloseEndTime "${input.autoCloseEndTime}". Expected HH:MM (24-hour).`);
    }

    await this.configRepo.saveSettings(input);

    if (input.timezone) this.config.timezone = input.timezone;
    if (input.thursdayMode) this.config.thursdayMode = input.thursdayMode;
    if (input.startTime) this.config.startTime = input.startTime;
    if (input.organization) this.config.organization = input.organization;
    if (input.project) this.config.project = input.project;
    if (input.workItemType) this.config.workItemType = input.workItemType;
    if (input.titlePrefix) this.config.titlePrefix = input.titlePrefix;
    if (input.githubToken !== undefined && input.githubToken.trim()) {
      this.config.githubToken = input.githubToken.trim();
      process.env.GITHUB_TOKEN = input.githubToken.trim();
    }
    if (input.githubOrg !== undefined) this.config.githubOrg = input.githubOrg;
    if (input.githubUserSuffix !== undefined) this.config.githubUserSuffix = input.githubUserSuffix;
    if (input.autoClose !== undefined) this.config.autoClose = input.autoClose;
    if (input.autoCloseStartTime !== undefined) this.config.autoCloseStartTime = input.autoCloseStartTime;
    if (input.autoCloseEndTime !== undefined) this.config.autoCloseEndTime = input.autoCloseEndTime;

    return { message: 'Settings saved successfully.', config: await this.getConfig() };
  }

  async savePat(input: SavePatInput): Promise<{ message: string; patMasked: string }> {
    const pat = input.pat?.trim();
    if (!pat) {
      throw new Error('PAT cannot be empty.');
    }

    await this.configRepo.savePat(pat);
    process.env.AZURE_DEVOPS_PAT = pat;

    const patMasked = `${pat.slice(0, 4)}...${pat.slice(-4)}`;
    return { message: 'PAT saved to server configuration.', patMasked };
  }
}