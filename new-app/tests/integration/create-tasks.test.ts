import { describe, it, expect, beforeEach } from 'vitest';
import { CreateTasksUseCase } from '../../src/application/use-cases/create-tasks';
import { PlanTasksUseCase } from '../../src/application/use-cases/plan-tasks';
import {
  WorkItemRepository,
  JournalRepository,
  LockRepository,
  JournalEntry,
  AppConfig,
} from '../../src/domain/ports/repositories';
import { WorkItem, DiscoveredTask, CreatedTask, Person } from '../../src/domain/index';
import { getTodayIso, addDays, getNextThursdayIso } from '../../src/domain/value-objects/date-window';

/** Clock-independent "today" used to build deterministic-but-current fixtures. */
const TODAY = getTodayIso('UTC');
const SOURCE_DATE = addDays(TODAY, -1);

/** In-memory fake Azure DevOps repository for deterministic tests. */
class FakeWorkItemRepo implements WorkItemRepository {
  public created: Array<{ title: string; assignedTo: string }> = [];
  public failTitles = new Set<string>();
  public lastQueryRange: { startDate: string; endDate: string } | null = null;
  private nextId = 1000;
  private createdFields = new Map<number, WorkItem['fields']>();

  constructor(
    private hasSource: boolean,
    private existingByDate: Map<string, { id: number; title: string; isoDate: string }> = new Map()
  ) {}

  async validateProject(): Promise<void> {}
  async validateWorkItemType(): Promise<void> {}

  async findLatestTaskForPerson(): Promise<DiscoveredTask | null> {
    return null;
  }

  async discoverLatestTasksForPeople(
    _p: string, _w: string, _t: string, people: Person[]
  ): Promise<Map<string, DiscoveredTask>> {
    const map = new Map<string, DiscoveredTask>();
    if (!this.hasSource) return map;
    const source: WorkItem = {
      id: 42,
      rev: 1,
      fields: { 'System.Title': `3in1_PWA_MyAccount | x` },
      relations: [],
    };
    for (const person of people) {
      map.set(person.key, {
        workItem: source,
        parsedDate: { isoDate: SOURCE_DATE, formattedTitleDate: 'x', year: 2026, isValid: true },
        key: person.key,
      });
    }
    return map;
  }

  async getExistingTasksForPerson(
    _proj: string, _type: string, _t: string, _person: string, startDate: string, endDate: string
  ): Promise<Map<string, { id: number; title: string; isoDate: string }>> {
    this.lastQueryRange = { startDate, endDate };
    return this.existingByDate;
  }

  async getWorkItem(id: number): Promise<WorkItem> {
    return { id, rev: 1, fields: this.createdFields.get(id) ?? {}, relations: [] };
  }

  async createWorkItemWithReconciliation(
    _proj: string, _type: string, fieldOps: any[], data: { title: string; assignedTo: string }
  ): Promise<CreatedTask> {
    if (this.failTitles.has(data.title)) {
      throw new Error('Simulated Azure failure');
    }
    const id = this.nextId++;
    this.createdFields.set(id, {
      'System.WorkItemType': '3in1 Task',
      ...Object.fromEntries(fieldOps
        .filter((op: { path: string }) => op.path.startsWith('/fields/'))
        .map((op: { path: string; value: unknown }) => [op.path.slice('/fields/'.length), op.value])),
    });
    this.created.push({
      title: data.title,
      assignedTo: fieldOps.find(o => o.path === '/fields/System.AssignedTo')?.value,
    });
    return { id, title: data.title, isoDate: SOURCE_DATE, url: `http://x/${id}` };
  }

  async copyRelations(): Promise<{ copiedCount: number; failedCount: number; totalRelations: number }> {
    return { copiedCount: 0, failedCount: 0, totalRelations: 0 };
  }

