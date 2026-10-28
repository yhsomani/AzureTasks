/**
 * Azure DevOps Work Item Service
 * Implements the WorkItemRepository port
 */

import { AzureDevOpsClient } from './client.js';
import { logger } from '../logging/logger.js';
import { 
  WorkItemRepository, 
  WorkItem, 
  DiscoveredTask, 
  Person, 
  CreatedTask,
  parseWorkItemTaskDate,
  extractWorkItemPlannedStartDate,
  extractWorkItemRecordedDate,
  matchesPerson,
  matchesTaskSeries,
  validateSourceTaskOwnership,
  isUserStoryOrParentContainer,
} from '../../domain/index.js';

interface WiqlQueryResult {
  workItems: Array<{ id: number }>;
}

interface WorkItemBatchResult {
  value: WorkItem[];
  count: number;
}

export class AzureWorkItemService implements WorkItemRepository {
  private readonly workItemCache = new Map<number, { item: WorkItem; timestamp: number }>();
  constructor(private readonly client: AzureDevOpsClient, private readonly timezone: () => string = () => 'UTC') {}

  private requireCompleteBatch(batch: WorkItemBatchResult, ids: number[], purpose: string): WorkItem[] {
    const expected = new Set(ids);
    if (!Array.isArray(batch?.value) || expected.size !== ids.length ||
        batch.value.length !== expected.size ||
        new Set(batch.value.map(w => w?.id)).size !== expected.size ||
        batch.value.some(w => !w || !expected.has(w.id) || !w.fields)) {
      const received = Array.isArray(batch?.value) ? batch.value.length : 0;
      const receivedIds = Array.isArray(batch?.value) ? batch.value.map(w => w?.id).filter(Boolean).join(', ') : 'none';
      throw new Error(`Azure DevOps returned incomplete or mismatched ${purpose} data. Expected ${ids.length} items with IDs [${ids.join(', ')}], got ${received} items [${receivedIds}]. Refusing to infer missing tasks.`);
    }
    return batch.value;
  }

  async validateProject(project: string): Promise<void> {
    await this.client.get<any>(`/_apis/projects/${project}?api-version=7.0`);
  }

  async validateWorkItemType(project: string, workItemType: string): Promise<void> {
    const result = await this.client.get<any>(
      `/${project}/_apis/wit/workitemtypes/${encodeURIComponent(workItemType)}?api-version=7.0`
    );
    if (!result.name) {
      throw new Error(`Work item type "${workItemType}" not found in project "${project}"`);
    }
  }

