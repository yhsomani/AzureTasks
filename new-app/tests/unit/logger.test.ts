import { describe, it, expect, vi } from 'vitest';
import { logger } from '../../src/infrastructure/logging/logger';

describe('Logger secret scrubbing', () => {
  it('redacts secrets even in raw console output', () => {
    const secret = 'test-only-raw-logger-token-748596';
    logger.registerSecret(secret);
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {});
    try {
      logger.raw('Untrusted API message: ' + secret);
      expect(spy).toHaveBeenCalledOnce();
      expect(String(spy.mock.calls[0][0])).toContain('***');
      expect(String(spy.mock.calls[0][0])).not.toContain(secret);
    } finally {
      spy.mockRestore();
    }
  });
});