  async findCandidateTasks(
    _project: string,
    _workItemType: string,
    _titlePrefix: string,
    _startDate?: string,
    _endDate?: string,
    _personIdentities?: string[]
  ): Promise<WorkItem[]> {
    return [];
  }

  async patchWorkItem(
    id: number,
    _fieldOps: any[],
    _options?: { bypassRules?: boolean }
  ): Promise<WorkItem> {
    return { id, rev: 1, fields: this.createdFields.get(id) ?? {}, relations: [] };
  }
}

class FakeJournalRepo implements JournalRepository {
  public entries: JournalEntry[] = [];
  async record(e: JournalEntry): Promise<void> { this.entries.push(e); }
  async getEntries(): Promise<JournalEntry[]> { return this.entries; }
  async getUnfinishedRelations(): Promise<JournalEntry[]> {
    return this.entries.filter(e => e.relationCopyStatus !== 'SUCCESS');
  }
  async markRepaired(
    _entry: JournalEntry,
    _status: JournalEntry['relationCopyStatus'],
    _note: string,
    _verified?: boolean
  ): Promise<boolean> {
    return true;
  }
  async exportCsv(): Promise<string> { return ''; }
  async exportJson(): Promise<string> { return JSON.stringify(this.entries); }
}

class FakeLockRepo implements LockRepository {
  private locked = false;
  acquire(): boolean { if (this.locked) return false; this.locked = true; return true; }
  release(): void { this.locked = false; }
  isLocked(): boolean { return this.locked; }
  getLockInfo() { return null; }
}

const config: AppConfig = {
  organization: 'Org', project: 'Proj', baseUrl: 'https://dev.azure.com',
  workItemType: '3in1 Task', taskSeries: 's', titlePrefix: '3in1_PWA_MyAccount |',
  startTime: '09:30', timezone: 'UTC', skipWeekends: true, stopDay: 'THURSDAY',
  stopDayOfWeek: 4, thursdayMode: 'CURRENT', defaultState: 'New', autoClose: false,
  copyEstimates: true, resetActualWork: true, maxRetries: 1, initialRetryDelayMs: 0,
  people: [
    { key: 'p1', name: 'Alice', assignedTo: 'alice@b.com', enabled: true },
    { key: 'p2', name: 'Bob', assignedTo: 'bob@b.com', enabled: true },
  ],
};

