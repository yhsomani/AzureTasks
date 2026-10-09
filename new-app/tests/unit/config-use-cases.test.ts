import { describe, it, expect, beforeEach } from 'vitest';
import { ConfigUseCases } from '../../src/application/use-cases/config';
import { ConfigRepository, AppConfig } from '../../src/domain/ports/repositories';

function fakeRepo(): ConfigRepository {
  return {
    async load() { return config; },
    async save() {},
    async savePeople() {},
    async saveSettings() {},
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
  beforeEach(() => { useCases = new ConfigUseCases(fakeRepo(), { ...config }); });

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
});
