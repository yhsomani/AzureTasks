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
}
