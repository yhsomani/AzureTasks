import { describe, expect, it } from 'vitest';
import { logger, LogEntry } from '../src/utils/logger.js';

describe('Logger Ring Buffer & Streaming Suite', () => {
  it('records log entries in buffer and sanitizes secrets', () => {
    logger.registerSecret('SuperSecretPAT123');
    logger.info('Test log with SuperSecretPAT123 token');

    const recent = logger.getRecentLogs(10);
    expect(recent.length).toBeGreaterThan(0);
    const last = recent[recent.length - 1];
    expect(last.level).toBe('INFO');
    expect(last.message).toContain('Test log with ***REDACTED*** token');
    expect(last.message).not.toContain('SuperSecretPAT123');
  });

  it('notifies subscribers via addListener and supports unsubscribe', () => {
    const received: LogEntry[] = [];
    const unsubscribe = logger.addListener((entry) => {
      received.push(entry);
    });

    logger.success('Operation succeeded!');
    expect(received.length).toBe(1);
    expect(received[0].level).toBe('SUCCESS');
    expect(received[0].message).toBe('Operation succeeded!');

    unsubscribe();
    logger.info('Another message after unsubscribe');
    expect(received.length).toBe(1); // No new events received
  });

  it('limits buffer size to maxBufferSize', () => {
    logger.clearBuffer();
    for (let i = 0; i < 350; i++) {
      logger.info(`Message ${i}`);
    }
    const recent = logger.getRecentLogs(400);
    expect(recent.length).toBeLessThanOrEqual(300);
  });
});
