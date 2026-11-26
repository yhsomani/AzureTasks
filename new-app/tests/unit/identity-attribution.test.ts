import { describe, expect, it } from 'vitest';
import { RelationalJournalRepository } from '../../src/infrastructure/persistence/relational-journal-repo.js';
import { createDatabase } from '../../src/infrastructure/persistence/database.js';
import {
  sanitizeOperatorEmail,
  resolveOperator,
  ImmutableJournalEntry,
} from '../../src/infrastructure/auth/identity.js';

describe('Milestone 4 — Feature 25: Personal Identity Attribution', () => {
  describe('Operator Email Formatting and Sanitization', () => {
    it('sanitizes and formats operator email to trimmed lowercase', () => {
      const clean = sanitizeOperatorEmail('  Alex.Smith@Example.COM  ');
      expect(clean).toBe('alex.smith@example.com');
    });

    it('rejects empty or whitespace-only email', () => {
      expect(() => sanitizeOperatorEmail('')).toThrow('Operator identity required for audit compliance.');
      expect(() => sanitizeOperatorEmail('   ')).toThrow('Operator identity required for audit compliance.');
    });
  });

  describe('Header Spoofing Neutralization', () => {
    it('always strictly resolves verified JWT email over spoofed headers', () => {
      const authenticatedJwtEmail = 'priya@example.com';
      const spoofedHeaderEmail = 'alex@example.com';

      const finalOperator = resolveOperator(authenticatedJwtEmail, spoofedHeaderEmail);
      expect(finalOperator).toBe('priya@example.com');
      expect(finalOperator).not.toBe('alex@example.com');
    });

    it('resolves operator from authenticated user object over spoofed header', () => {
      const user = { email: '  Priya@Example.COM  ' };
      const spoofedHeaderEmail = 'alex@example.com';

      const finalOperator = resolveOperator(user, spoofedHeaderEmail);
      expect(finalOperator).toBe('priya@example.com');
      expect(finalOperator).not.toBe('alex@example.com');
    });

    it('rejects untrusted header fallback when jwt email is missing', () => {
      const headerEmail = 'alex@example.com';
      expect(() => resolveOperator(undefined, headerEmail)).toThrow(
        'Operator identity required for audit compliance.'
      );
    });

    it('throws error when neither JWT nor header identity is present', () => {
      expect(() => resolveOperator(undefined, undefined)).toThrow('Operator identity required for audit compliance.');
    });
  });

  describe('Missing Operator Identity Enforcement', () => {
    it('rejects mutation attempts when operator identity is missing', () => {
      expect(() => sanitizeOperatorEmail('')).toThrow('Operator identity required for audit compliance.');
    });

    it('relational journal repository rejects record with missing operator identity', async () => {
      const db = createDatabase({ sqlitePath: ':memory:' });
      const journalRepo = new RelationalJournalRepository(db);

      await expect(
        journalRepo.record({
          runId: 'run-test-no-op',
          timestamp: new Date().toISOString(),
          action: 'CREATED',
          taskId: 9199,
          personKey: 'dev1',
          personName: 'Dev One',
          targetIsoDate: '2026-11-21',
          title: 'Task missing operator',
          operatorEmail: '',
        } as any)
      ).rejects.toThrow('Operator identity required for audit compliance.');
    });
  });

  describe('Immutable Journal Entry Integrity', () => {
    it('blocks direct modification of journal operator email', () => {
      const entry = new ImmutableJournalEntry('entry-1', 'alex@example.com');
      expect(() => {
        (entry as any).operatorEmail = 'tampered@example.com';
      }).toThrow();
      expect(entry.operatorEmail).toBe('alex@example.com');
    });
  });

  describe('Relational Journal Attribution Persistence', () => {
    it('records and returns operator_email in relational journal entries and exports', async () => {
      const db = createDatabase({ sqlitePath: ':memory:' });
      const journalRepo = new RelationalJournalRepository(db);

      await journalRepo.record({
        runId: 'run-test-attribution',
        timestamp: new Date().toISOString(),
        action: 'CREATED',
        taskId: 9101,
        personKey: 'dev1',
        personName: 'Dev One',
        assignedTo: 'dev1@workops.test',
        operatorEmail: 'lead@workops.test',
        targetIsoDate: '2026-11-21',
        title: 'Attributed Task #9101',
        sourceTaskId: 9000,
        createdWorkItemId: 9101,
        fieldCopyStatus: 'SUCCESS',
        relationCopyStatus: 'SUCCESS',
        verified: true,
      });

      const entries = await journalRepo.getEntries();
      const found: any = entries.find((e: any) => e.taskId === 9101);
      expect(found).toBeDefined();
      expect(found.operatorEmail).toBe('lead@workops.test');
      expect(found.operator_email).toBe('lead@workops.test');

      const csv = await journalRepo.exportCsv();
      expect(csv).toContain('lead@workops.test');
      expect(csv).toContain('OperatorEmail');

      const jsonStr = await journalRepo.exportJson();
      const parsed = JSON.parse(jsonStr);
      expect(parsed[0].operatorEmail).toBe('lead@workops.test');
    });
  });
});
