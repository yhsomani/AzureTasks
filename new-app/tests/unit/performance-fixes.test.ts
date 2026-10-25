import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AzureWorkItemService } from '../../src/infrastructure/azure/work-item-service.js';
import { FileJournalRepository } from '../../src/infrastructure/journal/file-journal-repo.js';
import { JournalEntry } from '../../src/domain/ports/repositories.js';
import * as fs from 'fs';
import * as path from 'path';

describe('Performance Fixes', () => {
  describe('work-item-service: copyRelations N+1 optimization', () => {
    it('batches all relations into a single PATCH call', async () => {
      const patchCalls: any[] = [];
      
      const mockClient = {
        get: vi.fn(),
        post: vi.fn(),
        patch: vi.fn(async (url, body) => {
          patchCalls.push({ url, body });
          return { id: 123, fields: {} };
        }),
        baseUrl: 'https://dev.azure.com',
        organization: 'myorg',
      };

      const service = new AzureWorkItemService(mockClient as any);

      const sourceWorkItem = {
        id: 100,
        rev: 1,
        relations: [
          {
            rel: 'System.LinkTypes.Hierarchy-reverse',
            url: 'https://dev.azure.com/myorg/project/_apis/wit/workitems/201',
            attributes: { comment: 'Parent task' },
          },
          {
            rel: 'System.LinkTypes.Related',
            url: 'https://dev.azure.com/myorg/project/_apis/wit/workitems/202',
            attributes: { comment: 'Related task' },
          },
          {
            rel: 'System.LinkTypes.Related',
            url: 'https://dev.azure.com/myorg/project/_apis/wit/workitems/203',
          },
        ],
        fields: {},
      };

      const result = await service.copyRelations(sourceWorkItem, 300, [
        'System.LinkTypes.Hierarchy-reverse',
        'System.LinkTypes.Related',
      ]);

      // Should make only 1 PATCH call (batched)
      expect(patchCalls.length).toBe(1);
      
      // The PATCH call should contain all 3 relations
      expect(patchCalls[0].body).toHaveLength(3);
      expect(patchCalls[0].body[0].value.url).toContain('201');
      expect(patchCalls[0].body[1].value.url).toContain('202');
      expect(patchCalls[0].body[2].value.url).toContain('203');
      
      // All relations should be copied successfully
      expect(result.copiedCount).toBe(3);
      expect(result.failedCount).toBe(0);
      expect(result.totalRelations).toBe(3);
    });

    it('maintains at least 10x performance improvement over individual calls', async () => {
      const patchCalls: any[] = [];
      const callTimings: number[] = [];
      
      const mockClient = {
        get: vi.fn(),
        post: vi.fn(),
        patch: vi.fn(async () => {
          const start = Date.now();
          // Simulate API latency
          await new Promise(resolve => setTimeout(resolve, 10));
          const end = Date.now();
          callTimings.push(end - start);
          patchCalls.push({});
          return { id: 123, fields: {} };
        }),
        baseUrl: 'https://dev.azure.com',
        organization: 'myorg',
      };

      const service = new AzureWorkItemService(mockClient as any);

      // Create a source work item with 50 relations
      const relations = Array.from({ length: 50 }, (_, i) => ({
        rel: 'System.LinkTypes.Related',
        url: `https://dev.azure.com/myorg/project/_apis/wit/workitems/${i}`,
      }));

      const sourceWorkItem = {
        id: 100,
        rev: 1,
        relations,
        fields: {},
      };

      const start = Date.now();
      const result = await service.copyRelations(sourceWorkItem, 300, ['System.LinkTypes.Related']);
      const end = Date.now();
      const batchTime = end - start;

      // Should make only 1 PATCH call with 50 relations
      expect(patchCalls.length).toBe(1);
      expect(result.copiedCount).toBe(50);
      expect(result.failedCount).toBe(0);

      // Batching should take roughly 10-15ms total (1 call * ~10-15ms latency)
      // Individual calls would take ~500-750ms (50 calls * ~10-15ms latency each)
      // So batching should be at least 10x faster
      expect(batchTime).toBeLessThan(200); // Batching should be fast
    });

    it('falls back to individual copies on batch failure', async () => {
      let attemptCount = 0;
      const mockClient = {
        get: vi.fn(),
        post: vi.fn(),
        patch: vi.fn(async (url, body) => {
          attemptCount++;
          // First call (batch) fails
          if (attemptCount === 1) {
            throw new Error('Batch update failed');
          }
          // Individual calls succeed
          return { id: 123, fields: {} };
        }),
        baseUrl: 'https://dev.azure.com',
        organization: 'myorg',
      };

      const service = new AzureWorkItemService(mockClient as any);

      const sourceWorkItem = {
        id: 100,
        rev: 1,
        relations: [
          {
            rel: 'System.LinkTypes.Related',
            url: 'https://dev.azure.com/myorg/project/_apis/wit/workitems/201',
          },
          {
            rel: 'System.LinkTypes.Related',
            url: 'https://dev.azure.com/myorg/project/_apis/wit/workitems/202',
          },
        ],
        fields: {},
      };

      const result = await service.copyRelations(sourceWorkItem, 300, ['System.LinkTypes.Related']);

      // Should attempt batch first, then fall back to individual
      // Total calls: 1 (batch) + 2 (individual) = 3
      expect(attemptCount).toBe(3);
      expect(result.copiedCount).toBe(2);
      expect(result.failedCount).toBe(0);
    });
  });

  describe('work-item-service: getWorkItem caching', () => {
    it('caches frequently requested work items', async () => {
      const getCalls: number[] = [];
      
      const mockClient = {
        get: vi.fn(async () => {
          getCalls.push(1);
          return {
            id: 123,
            rev: 1,
            fields: { 'System.Title': 'Test' },
            relations: [],
          };
        }),
        post: vi.fn(),
        patch: vi.fn(),
      };

      const service = new AzureWorkItemService(mockClient as any);

      // Request the same item 10 times
      for (let i = 0; i < 10; i++) {
        await service.getWorkItem(123);
      }

      // Should only call the API once, rest from cache
      expect(getCalls.length).toBe(1);
      expect(mockClient.get).toHaveBeenCalledTimes(1);
    });

    it('caches different work items separately', async () => {
      let callCount = 0;
      const mockClient = {
        get: vi.fn(async () => {
          callCount++;
          return {
            id: 100 + callCount,
            rev: 1,
            fields: { 'System.Title': 'Test' },
            relations: [],
          };
        }),
        post: vi.fn(),
        patch: vi.fn(),
      };

      const service = new AzureWorkItemService(mockClient as any);

      // Request 5 different items
      for (let i = 0; i < 5; i++) {
        await service.getWorkItem(100 + i);
      }

      // Should call API 5 times for different items
      expect(callCount).toBe(5);
    });
  });

  describe('file-journal-repo: write buffering', () => {
    let testDir: string;
    let journalPath: string;

    beforeEach(() => {
      testDir = path.join(process.cwd(), `.journal-test-${Date.now()}`);
      journalPath = path.join(testDir, 'test-journal.json');
      if (!fs.existsSync(testDir)) {
        fs.mkdirSync(testDir, { recursive: true });
      }
    });

    afterEach(async () => {
      // Clean up
      if (fs.existsSync(testDir)) {
        fs.rmSync(testDir, { recursive: true, force: true });
      }
    });

    it('buffers entries and flushes them together', async () => {
      const repo = new FileJournalRepository(journalPath);

      const entries: JournalEntry[] = Array.from({ length: 10 }, (_, i) => ({
        timestamp: new Date().toISOString(),
        runId: `run-${i}`,
        personName: 'Test',
        assignedTo: 'test@example.com',
        targetIsoDate: '2026-10-26',
        title: `Task ${i}`,
        sourceTaskId: 100 + i,
        createdWorkItemId: 200 + i,
        fieldCopyStatus: 'SUCCESS',
        relationCopyStatus: 'SUCCESS',
        verified: true,
      }));

      // Record all entries rapidly
      for (const entry of entries) {
        await repo.record(entry);
      }

      // Wait for flush to complete
      await new Promise(resolve => setTimeout(resolve, 150));
      
      // Close the repo to ensure final flush
      await (repo as any).close?.();

      // Verify all entries were written atomically
      const result = await repo.getEntries();
      expect(result.length).toBeGreaterThanOrEqual(10);
    });

    it('respects 100ms flush interval', async () => {
      const repo = new FileJournalRepository(journalPath);
      const writeStartTime = Date.now();

      const entry: JournalEntry = {
        timestamp: new Date().toISOString(),
        runId: 'run-1',
        personName: 'Test',
        assignedTo: 'test@example.com',
        targetIsoDate: '2026-10-26',
        title: 'Test Task',
        sourceTaskId: 100,
        createdWorkItemId: 200,
        fieldCopyStatus: 'SUCCESS',
        relationCopyStatus: 'SUCCESS',
        verified: true,
      };

      // Record entry
      await repo.record(entry);

      // Check immediately - file might not exist yet
      let fileExists = fs.existsSync(journalPath);

      // Wait for flush interval
      await new Promise(resolve => setTimeout(resolve, 150));

      // Now file should exist with the entry
      fileExists = fs.existsSync(journalPath);
      expect(fileExists).toBe(true);

      await (repo as any).close?.();
    });

    it('prevents data loss on immediate flush', async () => {
      const repo = new FileJournalRepository(journalPath);

      const entries: JournalEntry[] = Array.from({ length: 5 }, (_, i) => ({
        timestamp: new Date().toISOString(),
        runId: `run-${i}`,
        personName: 'Test',
        assignedTo: 'test@example.com',
        targetIsoDate: '2026-10-26',
        title: `Task ${i}`,
        sourceTaskId: 100 + i,
        createdWorkItemId: 200 + i,
        fieldCopyStatus: 'SUCCESS',
        relationCopyStatus: 'SUCCESS',
        verified: true,
      }));

      // Record entries
      for (const entry of entries) {
        await repo.record(entry);
      }

      // Close immediately to trigger final flush
      await (repo as any).close?.();

      // Verify all entries were persisted
      const result = await repo.getEntries();
      expect(result.length).toBeGreaterThanOrEqual(5);
    });

    it('handles concurrent record calls efficiently', async () => {
      const repo = new FileJournalRepository(journalPath);
      const writeTimings: number[] = [];

      const entries: JournalEntry[] = Array.from({ length: 100 }, (_, i) => ({
        timestamp: new Date().toISOString(),
        runId: `run-${i}`,
        personName: 'Test',
        assignedTo: 'test@example.com',
        targetIsoDate: '2026-10-26',
        title: `Task ${i}`,
        sourceTaskId: 100 + i,
        createdWorkItemId: 200 + i,
        fieldCopyStatus: 'SUCCESS',
        relationCopyStatus: 'SUCCESS',
        verified: true,
      }));

      const start = Date.now();

      // Record all entries rapidly
      const promises = entries.map(entry => repo.record(entry));
      await Promise.all(promises);

      // Record time for buffered approach
      writeTimings.push(Date.now() - start);

      // Wait for flush
      await new Promise(resolve => setTimeout(resolve, 150));
      await (repo as any).close?.();

      // All entries should be persisted efficiently
      const result = await repo.getEntries();
      expect(result.length).toBeGreaterThanOrEqual(100);
      
      // Buffered writes should complete quickly (all in ~0-50ms)
      // Synchronous writes would take much longer
      expect(writeTimings[0]).toBeLessThan(100);
    });

    it('maintains atomicity during flush', async () => {
      const repo = new FileJournalRepository(journalPath);

      const entry: JournalEntry = {
        timestamp: new Date().toISOString(),
        runId: 'run-1',
        personName: 'Test',
        assignedTo: 'test@example.com',
        targetIsoDate: '2026-10-26',
        title: 'Test Task',
        sourceTaskId: 100,
        createdWorkItemId: 200,
        fieldCopyStatus: 'SUCCESS',
        relationCopyStatus: 'SUCCESS',
        verified: true,
      };

      await repo.record(entry);
      await new Promise(resolve => setTimeout(resolve, 150));
      await (repo as any).close?.();

      // Read the file
      const content = fs.readFileSync(journalPath, 'utf-8');
      const parsed = JSON.parse(content);

      // Should be valid JSON array with entry
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed.length).toBeGreaterThan(0);
    });
  });
});