describe('CreateTasksUseCase (integration, fake repo)', () => {
  let journal: FakeJournalRepo;
  let lock: FakeLockRepo;

  beforeEach(() => {
    journal = new FakeJournalRepo();
    lock = new FakeLockRepo();
  });

  function build(repo: FakeWorkItemRepo) {
    return new CreateTasksUseCase(repo, journal, lock, config);
  }

  /** Derive the current planned dates so assertions never hard-code a weekday. */
  async function plannedCount(repo: FakeWorkItemRepo): Promise<number> {
    const plan = await new PlanTasksUseCase(repo, config).execute({ all: true, asOf: TODAY });
    return plan.personPlans.flatMap(p => p.plannedDates).filter(d => d.status === 'PLANNED').length;
  }

  it('creates one task per planned person-date', async () => {
    const repo = new FakeWorkItemRepo(true);
    const expected = await plannedCount(repo);
    expect(expected).toBeGreaterThan(0);

    const result = await build(repo).execute({ all: true, asOf: TODAY, yes: true });

    expect(result.totalCreatedCount).toBe(expected);
    expect(result.peopleProcessedCount).toBe(2);
    expect(repo.created).toHaveLength(expected);
    expect(journal.entries).toHaveLength(expected);
    expect(journal.entries.every(e => e.fieldCopyStatus === 'SUCCESS')).toBe(true);
    expect(journal.entries.every(e => e.verified === true)).toBe(true);
  });

  it('never relabels an Azure-created task as a failed creation when journaling fails', async () => {
    const repo = new FakeWorkItemRepo(true);
    const expected = await plannedCount(repo);
    journal.record = async () => { throw new Error('disk full'); };
    const output = await build(repo).execute({ all: true, asOf: TODAY, yes: true });
    expect(output.totalCreatedCount).toBe(expected);
    expect(output.totalTaskFailureCount).toBe(0);
    expect(repo.created).toHaveLength(expected);
    expect(output.personResults.every(p => p.status === 'PARTIAL')).toBe(true);
    expect(output.personResults.every(p => p.auditWarnings?.some(w => w.includes('journal write failed')))).toBe(true);
  });

  it('marks Azure accepted creations unverified when read-back lacks critical fields', async () => {
    const repo = new FakeWorkItemRepo(true);
    repo.getWorkItem = async id => ({ id, rev: 1, fields: {
      'System.Title': repo.created[0]?.title,
      'System.AssignedTo': repo.created[0]?.assignedTo,
    }, relations: [] });
    const output = await build(repo).execute({ all: true, asOf: TODAY, yes: true });
    expect(output.totalCreatedCount).toBeGreaterThan(0);
    expect(output.totalTaskFailureCount).toBe(0);
    expect(journal.entries.every(e => e.verified === false)).toBe(true);
    expect(output.personResults.every(p => p.status === 'PARTIAL')).toBe(true);
  });

  it('does not verify copied relations without an independent relation read-back', async () => {
    const repo = new FakeWorkItemRepo(true);
    const originalDiscovery = repo.discoverLatestTasksForPeople.bind(repo);
    repo.discoverLatestTasksForPeople = async (...args) => {
      const sources = await originalDiscovery(...args);
      for (const source of sources.values()) {
        source.workItem.relations = [{ rel: 'System.LinkTypes.Related', url: 'https://example.invalid/link/42' }];
      }
      return sources;
    };
    // The fake confirms the Azure relation PATCH but the target has no link.
    repo.copyRelations = async () => ({ copiedCount: 1, failedCount: 0, totalRelations: 1 });
    const output = await build(repo).execute({ all: true, asOf: TODAY, yes: true });
    expect(output.totalCreatedCount).toBeGreaterThan(0);
    expect(journal.entries.every(e => e.verified === false)).toBe(true);
    expect(output.personResults.every(p => p.status === 'PARTIAL')).toBe(true);
  });

  it('refuses ad-hoc creation for a disabled member before acquiring the remote lock', async () => {
    const repo = new FakeWorkItemRepo(true);
    const disabledConfig: AppConfig = {
      ...config,
      people: config.people.map(p => p.key === 'p2' ? { ...p, enabled: false } : p),
    };
    const futureThursday = getNextThursdayIso(addDays(TODAY, 7), 'CURRENT');
    await expect(new CreateTasksUseCase(repo, journal, lock, disabledConfig)
      .executeAdHocTask({ personKey: 'p2', targetIsoDate: futureThursday }))
      .rejects.toThrow(/not an enabled configured team member/i);
    expect(repo.created).toHaveLength(0);
    expect(lock.isLocked()).toBe(false);
  });

  it('assigns each created task to the correct person', async () => {
    const repo = new FakeWorkItemRepo(true);
    const perPerson = await plannedCount(repo) / 2;
    await build(repo).execute({ all: true, asOf: TODAY, yes: true });
    expect(repo.created.filter(c => c.assignedTo === 'alice@b.com')).toHaveLength(perPerson);
    expect(repo.created.filter(c => c.assignedTo === 'bob@b.com')).toHaveLength(perPerson);
  });

  it('skips every planned date as a duplicate when they already exist (idempotency)', async () => {
    const repo = new FakeWorkItemRepo(true);
    const plan = await new PlanTasksUseCase(repo, config).execute({ all: true, asOf: TODAY });
    const existing = new Map<string, { id: number; title: string; isoDate: string }>();
    for (const p of plan.personPlans) {
      for (const d of p.plannedDates.filter(d => d.status === 'PLANNED')) {
        existing.set(d.isoDate, { id: 1, title: d.fullTitle, isoDate: d.isoDate });
      }
    }
    const populated = new FakeWorkItemRepo(true, existing);
    const result = await build(populated).execute({ all: true, asOf: TODAY, yes: true });

    expect(result.totalCreatedCount).toBe(0);
    expect(result.totalDuplicateCount).toBeGreaterThan(0);
    expect(populated.created).toHaveLength(0);
  });

  it('does not create anything in dry-run mode', async () => {
    const repo = new FakeWorkItemRepo(true);
    const result = await build(repo).execute({ all: true, asOf: TODAY, dryRun: true });
    expect(result.totalCreatedCount).toBe(0);
    expect(repo.created).toHaveLength(0);
  });

  it('honours the thursdayMode override over persisted config', async () => {
    // Pick a Thursday strictly in the future so FOLLOWING differs from CURRENT.
    const thursday = getNextThursdayIso(addDays(TODAY, 7), 'CURRENT');
    const expected = getNextThursdayIso(thursday, 'FOLLOWING');

    const repo = new FakeWorkItemRepo(true);
    const out = await new PlanTasksUseCase(repo, config).execute({
      all: true,
      asOf: thursday,
      thursdayMode: 'FOLLOWING',
    });

    expect(out.nextThursdayIso).toBe(expected);
    for (const p of out.personPlans) {
      expect(p.nextThursday).toBe(expected);
    }
  });

  it('queries existing tasks up to the configured stop day, not always Thursday', async () => {
    const fridayConfig: AppConfig = { ...config, stopDay: 'FRIDAY', stopDayOfWeek: 5 };
    const repo = new FakeWorkItemRepo(true);
    await new CreateTasksUseCase(repo, journal, lock, fridayConfig)
      .execute({ all: true, asOf: TODAY, dryRun: true });

    expect(repo.lastQueryRange?.endDate).toBe(getNextThursdayIso(TODAY, 'CURRENT', 5));
  });

  it('isolates failures to a single date and continues', async () => {
    const repo = new FakeWorkItemRepo(true);
    const plan = await new PlanTasksUseCase(repo, config).execute({ all: true, asOf: TODAY });
    const expectedTotal = plan.personPlans
      .flatMap(p => p.plannedDates)
      .filter(d => d.status === 'PLANNED').length;
    const firstDate = plan.personPlans[0].plannedDates.find(d => d.status === 'PLANNED')!;
    repo.failTitles.add(firstDate.fullTitle);

    const result = await build(repo).execute({ all: true, asOf: TODAY, yes: true });

    expect(result.totalTaskFailureCount).toBe(2); // both people, same date
    expect(result.totalCreatedCount).toBe(expectedTotal - 2);
    const alice = result.personResults.find(p => p.person.key === 'p1')!;
    expect(['PARTIAL', 'FAILED']).toContain(alice.status);
    // A failed create processed no relations; only successful creates count.
    expect(alice.relationsProcessed).toBe(alice.createdTasks.length);
  });

  it('reports source failures when a person has no source task', async () => {
    const repo = new FakeWorkItemRepo(false);
    const result = await build(repo).execute({ all: true, asOf: TODAY, yes: true });
    expect(result.totalSourceFailureCount).toBe(2);
    expect(result.totalCreatedCount).toBe(0);
  });

  it('blocks concurrent execution via the lock', async () => {
    const repo = new FakeWorkItemRepo(true);
    lock.acquire(); // simulate an in-progress run
    await expect(build(repo).execute({ all: true, asOf: TODAY, yes: true }))
      .rejects.toThrow(/already running/i);
  });

  it('rejects creation for past dates', async () => {
    const repo = new FakeWorkItemRepo(true);
    await expect(build(repo).execute({ all: true, asOf: '2020-01-01', yes: true }))
      .rejects.toThrow(/past/i);
  });
});
