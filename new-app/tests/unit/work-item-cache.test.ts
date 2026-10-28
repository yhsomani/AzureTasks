import { afterEach, describe, expect, it, vi } from 'vitest';
import { AzureWorkItemService } from '../../src/infrastructure/azure/work-item-service.js';
import { AzureDevOpsClient } from '../../src/infrastructure/azure/client.js';

afterEach(() => vi.restoreAllMocks());

describe('work-item observation freshness', () => {
  it('bypasses a cached observation when verification explicitly requests fresh data', async () => {
    let revision = 0;
    const client = { get: vi.fn(async () => ({ id: 7, rev: ++revision, fields: {} })) };
    const service = new AzureWorkItemService(client as unknown as AzureDevOpsClient);
    await service.getWorkItem(7);
    expect((await service.getWorkItem(7, { fresh: true })).rev).toBe(2);
    expect(client.get).toHaveBeenCalledTimes(2);
  });

  it('evicts the oldest observation when the thousand-item bound is exceeded', async () => {
    const client = { get: vi.fn(async () => ({ id: 7, fields: {} })) };
    const service = new AzureWorkItemService(client as unknown as AzureDevOpsClient);
    for (let index = 0; index < 1001; index++) await service.getWorkItem(index);
    await service.getWorkItem(0);
    expect(client.get).toHaveBeenCalledTimes(1002);
  });

  it('invalidates observations around patch before independent verification', async () => {
    let active = false;
    const client = {
      get: vi.fn(async () => ({ id: 7, fields: { 'System.State': active ? 'Active' : 'New' } })),
      patch: vi.fn(async () => { active = true; return { id: 7, fields: {} }; }),
    };
    const service = new AzureWorkItemService(client as unknown as AzureDevOpsClient);
    await service.getWorkItem(7);
    await service.patchWorkItem(7, []);
    const current = await service.getWorkItem(7);
    expect(current.fields['System.State']).toBe('Active');
    expect(client.get).toHaveBeenCalledTimes(2);
  });

  it('expires observations after thirty seconds', async () => {
    const clock = vi.spyOn(Date, 'now').mockReturnValue(1000);
    const client = { get: vi.fn(async () => ({ id: 7, fields: {} })) };
    const service = new AzureWorkItemService(client as unknown as AzureDevOpsClient);
    await service.getWorkItem(7);
    clock.mockReturnValue(32000);
    await service.getWorkItem(7);
    expect(client.get).toHaveBeenCalledTimes(2);
  });
});