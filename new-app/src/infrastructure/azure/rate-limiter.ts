/**
 * Bounded Concurrency & Token Bucket Rate Limiter for Azure DevOps
 * Protects against upstream HTTP 429 rate limiting and regulates outbound throughput.
 */

export interface TokenBucketOptions {
  capacity?: number;
  refillRatePerSecond?: number;
}

export class TokenBucket {
  private capacity: number;
  private refillRate: number;
  private tokens: number;
  private lastRefillTimestamp: number;

  constructor(options: TokenBucketOptions = {}) {
    this.capacity = options.capacity ?? 50;
    this.refillRate = options.refillRatePerSecond ?? 10;
    this.tokens = this.capacity;
    this.lastRefillTimestamp = Date.now();
  }

  private refill(): void {
    const now = Date.now();
    const elapsedSeconds = (now - this.lastRefillTimestamp) / 1000;
    if (elapsedSeconds > 0) {
      const addedTokens = elapsedSeconds * this.refillRate;
      this.tokens = Math.min(this.capacity, this.tokens + addedTokens);
      this.lastRefillTimestamp = now;
    }
  }

  consume(tokens: number = 1): boolean {
    if (tokens <= 0) {
      return true;
    }
    this.refill();
    if (this.tokens >= tokens) {
      this.tokens -= tokens;
      return true;
    }
    return false;
  }

  async acquire(tokens: number = 1, abortSignal?: AbortSignal): Promise<void> {
    if (tokens > this.capacity) {
      throw new Error(`Requested tokens (${tokens}) exceeds bucket capacity (${this.capacity})`);
    }
    while (!this.consume(tokens)) {
      if (abortSignal?.aborted) {
        throw new Error('Token acquisition aborted');
      }
      // Wait for tokens to replenish
      const waitMs = Math.ceil((tokens / this.refillRate) * 1000);
      await new Promise((resolve) => setTimeout(resolve, Math.min(waitMs, 200)));
    }
  }

  getRemainingTokens(): number {
    this.refill();
    return Math.floor(this.tokens);
  }
}

/**
 * Bounded Concurrency Queue (p-limit semantics)
 */
export function pLimit(concurrency: number) {
  if (concurrency < 1) {
    throw new TypeError('Expected concurrency to be at least 1');
  }

  const queue: Array<() => void> = [];
  let activeCount = 0;

  const next = () => {
    activeCount--;
    if (queue.length > 0) {
      const task = queue.shift();
      if (task) task();
    }
  };

  return async <T>(fn: () => Promise<T>): Promise<T> => {
    return new Promise<T>((resolve, reject) => {
      const run = async () => {
        activeCount++;
        try {
          const result = await fn();
          resolve(result);
        } catch (err) {
          reject(err);
        } finally {
          next();
        }
      };

      if (activeCount < concurrency) {
        run();
      } else {
        queue.push(run);
      }
    });
  };
}

/**
 * Execute tasks in chunks with bounded concurrency while preserving input order
 */
export async function executeBoundedBatch<TItem, TResult>(
  items: TItem[],
  batchHandler: (chunk: TItem[], chunkIndex: number) => Promise<TResult[]>,
  options: { chunkSize?: number; concurrency?: number; signal?: AbortSignal } = {}
): Promise<TResult[]> {
  if (options.signal?.aborted) {
    throw new Error('Batch execution cancelled');
  }

  const chunkSize = options.chunkSize ?? 100;
  const concurrency = options.concurrency ?? 5;
  const limiter = pLimit(concurrency);

  const chunks: TItem[][] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }

  return new Promise<TResult[]>((resolve, reject) => {
    let completed = false;
    let abortListener: (() => void) | undefined;

    if (options.signal) {
      abortListener = () => {
        if (!completed) {
          completed = true;
          reject(new Error('Batch execution cancelled'));
        }
      };
      options.signal.addEventListener('abort', abortListener, { once: true });
    }

    const chunkPromises = chunks.map((chunk, index) =>
      limiter(async () => {
        if (options.signal?.aborted || completed) {
          throw new Error('Batch execution cancelled');
        }
        return batchHandler(chunk, index);
      })
    );

    Promise.all(chunkPromises)
      .then((chunkResults) => {
        if (!completed) {
          completed = true;
          if (abortListener && options.signal) {
            options.signal.removeEventListener('abort', abortListener);
          }
          resolve(chunkResults.flat());
        }
      })
      .catch((err) => {
        if (!completed) {
          completed = true;
          if (abortListener && options.signal) {
            options.signal.removeEventListener('abort', abortListener);
          }
          reject(err);
        }
      });
  });
}

/**
 * Calculate exponential backoff delay with jitter
 */
export function calculateBackoffDelay(attempt: number, baseMs: number = 1000, maxMs: number = 30000): number {
  const delay = baseMs * Math.pow(2, attempt);
  const jitter = Math.random() * 0.2 * delay;
  return Math.min(maxMs, delay + jitter);
}
