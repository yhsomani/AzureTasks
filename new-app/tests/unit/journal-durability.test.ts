import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { FileJournalRepository } from '../../src/infrastructure/journal/file-journal-repo.js';
import { AtomicFileWriter } from '../../src/infrastructure/persistence/atomic-file-writer.js';
import type { JournalEntry } from '../../src/domain/ports/repositories.js';

const roots: string[] = [];
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'studio-journal-'));
  roots.push(root);
  const filename = join(root, 'journal.json');
  return { filename, repo: new FileJournalRepository(filename) };
}
function entry(index = 1): JournalEntry {
  return {
    runId: `run-${index}`, timestamp: '2026-10-28T10:00:00Z', personKey: 'sample',
    personName: 'Sample', assignedTo: 'sample@example.invalid', targetIsoDate: '2026-10-28',
    title: `Sample ${index}`, sourceTaskId: 1, createdWorkItemId: 10 + index,
    fieldCopyStatus: 'SUCCESS', relationCopyStatus: 'SUCCESS', verified: true,
  };
}
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('journal acknowledgment durability', () => {
  it('persists before record resolves without requiring close or a timer', async () => {
    const { filename, repo } = fixture();
    await repo.record(entry());
    expect(JSON.parse(readFileSync(filename, 'utf8'))).toEqual([entry()]);
    expect(await new FileJournalRepository(filename).getEntries()).toEqual([entry()]);
  });

  it('batches concurrent callers into one committed write', async () => {
    const { filename, repo } = fixture();
    const write = vi.spyOn(AtomicFileWriter, 'writeJson');
    await Promise.all(Array.from({ length: 20 }, (_, index) => repo.record(entry(index))));
    expect(JSON.parse(readFileSync(filename, 'utf8'))).toHaveLength(20);
    expect(write).toHaveBeenCalledTimes(1);
  });

  it('rejects every affected caller when storage fails and preserves previous evidence', async () => {
    const { filename, repo } = fixture();
    writeFileSync(filename, JSON.stringify([entry(0)]));
    vi.spyOn(AtomicFileWriter, 'writeJson').mockImplementation(() => { throw new Error('disk full'); });
    const results = await Promise.allSettled([repo.record(entry(1)), repo.record(entry(2))]);
    expect(results.every(result => result.status === 'rejected')).toBe(true);
    expect(JSON.parse(readFileSync(filename, 'utf8'))).toEqual([entry(0)]);
    await expect(repo.close()).rejects.toThrow('disk full');
  });
});