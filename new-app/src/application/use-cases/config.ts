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
    return this.config;
  }

  async savePeople(input: SavePeopleInput): Promise<{ message: string; people: PersonConfig[] }> {
    // Validate
    if (!input.people || !Array.isArray(input.people)) {
      throw new Error('Expected { people: [...] } payload.');
    }

    const seenIdentities = new Set<string>();
    const seenKeys = new Set<string>();
    for (const p of input.people) {
      if (!p.key?.trim() || !p.name?.trim() || !p.assignedTo?.trim()) {
        throw new Error('Each person must have non-empty key, name and assignedTo fields.');
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

    await this.configRepo.saveSettings(input);

    if (input.timezone) this.config.timezone = input.timezone;
    if (input.thursdayMode) this.config.thursdayMode = input.thursdayMode;
    if (input.startTime) this.config.startTime = input.startTime;
    if (input.organization) this.config.organization = input.organization;
    if (input.project) this.config.project = input.project;

    return { message: 'Settings saved successfully.', config: this.config };
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