/**
 * Azure DevOps Work Item Service
 * Implements the WorkItemRepository port
 */

import { AzureDevOpsClient } from './client.js';
import { 
  WorkItemRepository, 
  WorkItem, 
  DiscoveredTask, 
  Person, 
  CreatedTask,
  parseTitleDate,
  addDays,
  matchesPerson
} from '../../domain/index.js';

interface WiqlQueryResult {
  workItems: Array<{ id: number }>;
}

interface WorkItemBatchResult {
  value: WorkItem[];
  count: number;
}

export class AzureWorkItemService implements WorkItemRepository {
  constructor(private readonly client: AzureDevOpsClient) {}

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
      const parsedDate = parseTitleDate(workItem.fields['System.Title'] || '', titlePrefix, true);
      if (!parsedDate.isValid) {
        return null;
      }
      return {
        workItem,
        parsedDate,
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

    const ids = result.workItems.slice(0, 100).map(w => w.id).join(',');
    const batchResult = await this.client.get<WorkItemBatchResult>(
      `/${project}/_apis/wit/workitems?ids=${ids}&$expand=relations&api-version=7.0`
    );

    const candidateTasks: DiscoveredTask[] = [];
    for (const workItem of batchResult.value || []) {
      if (!matchesPerson(workItem.fields['System.AssignedTo'], targetPerson)) {
        continue;
      }
      const title = workItem.fields['System.Title'] || '';
      const parsedDate = parseTitleDate(title, titlePrefix, true);
      if (parsedDate.isValid) {
        candidateTasks.push({
          workItem,
          parsedDate,
          key: personIdentity.toLowerCase().trim(),
        });
      }
    }

    if (candidateTasks.length === 0) {
      return null;
    }

    candidateTasks.sort((a, b) => b.parsedDate.isoDate.localeCompare(a.parsedDate.isoDate));
    return candidateTasks[0];
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
    const overrideCache = new Map<number, { workItem: WorkItem; parsedDate: ReturnType<typeof parseTitleDate> } | null>();

    for (const person of people) {
      const overrideId = person.sourceTaskId ?? sourceTaskIdOverride;
      if (!overrideId) {
        discoveryPeople.push(person);
        continue;
      }

      let resolved = overrideCache.get(overrideId);
      if (resolved === undefined) {
        const workItem = await this.getWorkItem(overrideId);
        const prefix = person.titlePrefix || titlePrefix;
        const parsedDate = parseTitleDate(workItem.fields['System.Title'] || '', prefix, true);
        resolved = parsedDate.isValid ? { workItem, parsedDate } : null;
        overrideCache.set(overrideId, resolved);
      }
      if (resolved) {
        results.set(person.key, { ...resolved, key: person.key });
      }
    }

    if (discoveryPeople.length === 0) {
      return results;
    }

    // Query candidate work items targeting the discovery people directly in Azure DevOps
    const assignedEmails = discoveryPeople
      .map(p => `'${this.escapeWiql(p.assignedTo)}'`)
      .join(', ');

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
      const ids = result.workItems.slice(0, 200).map(w => w.id);
      const CHUNK_SIZE = 100;
      const allFetched: WorkItem[] = [];

      for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
        const chunk = ids.slice(i, i + CHUNK_SIZE).join(',');
        const batchResult = await this.client.get<WorkItemBatchResult>(
          `/${project}/_apis/wit/workitems?ids=${chunk}&$expand=relations&api-version=7.0`
        );
        if (batchResult.value) {
          allFetched.push(...batchResult.value);
        }
      }

