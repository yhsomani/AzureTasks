import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FileAutoClosureAuditRepository } from '../../src/infrastructure/journal/file-auto-closure-audit-repo.js';
import { AutoClosureAuditLog } from '../../src/domain/entities/auto-closure-config.js';
import * as fs from 'fs';
import * as path from 'path';

describe('FileAutoClosureAuditRepository', () => {
  const testAuditPath = path.join(process.cwd(), '.test-auto-closure-audit.json');
  let repo: FileAutoClosureAuditRepository;

  beforeEach(() => {
    // Clean up test files before each test
    if (fs.existsSync(testAuditPath)) {
      fs.unlinkSync(testAuditPath);
    }
    repo = new FileAutoClosureAuditRepository(testAuditPath);
  });

  afterEach(() => {
    // Clean up test files after each test
    if (fs.existsSync(testAuditPath)) {
      fs.unlinkSync(testAuditPath);
    }
  });

  describe('record', () => {
    it('should record audit entry', async () => {
      const entry: AutoClosureAuditLog = {
        id: '',
        taskId: 123,
        assignedUser: 'user@example.com',
        closedAt: '2024-01-01T12:00:00Z',
        triggerSource: 'scheduled',
        closureReason: 'Auto-closed by task closure',
        automationDetails: {},
        configurationVersion: 1,
        validationResults: { passed: true },
        status: 'success',
      };

      await repo.record(entry);

      expect(fs.existsSync(testAuditPath)).toBe(true);

      const entries = JSON.parse(fs.readFileSync(testAuditPath, 'utf-8'));
      expect(entries).toHaveLength(1);
      expect(entries[0].taskId).toBe(123);
    });

    it('should assign ID to entry if missing', async () => {
      const entry: AutoClosureAuditLog = {
        id: '',
        taskId: 123,
        assignedUser: 'user@example.com',
        closedAt: '2024-01-01T12:00:00Z',
        triggerSource: 'scheduled',
        closureReason: 'Auto-closed by task closure',
        automationDetails: {},
        configurationVersion: 1,
        validationResults: { passed: true },
        status: 'success',
      };

      await repo.record(entry);

      const entries = JSON.parse(fs.readFileSync(testAuditPath, 'utf-8'));
      expect(entries[0].id).toBeTruthy();
      expect(entries[0].id).toMatch(/^[0-9a-f-]+$/);  // UUID format
    });
  });

  describe('getEntries', () => {
    it('should return empty array when no entries exist', async () => {
      const entries = await repo.getEntries();
      expect(entries).toHaveLength(0);
    });

    it('should return recorded entries in reverse order', async () => {
      const entry1: AutoClosureAuditLog = {
        id: 'id-1',
        taskId: 123,
        assignedUser: 'user@example.com',
        closedAt: '2024-01-01T10:00:00Z',
        triggerSource: 'scheduled',
        closureReason: 'Auto-closed',
        automationDetails: {},
        configurationVersion: 1,
        validationResults: { passed: true },
        status: 'success',
      };

      const entry2: AutoClosureAuditLog = {
        id: 'id-2',
        taskId: 124,
        assignedUser: 'user@example.com',
        closedAt: '2024-01-01T11:00:00Z',
        triggerSource: 'scheduled',
        closureReason: 'Auto-closed',
        automationDetails: {},
        configurationVersion: 1,
        validationResults: { passed: true },
        status: 'success',
      };

      await repo.record(entry1);
      await repo.record(entry2);

      const entries = await repo.getEntries();
      expect(entries).toHaveLength(2);
      expect(entries[0].taskId).toBe(124);  // Most recent first
      expect(entries[1].taskId).toBe(123);
    });

    it('should respect limit parameter', async () => {
      for (let i = 0; i < 5; i++) {
        const entry: AutoClosureAuditLog = {
          id: `id-${i}`,
          taskId: 100 + i,
          assignedUser: 'user@example.com',
          closedAt: '2024-01-01T12:00:00Z',
          triggerSource: 'scheduled',
          closureReason: 'Auto-closed',
          automationDetails: {},
          configurationVersion: 1,
          validationResults: { passed: true },
          status: 'success',
        };
        await repo.record(entry);
      }

      const entries = await repo.getEntries(2);
      expect(entries).toHaveLength(2);
    });
  });

  describe('getEntriesByTask', () => {
    it('should filter entries by task ID', async () => {
      for (let i = 0; i < 3; i++) {
        const entry: AutoClosureAuditLog = {
          id: `id-${i}`,
          taskId: i === 1 ? 123 : 100 + i,
          assignedUser: 'user@example.com',
          closedAt: '2024-01-01T12:00:00Z',
          triggerSource: 'scheduled',
          closureReason: 'Auto-closed',
          automationDetails: {},
          configurationVersion: 1,
          validationResults: { passed: true },
          status: 'success',
        };
        await repo.record(entry);
      }

      const entries = await repo.getEntriesByTask(123);
      expect(entries).toHaveLength(1);
      expect(entries[0].taskId).toBe(123);
    });
  });

  describe('getEntriesByUser', () => {
    it('should filter entries by user ID', async () => {
      for (let i = 0; i < 3; i++) {
        const entry: AutoClosureAuditLog = {
          id: `id-${i}`,
          taskId: 100 + i,
          assignedUser: i === 1 ? 'targetuser@example.com' : `user${i}@example.com`,
          closedAt: '2024-01-01T12:00:00Z',
          triggerSource: 'scheduled',
          closureReason: 'Auto-closed',
          automationDetails: {},
          configurationVersion: 1,
          validationResults: { passed: true },
          status: 'success',
        };
        await repo.record(entry);
      }

      const entries = await repo.getEntriesByUser('targetuser@example.com');
      expect(entries).toHaveLength(1);
      expect(entries[0].assignedUser).toBe('targetuser@example.com');
    });
  });

  describe('exportCsv', () => {
    it('should export entries as CSV', async () => {
      const entry: AutoClosureAuditLog = {
        id: 'id-1',
        taskId: 123,
        assignedUser: 'user@example.com',
        closedAt: '2024-01-01T12:00:00Z',
        triggerSource: 'scheduled',
        closureReason: 'Auto-closed',
        automationDetails: { ruleId: 'rule-1' },
        configurationVersion: 1,
        validationResults: { passed: true },
        status: 'success',
      };

      await repo.record(entry);

      const csv = await repo.exportCsv();
      expect(csv).toContain('Timestamp');
      expect(csv).toContain('TaskId');
      expect(csv).toContain('user@example.com');
      expect(csv).toContain('123');
    });
  });

  describe('exportJson', () => {
    it('should export entries as JSON', async () => {
      const entry: AutoClosureAuditLog = {
        id: 'id-1',
        taskId: 123,
        assignedUser: 'user@example.com',
        closedAt: '2024-01-01T12:00:00Z',
        triggerSource: 'scheduled',
        closureReason: 'Auto-closed',
        automationDetails: {},
        configurationVersion: 1,
        validationResults: { passed: true },
        status: 'success',
      };

      await repo.record(entry);

      const json = await repo.exportJson();
      const parsed = JSON.parse(json);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed[0].taskId).toBe(123);
    });
  });

  describe('cleanup', () => {
    it('should remove entries before specified date', async () => {
      const entries: AutoClosureAuditLog[] = [
        {
          id: 'id-1',
          taskId: 123,
          assignedUser: 'user@example.com',
          closedAt: '2024-01-01T12:00:00Z',
          triggerSource: 'scheduled',
          closureReason: 'Auto-closed',
          automationDetails: {},
          configurationVersion: 1,
          validationResults: { passed: true },
          status: 'success',
        },
        {
          id: 'id-2',
          taskId: 124,
          assignedUser: 'user@example.com',
          closedAt: '2024-01-10T12:00:00Z',
          triggerSource: 'scheduled',
          closureReason: 'Auto-closed',
          automationDetails: {},
          configurationVersion: 1,
          validationResults: { passed: true },
          status: 'success',
        },
      ];

      for (const entry of entries) {
        await repo.record(entry);
      }

      const deleted = await repo.cleanup('2024-01-05T00:00:00Z');
      expect(deleted).toBe(1);

      const remaining = await repo.getEntries();
      expect(remaining).toHaveLength(1);
      expect(remaining[0].taskId).toBe(124);
    });
  });
});
