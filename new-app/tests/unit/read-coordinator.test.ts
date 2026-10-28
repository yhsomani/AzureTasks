import { describe, expect, it, vi } from 'vitest';
import { ReadCoordinator } from '../../src/presentation/api/read-coordinator.js';

describe('ReadCoordinator', () => {
  it('coalesces matching scopes but never caches completed results', async () => {
    const coordinator = new ReadCoordinator();
    const load = vi.fn(async () => ({ count: 7 }));
    const results = await Promise.all(Array.from({ length: 10 }, () => coordinator.run('operator:week', load)));
    expect(load).toHaveBeenCalledTimes(1);
    expect(results).toHaveLength(10);
    await coordinator.run('operator:week', load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('isolates roles and invalidated generations', async () => {
    const coordinator = new ReadCoordinator();
    const load = vi.fn(async () => 1);
    const first = coordinator.run('operator:week', load);
    const viewer = coordinator.run('viewer:week', load);
    coordinator.invalidate();
    const newer = coordinator.run('operator:week', load);
    await Promise.all([first, viewer, newer]);
    expect(load).toHaveBeenCalledTimes(3);
  });

  it('does not retain rejected requests', async () => {
    const coordinator = new ReadCoordinator();
    await expect(coordinator.run('week', async () => { throw new Error('offline'); })).rejects.toThrow('offline');
    await expect(coordinator.run('week', async () => 2)).resolves.toBe(2);
  });
});