export class ReadCoordinator {
  private readonly pending = new Map<string, Promise<unknown>>();
  private generation = 0;

  constructor(private readonly maxPending = 100) {}

  invalidate(): void {
    this.generation += 1;
  }

  async run<Result>(scope: string, operation: () => Promise<Result>): Promise<Result> {
    const key = `${this.generation}:${scope}`;
    const existing = this.pending.get(key);
    if (existing) return existing as Promise<Result>;
    if (this.pending.size >= this.maxPending) return operation();
    const request = Promise.resolve().then(operation);
    this.pending.set(key, request);
    try {
      return await request;
    } finally {
      if (this.pending.get(key) === request) this.pending.delete(key);
    }
  }
}