  async findLatestTaskForPerson(
    project: string,
    workItemType: string,
    titlePrefix: string,
    personIdentity: string,
    sourceTaskIdOverride?: number
  ): Promise<DiscoveredTask | null> {
    if (sourceTaskIdOverride) {
      const workItem = await this.getWorkItem(sourceTaskIdOverride);
      validateSourceTaskOwnership(workItem, project, workItemType, titlePrefix, personIdentity);
      const anchoredDate = parseWorkItemTaskDate(workItem, titlePrefix, this.timezone());
      if (!anchoredDate.isValid) throw new Error('Source task title and recorded Azure dates conflict.');
      return {
        workItem,
        parsedDate: anchoredDate,
        key: personIdentity.toLowerCase().trim(),
      };
    }

    // Query candidate work items targeting the person directly in Azure DevOps
    let wiql = `
      SELECT [System.Id], [System.Title], [System.AssignedTo], [System.CreatedDate]
      FROM WorkItems
      WHERE [System.TeamProject] = '${this.escapeWiql(project)}'
        AND [System.WorkItemType] = '${this.escapeWiql(workItemType)}'
        AND [System.State] <> 'Removed'
        AND ([System.AssignedTo] = '${this.escapeWiql(personIdentity)}' OR [System.AssignedTo] CONTAINS '${this.escapeWiql(personIdentity)}')
      ORDER BY [System.CreatedDate] DESC, [System.Id] DESC
    `;

    let result = await this.client.post<WiqlQueryResult>(
      `/${project}/_apis/wit/wiql?api-version=7.0`,
      { query: wiql }
    );

    // Fallback to project-wide title prefix search if direct identity query had zero results
    if (!result.workItems || result.workItems.length === 0) {
      wiql = `
        SELECT [System.Id], [System.Title], [System.AssignedTo], [System.CreatedDate]
        FROM WorkItems
        WHERE [System.TeamProject] = '${this.escapeWiql(project)}'
          AND [System.WorkItemType] = '${this.escapeWiql(workItemType)}'
          AND [System.Title] CONTAINS '${this.escapeWiql(titlePrefix)}'
          AND [System.State] <> 'Removed'
        ORDER BY [System.CreatedDate] DESC, [System.Id] DESC
      `;
      result = await this.client.post<WiqlQueryResult>(
        `/${project}/_apis/wit/wiql?api-version=7.0`,
        { query: wiql }
      );
    }

    if (!result.workItems || result.workItems.length === 0) {
      return null;
    }

    const targetPerson = {
      assignedTo: personIdentity,
      name: personIdentity,
      key: personIdentity.toLowerCase().trim(),
    };

    // CreatedDate order is not the same as the dated task title. A fixed
    // first-100 slice can discard the chronologically latest task.
    if (result.workItems.length > 5000) {
      throw new Error('Too many source task candidates (>5000); narrow the member or task series.');
    }
    const allFetched: WorkItem[] = [];
    for (let i = 0; i < result.workItems.length; i += 100) {
      const ids = result.workItems.slice(i, i + 100).map(w => w.id).join(',');
      const batch = await this.client.get<WorkItemBatchResult>(
        `/${project}/_apis/wit/workitems?ids=${ids}&$expand=relations&api-version=7.0`
      );
      allFetched.push(...this.requireCompleteBatch(batch, result.workItems.slice(i, i + 100).map(w => w.id), 'source work-item batch'));
    }

    const candidateTasks: DiscoveredTask[] = [];
    const fallbackTasks: DiscoveredTask[] = [];
    for (const workItem of allFetched) {
      if (isUserStoryOrParentContainer(workItem)) continue;
      if (!matchesPerson(workItem.fields['System.AssignedTo'], targetPerson)) {
        continue;
      }
      const title = workItem.fields['System.Title'] || '';
      if (matchesTaskSeries(title, titlePrefix)) {
        const parsedDate = parseWorkItemTaskDate(workItem, titlePrefix, this.timezone());
        if (parsedDate.isValid) {
          candidateTasks.push({
            workItem,
            parsedDate,
            key: personIdentity.toLowerCase().trim(),
          });
        }
      } else {
        // Fallback: check Planned Start Date or non-pipe title formats
        const recorded = extractWorkItemRecordedDate(workItem, this.timezone());
        const parsedDate = parseWorkItemTaskDate(workItem, '', this.timezone(), false, true);
        if (recorded) {
          fallbackTasks.push({
            workItem,
            parsedDate: {
              isoDate: recorded.isoDate,
              formattedTitleDate: parsedDate.isValid ? parsedDate.formattedTitleDate : recorded.isoDate.slice(5),
              year: recorded.year,
              isValid: true,
            },
            key: personIdentity.toLowerCase().trim(),
          });
        } else if (parsedDate.isValid && !title.includes('|')) {
          fallbackTasks.push({
            workItem,
            parsedDate,
            key: personIdentity.toLowerCase().trim(),
          });
        }
      }
    }

    const pool = candidateTasks.length > 0 ? candidateTasks : fallbackTasks;
    if (pool.length === 0) {
      return null;
    }

    pool.sort((a, b) => b.parsedDate.isoDate.localeCompare(a.parsedDate.isoDate));
    return pool[0];
  }

