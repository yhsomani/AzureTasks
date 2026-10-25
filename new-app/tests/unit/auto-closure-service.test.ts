import { describe, it, expect, beforeEach } from 'vitest';
import { AutoClosureService } from '../../src/domain/services/auto-closure-service.js';
import { AutoClosureConfig, AutoClosureRule } from '../../src/domain/entities/auto-closure-config.js';

describe('AutoClosureService', () => {
  let service: AutoClosureService;

  beforeEach(() => {
    service = new AutoClosureService();
  });

  describe('shouldCloseTask', () => {
    it('should not close when auto-closure is disabled', () => {
      const config: AutoClosureConfig = {
        enabled: false,
        version: 1,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        createdBy: 'admin',
        lastModifiedBy: 'admin',
        rules: [],
      };

      const result = service.shouldCloseTask(config, 'user@example.com');
      expect(result.shouldClose).toBe(false);
      expect(result.reason).toContain('disabled');
    });

    it('should not close when no rules are defined', () => {
      const config: AutoClosureConfig = {
        enabled: true,
        version: 1,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        createdBy: 'admin',
        lastModifiedBy: 'admin',
        rules: [],
      };

      const result = service.shouldCloseTask(config, 'user@example.com');
      expect(result.shouldClose).toBe(false);
      expect(result.reason).toContain('No auto-closure rules');
    });

    it('should close when inclusion rule matches user', () => {
      const config: AutoClosureConfig = {
        enabled: true,
        version: 1,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        createdBy: 'admin',
        lastModifiedBy: 'admin',
        rules: [
          {
            ruleId: 'inclusion-users',
            type: 'inclusion',
            filterType: 'users',
            filters: [
              { id: 'user@example.com', name: 'Test User' },
            ],
            description: 'Allow specific users',
            createdAt: '2024-01-01T00:00:00Z',
            updatedAt: '2024-01-01T00:00:00Z',
            createdBy: 'admin',
          },
        ],
      };

      const result = service.shouldCloseTask(config, 'user@example.com');
      expect(result.shouldClose).toBe(true);
      expect(result.reason).toContain('inclusion rule');
    });

    it('should not close when exclusion rule matches user', () => {
      const config: AutoClosureConfig = {
        enabled: true,
        version: 1,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        createdBy: 'admin',
        lastModifiedBy: 'admin',
        rules: [
          {
            ruleId: 'exclusion-users',
            type: 'exclusion',
            filterType: 'users',
            filters: [
              { id: 'user@example.com', name: 'Test User' },
            ],
            description: 'Exclude specific users',
            createdAt: '2024-01-01T00:00:00Z',
            updatedAt: '2024-01-01T00:00:00Z',
            createdBy: 'admin',
          },
        ],
      };

      const result = service.shouldCloseTask(config, 'user@example.com');
      expect(result.shouldClose).toBe(false);
      expect(result.reason).toContain('exclusion rule');
    });

    it('should match user by role when role is provided', () => {
      const config: AutoClosureConfig = {
        enabled: true,
        version: 1,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        createdBy: 'admin',
        lastModifiedBy: 'admin',
        rules: [
          {
            ruleId: 'role-based',
            type: 'inclusion',
            filterType: 'roles',
            filters: [
              { id: 'developer', name: 'Developer' },
            ],
            description: 'Allow developers',
            createdAt: '2024-01-01T00:00:00Z',
            updatedAt: '2024-01-01T00:00:00Z',
            createdBy: 'admin',
          },
        ],
      };

      const result = service.shouldCloseTask(config, 'user@example.com', 'developer');
      expect(result.shouldClose).toBe(true);
      expect(result.reason).toContain('inclusion rule');
    });

    it('should give precedence to exclusion rules', () => {
      const config: AutoClosureConfig = {
        enabled: true,
        version: 1,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        createdBy: 'admin',
        lastModifiedBy: 'admin',
        rules: [
          {
            ruleId: 'inclusion-users',
            type: 'inclusion',
            filterType: 'users',
            filters: [
              { id: 'user@example.com', name: 'Test User' },
            ],
            createdAt: '2024-01-01T00:00:00Z',
            updatedAt: '2024-01-01T00:00:00Z',
            createdBy: 'admin',
          },
          {
            ruleId: 'exclusion-users',
            type: 'exclusion',
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

      const result = service.shouldCloseTask(config, 'user@example.com');
      expect(result.shouldClose).toBe(false);
      expect(result.reason).toContain('exclusion rule');
    });

    it('should not close if no inclusion rule matches', () => {
      const config: AutoClosureConfig = {
        enabled: true,
        version: 1,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        createdBy: 'admin',
        lastModifiedBy: 'admin',
        rules: [
          {
            ruleId: 'inclusion-users',
            type: 'inclusion',
            filterType: 'users',
            filters: [
              { id: 'other@example.com', name: 'Other User' },
            ],
            createdAt: '2024-01-01T00:00:00Z',
            updatedAt: '2024-01-01T00:00:00Z',
            createdBy: 'admin',
          },
        ],
      };

      const result = service.shouldCloseTask(config, 'user@example.com');
      expect(result.shouldClose).toBe(false);
      expect(result.reason).toContain('does not match any inclusion rules');
    });

    it('should match case-insensitively', () => {
      const config: AutoClosureConfig = {
        enabled: true,
        version: 1,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        createdBy: 'admin',
        lastModifiedBy: 'admin',
        rules: [
          {
            ruleId: 'inclusion-users',
            type: 'inclusion',
            filterType: 'users',
            filters: [
              { id: 'User@Example.COM', name: 'Test User' },
            ],
            createdAt: '2024-01-01T00:00:00Z',
            updatedAt: '2024-01-01T00:00:00Z',
            createdBy: 'admin',
          },
        ],
      };

      const result = service.shouldCloseTask(config, 'user@example.com');
      expect(result.shouldClose).toBe(true);
    });
  });

  describe('checkConfigurationAuthorization', () => {
    it('should deny when no admin users are configured', () => {
      const result = service.checkConfigurationAuthorization('user@example.com', undefined);
      expect(result.isAuthorized).toBe(false);
      expect(result.reason).toContain('No admin users configured');
    });

    it('should deny when user is not admin', () => {
      const result = service.checkConfigurationAuthorization(
        'user@example.com',
        ['admin@example.com']
      );
      expect(result.isAuthorized).toBe(false);
      expect(result.reason).toContain('not authorized');
    });

    it('should allow when user is admin', () => {
      const result = service.checkConfigurationAuthorization(
        'admin@example.com',
        ['admin@example.com']
      );
      expect(result.isAuthorized).toBe(true);
    });

    it('should check case-insensitively', () => {
      const result = service.checkConfigurationAuthorization(
        'Admin@Example.COM',
        ['admin@example.com']
      );
      expect(result.isAuthorized).toBe(true);
    });
  });

  describe('detectConflicts', () => {
    it('should detect when same user is in both inclusion and exclusion', () => {
      const config: AutoClosureConfig = {
        enabled: true,
        version: 1,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        createdBy: 'admin',
        lastModifiedBy: 'admin',
        rules: [
          {
            ruleId: 'inclusion-users',
            type: 'inclusion',
            filterType: 'users',
            filters: [
              { id: 'user@example.com', name: 'Test User' },
            ],
            createdAt: '2024-01-01T00:00:00Z',
            updatedAt: '2024-01-01T00:00:00Z',
            createdBy: 'admin',
          },
          {
            ruleId: 'exclusion-users',
            type: 'exclusion',
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

      const conflicts = service.detectConflicts(config);
      expect(conflicts.length).toBeGreaterThan(0);
      expect(conflicts[0]).toContain('both inclusion rule');
    });

    it('should not report conflicts for different filter types', () => {
      const config: AutoClosureConfig = {
        enabled: true,
        version: 1,
        createdAt: '2024-01-01T00:00:00Z',
        updatedAt: '2024-01-01T00:00:00Z',
        createdBy: 'admin',
        lastModifiedBy: 'admin',
        rules: [
          {
            ruleId: 'inclusion-users',
            type: 'inclusion',
            filterType: 'users',
            filters: [
              { id: 'user@example.com', name: 'Test User' },
            ],
            createdAt: '2024-01-01T00:00:00Z',
            updatedAt: '2024-01-01T00:00:00Z',
            createdBy: 'admin',
          },
          {
            ruleId: 'exclusion-roles',
            type: 'exclusion',
            filterType: 'roles',
            filters: [
              { id: 'manager', name: 'Manager' },
            ],
            createdAt: '2024-01-01T00:00:00Z',
            updatedAt: '2024-01-01T00:00:00Z',
            createdBy: 'admin',
          },
        ],
      };

      const conflicts = service.detectConflicts(config);
      expect(conflicts.length).toBe(0);
    });
  });
});
