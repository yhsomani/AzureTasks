/**
 * Secret Manager Port Interface
 * Defines contracts for secure external secret storage and retrieval (Azure Key Vault, K8s secrets, environment fallback)
 */

export interface SecretItem {
  value: string;
  expiresAt?: number;
  version?: string;
}

export interface ISecretManager {
  /**
   * Retrieve a secret by name. Throws an error if not found.
   */
  getSecret(secretName: string): Promise<string>;

  /**
   * Retrieve an optional secret by name. Returns undefined if not found.
   */
  getOptionalSecret(secretName: string): Promise<string | undefined>;

  /**
   * Store or update a secret value.
   */
  setSecret?(secretName: string, value: string, expiresAt?: number): Promise<void>;

  /**
   * Validate that all required secrets exist. Throws fatal error if any are missing.
   */
  validateRequiredSecrets(requiredSecretNames: string[]): Promise<boolean>;

  /**
   * Dynamically rotate a secret in the cache/store.
   */
  rotateSecret?(secretName: string, newValue: string): Promise<void>;

  /**
   * Check health and connectivity of the secret store.
   */
  checkHealth?(): Promise<{ healthy: boolean; error?: string }>;
}
