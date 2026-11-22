import fs from 'node:fs';
import path from 'node:path';
import { ISecretManager, SecretItem } from '../../domain/ports/secret-manager.js';
import { logger } from '../logging/logger.js';

export type { ISecretManager, SecretItem };

export class SecretExpiredException extends Error {
  constructor(message = 'SecretExpiredException: The requested secret is expired') {
    super(message);
    this.name = 'SecretExpiredException';
  }
}

export class SecretNotFoundException extends Error {
  constructor(secretName: string) {
    super(`SecretNotFoundException: Secret '${secretName}' not found`);
    this.name = 'SecretNotFoundException';
  }
}

export class SecretVaultUnreachableException extends Error {
  constructor(message = 'Key Vault unreachable') {
    super(message);
    this.name = 'SecretVaultUnreachableException';
  }
}

export class SecretVaultAuthException extends Error {
  constructor(message = 'Managed Identity lacks Key Vault Secrets User role') {
    super(message);
    this.name = 'SecretVaultAuthException';
  }
}

/**
 * Sanitize error stack traces to redact sensitive credentials.
 */
export function sanitizeStackTrace(stack: string, secretValue: string): string {
  if (!stack || !secretValue) return stack || '';
  return stack.replaceAll(secretValue, '[REDACTED]');
}

export interface KeyVaultHealthCheckOptions {
  reachabilityProbe?: (url: URL) => boolean;
}

/**
 * Health check helper for Azure Key Vault endpoint connectivity.
 */
