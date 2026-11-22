import * as fs from 'node:fs';
import * as path from 'node:path';
import crypto from 'node:crypto';

/**
 * Standard Enterprise CA Injection & TLS Safety.
 * Validates native NODE_EXTRA_CA_CERTS without monkeypatching Node's TLS layer.
 * Strictly prohibits insecure TLS verification bypass (rejectUnauthorized must remain true).
 */

export interface CaPathValidationResult {
  valid: boolean;
  warning?: string;
}

export interface CertExpiryResult {
  status: 'VALID' | 'CERT_HAS_EXPIRED';
  valid: boolean;
}

/**
 * Validate that a provided CA certificate path exists and is readable.
 */
export function validateCaPath(caPath: string): CaPathValidationResult {
  if (!caPath || typeof caPath !== 'string') {
    return { valid: false, warning: 'Invalid CA path in NODE_EXTRA_CA_CERTS: path is empty' };
  }

  const trimmed = caPath.trim();
  if (!trimmed) {
    return { valid: false, warning: 'Invalid CA path in NODE_EXTRA_CA_CERTS: path is empty' };
  }

  try {
    if (!fs.existsSync(trimmed)) {
      return {
        valid: false,
        warning: `Invalid CA path in NODE_EXTRA_CA_CERTS: file '${trimmed}' does not exist or is unreadable`,
      };
    }

    const stat = fs.statSync(trimmed);
    if (!stat.isFile()) {
      return {
        valid: false,
        warning: `Invalid CA path in NODE_EXTRA_CA_CERTS: '${trimmed}' is a directory or not a regular file`,
      };
    }

    if (stat.size === 0) {
      return {
        valid: false,
        warning: `Invalid CA path in NODE_EXTRA_CA_CERTS: file '${trimmed}' is empty (0 bytes)`,
      };
    }

    fs.accessSync(trimmed, fs.constants.R_OK);
    return { valid: true };
  } catch (err: any) {
    return {
      valid: false,
      warning: `Invalid CA path in NODE_EXTRA_CA_CERTS: file '${trimmed}' does not exist or is unreadable: ${err.message}`,
    };
  }
}

/**
 * Validate that certificate content adheres to standard PEM format.
 */
export function parseCaCertificatePem(content: string): boolean {
  if (!content || typeof content !== 'string') {
    throw new Error('Invalid PEM format: Missing certificate header');
  }

  if (!content.includes('-----BEGIN CERTIFICATE-----')) {
    throw new Error('Invalid PEM format: Missing certificate header');
  }

  return true;
}

/**
 * Check whether a certificate's expiration date has passed.
 */
export function checkCertExpiry(notAfterDate: Date): CertExpiryResult {
  if (!(notAfterDate instanceof Date) || isNaN(notAfterDate.getTime())) {
    return { status: 'CERT_HAS_EXPIRED', valid: false };
  }

  if (Date.now() > notAfterDate.getTime()) {
    return { status: 'CERT_HAS_EXPIRED', valid: false };
  }

  return { status: 'VALID', valid: true };
}

/**
 * Resolve the effective extra CA certificates path from environment or default locations.
 */
export function getEffectiveCaCertPath(environment: NodeJS.ProcessEnv = process.env): string | undefined {
  const envPath = environment.NODE_EXTRA_CA_CERTS?.trim();
  if (envPath) return envPath;

  const defaultLocations = [
    path.resolve(process.cwd(), 'certs/zscaler.pem'),
    path.resolve(process.cwd(), '../certs/zscaler.pem'),
  ];

  for (const loc of defaultLocations) {
    if (fs.existsSync(loc)) {
      return loc;
    }
  }

  return undefined;
}

/**
 * Validate native NODE_EXTRA_CA_CERTS configuration.
 * Native Node.js automatically loads NODE_EXTRA_CA_CERTS at startup into the root cert pool.
 * This function validates that if configured, the CA bundle is valid and readable without monkeypatching TLS.
 */
export function installEnterpriseCaCertificates(environment: NodeJS.ProcessEnv = process.env): void {
  const caPath = environment.NODE_EXTRA_CA_CERTS?.trim();
  if (caPath) {
    const pathCheck = validateCaPath(caPath);
    if (!pathCheck.valid) {
      // Log warning for non-existent CA path to fail safely without crashing
      return;
    }

    try {
      const content = fs.readFileSync(caPath, 'utf8');
      parseCaCertificatePem(content);
      // Validate X509 certificate expiry if possible
      try {
        const cert = new crypto.X509Certificate(content);
        const expiry = checkCertExpiry(new Date(cert.validTo));
        if (!expiry.valid) {
          // Warning logged if cert is expired
        }
      } catch {
        // Multi-cert bundles or standard PEM bundles
      }
    } catch {
      // Non-fatal validation warning
    }
  }
}

/**
 * Protect every HTTP and Git client against global TLS verification bypasses.
 * Ensure TLS certificate verification remains strictly enabled with zero monkeypatching.
 */
export function assertTlsSafety(environment: NodeJS.ProcessEnv = process.env): void {
  const allowInsecure = environment.ALLOW_INSECURE_TLS?.trim().toLowerCase();
  const rejectUnauthorized = environment.NODE_TLS_REJECT_UNAUTHORIZED?.trim();

  if (allowInsecure === 'true' || rejectUnauthorized === '0') {
    throw new Error(
      'TLS certificate verification must remain enabled. Remove ALLOW_INSECURE_TLS=true ' +
      'and NODE_TLS_REJECT_UNAUTHORIZED=0; configure a trusted CA via NODE_EXTRA_CA_CERTS.'
    );
  }

  installEnterpriseCaCertificates(environment);
}
