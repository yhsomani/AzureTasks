import { describe, it, expect, beforeEach } from 'vitest';
import { ConfigUseCases } from '../../src/application/use-cases/config';
import { ConfigRepository, AppConfig } from '../../src/domain/ports/repositories';

let lastSavedSettings: any = null;

function fakeRepo(): ConfigRepository {
  return {
    async load() { return config; },
    async save() {},
    async savePeople() {},
    async saveSettings(settings) { lastSavedSettings = settings; },
    async savePat() {},
  };
}

const config: AppConfig = {
  organization: 'Org', project: 'Proj', baseUrl: 'https://dev.azure.com',
  workItemType: '3in1 Task', taskSeries: 's', titlePrefix: 'p |',
  startTime: '09:30', timezone: 'Asia/Kolkata', skipWeekends: true, stopDay: 'THURSDAY',
  stopDayOfWeek: 4, thursdayMode: 'CURRENT', defaultState: 'New', autoClose: false,
  copyEstimates: true, resetActualWork: true, maxRetries: 1, initialRetryDelayMs: 0,
  people: [],
};

describe('ConfigUseCases', () => {
  let useCases: ConfigUseCases;
  beforeEach(() => {
    lastSavedSettings = null;
    delete process.env.GITHUB_TOKEN;
    delete process.env.GH_PAT;
    useCases = new ConfigUseCases(fakeRepo(), { ...config });
  });

  it('rejects duplicate person keys', async () => {
    await expect(useCases.savePeople({
      people: [
        { key: 'dup', name: 'A', assignedTo: 'a@b.com' },
        { key: 'dup', name: 'B', assignedTo: 'b@b.com' },
      ],
    })).rejects.toThrow(/Duplicate person key/);
  });

  it('rejects duplicate identities', async () => {
    await expect(useCases.savePeople({
      people: [
        { key: 'a', name: 'A', assignedTo: 'x@b.com' },
        { key: 'b', name: 'B', assignedTo: 'X@B.com' },
      ],
    })).rejects.toThrow(/Duplicate identity/);
  });

  it('rejects unsafe repository paths and branch names in a team member', async () => {
    await expect(useCases.savePeople({ people: [{
      key: 'a', name: 'A', assignedTo: 'a@b.com', githubRepositories: ['../secrets'],
    }] })).rejects.toThrow(/GitHub repositories/);
    await expect(useCases.savePeople({ people: [{
      key: 'a', name: 'A', assignedTo: 'a@b.com', githubBranches: ['../../secret'],
    }] })).rejects.toThrow(/GitHub branches/);
  });

  it('accepts a valid roster', async () => {
    const result = await useCases.savePeople({
      people: [
        { key: 'a', name: 'A', assignedTo: 'a@b.com' },
        { key: 'b', name: 'B', assignedTo: 'b@b.com' },
      ],
    });
    expect(result.people).toHaveLength(2);
  });

  it('rejects an invalid timezone', async () => {
    await expect(useCases.saveSettings({ timezone: 'Not/AZone' }))
      .rejects.toThrow(/Invalid timezone/);
  });

  it('rejects an invalid start time', async () => {
    await expect(useCases.saveSettings({ startTime: '25:99' }))
      .rejects.toThrow(/Invalid startTime/);
  });

  it('accepts valid settings and updates the live config', async () => {
    const result = await useCases.saveSettings({ timezone: 'UTC', startTime: '08:15' });
    expect(result.config.timezone).toBe('UTC');
    expect(result.config.startTime).toBe('08:15');
  });

  it('masks githubToken in getConfig response', async () => {
    const ucWithToken = new ConfigUseCases(fakeRepo(), {
      ...config,
      githubToken: 'ghp_secretToken1234567890abcdef',
    });
    const retrieved = await ucWithToken.getConfig();
    expect(retrieved.githubToken).toBe('ghp_...cdef');
    expect(retrieved.githubToken).not.toContain('secretToken');
  });

  it('returns undefined for githubToken in getConfig when unset', async () => {
    const retrieved = await useCases.getConfig();
    expect(retrieved.githubToken).toBeUndefined();
  });

  it('persists githubOrg, githubUserSuffix, autoClose, workItemType, titlePrefix and updates env on saveSettings', async () => {
    const result = await useCases.saveSettings({
      githubOrg: 'AcmeOrg',
      githubUserSuffix: '@acme.com',
      githubToken: 'ghp_newSuperSecretKey9999',
      autoClose: true,
      autoCloseStartTime: '18:00',
      autoCloseEndTime: '18:30',
      workItemType: 'Custom Task',
      titlePrefix: 'Custom |',
    });

    expect(result.config.githubOrg).toBe('AcmeOrg');
    expect(result.config.githubUserSuffix).toBe('@acme.com');
    expect(result.config.autoClose).toBe(true);
    expect(result.config.autoCloseStartTime).toBe('18:00');
    expect(result.config.autoCloseEndTime).toBe('18:30');
    expect(result.config.workItemType).toBe('Custom Task');
    expect(result.config.titlePrefix).toBe('Custom |');
    expect(process.env.GITHUB_TOKEN).toBe('ghp_newSuperSecretKey9999');
    expect(lastSavedSettings).toMatchObject({
      githubOrg: 'AcmeOrg',
      githubUserSuffix: '@acme.com',
      githubToken: 'ghp_newSuperSecretKey9999',
      autoClose: true,
      autoCloseStartTime: '18:00',
      autoCloseEndTime: '18:30',
      workItemType: 'Custom Task',
      titlePrefix: 'Custom |',
    });
  });

  it('never returns a raw GitHub token after saving settings', async () => {
    const token = 'ghp_critical-secret-only-in-memory-5678';
    const saved = await useCases.saveSettings({ githubToken: token, githubOrg: 'Example' });
    expect(lastSavedSettings.githubToken).toBe(token); // credential persistence is unchanged
    expect(saved.config.githubToken).not.toBe(token);
    expect(JSON.stringify(saved)).not.toContain('critical-secret-only-in-memory');
    expect(saved.config.githubToken).toBe('ghp_...5678');
  });

  it('validates autoCloseStartTime and autoCloseEndTime format', async () => {
    await expect(useCases.saveSettings({ autoCloseStartTime: 'invalid' }))
      .rejects.toThrow(/Invalid autoCloseStartTime/);
    await expect(useCases.saveSettings({ autoCloseEndTime: '25:00' }))
      .rejects.toThrow(/Invalid autoCloseEndTime/);
  });
});