  async discoverLatestTasksForPeople(
    project: string,
    workItemType: string,
    titlePrefix: string,
    people: Person[],
    sourceTaskIdOverride?: number,
    defaultSourceTaskId?: number
  ): Promise<Map<string, DiscoveredTask>> {
    const results = new Map<string, DiscoveredTask>();

    // Resolve explicit source overrides first.
    const discoveryPeople: Person[] = [];
    const overrideCache = new Map<number, WorkItem>();

    for (const person of people) {
      const overrideId = person.sourceTaskId ?? sourceTaskIdOverride;
      if (!overrideId) {
        discoveryPeople.push(person);
        continue;
      }

      let workItem = overrideCache.get(overrideId);
      if (!workItem) {
        workItem = await this.getWorkItem(overrideId);
        overrideCache.set(overrideId, workItem);
      }
      const prefix = person.titlePrefix || titlePrefix;
      validateSourceTaskOwnership(workItem, project, workItemType, prefix, person);
      const parsedDate = parseWorkItemTaskDate(workItem, prefix, this.timezone());
      if (!parsedDate.isValid) {
        throw new Error(`Source work item #${workItem.id} has conflicting title and recorded Azure dates.`);
      }
      results.set(person.key, { workItem, parsedDate, key: person.key });
    }

    if (discoveryPeople.length === 0) {
      return results;
    }

    // Query candidate work items targeting the discovery people directly in Azure DevOps
    const assignedEmails = Array.from(
      new Set(discoveryPeople.flatMap(p => [p.assignedTo, p.name].filter(Boolean) as string[]))
    ).map(id => `'${this.escapeWiql(id)}'`).join(', ');

    let wiql = `
      SELECT [System.Id], [System.Title], [System.AssignedTo], [System.CreatedDate]
      FROM WorkItems
      WHERE [System.TeamProject] = '${this.escapeWiql(project)}'
        AND [System.WorkItemType] = '${this.escapeWiql(workItemType)}'
        AND [System.State] <> 'Removed'
        AND [System.AssignedTo] IN (${assignedEmails})
      ORDER BY [System.CreatedDate] DESC, [System.Id] DESC
    `;

    let result = await this.client.post<WiqlQueryResult>(
      `/${project}/_apis/wit/wiql?api-version=7.0`,
      { query: wiql }
    );

    // Fallback if IN query yields no results (e.g. test environment or title-only conventions)
    if (!result.workItems || result.workItems.length === 0) {
      wiql = `
        SELECT [System.Id], [System.Title], [System.AssignedTo], [System.CreatedDate]
        FROM WorkItems
        WHERE [System.TeamProject] = '${this.escapeWiql(project)}'
          AND [System.WorkItemType] = '${this.escapeWiql(workItemType)}'
          AND [System.Title] CONTAINS '${this.escapeWiql(titlePrefix)}'
          AND [System.State] <> 'Removed'
        ORDER BY [System.CreatedDate] DESC, [System.Id] DESC
      `;
      result = await this.client.post<WiqlQueryResult>(
        `/${project}/_apis/wit/wiql?api-version=7.0`,
        { query: wiql }
      );
    }

    const personCandidateTasks = new Map<string, DiscoveredTask[]>();

    if (result.workItems && result.workItems.length > 0) {
      if (result.workItems.length > 5000) {
        throw new Error('Too many source task candidates (>5000); narrow the team or task series.');
      }
      const ids = result.workItems.map(w => w.id);
      const CHUNK_SIZE = 100;
      const allFetched: WorkItem[] = [];

      for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
        const chunk = ids.slice(i, i + CHUNK_SIZE).join(',');
        const batchResult = await this.client.get<WorkItemBatchResult>(
          `/${project}/_apis/wit/workitems?ids=${chunk}&$expand=relations&api-version=7.0`
        );
        allFetched.push(...this.requireCompleteBatch(batchResult, ids.slice(i, i + CHUNK_SIZE), 'team source work-item batch'));
      }

      const personFallbackTasks = new Map<string, DiscoveredTask[]>();

      for (const workItem of allFetched) {
        if (isUserStoryOrParentContainer(workItem)) continue;
        const assignedToVal = workItem.fields['System.AssignedTo'];
        for (const person of discoveryPeople) {
          if (matchesPerson(assignedToVal, person)) {
            const title = workItem.fields['System.Title'] || '';
            const prefix = person.titlePrefix || titlePrefix;
            if (matchesTaskSeries(title, prefix)) {
              const parsedDate = parseWorkItemTaskDate(workItem, prefix, this.timezone());
              if (parsedDate.isValid) {
                const list = personCandidateTasks.get(person.key) || [];
                list.push({ workItem, parsedDate, key: person.key });
                personCandidateTasks.set(person.key, list);
              }
            } else {
              // Fallback: check Planned Start Date or non-pipe title formats
              const recorded = extractWorkItemRecordedDate(workItem, this.timezone());
              const parsedDate = parseWorkItemTaskDate(workItem, '', this.timezone(), false, true);
              if (recorded) {
                const list = personFallbackTasks.get(person.key) || [];
                list.push({
                  workItem,
                  parsedDate: {
                    isoDate: recorded.isoDate,
                    formattedTitleDate: parsedDate.isValid ? parsedDate.formattedTitleDate : recorded.isoDate.slice(5),
                    year: recorded.year,
                    isValid: true,
                  },
                  key: person.key,
                });
                personFallbackTasks.set(person.key, list);
              } else if (parsedDate.isValid && !title.includes('|')) {
                const list = personFallbackTasks.get(person.key) || [];
                list.push({ workItem, parsedDate, key: person.key });
                personFallbackTasks.set(person.key, list);
              }
            }
          }
        }
      }

      // If any person had no primary prefix match, use their fallback tasks
      for (const person of discoveryPeople) {
        if (!personCandidateTasks.has(person.key) || personCandidateTasks.get(person.key)!.length === 0) {
          const fallbacks = personFallbackTasks.get(person.key);
          if (fallbacks && fallbacks.length > 0) {
            personCandidateTasks.set(person.key, fallbacks);
          }
        }
      }
    }

