import { describe, expect, it } from 'vitest';
import {
  AzureKeyVaultSecretManager,
  KubernetesSecretManager,
  EnvSecretManager,
  createSecretManager,
  checkKeyVaultHealth,
  handleVaultAuthError,
  sanitizeStackTrace,
  SecretExpiredException,
} from '../../src/infrastructure/security/secret-manager.js';

describe('Milestone 4 — Feature 27: External Secret Management', () => {
  describe('checkKeyVaultHealth() & Fast-Fail', () => {
    it('approves a valid Azure Key Vault URI format', () => {
      const check = checkKeyVaultHealth('https://workops-vault.vault.azure.net');
      expect(check.canStart).toBe(true);
      expect(check.exitCode).toBe(0);
    });

    it('rejects non-HTTPS protocols', () => {
      const check = checkKeyVaultHealth('http://workops-vault.vault.azure.net');
      expect(check.canStart).toBe(false);
      expect(check.exitCode).toBe(1);
      expect(check.error).toContain('Key Vault unreachable');
    });

    it('rejects invalid or non-Azure vault URLs', () => {
      const check = checkKeyVaultHealth('https://invalid-host.com');
      expect(check.canStart).toBe(false);
      expect(check.exitCode).toBe(1);
      expect(check.error).toContain('Key Vault unreachable');
    });

    it('rejects subdomain spoofing attack URLs', () => {
      const check = checkKeyVaultHealth('https://workops-vault.vault.azure.net.attacker.com');
      expect(check.canStart).toBe(false);
      expect(check.exitCode).toBe(1);
      expect(check.error).toContain('Key Vault unreachable');
    });

    it('rejects failed reachability probes', () => {
      const check = checkKeyVaultHealth('https://workops-vault.vault.azure.net', {
        reachabilityProbe: () => false,
      });
      expect(check.canStart).toBe(false);
      expect(check.exitCode).toBe(1);
      expect(check.error).toContain('Key Vault unreachable');
    });

    it('rejects malformed or empty URLs', () => {
      expect(checkKeyVaultHealth('').canStart).toBe(false);
      expect(checkKeyVaultHealth('not-a-valid-url').canStart).toBe(false);
    });
  });

  describe('AzureKeyVaultSecretManager', () => {
    it('initializes and retrieves stored secrets', async () => {
      const manager = new AzureKeyVaultSecretManager('https://test-vault.vault.azure.net', {
        initialSecrets: {
          AZURE_DEVOPS_PAT: 'pat_12345',
          GITHUB_TOKEN: 'gh_abcde',
        },
      });

      const pat = await manager.getSecret('AZURE_DEVOPS_PAT');
      expect(pat).toBe('pat_12345');
    });

    it('throws SecretExpiredException when a secret is past its TTL', async () => {
      const manager = new AzureKeyVaultSecretManager('https://test-vault.vault.azure.net', {
        initialSecrets: {
          EXPIRED_TOKEN: { value: 'tok_old', expiresAt: Date.now() - 1000 },
        },
      });

      await expect(manager.getSecret('EXPIRED_TOKEN')).rejects.toThrow(SecretExpiredException);
    });

    it('validates mandatory secrets and throws when missing', async () => {
      const manager = new AzureKeyVaultSecretManager('https://test-vault.vault.azure.net', {
        initialSecrets: {},
      });

      await expect(manager.validateRequiredSecrets(['AZURE_DEVOPS_PAT'])).rejects.toThrow(
        "Fatal: Required secret 'AZURE_DEVOPS_PAT' missing from secret vault"
      );
    });

    it('handles dynamic secret rotation', async () => {
      const manager = new AzureKeyVaultSecretManager('https://test-vault.vault.azure.net', {
        initialSecrets: {
          ROTATING_KEY: 'secret-v1',
        },
      });

      expect(await manager.getSecret('ROTATING_KEY')).toBe('secret-v1');
      await manager.rotateSecret('ROTATING_KEY', 'secret-v2');
      expect(await manager.getSecret('ROTATING_KEY')).toBe('secret-v2');
    });

    it('handles HTTP 403 Forbidden Key Vault access errors cleanly', () => {
      const res = handleVaultAuthError(403);
      expect(res.exitCode).toBe(1);
      expect(res.error).toContain('Managed Identity lacks Key Vault Secrets User role');
    });
  });

  describe('KubernetesSecretManager', () => {
    it('handles missing directory gracefully with health check', async () => {
      const manager = new KubernetesSecretManager('/var/run/secrets/nonexistent');
      const health = await manager.checkHealth();
      expect(health.healthy).toBe(false);
      expect(health.error).toContain('does not exist');
    });

    it('supports setting, retrieving and rotating secrets', async () => {
      const manager = new KubernetesSecretManager('/var/run/secrets/workops');
      await manager.setSecret('API_KEY', 'k8s-key-1');
      expect(await manager.getSecret('API_KEY')).toBe('k8s-key-1');

      await manager.rotateSecret('API_KEY', 'k8s-key-2');
      expect(await manager.getSecret('API_KEY')).toBe('k8s-key-2');
    });
  });

  describe('EnvSecretManager', () => {
    it('retrieves secrets from environment dictionary', async () => {
      const manager = new EnvSecretManager({ TEST_ENV_VAR: 'env-val-123' });
      expect(await manager.getSecret('TEST_ENV_VAR')).toBe('env-val-123');
    });

    it('validates presence of required secrets', async () => {
      const manager = new EnvSecretManager({ REQUIRED_ONE: 'val1' });
      await expect(manager.validateRequiredSecrets(['REQUIRED_ONE'])).resolves.toBe(true);
      await expect(manager.validateRequiredSecrets(['REQUIRED_TWO'])).rejects.toThrow(
        "Fatal: Required secret 'REQUIRED_TWO' missing"
      );
    });
  });

  describe('createSecretManager() factory', () => {
    it('creates AzureKeyVaultSecretManager when vault URL provided', () => {
      const manager = createSecretManager({ vaultUrl: 'https://workops-vault.vault.azure.net' });
      expect(manager).toBeInstanceOf(AzureKeyVaultSecretManager);
    });

    it('falls back to EnvSecretManager when no external secret provider configured', () => {
      const manager = createSecretManager();
      expect(manager).toBeInstanceOf(EnvSecretManager);
    });
  });

  describe('sanitizeStackTrace()', () => {
    it('redacts secret values in error stack traces', () => {
      const rawStack = 'Error: API failed with token=secret_pat_998877 at line 42';
      const cleanStack = sanitizeStackTrace(rawStack, 'secret_pat_998877');
      expect(cleanStack).not.toContain('secret_pat_998877');
      expect(cleanStack).toContain('[REDACTED]');
    });

    it('handles empty or missing stack safely', () => {
      expect(sanitizeStackTrace('', 'secret')).toBe('');
      expect(sanitizeStackTrace('clean stack', '')).toBe('clean stack');
    });
  });
});