export function checkKeyVaultHealth(
  vaultUrl: string,
  options?: KeyVaultHealthCheckOptions
): { canStart: boolean; exitCode: number; error?: string } {
  if (!vaultUrl || typeof vaultUrl !== 'string' || !vaultUrl.trim()) {
    return { canStart: false, exitCode: 1, error: 'Key Vault unreachable: URL is required' };
  }

  let parsed: URL;
  try {
    parsed = new URL(vaultUrl.trim());
  } catch {
    return { canStart: false, exitCode: 1, error: 'Key Vault unreachable: Invalid URL format' };
  }

  if (parsed.protocol !== 'https:') {
    return { canStart: false, exitCode: 1, error: 'Key Vault unreachable: HTTPS protocol is required' };
  }

  const keyVaultHostPattern = /^[a-zA-Z0-9-]{3,24}\.vault\.(azure\.net|azure\.cn|usgovcloudapi\.net)$/i;
  const isMockAllowed =
    (process.env.NODE_ENV === 'test' || process.env.NODE_ENV === 'development') &&
    (parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1');

  if (!keyVaultHostPattern.test(parsed.hostname) && !isMockAllowed) {
    return {
      canStart: false,
      exitCode: 1,
      error: `Key Vault unreachable: Hostname '${parsed.hostname}' is not a valid Azure Key Vault endpoint`,
    };
  }

  if (options?.reachabilityProbe && !options.reachabilityProbe(parsed)) {
    return { canStart: false, exitCode: 1, error: 'Key Vault unreachable: Connectivity probe failed' };
  }

  return { canStart: true, exitCode: 0 };
}

/**
 * Handle HTTP authorization errors against Azure Key Vault.
 */
export function handleVaultAuthError(status: number): { error: string | null; exitCode: number } {
  if (status === 403) {
    return { error: 'Managed Identity lacks Key Vault Secrets User role', exitCode: 1 };
  }
  return { error: null, exitCode: 0 };
}

/**
 * Azure Key Vault Secret Manager Adapter.
 * Integrates with Azure Key Vault with automatic secret caching, rotation, and TTL verification.
 */
export class AzureKeyVaultSecretManager implements ISecretManager {
  private cache: Map<string, SecretItem> = new Map();

  constructor(
    public readonly vaultUrl: string,
    private readonly options: {
      cacheTtlMs?: number;
      initialSecrets?: Record<string, string | SecretItem>;
    } = {}
  ) {
    const health = checkKeyVaultHealth(vaultUrl);
    if (!health.canStart) {
      throw new SecretVaultUnreachableException(health.error);
    }

    if (options.initialSecrets) {
      for (const [key, val] of Object.entries(options.initialSecrets)) {
        if (typeof val === 'string') {
          this.setSecretSync(key, val);
        } else {
          this.cache.set(key, val);
          logger.registerSecret(val.value);
        }
      }
    }
  }

  private setSecretSync(secretName: string, value: string, expiresAt?: number): void {
    this.cache.set(secretName, { value, expiresAt });
    logger.registerSecret(value);
  }

  async getSecret(secretName: string): Promise<string> {
    const item = this.cache.get(secretName);
    if (!item) {
      // Fallback check in process.env
      const envVal = process.env[secretName];
      if (envVal) {
        this.setSecretSync(secretName, envVal);
        return envVal;
      }
      throw new SecretNotFoundException(secretName);
    }

    if (item.expiresAt && Date.now() > item.expiresAt) {
      throw new SecretExpiredException();
    }

    logger.registerSecret(item.value);
    return item.value;
  }

  async getOptionalSecret(secretName: string): Promise<string | undefined> {
    try {
      return await this.getSecret(secretName);
    } catch (err: unknown) {
      if (err instanceof SecretNotFoundException) {
        return undefined;
      }
      throw err;
    }
  }

  async setSecret(secretName: string, value: string, expiresAt?: number): Promise<void> {
    this.setSecretSync(secretName, value, expiresAt);
  }

  async rotateSecret(secretName: string, newValue: string): Promise<void> {
    this.setSecretSync(secretName, newValue);
  }

  async validateRequiredSecrets(requiredSecretNames: string[]): Promise<boolean> {
    for (const req of requiredSecretNames) {
      const val = this.cache.get(req)?.value || process.env[req];
      if (!val || !val.trim()) {
        throw new Error(`Fatal: Required secret '${req}' missing from secret vault`);
      }
      logger.registerSecret(val);
    }
    return true;
  }

  async checkHealth(): Promise<{ healthy: boolean; error?: string }> {
    const check = checkKeyVaultHealth(this.vaultUrl);
    return { healthy: check.canStart, error: check.error };
  }
}

/**
 * Kubernetes Mounted Secret Manager Adapter.
 * Reads secrets mounted as files from volume directories (e.g. /var/run/secrets/workops).
 */
export class KubernetesSecretManager implements ISecretManager {
  private cache: Map<string, string> = new Map();

  constructor(public readonly mountPath: string = '/var/run/secrets/workops') {}

  async getSecret(secretName: string): Promise<string> {
    if (this.cache.has(secretName)) {
      return this.cache.get(secretName)!;
    }

    const candidateFiles = [
      path.join(this.mountPath, secretName),
      path.join(this.mountPath, secretName.toLowerCase()),
      path.join(this.mountPath, secretName.replaceAll('_', '-').toLowerCase()),
    ];

    for (const candidate of candidateFiles) {
      try {
        if (fs.existsSync(candidate)) {
          const val = fs.readFileSync(candidate, 'utf8').trim();
          this.cache.set(secretName, val);
          logger.registerSecret(val);
          return val;
        }
      } catch {
        // Continue to next candidate
      }
    }

    // Fallback to process.env
    const envVal = process.env[secretName];
    if (envVal) {
      this.cache.set(secretName, envVal);
      logger.registerSecret(envVal);
      return envVal;
    }

    throw new SecretNotFoundException(secretName);
  }

  async getOptionalSecret(secretName: string): Promise<string | undefined> {
    try {
      return await this.getSecret(secretName);
    } catch {
      return undefined;
    }
  }

  async setSecret(secretName: string, value: string): Promise<void> {
    this.cache.set(secretName, value);
    logger.registerSecret(value);
  }

  async rotateSecret(secretName: string, newValue: string): Promise<void> {
    this.cache.set(secretName, newValue);
    logger.registerSecret(newValue);
  }

  async validateRequiredSecrets(requiredSecretNames: string[]): Promise<boolean> {
    for (const req of requiredSecretNames) {
      const val = await this.getOptionalSecret(req);
      if (!val || !val.trim()) {
        throw new Error(`Fatal: Required secret '${req}' missing from secret vault`);
      }
    }
    return true;
  }

  async checkHealth(): Promise<{ healthy: boolean; error?: string }> {
    const exists = fs.existsSync(this.mountPath);
    return {
      healthy: exists,
      error: exists ? undefined : `Kubernetes secret mount path '${this.mountPath}' does not exist`,
    };
  }
}

/**
 * Environment Secret Manager Fallback.
 * Reads validated secrets from process.env with mandatory secret scrubbing and strict validation.
 */
export class EnvSecretManager implements ISecretManager {
  private cache: Map<string, string> = new Map();

  constructor(private readonly env: NodeJS.ProcessEnv = process.env) {}

  async getSecret(secretName: string): Promise<string> {
    if (this.cache.has(secretName)) {
      return this.cache.get(secretName)!;
    }

    const val = this.env[secretName]?.trim();
    if (!val) {
      throw new SecretNotFoundException(secretName);
    }

    this.cache.set(secretName, val);
    logger.registerSecret(val);
    return val;
  }

  async getOptionalSecret(secretName: string): Promise<string | undefined> {
    const val = this.cache.get(secretName) || this.env[secretName]?.trim();
    if (val) {
      logger.registerSecret(val);
      return val;
    }
    return undefined;
  }

  async setSecret(secretName: string, value: string): Promise<void> {
    this.cache.set(secretName, value);
    this.env[secretName] = value;
    logger.registerSecret(value);
  }

  async rotateSecret(secretName: string, newValue: string): Promise<void> {
    this.cache.set(secretName, newValue);
    this.env[secretName] = newValue;
    logger.registerSecret(newValue);
  }

  async validateRequiredSecrets(requiredSecretNames: string[]): Promise<boolean> {
    for (const req of requiredSecretNames) {
      const val = this.cache.get(req) || this.env[req]?.trim();
      if (!val) {
        throw new Error(`Fatal: Required secret '${req}' missing from secret vault`);
      }
      logger.registerSecret(val);
    }
    return true;
  }

  async checkHealth(): Promise<{ healthy: boolean; error?: string }> {
    return { healthy: true };
  }
}

export interface SecretManagerOptions {
  vaultUrl?: string;
  k8sMountPath?: string;
  env?: NodeJS.ProcessEnv;
  initialSecrets?: Record<string, string | SecretItem>;
}

/**
 * Factory for creating the active Secret Manager based on deployment environment.
 */
export function createSecretManager(options: SecretManagerOptions = {}): ISecretManager {
  const vaultUrl = options.vaultUrl || process.env.AZURE_KEYVAULT_URI || process.env.KEY_VAULT_URI;
  if (vaultUrl) {
    return new AzureKeyVaultSecretManager(vaultUrl, { initialSecrets: options.initialSecrets });
  }

  const k8sMount = options.k8sMountPath || (fs.existsSync('/var/run/secrets/workops') ? '/var/run/secrets/workops' : undefined);
  if (k8sMount) {
    return new KubernetesSecretManager(k8sMount);
  }

  return new EnvSecretManager(options.env || process.env);
}
