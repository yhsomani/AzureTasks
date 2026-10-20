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

  it('redacts unregistered Bearer tokens via regex pattern', () => {
    const msg = 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.e30.t-IDmLeq';
    expect(logger.sanitize(msg)).toBe('Authorization: Bearer ***');
  });

  it('redacts unregistered GitHub classic PATs (ghp_)', () => {
    const token = 'ghp_' + 'A'.repeat(36);
    const msg = `API call failed with token ${token} on repo`;
    expect(logger.sanitize(msg)).toBe('API call failed with token *** on repo');
  });

  it('redacts unregistered GitHub fine-grained PATs (github_pat_)', () => {
    const token = 'github_pat_' + '1'.repeat(82);
    const msg = `Remote URL: https://${token}@github.com/org/repo.git`;
    expect(logger.sanitize(msg)).toBe('Remote URL: https://***@github.com/org/repo.git');
  });

  it('redacts unregistered Azure DevOps PATs (52-char base32/alphanumeric)', () => {
    const patBase32 = '4abcdefghijklmnopqrstuvwxyz234567abcdefghijklmnopqrs';
    expect(patBase32.length).toBe(52);
    const msg1 = `Connected with Azure PAT ${patBase32} successfully`;
    expect(logger.sanitize(msg1)).toBe('Connected with Azure PAT *** successfully');

    const patAlpha = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
    expect(patAlpha.length).toBe(52);
    const msg2 = `Azure token: ${patAlpha}`;
    expect(logger.sanitize(msg2)).toBe('Azure token: ***');
  });

  it('redacts unregistered HTTP Basic Authorization headers (Azure DevOps PAT base64)', () => {
    const header = 'Authorization: Basic OjUyY2hhcmFjdGVycGF0ZXhhbXBsZXRva2VuZm9yYXp1cmVkZXZvcHM=';
    expect(logger.sanitize(header)).toBe('Authorization: Basic ***');
  });

  it('scrubs regex credentials across in-memory buffer and listeners', () => {
    const pat = 'ghp_' + 'B'.repeat(36);
    let captured: string | undefined;
    const unsub = logger.addListener(entry => { captured = entry.message; });
    try {
      logger.info(`Token emitted: ${pat}`);
      expect(captured).toBe('Token emitted: ***');
      const recent = logger.getRecentLogs(1);
      expect(recent[0].message).toBe('Token emitted: ***');
    } finally {
      unsub();
    }
  });

  it('retroactively scrubs in-memory buffer when a new secret is registered', () => {
    const lateSecret = 'late-registered-secret-token-12345';
    logger.info(`Pre-existing buffer message containing ${lateSecret}`);
    const before = logger.getRecentLogs(1)[0];
    expect(before.message).toContain(lateSecret);

    logger.registerSecret(lateSecret);
    const after = logger.getRecentLogs(1)[0];
    expect(after.message).not.toContain(lateSecret);
    expect(after.message).toContain('***');
  });

  it('provides mask helper for secrets', () => {
    expect(logger.mask('')).toBe('');
    const secret = 'ghp_' + 'C'.repeat(36);
    expect(logger.mask(secret)).toBe('***');
  });
});
