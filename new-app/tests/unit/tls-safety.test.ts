import { describe, expect, it } from 'vitest';
import { assertTlsSafety } from '../../src/infrastructure/security/tls-safety';

describe('TLS startup security', () => {
  it('accepts a default environment that preserves certificate verification', () => {
    expect(() => assertTlsSafety({})).not.toThrow();
  });

  it('rejects an explicit insecure TLS bypass', () => {
    expect(() => assertTlsSafety({ ALLOW_INSECURE_TLS: 'true' }))
      .toThrow(/TLS certificate verification must remain enabled/);
  });

  it('rejects the Node.js global TLS verification bypass', () => {
    expect(() => assertTlsSafety({ NODE_TLS_REJECT_UNAUTHORIZED: '0' }))
      .toThrow(/TLS certificate verification must remain enabled/);
  });
});
