import { describe, it, expect } from 'vitest';
import {
  generatePlanToken,
  verifyPlanToken,
  computePlanHash,
  getPlanSigningSecret,
} from '../../src/domain/entities/plan-token.js';

describe('Milestone 3 — Feature 19: Plan Token Cryptographic Signing & Validation', () => {
  const sampleSnapshot = {
    todayIso: '2026-11-22',
    nextThursdayIso: '2026-11-26',
    totalPlanned: 2,
    personCount: 1,
    items: [
      {
        personKey: 'dev1',
        personName: 'Dev One',
        assignedTo: 'dev1@workops.test',
        targetIsoDate: '2026-11-23',
        title: 'Task: Dev One | Sprint 1 | 2026-11-23',
      },
    ],
  };

  it('computes deterministic SHA-256 hash for snapshot', () => {
    const hash1 = computePlanHash(sampleSnapshot);
    const hash2 = computePlanHash(sampleSnapshot);
    expect(hash1).toBe(hash2);
    expect(hash1).toHaveLength(64);
  });

  it('generates HMAC-SHA256 signed plan token with default 10-minute TTL', () => {
    const start = Date.now();
    const tokenInfo = generatePlanToken(sampleSnapshot);
    const end = Date.now();

    expect(tokenInfo.planToken.startsWith('pln_')).toBe(true);
    expect(tokenInfo.planHash).toHaveLength(64);
    expect(tokenInfo.tokenHash).toHaveLength(64);

    // TTL must be approximately 10 minutes (600,000 ms)
    const ttl = tokenInfo.expiresAt - start;
    expect(ttl).toBeGreaterThanOrEqual(600000 - 100);
    expect(ttl).toBeLessThanOrEqual(600000 + (end - start) + 100);

    const parts = tokenInfo.planToken.slice(4).split('.');
    expect(parts.length).toBe(3);
    const [hash, expiresAtStr, signature] = parts;
    expect(hash).toBe(tokenInfo.planHash);
    expect(Number(expiresAtStr)).toBe(tokenInfo.expiresAt);
    expect(signature).toHaveLength(64);
  });

  it('verifies a genuine unexpired plan token successfully', () => {
    const tokenInfo = generatePlanToken(sampleSnapshot);
    const verification = verifyPlanToken(tokenInfo.planToken);

    expect(verification.valid).toBe(true);
    expect(verification.planHash).toBe(tokenInfo.planHash);
    expect(verification.expiresAt).toBe(tokenInfo.expiresAt);
    expect(verification.tokenHash).toBe(tokenInfo.tokenHash);
  });

  it('detects tampered plan token signatures (PLAN_TAMPERED)', () => {
    const tokenInfo = generatePlanToken(sampleSnapshot);
    const parts = tokenInfo.planToken.split('.');
    // Tamper with the last character of signature
    const badSignature = parts[2].slice(0, -1) + (parts[2].endsWith('a') ? 'b' : 'a');
    const tamperedToken = `${parts[0]}.${parts[1]}.${badSignature}`;

    const verification = verifyPlanToken(tamperedToken);
    expect(verification.valid).toBe(false);
    expect(verification.error).toBe('PLAN_TAMPERED');
  });

  it('detects expired plan tokens (PLAN_EXPIRED)', () => {
    // Generate token with 100ms TTL
    const tokenInfo = generatePlanToken(sampleSnapshot, 100);
    const futureTime = tokenInfo.expiresAt + 5000;

    const verification = verifyPlanToken(tokenInfo.planToken, getPlanSigningSecret(), futureTime);
    expect(verification.valid).toBe(false);
    expect(verification.error).toBe('PLAN_EXPIRED');
  });

  it('rejects malformed token strings (INVALID_FORMAT)', () => {
    expect(verifyPlanToken('').valid).toBe(false);
    expect(verifyPlanToken('not-a-token').valid).toBe(false);
    expect(verifyPlanToken('pln_abc.123').valid).toBe(false);
    expect(verifyPlanToken('pln_abc.not-a-number.sig').valid).toBe(false);
  });

  it('rejects token signed with rotated or mismatched secret key', () => {
    const secretA = 'secret-key-alpha-32-characters-long!';
    const secretB = 'secret-key-bravo-32-characters-long!';

    const tokenInfo = generatePlanToken(sampleSnapshot, 600000, secretA);
    const verification = verifyPlanToken(tokenInfo.planToken, secretB);

    expect(verification.valid).toBe(false);
    expect(verification.error).toBe('PLAN_TAMPERED');
  });
});
