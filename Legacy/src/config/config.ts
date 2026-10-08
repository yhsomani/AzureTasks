import * as fs from 'fs';
import * as path from 'path';

export interface PersonConfig {
  key?: string; // Stable person key (e.g. "person1")
  name: string;
  assignedTo: string; // Email, UPN, displayName, or identity descriptor
  enabled?: boolean; // Defaults to true
  sourceTaskId?: number; // Optional per-person source work item override
  pod?: string; // Team or POD name
  role?: string; // Role in the company
}

export interface AppConfig {
  organization: string;
  project: string;
  baseUrl: string;
  workItemType: string;
  taskSeries: string; // Internal stable series key, e.g. "3in1_PWA_MyAccount"
  titlePrefix: string;
  startTime: string; // e.g. "09:30"
  timezone: string; // e.g. "Asia/Kolkata"
  skipWeekends: boolean;
  stopDay: string; // "THURSDAY"
  stopDayOfWeek: number; // 4 = Thursday
  thursdayMode: 'CURRENT' | 'FOLLOWING'; // CURRENT = ends today on Thursday; FOLLOWING = ends next Thursday
  defaultState: string; // "New"
  autoClose: boolean; // false
  copyEstimates: boolean; // true
  resetActualWork: boolean; // true
  maxRetries: number;
  initialRetryDelayMs: number;
  defaultSourceTaskId?: number; // Optional fallback template task ID for members without existing tasks
  people: PersonConfig[];
}

export const DEFAULT_PEOPLE: PersonConfig[] = [
  {
    key: 'person1',
    name: 'Person 1',
    assignedTo: 'person1@company.com',
    enabled: true,
  },
  {
    key: 'person2',
    name: 'Person 2',
    assignedTo: 'person2@company.com',
    enabled: true,
  },
  {
    key: 'person3',
    name: 'Person 3',
    assignedTo: 'person3@company.com',
    enabled: true,
  },
];

export const DEFAULT_CONFIG: AppConfig = {
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
  stopDayOfWeek: 4, // Thursday
  thursdayMode: 'CURRENT',
  defaultState: 'New',
  autoClose: false,
  copyEstimates: true,
  resetActualWork: true,
  maxRetries: 3,
  initialRetryDelayMs: 1000,
  people: DEFAULT_PEOPLE,
};

export interface CliOptions {
  dryRun: boolean;
  yes: boolean;
  person?: string; // Single name, key, email, or comma-separated list
  all: boolean; // Process all configured people
  sourceTaskId?: number; // Global source task ID override
  verbose: boolean;
  timezone?: string;
  asOf?: string; // For testing/backfill simulations: YYYY-MM-DD
  todayOverride?: string; // Alias for asOf
  configFile?: string; // Optional path to custom config JSON file
  repair?: boolean; // Safe repair mode for partial relation copies
  thursdayMode?: 'CURRENT' | 'FOLLOWING'; // Rolling window behavior on Thursday
  ui?: boolean; // Launch web UI dashboard
  daemon?: boolean; // Run automated daily background scheduler
}

/**
 * Loads configuration from a JSON file if present, falling back to defaults.
 */
export function loadConfig(configFilePath?: string): AppConfig {
  const resolvedPath = configFilePath
    ? path.resolve(process.cwd(), configFilePath)
    : path.resolve(process.cwd(), 'people.json');

  if (fs.existsSync(resolvedPath)) {
    try {
      const raw = fs.readFileSync(resolvedPath, 'utf-8');
      const parsed = JSON.parse(raw);

      // Support array of people directly or { people: [...] }
      if (Array.isArray(parsed)) {
        return {
          ...DEFAULT_CONFIG,
          people: parsed,
        };
      } else if (parsed && typeof parsed === 'object') {
        const stopDayOfWeek =
          parsed.stopDay?.toUpperCase() === 'THURSDAY'
            ? 4
            : typeof parsed.stopDayOfWeek === 'number'
              ? parsed.stopDayOfWeek
              : DEFAULT_CONFIG.stopDayOfWeek;

        const thursdayMode =
          parsed.thursdayMode?.toUpperCase() === 'FOLLOWING'
            ? 'FOLLOWING'
            : 'CURRENT';

        const config: AppConfig = {
          ...DEFAULT_CONFIG,
          ...parsed,
          stopDayOfWeek,
          thursdayMode,
          people: Array.isArray(parsed.people) ? parsed.people : DEFAULT_CONFIG.people,
        };

        // Validate people identities: prevent duplicate assignedTo aliases
        const seenIdentities = new Set<string>();
        for (const person of config.people) {
          if (!person.assignedTo) continue;
          const lower = person.assignedTo.trim().toLowerCase();
          if (seenIdentities.has(lower)) {
            throw new Error(
              `Configuration Error: Duplicate identity found for "${person.assignedTo}". Multiple people cannot map to the same Azure DevOps identity.`
            );
          }
          seenIdentities.add(lower);
        }

        return config;
      }
    } catch (err: any) {
      if (err.message?.includes('Configuration Error')) {
        throw err;
      }
      // Ignore JSON parse error, use default
    }
  }

  return DEFAULT_CONFIG;
}
