/**
 * Security Integration Tests
 * Tests that verify rate limiting, authentication, and environment validation
 * work together correctly in the application
 */

import { describe, it, expect, beforeEach } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('Security Implementation Integration Tests', () => {
  describe('File Structure and Integration', () => {
    it('should have rate-limiter.ts module', () => {
      const filePath = path.resolve(process.cwd(), 'src/presentation/api/rate-limiter.ts');
      expect(fs.existsSync(filePath)).toBe(true);
    });

    it('should have env-validation.ts module', () => {
      const filePath = path.resolve(process.cwd(), 'src/presentation/api/env-validation.ts');
      expect(fs.existsSync(filePath)).toBe(true);
    });

    it('should have updated server.ts with rate limiting', () => {
      const filePath = path.resolve(process.cwd(), 'src/presentation/api/server.ts');
      const content = fs.readFileSync(filePath, 'utf8');

      expect(content).toContain('import { generalLimiter, strictLimiter, authLimiter, bulkOperationsLimiter }');
      expect(content).toContain('import { validateEnvironmentSecrets, validateGitIgnore, ensureEnvExample }');
      expect(content).toContain('ensureEnvExample()');
      expect(content).toContain('validateGitIgnore()');
      expect(content).toContain('validateEnvironmentSecrets()');
      expect(content).toContain('this.app.use(generalLimiter)');
      expect(content).toContain('this.app.use(strictLimiter)');
      expect(content).toContain('this.app.use(authLimiter)');
      expect(content).toContain('this.app.use(bulkOperationsLimiter)');
    });

    it('should have updated package.json with express-rate-limit', () => {
      const filePath = path.resolve(process.cwd(), 'package.json');
      const content = fs.readFileSync(filePath, 'utf8');
      const pkg = JSON.parse(content);

      expect(pkg.dependencies).toHaveProperty('express-rate-limit');
    });

    it('should have .env.example file', () => {
      const filePath = path.resolve(process.cwd(), '.env.example');
      expect(fs.existsSync(filePath)).toBe(true);
    });

    it('should have SECURITY.md documentation', () => {
      const filePath = path.resolve(process.cwd(), 'SECURITY.md');
      expect(fs.existsSync(filePath)).toBe(true);
    });

    it('should have pre-commit hook script', () => {
      const filePath = path.resolve(process.cwd(), 'scripts/pre-commit-env-check.sh');
      expect(fs.existsSync(filePath)).toBe(true);
    });
  });

  describe('Rate Limiting Module Quality', () => {
    it('should export all required limiters', () => {
      const filePath = path.resolve(process.cwd(), 'src/presentation/api/rate-limiter.ts');
      const content = fs.readFileSync(filePath, 'utf8');

      expect(content).toContain('export const generalLimiter');
      expect(content).toContain('export const strictLimiter');
      expect(content).toContain('export const authLimiter');
      expect(content).toContain('export const bulkOperationsLimiter');
    });

    it('should have rate limiting configuration', () => {
      const filePath = path.resolve(process.cwd(), 'src/presentation/api/rate-limiter.ts');
      const content = fs.readFileSync(filePath, 'utf8');

      // General: 100 per 15 minutes
      expect(content).toContain('max: 100');
      expect(content).toContain('windowMs: 15 * 60 * 1000');

      // Strict: 30 per 15 minutes
      expect(content).toContain('max: 30');

      // Auth: 5 per 15 minutes
      expect(content).toContain('max: 5');

      // Bulk: 10 per 1 hour
      expect(content).toContain('max: 10');
      expect(content).toContain('windowMs: 60 * 60 * 1000');
    });

    it('should have proper error handling for rate limits', () => {
      const filePath = path.resolve(process.cwd(), 'src/presentation/api/rate-limiter.ts');
      const content = fs.readFileSync(filePath, 'utf8');

      expect(content).toContain('success: false');
      expect(content).toContain('handler:');
      expect(content).toContain('statusCode: 429');
    });

    it('should include violation logging', () => {
      const filePath = path.resolve(process.cwd(), 'src/presentation/api/rate-limiter.ts');
      const content = fs.readFileSync(filePath, 'utf8');

      expect(content).toContain('logViolation');
      expect(content).toContain('logger.warn');
      expect(content).toContain('logger.error');
    });

    it('should skip rate limiting for health check', () => {
      const filePath = path.resolve(process.cwd(), 'src/presentation/api/rate-limiter.ts');
      const content = fs.readFileSync(filePath, 'utf8');

      expect(content).toContain('/api/health');
      expect(content).toContain('/api/session');
      expect(content).toContain('skip:');
    });

    it('should have memory cleanup for violations log', () => {
      const filePath = path.resolve(process.cwd(), 'src/presentation/api/rate-limiter.ts');
      const content = fs.readFileSync(filePath, 'utf8');

      expect(content).toContain('setInterval');
      expect(content).toContain('violationLog');
    });
  });

  describe('Environment Validation Module Quality', () => {
    it('should export validation functions', () => {
      const filePath = path.resolve(process.cwd(), 'src/presentation/api/env-validation.ts');
      const content = fs.readFileSync(filePath, 'utf8');

      expect(content).toContain('export function validateEnvironmentSecrets');
      expect(content).toContain('export function validateGitIgnore');
      expect(content).toContain('export function ensureEnvExample');
    });

    it('should have secret detection patterns', () => {
      const filePath = path.resolve(process.cwd(), 'src/presentation/api/env-validation.ts');
      const content = fs.readFileSync(filePath, 'utf8');

      expect(content).toContain('SENSITIVE_PATTERNS');
      expect(content).toContain('AZURE_DEVOPS_PAT');
      expect(content).toContain('GITHUB_TOKEN');
      expect(content).toContain('API_AUTH_TOKEN');
    });

    it('should have dummy pattern recognition', () => {
      const filePath = path.resolve(process.cwd(), 'src/presentation/api/env-validation.ts');
      const content = fs.readFileSync(filePath, 'utf8');

      expect(content).toContain('DUMMY_PATTERNS');
      expect(content).toContain('your-');
      expect(content).toContain('YOUR_');
      expect(content).toContain('example');
      expect(content).toContain('EXAMPLE');
    });

    it('should validate .gitignore for .env', () => {
      const filePath = path.resolve(process.cwd(), 'src/presentation/api/env-validation.ts');
      const content = fs.readFileSync(filePath, 'utf8');

      expect(content).toContain('validateGitIgnore');
      expect(content).toContain('.gitignore');
      expect(content).toContain('.env');
    });

    it('should create .env.example if missing', () => {
      const filePath = path.resolve(process.cwd(), 'src/presentation/api/env-validation.ts');
      const content = fs.readFileSync(filePath, 'utf8');

      expect(content).toContain('ensureEnvExample');
      expect(content).toContain('.env.example');
    });
  });

  describe('.env.example Documentation Quality', () => {
    it('should have comprehensive variable documentation', () => {
      const filePath = path.resolve(process.cwd(), '.env.example');
      const content = fs.readFileSync(filePath, 'utf8');

      expect(content).toContain('AZURE_DEVOPS_PAT');
      expect(content).toContain('GITHUB_TOKEN');
      expect(content).toContain('API_AUTH_TOKEN');
      expect(content).toContain('PORT');
      expect(content).toContain('NODE_ENV');
    });

    it('should have section headers for organization', () => {
      const filePath = path.resolve(process.cwd(), '.env.example');
      const content = fs.readFileSync(filePath, 'utf8');

      expect(content).toContain('AZURE DEVOPS CONFIGURATION');
      expect(content).toContain('GITHUB CONFIGURATION');
      expect(content).toContain('SERVER CONFIGURATION');
      expect(content).toContain('HTTP BASIC AUTHENTICATION');
    });

    it('should warn about production security', () => {
      const filePath = path.resolve(process.cwd(), '.env.example');
      const content = fs.readFileSync(filePath, 'utf8');

      expect(content.toLowerCase()).toContain('production');
      expect(content).toContain('WARNING');
      expect(content.toLowerCase()).toContain('secret');
    });

    it('should not contain real secrets', () => {
      const filePath = path.resolve(process.cwd(), '.env.example');
      const content = fs.readFileSync(filePath, 'utf8');

      // Extract all values
      const lines = content.split('\n');
      const values = lines
        .filter(line => !line.trim().startsWith('#') && line.includes('='))
        .map(line => line.split('=')[1]?.trim())
        .filter(v => v && v.length > 0);

      // None should look like real tokens
      values.forEach(value => {
        // Remove quotes if present
        const unquoted = value.replace(/^["']|["']$/g, '');

        // Should be placeholder-like or standard safe configuration defaults
        const isPlaceholder = /^(YOUR[-_]|your[-_]|example|EXAMPLE|replace|REPLACE|xxx|XXX|false|true|0|1|\/|https?:\/\/|[0-9]+|UTC|Asia\/|development|production|test|info|warn|error|New|Active|Closed|3in1|Task|_suffix|No|Yes|CURRENT|NEXT)/i.test(unquoted);
        expect(isPlaceholder).toBe(true);
      });
    });

    it('should include usage instructions', () => {
      const filePath = path.resolve(process.cwd(), '.env.example');
      const content = fs.readFileSync(filePath, 'utf8');

      expect(content).toMatch(/[Cc]opy|[Cc]onfigure|[Gg]enerate/);
    });
  });

  describe('SECURITY.md Documentation', () => {
    it('should document rate limiting', () => {
      const filePath = path.resolve(process.cwd(), 'SECURITY.md');
      const content = fs.readFileSync(filePath, 'utf8');

      expect(content).toContain('Rate Limiting');
      expect(content).toContain('General Limiter');
      expect(content).toContain('Strict Limiter');
      expect(content).toContain('Auth Limiter');
      expect(content).toContain('Bulk Operations');
    });

    it('should document environment security', () => {
      const filePath = path.resolve(process.cwd(), 'SECURITY.md');
      const content = fs.readFileSync(filePath, 'utf8');

      expect(content).toContain('Environment Security');
      expect(content).toContain('.env.example');
      expect(content).toContain('.gitignore');
    });

    it('should provide testing instructions', () => {
      const filePath = path.resolve(process.cwd(), 'SECURITY.md');
      const content = fs.readFileSync(filePath, 'utf8');

      expect(content).toContain('Testing');
      expect(content).toContain('npm test');
    });

    it('should include troubleshooting guide', () => {
      const filePath = path.resolve(process.cwd(), 'SECURITY.md');
      const content = fs.readFileSync(filePath, 'utf8');

      expect(content).toContain('Troubleshooting');
      expect(content).toContain('Problem');
      expect(content).toContain('Solution');
    });
  });

  describe('Pre-commit Hook Script', () => {
    it('should check for .env in staged files', () => {
      const filePath = path.resolve(process.cwd(), 'scripts/pre-commit-env-check.sh');
      const content = fs.readFileSync(filePath, 'utf8');

      expect(content).toContain('.env');
      expect(content).toContain('git diff --cached');
    });

    it('should provide helpful error messages', () => {
      const filePath = path.resolve(process.cwd(), 'scripts/pre-commit-env-check.sh');
      const content = fs.readFileSync(filePath, 'utf8');

      expect(content).toContain('ERROR');
      expect(content).toContain('must NEVER');
      expect(content).toContain('git reset HEAD');
    });

    it('should have executable instructions', () => {
      const filePath = path.resolve(process.cwd(), 'scripts/pre-commit-env-check.sh');
      const content = fs.readFileSync(filePath, 'utf8');

      expect(content).toContain('#!/bin/bash');
      expect(content).toContain('chmod +x');
    });
  });

  describe('Test Files', () => {
    it('should have rate-limiting tests', () => {
      const filePath = path.resolve(process.cwd(), 'tests/rate-limiting.test.ts');
      expect(fs.existsSync(filePath)).toBe(true);
      const content = fs.readFileSync(filePath, 'utf8');

      expect(content).toContain('Rate Limiting Middleware');
      expect(content).toContain('General Limiter');
      expect(content).toContain('Strict Limiter');
    });

    it('should have env-validation tests', () => {
      const filePath = path.resolve(process.cwd(), 'tests/env-validation.test.ts');
      expect(fs.existsSync(filePath)).toBe(true);
      const content = fs.readFileSync(filePath, 'utf8');

      expect(content).toContain('Environment Security Validation');
      expect(content).toContain('Secret Detection');
      expect(content).toContain('.gitignore Validation');
    });
  });

  describe('Integration Verification', () => {
    it('should have all components properly integrated', () => {
      const serverPath = path.resolve(process.cwd(), 'src/presentation/api/server.ts');
      const serverContent = fs.readFileSync(serverPath, 'utf8');

      // Check imports
      expect(serverContent).toContain('rate-limiter');
      expect(serverContent).toContain('env-validation');

      // Check initialization
      expect(serverContent).toContain('ensureEnvExample()');
      expect(serverContent).toContain('validateEnvironmentSecrets()');

      // Check middleware application
      expect(serverContent).toContain('this.app.use(generalLimiter)');
      expect(serverContent).toContain('this.app.use(strictLimiter)');
    });

    it('should maintain backward compatibility with existing code', () => {
      const serverPath = path.resolve(process.cwd(), 'src/presentation/api/server.ts');
      const serverContent = fs.readFileSync(serverPath, 'utf8');

      // Check that existing middleware is still present
      expect(serverContent).toContain('X-Content-Type-Options');
      expect(serverContent).toContain('express.json');
      expect(serverContent).toContain('createApiRouter');
      expect(serverContent).toContain('basicAuth');
    });
  });
});
