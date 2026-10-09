import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { RepairRelationsUseCase } from '../../src/application/use-cases/repair-relations';
import { FileJournalRepository } from '../../src/infrastructure/journal/file-journal-repo';
import { JournalEntry, WorkItemRepository } from '../../src/domain/ports/repositories';
import { WorkItem } from '../../src/domain/entities/task';

let dir: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'repair-test-'));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const entry = (over: Partial<JournalEntry> = {}): JournalEntry => ({
  runId: 'run-1',
  timestamp: new Date().toISOString(),
  personKey: 'p1',
  personName: 'A',
  assignedTo: 'a@b.com',
  targetIsoDate: '2026-10-08',
  title: 't',
  sourceTaskId: 1,
  createdWorkItemId: 2,
  fieldCopyStatus: 'SUCCESS',
  relationCopyStatus: 'PARTIAL',
  verified: false,
  ...over,
});

function fakeRepo(overrides: Partial<WorkItemRepository> = {}): WorkItemRepository {
  return {
    async getWorkItem(id: number): Promise<WorkItem> {
      if (id === 1) {
        return {
          id: 1,
          rev: 1,
          fields: {},
          relations: [
            { rel: 'System.LinkTypes.Related', url: 'vstfs:///x/1' },
            { rel: 'System.LinkTypes.Hierarchy-Reverse', url: 'vstfs:///x/parent' },
          ],
        };
      }
      return {
        id: 2,
        rev: 1,
        fields: {},
        relations: [{ rel: 'System.LinkTypes.Related', url: 'vstfs:///x/1' }],
      };
    },
    async copyRelations(src: WorkItem) {
      return {
        copiedCount: (src.relations ?? []).length,
        failedCount: 0,
        totalRelations: (src.relations ?? []).length,
      };
    },
    ...overrides,
  } as unknown as WorkItemRepository;
}

describe('RepairRelationsUseCase', () => {
  it('re-copies the missing relations and marks the journal entry repaired', async () => {
    const journal = new FileJournalRepository(path.join(dir, '.journal.json'));
    await journal.record(entry());
    expect(await journal.getUnfinishedRelations()).toHaveLength(1);

    const useCase = new RepairRelationsUseCase(fakeRepo(), journal);
    const report = await useCase.execute();

    expect(report.total).toBe(1);
    expect(report.repaired).toBe(1);
    expect(report.rows[0].copiedCount).toBe(1); // only the missing Parent link
    expect(await journal.getUnfinishedRelations()).toHaveLength(0);
  });

  it('skips entries with no created work item id', async () => {
    const journal = new FileJournalRepository(path.join(dir, '.journal.json'));
    await journal.record(entry({ createdWorkItemId: undefined }));

    const useCase = new RepairRelationsUseCase(fakeRepo(), journal);
    const report = await useCase.execute();

    expect(report.skipped).toBe(1);
    expect(report.repaired).toBe(0);
  });

  it('isolates per-entry failures', async () => {
    const journal = new FileJournalRepository(path.join(dir, '.journal.json'));
    await journal.record(entry());
    const failing = fakeRepo({
      async getWorkItem() {
        throw new Error('network down');
      },
    });

    const useCase = new RepairRelationsUseCase(failing, journal);
    const report = await useCase.execute();

    expect(report.failed).toBe(1);
    expect(report.rows[0].message).toContain('network down');
    // Entry stays unfinished so it can be retried.
    expect(await journal.getUnfinishedRelations()).toHaveLength(1);
  });
});
