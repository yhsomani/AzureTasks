import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FileAutoClosureConfigRepository } from '../../src/infrastructure/config/file-auto-closure-config-repo.js';
import { AutoClosureConfig } from '../../src/domain/entities/auto-closure-config.js';
import * as fs from 'fs';
import * as path from 'path';

describe('FileAutoClosureConfigRepository', () => {
  const testConfigPath = path.join(process.cwd(), '.test-auto-closure-config.json');
  let repo: FileAutoClosureConfigRepository;

  beforeEach(() => {
    // Clean up test file before each test
    if (fs.existsSync(testConfigPath)) {
      fs.unlinkSync(testConfigPath);
    }
    repo = new FileAutoClosureConfigRepository(testConfigPath);
  });

  afterEach(() => {
    // Clean up test file after each test
    if (fs.existsSync(testConfigPath)) {
      fs.unlinkSync(testConfigPath);
    }
  });

  describe('load', () => {
    it('should return default config when file does not exist', async () => {
      const config = await repo.load();
      expect(config.enabled).toBe(false);
      expect(config.rules).toEqual([]);
      expect(config.version).toBe(1);
    });

    it('should load existing config from file', async () => {
      const testConfig: AutoClosureConfig = {
        enabled: true,
        version: 1,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        createdBy: 'admin',
        lastModifiedBy: 'admin',
        rules: [
          {
            ruleId: 'test-rule',
            type: 'inclusion',
            filterType: 'users',
            filters: [
              { id: 'user@example.com', name: 'Test User' },
            ],
            createdAt: '2024-01-01T00:00:00Z',
            updatedAt: '2024-01-01T00:00:00Z',
            createdBy: 'admin',
          },
        ],
      };

      fs.writeFileSync(testConfigPath, JSON.stringify(testConfig), 'utf-8');

      const config = await repo.load();
      expect(config.enabled).toBe(true);
      expect(config.rules).toHaveLength(1);
      expect(config.rules[0].ruleId).toBe('test-rule');
    });

    it('should cache config with 5 second TTL', async () => {
      const config1 = await repo.load();
      const config2 = await repo.load();

      // Both should be the same object from cache
      expect(config1).toBe(config2);
    });
  });

  describe('save', () => {
    it('should save config to file', async () => {
      const testConfig: AutoClosureConfig = {
        enabled: true,
        version: 1,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        createdBy: 'admin',
        lastModifiedBy: 'admin',
        rules: [],
      };

      await repo.save(testConfig);

      expect(fs.existsSync(testConfigPath)).toBe(true);

      const saved = JSON.parse(fs.readFileSync(testConfigPath, 'utf-8'));
      expect(saved.enabled).toBe(true);
    });

    it('should increment version on save', async () => {
      const testConfig: AutoClosureConfig = {
        enabled: true,
        version: 1,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        createdBy: 'admin',
        lastModifiedBy: 'admin',
        rules: [],
      };

      await repo.save(testConfig);

      const saved = JSON.parse(fs.readFileSync(testConfigPath, 'utf-8'));
      expect(saved.version).toBe(2);
    });

    it('should reject invalid config', async () => {
      const invalidConfig: any = {
        enabled: 'yes',  // Should be boolean
        version: 1,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        createdBy: 'admin',
        lastModifiedBy: 'admin',
        rules: [],
      };

      await expect(repo.save(invalidConfig)).rejects.toThrow();
    });
  });

  describe('validate', () => {
    it('should accept valid config', async () => {
      const validConfig: AutoClosureConfig = {
        enabled: false,
        version: 1,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        createdBy: 'admin',
        lastModifiedBy: 'admin',
        rules: [],
      };

      const result = await repo.validate(validConfig);
      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject enabled config without rules', async () => {
      const invalidConfig: AutoClosureConfig = {
        enabled: true,
        version: 1,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        createdBy: 'admin',
        lastModifiedBy: 'admin',
        rules: [],
      };

      const result = await repo.validate(invalidConfig);
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.includes('enabled'))).toBe(true);
    });

    it('should warn about mixing inclusion and exclusion rules', async () => {
      const config: AutoClosureConfig = {
        enabled: true,
        version: 1,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        createdBy: 'admin',
        lastModifiedBy: 'admin',
        rules: [
          {
            ruleId: 'inclusion-rule',
            type: 'inclusion',
            filterType: 'users',
            filters: [{ id: 'user1', name: 'User 1' }],
            createdAt: '2024-01-01T00:00:00Z',
            updatedAt: '2024-01-01T00:00:00Z',
            createdBy: 'admin',
          },
          {
            ruleId: 'exclusion-rule',
            type: 'exclusion',
            filterType: 'users',
            filters: [{ id: 'user2', name: 'User 2' }],
            createdAt: '2024-01-01T00:00:00Z',
            updatedAt: '2024-01-01T00:00:00Z',
            createdBy: 'admin',
          },
        ],
      };

      const result = await repo.validate(config);
      expect(result.isValid).toBe(true);
      expect(result.warnings.some(w => w.includes('mixes'))).toBe(true);
    });

    it('should reject duplicate rule IDs', async () => {
      const config: AutoClosureConfig = {
        enabled: true,
        version: 1,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        createdBy: 'admin',
        lastModifiedBy: 'admin',
        rules: [
          {
            ruleId: 'same-id',
            type: 'inclusion',
            filterType: 'users',
            filters: [{ id: 'user1', name: 'User 1' }],
            createdAt: '2024-01-01T00:00:00Z',
            updatedAt: '2024-01-01T00:00:00Z',
            createdBy: 'admin',
          },
          {
            ruleId: 'same-id',
            type: 'inclusion',
            filterType: 'users',
            filters: [{ id: 'user2', name: 'User 2' }],
            createdAt: '2024-01-01T00:00:00Z',
            updatedAt: '2024-01-01T00:00:00Z',
            createdBy: 'admin',
          },
        ],
      };

      const result = await repo.validate(config);
      expect(result.isValid).toBe(false);
      expect(result.errors.some(e => e.includes('Duplicate rule ID'))).toBe(true);
    });
  });

  describe('getVersion', () => {
    it('should return config version', async () => {
      const testConfig: AutoClosureConfig = {
        enabled: false,
        version: 5,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        createdBy: 'admin',
        lastModifiedBy: 'admin',
        rules: [],
      };

      fs.writeFileSync(testConfigPath, JSON.stringify(testConfig), 'utf-8');

      const version = await repo.getVersion();
      expect(version).toBe(5);
    });
  });
});
