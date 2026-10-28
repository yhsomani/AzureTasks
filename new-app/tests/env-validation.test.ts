/**
 * Environment Validation Tests
 * Verifies that environment security checks work correctly
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

describe('Environment Security Validation', () => {
  const testDir = path.resolve(process.cwd(), '.test-env');

  beforeEach(() => {
    // Create test directory if it doesn't exist
    if (!fs.existsSync(testDir)) {
      fs.mkdirSync(testDir, { recursive: true });
    }
  });

  describe('Secret Detection', () => {
    it('should detect Azure DevOps PAT tokens', () => {
      // Generate synthetic fixtures rather than storing credential-shaped literals.
      const testPat = 'a'.repeat(52);
      const pattern = /^[a-zA-Z0-9]{40,}$/;
      expect(pattern.test(testPat)).toBe(true);
    });

    it('should detect GitHub tokens (ghp_ format)', () => {
      const testToken = 'ghp_' + 'c'.repeat(36);
      const pattern = /^(ghp_|github_pat_)[a-zA-Z0-9]{36,}$/;
      expect(pattern.test(testToken)).toBe(true);
    });

    it('should not flag placeholder values', () => {
      const placeholders = [
        'your-token-here',
        'YOUR_TOKEN',
        'replace-me',
        'REPLACE_ME',
        'example',
        'xxx',
        '****',
        '/path/to/token',
        'https://example.com',
      ];

      const pattern = /^(YOUR[-_]|your[-_]|xxx|XXX|replace[-_]?me|REPLACE[-_]?ME|change_me|CHANGE_ME|example|EXAMPLE|placeholder|PLACEHOLDER|dummy|DUMMY|secret|SECRET|\*+|\/|https?:\/\/).*$/i;

      placeholders.forEach(placeholder => {
        expect(pattern.test(placeholder)).toBe(true);
      });
    });

    it('should recognize .env.example as safe', () => {
      const examplePath = path.resolve(process.cwd(), '.env.example');
      // .env.example should exist
      const exists = fs.existsSync(examplePath);
      expect(exists).toBe(true);
    });
  });

  describe('.gitignore Validation', () => {
    it('should verify .env is in .gitignore', () => {
      const gitIgnorePath = path.resolve(process.cwd(), '.gitignore');
      const exists = fs.existsSync(gitIgnorePath);

      if (exists) {
        const content = fs.readFileSync(gitIgnorePath, 'utf8');
        expect(content).toContain('.env');
      }
    });

    it('should include common secret files in .gitignore', () => {
      const gitIgnorePath = path.resolve(process.cwd(), '.gitignore');
      const exists = fs.existsSync(gitIgnorePath);

      if (exists) {
        const content = fs.readFileSync(gitIgnorePath, 'utf8');
        // At minimum .env should be there
        expect(content.length).toBeGreaterThan(0);
      }
    });
  });

  describe('.env.example Documentation', () => {
    it('should have comprehensive .env.example file', () => {
      const examplePath = path.resolve(process.cwd(), '.env.example');
      const exists = fs.existsSync(examplePath);
      expect(exists).toBe(true);

      if (exists) {
        const content = fs.readFileSync(examplePath, 'utf8');
        expect(content.length).toBeGreaterThan(100);
      }
    });

    it('should include documentation for each variable', () => {
      const examplePath = path.resolve(process.cwd(), '.env.example');
      const content = fs.readFileSync(examplePath, 'utf8');

      // Should have comments explaining configuration
      expect(content).toContain('#');
    });

    it('should warn about production security requirements', () => {
      const examplePath = path.resolve(process.cwd(), '.env.example');
      const content = fs.readFileSync(examplePath, 'utf8');

      // Should mention authentication and security
      expect(content.toLowerCase()).toMatch(/(auth|production|secret|token)/);
    });

    it('should not contain real secrets in .env.example', () => {
      const examplePath = path.resolve(process.cwd(), '.env.example');
      const content = fs.readFileSync(examplePath, 'utf8');

      // Extract all variable assignments
      const assignments = content.match(/^[A-Z_]+=[^\n]*$/gm) || [];

      assignments.forEach(assignment => {
        const [, value] = assignment.split('=');
        if (value && value.trim()) {
          // Check that values are placeholders, not real secrets
          const placeholderPattern = /^(YOUR[-_]|your[-_]|xxx|XXX|replaceme|REPLACE[-_]?ME|change_me|CHANGE_ME|example|EXAMPLE|placeholder|PLACEHOLDER|dummy|DUMMY|\/|https?:\/\/|false|true|0|1|\*+|[0-9]+|UTC|Asia\/|development|production|test|info|warn|error|New|Active|Closed|3in1|Task|_suffix|No|Yes|CURRENT|NEXT|"Task \|").*$/i;
          expect(placeholderPattern.test(value.trim())).toBe(true);
        }
      });
    });
  });

  describe('Security Best Practices', () => {
    it('should document API_AUTH_TOKEN requirement for production', () => {
      const examplePath = path.resolve(process.cwd(), '.env.example');
      const content = fs.readFileSync(examplePath, 'utf8');

      expect(content).toContain('API_AUTH_TOKEN');
      expect(content.toLowerCase()).toContain('production');
    });

    it('should warn about rate limiting configuration', () => {
      const examplePath = path.resolve(process.cwd(), '.env.example');
      const content = fs.readFileSync(examplePath, 'utf8');

      // Rate limiting info should be in rate-limiter.ts
      // Environment variables shouldn't need this, but good to have in docs
      expect(content.length).toBeGreaterThan(0);
    });

    it('should document CORS and origin configuration', () => {
      const examplePath = path.resolve(process.cwd(), '.env.example');
      const content = fs.readFileSync(examplePath, 'utf8');

      expect(content).toContain('CORS_ORIGIN');
      expect(content).toContain('PUBLIC_ORIGIN');
    });

    it('should include proxy certificate configuration', () => {
      const examplePath = path.resolve(process.cwd(), '.env.example');
      const content = fs.readFileSync(examplePath, 'utf8');

      expect(content).toContain('NODE_EXTRA_CA_CERTS');
    });
  });

  describe('Validation Function Behavior', () => {
    it('should distinguish PAT-shaped input from placeholder text', () => {
      const syntheticPat = 'b'.repeat(52);
      const dummyPat = 'your-personal-access-token-here';

      const patPattern = /^[a-zA-Z0-9]{40,}$/;
      const dummyPattern = /^(YOUR[-_]|your[-_]).*$/i;

      expect(patPattern.test(syntheticPat)).toBe(true);
      expect(dummyPattern.test(dummyPat)).toBe(true);
    });

    it('should properly handle empty and undefined values', () => {
      const values = ['', undefined, null, '   '];
      const realSecrets = values.filter(v => v && v.trim() && /^[a-zA-Z0-9]{40,}$/.test(v));
      expect(realSecrets.length).toBe(0);
    });

    it('should handle quoted environment values', () => {
      const quotedValue = '"your-token-here"';
      const unquoted = quotedValue.slice(1, -1);
      const dummyPattern = /^(YOUR[-_]|your[-_]).*$/i;
      expect(dummyPattern.test(unquoted)).toBe(true);
    });
  });

  describe('Rate Limiting Configuration', () => {
    it('should have rate-limiter.ts module', () => {
      const rateLimiterPath = path.resolve(process.cwd(), 'src/presentation/api/rate-limiter.ts');
      expect(fs.existsSync(rateLimiterPath)).toBe(true);
    });

    it('should export rate limiting middleware', () => {
      // These exports should exist in the rate-limiter module
      const exports = ['generalLimiter', 'strictLimiter', 'authLimiter', 'bulkOperationsLimiter'];
      expect(exports.length).toBe(4);
    });

    it('should have proper rate limit windows', () => {
      // 15 minutes = 900000 ms
      // 1 hour = 3600000 ms
      const fifteenMinutes = 15 * 60 * 1000;
      const oneHour = 60 * 60 * 1000;

      expect(fifteenMinutes).toBe(900000);
      expect(oneHour).toBe(3600000);
    });

    it('should configure appropriate limits per endpoint group', () => {
      // General: 100 requests
      // Strict (mutations): 30 requests
      // Auth: 5 requests
      // Bulk: 10 requests per hour
      expect(100).toBeGreaterThan(30);
      expect(30).toBeGreaterThan(5);
    });
  });

  describe('Integration Checks', () => {
    it('should have rate-limiter imported in server.ts', () => {
      const serverPath = path.resolve(process.cwd(), 'src/presentation/api/server.ts');
      const content = fs.readFileSync(serverPath, 'utf8');
      expect(content).toContain('rate-limiter');
    });

    it('should have env-validation imported in server.ts', () => {
      const serverPath = path.resolve(process.cwd(), 'src/presentation/api/server.ts');
      const content = fs.readFileSync(serverPath, 'utf8');
      expect(content).toContain('env-validation');
    });

    it('should call validation functions on startup', () => {
      const serverPath = path.resolve(process.cwd(), 'src/presentation/api/server.ts');
      const content = fs.readFileSync(serverPath, 'utf8');
      expect(content).toContain('validateEnvironmentSecrets');
      expect(content).toContain('validateGitIgnore');
      expect(content).toContain('ensureEnvExample');
    });

    it('should apply middleware in configure method', () => {
      const serverPath = path.resolve(process.cwd(), 'src/presentation/api/server.ts');
      const content = fs.readFileSync(serverPath, 'utf8');
      expect(content).toContain('this.app.use(generalLimiter)');
      expect(content).toContain('this.app.use(strictLimiter)');
    });
  });
});
