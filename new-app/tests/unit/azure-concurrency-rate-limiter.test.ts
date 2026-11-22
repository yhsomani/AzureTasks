import { describe, it, expect } from 'vitest';
import {
  TokenBucket,
  pLimit,
  executeBoundedBatch,
  calculateBackoffDelay,
} from '../../src/infrastructure/azure/rate-limiter.js';

describe('Feature #37: Bounded Azure DevOps Concurrency & Rate Limiting', () => {
  it('regulates consumption and respects token bucket capacity', () => {
    const bucket = new TokenBucket({ capacity: 5, refillRatePerSecond: 1 });
    expect(bucket.consume(3)).toBe(true);
    expect(bucket.getRemainingTokens()).toBe(2);
    expect(bucket.consume(3)).toBe(false); // only 2 tokens left
    expect(bucket.consume(2)).toBe(true);
    expect(bucket.getRemainingTokens()).toBe(0);
  });

  it('handles zero or negative tokens in consume without inflating capacity', () => {
    const bucket = new TokenBucket({ capacity: 5, refillRatePerSecond: 1 });
    expect(bucket.consume(0)).toBe(true);
    expect(bucket.consume(-5)).toBe(true);
    expect(bucket.getRemainingTokens()).toBe(5);
  });

  it('throws descriptive error in acquire when requested tokens exceed bucket capacity', async () => {
    const bucket = new TokenBucket({ capacity: 5, refillRatePerSecond: 1 });
    await expect(bucket.acquire(10)).rejects.toThrow(
      'Requested tokens (10) exceeds bucket capacity (5)'
    );
  });

  it('bounds concurrent task execution to specified limit', async () => {
    const limit = pLimit(2);
    let activeWorkers = 0;
    let maxObservedWorkers = 0;

    const workerTask = async (id: number) => {
      return limit(async () => {
        activeWorkers++;
        maxObservedWorkers = Math.max(maxObservedWorkers, activeWorkers);
        await new Promise((resolve) => setTimeout(resolve, 20));
        activeWorkers--;
        return id * 2;
      });
    };

    const tasks = [1, 2, 3, 4, 5].map((id) => workerTask(id));
    const results = await Promise.all(tasks);

    expect(results).toEqual([2, 4, 6, 8, 10]);
    expect(maxObservedWorkers).toBeLessThanOrEqual(2);
  });

  it('preserves exact input ordering across chunked bounded batches', async () => {
    const inputIds = [101, 102, 103, 104, 105, 106];
    const results = await executeBoundedBatch(
      inputIds,
      async (chunk) => {
        // Mock asynchronous fetch with minor delay
        await new Promise((r) => setTimeout(r, 10));
        return chunk.map((id) => ({ id, title: `Item ${id}` }));
      },
      { chunkSize: 2, concurrency: 2 }
    );

    expect(results.map((r) => r.id)).toEqual(inputIds);
  });

  it('calculates exponential backoff delay correctly with bounded upper limit', () => {
    const delay0 = calculateBackoffDelay(0, 1000, 10000);
    const delay1 = calculateBackoffDelay(1, 1000, 10000);
    const delay2 = calculateBackoffDelay(2, 1000, 10000);

    expect(delay0).toBeGreaterThanOrEqual(1000);
    expect(delay1).toBeGreaterThanOrEqual(2000);
    expect(delay2).toBeGreaterThanOrEqual(4000);

    const highAttemptDelay = calculateBackoffDelay(10, 1000, 10000);
    expect(highAttemptDelay).toBeLessThanOrEqual(10000);
  });

  it('supports request cancellation via AbortSignal', async () => {
    const controller = new AbortController();
    const promise = executeBoundedBatch(
      [1, 2, 3],
      async (chunk) => {
        await new Promise((r) => setTimeout(r, 50));
        return chunk;
      },
      { signal: controller.signal }
    );

    controller.abort();
    await expect(promise).rejects.toThrow();
  });
});
