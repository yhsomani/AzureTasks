import { describe, expect, it, vi } from 'vitest';
import tls from 'node:tls';
import https from 'node:https';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { logger } from '../../src/infrastructure/logging/logger.js';
import {
  assertTlsSafety,
  validateCaPath,
  parseCaCertificatePem,
  checkCertExpiry,
  getEffectiveCaCertPath,
  installEnterpriseCaCertificates,
} from '../../src/infrastructure/security/tls-safety.js';

describe('Milestone 4 — Feature 28: Standard Enterprise CA Injection & TLS Safety', () => {
  describe('assertTlsSafety()', () => {
    it('accepts a default environment that preserves certificate verification', () => {
      expect(() => assertTlsSafety({})).not.toThrow();
    });

    it('rejects an explicit insecure TLS bypass', () => {
      expect(() => assertTlsSafety({ ALLOW_INSECURE_TLS: 'true' }))
        .toThrow(/TLS certificate verification must remain enabled/);
    });

    it('rejects case variants and whitespace in ALLOW_INSECURE_TLS', () => {
      expect(() => assertTlsSafety({ ALLOW_INSECURE_TLS: ' True ' }))
        .toThrow(/TLS certificate verification must remain enabled/);
    });

    it('rejects the Node.js global TLS verification bypass', () => {
      expect(() => assertTlsSafety({ NODE_TLS_REJECT_UNAUTHORIZED: '0' }))
        .toThrow(/TLS certificate verification must remain enabled/);
    });

    it('accepts secure environment configurations', () => {
      expect(() => assertTlsSafety({ ALLOW_INSECURE_TLS: 'false', NODE_TLS_REJECT_UNAUTHORIZED: '1' }))
        .not.toThrow();
    });
  });

  describe('validateCaPath()', () => {
    it('flags non-existent CA path with appropriate warning', () => {
      const result = validateCaPath('/non/existent/path/ca.pem');
      expect(result.valid).toBe(false);
      expect(result.warning).toContain('NODE_EXTRA_CA_CERTS');
    });

    it('flags arbitrary non-existent paths', () => {
      const result = validateCaPath('/custom/arbitrary/nonexistent/ca.pem');
      expect(result.valid).toBe(false);
      expect(result.warning).toContain('NODE_EXTRA_CA_CERTS');
    });

    it('rejects directory paths as invalid CA certificate files', () => {
      const result = validateCaPath(process.cwd());
      expect(result.valid).toBe(false);
      expect(result.warning).toContain('NODE_EXTRA_CA_CERTS');
      expect(result.warning).toContain('directory');
    });

    it('rejects 0-byte empty files as invalid CA certificates', () => {
      const tmpFile = path.join(os.tmpdir(), `empty-ca-${Date.now()}.pem`);
      try {
        fs.writeFileSync(tmpFile, '');
        const result = validateCaPath(tmpFile);
        expect(result.valid).toBe(false);
        expect(result.warning).toContain('NODE_EXTRA_CA_CERTS');
        expect(result.warning).toContain('empty');
      } finally {
        if (fs.existsSync(tmpFile)) {
          fs.unlinkSync(tmpFile);
        }
      }
    });

    it('flags empty or non-string paths', () => {
      expect(validateCaPath('').valid).toBe(false);
      expect(validateCaPath(null as any).valid).toBe(false);
    });

    it('validates existing file paths', () => {
      const result = validateCaPath(process.cwd() + '/package.json');
      expect(result.valid).toBe(true);
      expect(result.warning).toBeUndefined();
    });
  });

  describe('parseCaCertificatePem()', () => {
    it('accepts valid PEM certificate structure', () => {
      const validPem = '-----BEGIN CERTIFICATE-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8A...\n-----END CERTIFICATE-----';
      expect(parseCaCertificatePem(validPem)).toBe(true);
    });

    it('rejects corrupted or non-PEM strings', () => {
      expect(() => parseCaCertificatePem('NOT A VALID PEM')).toThrow('Invalid PEM format: Missing certificate header');
      expect(() => parseCaCertificatePem('')).toThrow('Invalid PEM format');
    });
  });

  describe('checkCertExpiry()', () => {
    it('detects expired certificates', () => {
      const pastDate = new Date(Date.now() - 1000 * 60 * 60);
      const result = checkCertExpiry(pastDate);
      expect(result.valid).toBe(false);
      expect(result.status).toBe('CERT_HAS_EXPIRED');
    });

    it('validates unexpired certificates', () => {
      const futureDate = new Date(Date.now() + 1000 * 60 * 60 * 24 * 365);
      const result = checkCertExpiry(futureDate);
      expect(result.valid).toBe(true);
      expect(result.status).toBe('VALID');
    });

    it('handles invalid dates safely', () => {
      const result = checkCertExpiry(new Date('invalid-date'));
      expect(result.valid).toBe(false);
      expect(result.status).toBe('CERT_HAS_EXPIRED');
    });
  });

  describe('Absence of TLS Dynamic Monkeypatching', () => {
    it('preserves native tls.createSecureContext and https.globalAgent', () => {
      installEnterpriseCaCertificates({});
      expect(typeof tls.createSecureContext).toBe('function');
      expect(typeof https.globalAgent).toBe('object');
      expect((https.globalAgent as any).__monkeypatched).toBeUndefined();
    });
  });

  describe('getEffectiveCaCertPath()', () => {
    it('resolves NODE_EXTRA_CA_CERTS from environment when present', () => {
      const customPath = '/custom/path/ca.pem';
      const resolved = getEffectiveCaCertPath({ NODE_EXTRA_CA_CERTS: customPath });
      expect(resolved).toBe(customPath);
    });
  });

  describe('installEnterpriseCaCertificates() warning diagnostics', () => {
    it('logs warning for missing CA certificate path without throwing', () => {
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
      try {
        expect(() =>
          installEnterpriseCaCertificates({ NODE_EXTRA_CA_CERTS: '/non/existent/ca-bundle.pem' })
        ).not.toThrow();
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('NODE_EXTRA_CA_CERTS'));
      } finally {
        warnSpy.mockRestore();
      }
    });

    it('logs warning for invalid PEM certificate file without throwing', () => {
      const tmpFile = path.join(os.tmpdir(), `invalid-pem-${Date.now()}.pem`);
      fs.writeFileSync(tmpFile, 'NOT_A_CERTIFICATE');
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
      try {
        expect(() => installEnterpriseCaCertificates({ NODE_EXTRA_CA_CERTS: tmpFile })).not.toThrow();
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('Invalid CA certificate bundle'));
      } finally {
        warnSpy.mockRestore();
        if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
      }
    });

    it('logs warning when an X509 CA certificate is expired', () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'expired-ca-'));
      const keyPath = path.join(tmpDir, 'ca.key');
      const certPath = path.join(tmpDir, 'ca.pem');
      const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {});
      try {
        execFileSync('openssl', [
          'req',
          '-x509',
          '-newkey',
          'rsa:2048',
          '-keyout',
          keyPath,
          '-out',
          certPath,
          '-nodes',
          '-subj',
          '/CN=ExpiredTestCA',
          '-not_before',
          '20200101000000Z',
          '-not_after',
          '20200102000000Z',
        ]);
        installEnterpriseCaCertificates({ NODE_EXTRA_CA_CERTS: certPath });
        expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('is expired'));
      } finally {
        warnSpy.mockRestore();
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });
  });
});
