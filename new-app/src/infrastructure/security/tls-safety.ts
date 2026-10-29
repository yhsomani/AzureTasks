import * as fs from 'fs';
import * as path from 'path';
import { createRequire } from 'module';

/**
 * Hook Node's TLS context creation to automatically inject extra CA certificates
 * specified in NODE_EXTRA_CA_CERTS or present in default locations (e.g. certs/zscaler.pem).
 * Node's internal fetch (Undici) creates TLS contexts dynamically. If NODE_EXTRA_CA_CERTS
 * is loaded via .env after Node starts, Node's CLI C++ flag parser hasn't seen it.
 * This hook ensures custom enterprise CAs (like Zscaler) are trusted by both fetch and https
 * while maintaining 100% strict TLS peer verification (zero bypass, rejectUnauthorized remains true).
 */
let tlsHooked = false;

export function installEnterpriseCaCertificates(environment: NodeJS.ProcessEnv = process.env): void {
  if (tlsHooked) return;
  try {
    const require = createRequire(import.meta.url);
    const tls = require('tls');
    const origCreateSecureContext = tls.createSecureContext;

    if (typeof origCreateSecureContext === 'function') {
      tls.createSecureContext = function (options: any = {}) {
        const ctx = origCreateSecureContext.call(tls, options);
        const certEnvPath = environment.NODE_EXTRA_CA_CERTS?.trim();
        const candidatePaths: string[] = [];
        if (certEnvPath) candidatePaths.push(certEnvPath);
        candidatePaths.push(path.resolve(process.cwd(), 'certs/zscaler.pem'));
        candidatePaths.push(path.resolve(process.cwd(), '../certs/zscaler.pem'));

        for (const candidate of candidatePaths) {
          try {
            if (fs.existsSync(candidate)) {
              const ca = fs.readFileSync(candidate);
              if (ctx?.context?.addCACert) {
                ctx.context.addCACert(ca);
              }
              break;
            }
          } catch {
            // Ignore unreadable candidates and continue
          }
        }
        return ctx;
      };
      tlsHooked = true;
    }
  } catch (err: any) {
    // Non-fatal if dynamic require fails in exotic bundler environments
    console.warn('Unable to hook TLS secure context for extra CA certs:', err.message);
  }
}

/**
 * Protect every HTTP and Git client against global TLS verification bypasses.
 * Install and trust the enterprise certificate authority instead of bypassing
 * peer certificate verification.
 */
export function assertTlsSafety(environment: NodeJS.ProcessEnv = process.env): void {
  if (environment.ALLOW_INSECURE_TLS?.trim().toLowerCase() === 'true' ||
      environment.NODE_TLS_REJECT_UNAUTHORIZED?.trim() === '0') {
    throw new Error(
      'TLS certificate verification must remain enabled. Remove ALLOW_INSECURE_TLS=true ' +
      'and NODE_TLS_REJECT_UNAUTHORIZED=0; configure a trusted CA via NODE_EXTRA_CA_CERTS.'
    );
  }
  installEnterpriseCaCertificates(environment);
}