    // For each person, take the task with latest date
    const personTasks = new Map<string, DiscoveredTask>();
    for (const [key, tasks] of personCandidateTasks) {
      tasks.sort((a, b) => b.parsedDate.isoDate.localeCompare(a.parsedDate.isoDate));
      personTasks.set(key, tasks[0]);
    }

    // A default source is not a license to clone another person's work
    // history. Apply it only to members who independently own the task.
    if (defaultSourceTaskId) {
      const workItem = await this.getWorkItem(defaultSourceTaskId);
      for (const person of discoveryPeople) {
        if (personTasks.has(person.key)) continue;
        const prefix = person.titlePrefix || titlePrefix;
        try {
          const parsedDate = validateSourceTaskOwnership(
            workItem, project, workItemType, prefix, person
          );
          personTasks.set(person.key, { workItem, parsedDate, key: person.key });
        } catch {
          // Missing or cross-member default source: report SOURCE_NOT_FOUND
          // in the plan instead of presenting someone else's work as a template.
        }
      }
    }

    for (const [key, task] of personTasks) {
      results.set(key, task);
    }
    return results;
  }

  async getExistingTasksForPerson(
    project: string,
    workItemType: string,
    titlePrefix: string,
    personIdentity: string,
    startDate: string,
    endDate: string
  ): Promise<Map<string, { id: number; title: string; isoDate: string; count?: number }>> {
    let wiql = `
      SELECT [System.Id], [System.Title], [System.AssignedTo], [System.CreatedDate]
      FROM WorkItems
      WHERE [System.TeamProject] = '${this.escapeWiql(project)}'
        AND [System.WorkItemType] = '${this.escapeWiql(workItemType)}'
        AND [System.State] <> 'Removed'
        AND ([System.AssignedTo] = '${this.escapeWiql(personIdentity)}' OR [System.AssignedTo] CONTAINS '${this.escapeWiql(personIdentity)}')
      ORDER BY [System.CreatedDate] DESC, [System.Id] DESC
    `;

    let result = await this.client.post<WiqlQueryResult>(
      `/${project}/_apis/wit/wiql?api-version=7.0`,
      { query: wiql }
    );

    if (!Array.isArray(result?.workItems)) {
      throw new Error('Azure DevOps returned an invalid duplicate-detection WIQL response.');
    }
    if (result.workItems.length === 0) {
      wiql = `
        SELECT [System.Id], [System.Title], [System.AssignedTo], [System.CreatedDate]
        FROM WorkItems
        WHERE [System.TeamProject] = '${this.escapeWiql(project)}'
          AND [System.WorkItemType] = '${this.escapeWiql(workItemType)}'
          AND [System.Title] CONTAINS '${this.escapeWiql(titlePrefix)}'
          AND [System.State] <> 'Removed'
        ORDER BY [System.CreatedDate] DESC, [System.Id] DESC
      `;
      result = await this.client.post<WiqlQueryResult>(
        `/${project}/_apis/wit/wiql?api-version=7.0`,
        { query: wiql }
      );
    }

    if (!Array.isArray(result?.workItems)) {
      throw new Error('Azure DevOps returned an invalid duplicate-detection WIQL response.');
    }
    // Incomplete duplicate coverage can create real duplicate work items.
    if (result.workItems.length > 5000) {
      throw new Error('Too many duplicate-detection candidates (>5000); narrow the task series or member.');
    }
    const existingMap = new Map<string, { id: number; title: string; isoDate: string; count?: number }>();
    
    if (result.workItems && result.workItems.length > 0) {
      const targetPerson = {
        assignedTo: personIdentity,
        name: personIdentity,
        key: personIdentity.toLowerCase().trim(),
      };

      const ids = result.workItems.map(w => w.id);
      const CHUNK_SIZE = 100;
      const allFetched: WorkItem[] = [];

      for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
        const chunk = ids.slice(i, i + CHUNK_SIZE).join(',');
        const batchResult = await this.client.get<WorkItemBatchResult>(
          `/${project}/_apis/wit/workitems?ids=${chunk}&$expand=relations&api-version=7.0`
        );
        allFetched.push(...this.requireCompleteBatch(batchResult, ids.slice(i, i + CHUNK_SIZE), 'duplicate-detection work-item batch'));
      }

      for (const workItem of allFetched) {
        if (isUserStoryOrParentContainer(workItem)) continue;
        if (!matchesPerson(workItem.fields['System.AssignedTo'], targetPerson)) {
          continue;
        }
        const title = workItem.fields['System.Title'] || '';
        let isoDate = '';

        // Prioritize Planned Start Date as primary source of truth
        const planned = extractWorkItemPlannedStartDate(workItem, this.timezone());
        if (planned && (!title.includes('|') || matchesTaskSeries(title, titlePrefix))) {
          isoDate = planned.isoDate;
        } else if (matchesTaskSeries(title, titlePrefix)) {
          const parsed = parseWorkItemTaskDate(workItem, titlePrefix, this.timezone());
          if (parsed.isValid) {
            isoDate = parsed.isoDate;
          } else {
            // Graceful resilience: If the title date parsing was ambiguous or conflicted,
            // fall back to recorded Azure scheduling dates (PlannedStartDate, StartDate, ActualStartDate)
            // or non-pipe title date instead of crashing the entire preview/planning execution.
            const recorded = extractWorkItemRecordedDate(workItem, this.timezone());
            if (recorded) {
              isoDate = recorded.isoDate;
              logger.debug(`Existing Azure task #${workItem.id} in series had ambiguous title date ("${title}"); resolved to recorded Azure date ${isoDate}.`);
            } else {
              const fallbackParsed = parseWorkItemTaskDate(workItem, '', this.timezone(), false, true);
              if (fallbackParsed.isValid) {
                isoDate = fallbackParsed.isoDate;
                logger.debug(`Existing Azure task #${workItem.id} in series had ambiguous title date ("${title}"); resolved to parsed date ${isoDate}.`);
              } else {
                logger.warn(`Could not prove workday for existing Azure task #${workItem.id} ("${title}"); skipping from duplicate map.`);
              }
            }
          }
        } else {
          // If the task does not strictly match the prefix, check its Azure recorded date (e.g. Planned Start Date)
          const recorded = extractWorkItemRecordedDate(workItem, this.timezone());
          if (recorded) {
            isoDate = recorded.isoDate;
          } else if (!title.includes('|')) {
            // Check non-pipe format task title
            const parsed = parseWorkItemTaskDate(workItem, '', this.timezone(), false, true);
            if (parsed.isValid) {
              isoDate = parsed.isoDate;
            }
          }
        }

        if (!isoDate || isoDate < startDate || isoDate > endDate) continue;

        const existing = existingMap.get(isoDate);
        if (existing) {
          existing.count = (existing.count ?? 1) + 1;
        } else {
          existingMap.set(isoDate, { id: workItem.id, title, isoDate, count: 1 });
        }
      }
    }

    return existingMap;
  }

  async findCandidateTasks(
    project: string,
    workItemType: string,
    titlePrefix: string,
    startDate?: string,
    endDate?: string,
    personIdentities?: string[]
  ): Promise<WorkItem[]> {
    // WIQL selects only standard fields. Request work-item details without a
    // rigid field list: custom date fields differ between Azure DevOps projects
    // and asking for an absent Custom.* field makes the entire request fail.
    let whereClause = `[System.TeamProject] = '${this.escapeWiql(project)}'
      AND [System.WorkItemType] = '${this.escapeWiql(workItemType)}'
      AND [System.State] <> 'Removed'`;

    if (personIdentities && personIdentities.length > 0) {
      const assignedList = personIdentities.map(p => `'${this.escapeWiql(p)}'`).join(', ');
      whereClause += ` AND [System.AssignedTo] IN (${assignedList})`;
    } else {
      whereClause += ` AND [System.Title] CONTAINS '${this.escapeWiql(titlePrefix)}'`;
    }

    const queryFor = (where: string) => `
      SELECT [System.Id]
      FROM WorkItems
      WHERE ${where}
      ORDER BY [System.CreatedDate] DESC, [System.Id] DESC
    `;

    try {
      let result = await this.client.post<WiqlQueryResult>(
        `/${project}/_apis/wit/wiql?api-version=7.0`,
        { query: queryFor(whereClause) }
      );

      // Azure identity metadata can differ from stored email/name values.
      // Fall back to project work items only when the scoped query found none;
      // the caller still matches every item to configured members.
      if (Array.isArray(result.workItems) && result.workItems.length === 0 &&
        personIdentities && personIdentities.length > 0) {
        const projectWhere = `[System.TeamProject] = '${this.escapeWiql(project)}'
          AND [System.WorkItemType] = '${this.escapeWiql(workItemType)}'
          AND [System.State] <> 'Removed'`;
        result = await this.client.post<WiqlQueryResult>(
          `/${project}/_apis/wit/wiql?api-version=7.0`,
          { query: queryFor(projectWhere) }
        );
      }

      if (!Array.isArray(result.workItems)) {
        throw new Error('Azure DevOps returned an invalid WIQL result.');
      }
      if (result.workItems.length === 0) return [];

      // Never return a partial list as complete coverage: that can make
      // existing work look missing and trigger accidental duplicate creation.
      if (result.workItems.length > 5000) {
        throw new Error('Too many matching Azure DevOps items (>5000). Narrow the team or query range.');
      }

      const CHUNK_SIZE = 100;
      const items: WorkItem[] = [];
      for (let i = 0; i < result.workItems.length; i += CHUNK_SIZE) {
        const ids = result.workItems.slice(i, i + CHUNK_SIZE).map(w => w.id).join(',');
        const batch = await this.client.get<WorkItemBatchResult>(
          `/${project}/_apis/wit/workitems?ids=${ids}&$expand=relations&api-version=7.0`
        );
        items.push(...this.requireCompleteBatch(batch, result.workItems.slice(i, i + CHUNK_SIZE).map(w => w.id), 'candidate work-item batch'));
      }
      return items;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      // Returning [] here would silently misreport connection/permission errors
      // as genuine "MISSING" tasks in Explorer and EOD.
      throw new Error(`Azure DevOps task discovery failed: ${reason}`);
    }
  }

  async getWorkItem(id: number, options: { fresh?: boolean } = {}): Promise<WorkItem> {
    const cached = this.workItemCache.get(id);
    if (!options.fresh && cached && Date.now() - cached.timestamp < 30000) {
      this.workItemCache.delete(id);
      this.workItemCache.set(id, cached);
      return cached.item;
    }
    const item = await this.client.get<WorkItem>(
      `/_apis/wit/workitems/${id}?$expand=relations&api-version=7.0`
    );
    if (!options.fresh) {
      this.workItemCache.delete(id);
      this.workItemCache.set(id, { item, timestamp: Date.now() });
      while (this.workItemCache.size > 1000) {
        this.workItemCache.delete(this.workItemCache.keys().next().value!);
      }
    }
    return item;
  }

  async createWorkItemWithReconciliation(
    project: string,
    workItemType: string,
    fieldOps: any[],
    reconciliationData: { title: string; assignedTo: string }
  ): Promise<CreatedTask> {
    // First try to create
    try {
      const result = await this.client.post<WorkItem>(
        `/${project}/_apis/wit/workitems/$${encodeURIComponent(workItemType)}?api-version=7.0`,
        fieldOps,
        { headers: { 'Content-Type': 'application/json-patch+json' } }
      );

      return {
        id: result.id,
        title: result.fields['System.Title'] || '',
        isoDate: result.fields['Microsoft.VSTS.Scheduling.StartDate']?.split('T')[0] || '',
        url: `${this.client.baseUrl}/${this.client.organization}/${project}/_workitems/edit/${result.id}`,
      };
    } catch (error: any) {
      // If duplicate error (unlikely with our duplicate detection), try to find existing
      if (error.message.includes('duplicate') || error.message.includes('already exists')) {
        const existing = await this.findExistingByTitleAndAssignee(project, workItemType, reconciliationData);
        if (existing) {
          // Never apply copied relations to a pre-existing item or count it as
          // newly created. A fresh duplicate check must decide the next action.
          throw new Error(`Azure DevOps already has matching work item #${existing.id}. No new task was created; refresh the plan before retrying.`);
        }
      }
      throw error;
    }
  }

  async copyRelations(
    sourceWorkItem: WorkItem,
    targetId: number,
    copyableTypes: string[]
  ): Promise<{ copiedCount: number; failedCount: number; totalRelations: number }> {
    this.workItemCache.delete(targetId);
    const relations = sourceWorkItem.relations || [];
    const copyable = relations.filter(r => copyableTypes.includes(r.rel));
    
    if (copyable.length === 0) {
      return { copiedCount: 0, failedCount: 0, totalRelations: 0 };
    }

    // Batch all relation additions into a single PATCH request for better performance
    const patchOps = copyable.map(relation => ({
      op: 'add',
      path: '/relations/-',
      value: {
        rel: relation.rel,
        url: relation.url,
        // Azure read-backs include computed attributes (e.g. name,
        // isLocked). Do not POST these as though they were writable.
        ...(relation.attributes?.comment
          ? { attributes: { comment: relation.attributes.comment } }
          : {}),
      },
    }));

    try {
      await this.client.patch(
        `/_apis/wit/workitems/${targetId}?api-version=7.0`,
        patchOps,
        { headers: { 'Content-Type': 'application/json-patch+json' } }
      );
      return { copiedCount: copyable.length, failedCount: 0, totalRelations: copyable.length };
    } catch (error) {
      logger.warn(`Relation batch outcome for #${targetId} is unverified; read back existing links before repair. No write replay attempted. ${error instanceof Error ? error.message : String(error)}`);
      return { copiedCount: 0, failedCount: copyable.length, totalRelations: copyable.length };
    } finally {
      this.workItemCache.delete(targetId);
    }
  }

  private async findExistingByTitleAndAssignee(
    project: string,
    workItemType: string,
    data: { title: string; assignedTo: string }
  ): Promise<WorkItem | null> {
    const wiql = `
      SELECT [System.Id]
      FROM WorkItems
      WHERE [System.TeamProject] = '${this.escapeWiql(project)}'
        AND [System.WorkItemType] = '${this.escapeWiql(workItemType)}'
        AND [System.Title] = '${this.escapeWiql(data.title)}'
        AND [System.AssignedTo] CONTAINS '${this.escapeWiql(data.assignedTo)}'
        AND [System.State] <> 'Removed'
    `;

    const result = await this.client.post<WiqlQueryResult>(
      `/${project}/_apis/wit/wiql?api-version=7.0`,
      { query: wiql }
    );

    if (result.workItems && result.workItems.length > 0) {
      return this.getWorkItem(result.workItems[0].id);
    }
    return null;
  }

  async patchWorkItem(
    id: number,
    fieldOps: any[],
    options?: { bypassRules?: boolean }
  ): Promise<WorkItem> {
    const qs = options?.bypassRules ? '?bypassRules=true&api-version=7.0' : '?api-version=7.0';
    this.workItemCache.delete(id);
    try {
      return await this.client.patch<WorkItem>(
        `/_apis/wit/workitems/${id}${qs}`,
        fieldOps,
        { headers: { 'Content-Type': 'application/json-patch+json' } }
      );
    } finally {
      this.workItemCache.delete(id);
    }
  }

  private escapeWiql(value: string): string {
    return value.replace(/'/g, "''");
  }
}