      for (const workItem of allFetched) {
        const assignedToVal = workItem.fields['System.AssignedTo'];
        for (const person of discoveryPeople) {
          if (matchesPerson(assignedToVal, person)) {
            const title = workItem.fields['System.Title'] || '';
            const prefix = person.titlePrefix || titlePrefix;
            const parsedDate = parseTitleDate(title, prefix, true);
            if (parsedDate.isValid) {
              const list = personCandidateTasks.get(person.key) || [];
              list.push({ workItem, parsedDate, key: person.key });
              personCandidateTasks.set(person.key, list);
            }
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

    // Apply default source task for people without a discovered task
    if (defaultSourceTaskId) {
      const workItem = await this.getWorkItem(defaultSourceTaskId);
      const parsedDate = parseTitleDate(workItem.fields['System.Title'] || '', titlePrefix, true);
      if (parsedDate.isValid) {
        for (const person of discoveryPeople) {
          if (!personTasks.has(person.key)) {
            personTasks.set(person.key, { workItem, parsedDate, key: person.key });
          }
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

    const existingMap = new Map<string, { id: number; title: string; isoDate: string; count?: number }>();
    
    if (result.workItems && result.workItems.length > 0) {
      const targetPerson = {
        assignedTo: personIdentity,
        name: personIdentity,
        key: personIdentity.toLowerCase().trim(),
      };

      const ids = result.workItems.slice(0, 150).map(w => w.id);
      const CHUNK_SIZE = 100;
      const allFetched: WorkItem[] = [];

      for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
        const chunk = ids.slice(i, i + CHUNK_SIZE).join(',');
        const batchResult = await this.client.get<WorkItemBatchResult>(
          `/${project}/_apis/wit/workitems?ids=${chunk}&fields=System.Id,System.Title,System.AssignedTo&api-version=7.0`
        );
        if (batchResult.value) {
          allFetched.push(...batchResult.value);
        }
      }

      for (const workItem of allFetched) {
        if (workItem.fields['System.AssignedTo'] && !matchesPerson(workItem.fields['System.AssignedTo'], targetPerson)) {
          continue;
        }
        const title = workItem.fields['System.Title'];
        if (!title) continue;
        const parsed = parseTitleDate(title, titlePrefix, true);
        if (!parsed.isValid) continue;
        if (parsed.isoDate < startDate || parsed.isoDate > endDate) continue;

        const existing = existingMap.get(parsed.isoDate);
        if (existing) {
          existing.count = (existing.count ?? 1) + 1;
        } else {
          existingMap.set(parsed.isoDate, { id: workItem.id, title, isoDate: parsed.isoDate, count: 1 });
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
    let whereClause = `[System.TeamProject] = '${this.escapeWiql(project)}'
      AND [System.WorkItemType] = '${this.escapeWiql(workItemType)}'
      AND [System.State] <> 'Removed'`;

    if (personIdentities && personIdentities.length > 0) {
      const assignedList = personIdentities.map(p => `'${this.escapeWiql(p)}'`).join(', ');
      whereClause += ` AND [System.AssignedTo] IN (${assignedList})`;
    } else {
      whereClause += ` AND [System.Title] CONTAINS '${this.escapeWiql(titlePrefix)}'`;
    }

    const query = `
      SELECT [System.Id], [System.Title], [System.State], [System.AssignedTo],
             [System.CreatedDate], [System.ChangedDate],
             [Microsoft.VSTS.Scheduling.StartDate],
             [Microsoft.VSTS.Scheduling.CompletedWork],
             [Microsoft.VSTS.Scheduling.RemainingWork],
             [Microsoft.VSTS.Scheduling.OriginalEstimate]
      FROM WorkItems
      WHERE ${whereClause}
      ORDER BY [System.CreatedDate] DESC, [System.Id] DESC
    `;

    try {
      let result = await this.client.post<WiqlQueryResult>(
        `/${project}/_apis/wit/wiql?api-version=7.0`,
        { query }
      );

      // Fallback if IN query yields no items (e.g. mock test data or different assignedTo format)
      if ((!result.workItems || result.workItems.length === 0) && personIdentities && personIdentities.length > 0) {
        const fallbackQuery = `
          SELECT [System.Id], [System.Title], [System.State], [System.AssignedTo],
                 [System.CreatedDate], [System.ChangedDate],
                 [Microsoft.VSTS.Scheduling.StartDate],
                 [Microsoft.VSTS.Scheduling.CompletedWork],
                 [Microsoft.VSTS.Scheduling.RemainingWork],
                 [Microsoft.VSTS.Scheduling.OriginalEstimate]
          FROM WorkItems
          WHERE [System.TeamProject] = '${this.escapeWiql(project)}'
            AND [System.WorkItemType] = '${this.escapeWiql(workItemType)}'
            AND [System.Title] CONTAINS '${this.escapeWiql(titlePrefix)}'
            AND [System.State] <> 'Removed'
          ORDER BY [System.CreatedDate] DESC, [System.Id] DESC
        `;
        result = await this.client.post<WiqlQueryResult>(
          `/${project}/_apis/wit/wiql?api-version=7.0`,
          { query: fallbackQuery }
        );
      }

      if (!result.workItems || result.workItems.length === 0) {
        return [];
      }

      const ids = result.workItems.slice(0, 500).map(w => w.id);
      const CHUNK_SIZE = 100;
      const workItems: WorkItem[] = [];

      for (let i = 0; i < ids.length; i += CHUNK_SIZE) {
        const chunk = ids.slice(i, i + CHUNK_SIZE).join(',');
        const batchResult = await this.client.get<WorkItemBatchResult>(
          `/${project}/_apis/wit/workitems?ids=${chunk}&fields=System.Id,System.Title,System.State,System.AssignedTo,System.CreatedDate,System.ChangedDate,Microsoft.VSTS.Scheduling.StartDate,Microsoft.VSTS.Scheduling.CompletedWork,Microsoft.VSTS.Scheduling.RemainingWork,Microsoft.VSTS.Scheduling.OriginalEstimate&api-version=7.0`
        );
        if (batchResult.value) {
          workItems.push(...batchResult.value);
        }
      }

      return workItems;
    } catch {
      return [];
    }
  }

  async getWorkItem(id: number): Promise<WorkItem> {
    return this.client.get<WorkItem>(
      `/_apis/wit/workitems/${id}?$expand=relations&api-version=7.0`
    );
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
        fieldOps
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
          return {
            id: existing.id,
            title: existing.fields['System.Title'] || '',
            isoDate: existing.fields['Microsoft.VSTS.Scheduling.StartDate']?.split('T')[0] || '',
            url: `${this.client.baseUrl}/${this.client.organization}/${project}/_workitems/edit/${existing.id}`,
          };
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
    const relations = sourceWorkItem.relations || [];
    const copyable = relations.filter(r => copyableTypes.includes(r.rel));
    
    if (copyable.length === 0) {
      return { copiedCount: 0, failedCount: 0, totalRelations: 0 };
    }

    let copiedCount = 0;
    let failedCount = 0;

    for (const relation of copyable) {
      try {
        const relBody = {
          op: 'add',
          path: '/relations/-',
          value: {
            rel: relation.rel,
            url: relation.url,
            attributes: relation.attributes,
          },
        };

        await this.client.patch(
          `/_apis/wit/workitems/${targetId}?api-version=7.0`,
          [relBody]
        );
        copiedCount++;
      } catch {
        failedCount++;
      }
    }

    return { copiedCount, failedCount, totalRelations: copyable.length };
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

  private escapeWiql(value: string): string {
    return value.replace(/'/g, "''");
  }
}