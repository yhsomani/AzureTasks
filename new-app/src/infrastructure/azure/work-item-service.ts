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
  addDays
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
    await this.client.get<any>(`/${project}/_apis/projects/${project}?api-version=7.0`);
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
      const parsedDate = parseTitleDate(workItem.fields['System.Title'] || '', titlePrefix);
      if (!parsedDate.isValid) {
        return null;
      }
      return {
        workItem,
        parsedDate,
        key: personIdentity.toLowerCase().trim(),
      };
    }

    // Query for latest task matching prefix for this person
    const wiql = `
      SELECT [System.Id]
      FROM WorkItems
      WHERE [System.WorkItemType] = '${this.escapeWiql(workItemType)}'
        AND [System.Title] LIKE '${this.escapeWiql(titlePrefix)}%'
        AND [System.AssignedTo] = '${this.escapeWiql(personIdentity)}'
        AND [System.State] <> 'Removed'
      ORDER BY [Microsoft.VSTS.Scheduling.StartDate] DESC, [System.Id] DESC
    `;

    const result = await this.client.post<WiqlQueryResult>(
      `/${project}/_apis/wit/wiql?api-version=7.0`,
      { query: wiql }
    );

    if (!result.workItems || result.workItems.length === 0) {
      return null;
    }

    // Get the latest task
    const latestId = result.workItems[0].id;
    const workItem = await this.getWorkItem(latestId);
    const parsedDate = parseTitleDate(workItem.fields['System.Title'] || '', titlePrefix);
    
    if (!parsedDate.isValid) {
      return null;
    }

    return {
      workItem,
      parsedDate,
      key: personIdentity.toLowerCase().trim(),
    };
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

    // Resolve explicit source overrides first. A per-person sourceTaskId wins
    // over the global override; everyone else is discovered via WIQL. Work
    // items shared by several people (e.g. a global override) are fetched once.
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
        const parsedDate = parseTitleDate(workItem.fields['System.Title'] || '', titlePrefix);
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

    // Build a query for the remaining people at once
    const identities = discoveryPeople.map(p => `'${this.escapeWiql(p.assignedTo)}'`).join(',');
    
    const wiql = `
      SELECT [System.Id], [System.AssignedTo], [System.Title], [Microsoft.VSTS.Scheduling.StartDate]
      FROM WorkItems
      WHERE [System.WorkItemType] = '${this.escapeWiql(workItemType)}'
        AND [System.Title] LIKE '${this.escapeWiql(titlePrefix)}%'
        AND [System.AssignedTo] IN (${identities})
        AND [System.State] <> 'Removed'
      ORDER BY [System.AssignedTo], [Microsoft.VSTS.Scheduling.StartDate] DESC, [System.Id] DESC
    `;

    const result = await this.client.post<WiqlQueryResult>(
      `/${project}/_apis/wit/wiql?api-version=7.0`,
      { query: wiql }
    );

    // Group by person and take the latest for each
    const personTasks = new Map<string, DiscoveredTask>();

    const resolvePersonKey = (assignedTo: any): string | null => {
      const unique = (assignedTo?.uniqueName || '').trim().toLowerCase();
      const display = (assignedTo?.displayName || '').trim().toLowerCase();
      for (const person of discoveryPeople) {
        const id = person.assignedTo.trim().toLowerCase();
        if (id === unique || id === display || person.name.trim().toLowerCase() === display) {
          return person.key;
        }
      }
      return null;
    };

    if (result.workItems && result.workItems.length > 0) {
      // Get full work items for the found IDs (batch)
      const ids = result.workItems.map(w => w.id).join(',');
      const batchResult = await this.client.get<WorkItemBatchResult>(
        `/${project}/_apis/wit/workitems?ids=${ids}&$expand=relations&api-version=7.0`
      );

      for (const workItem of batchResult.value || []) {
        const personKey = resolvePersonKey(workItem.fields['System.AssignedTo']);
        if (!personKey) continue;
        if (!personTasks.has(personKey)) {
          const title = workItem.fields['System.Title'] || '';
          const parsedDate = parseTitleDate(title, titlePrefix);
          if (parsedDate.isValid) {
            personTasks.set(personKey, { workItem, parsedDate, key: personKey });
          }
        }
      }
    }

    // Apply default source task for people without a discovered task
    if (defaultSourceTaskId) {
      const workItem = await this.getWorkItem(defaultSourceTaskId);
      const parsedDate = parseTitleDate(workItem.fields['System.Title'] || '', titlePrefix);
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
    // StartDate is stored as the UTC instant of 09:30 local; in timezones ahead
    // of UTC that instant lands on the previous UTC day. Filter one day wider
    // than the window and key the result by the title date so nothing is missed.
    const wiql = `
      SELECT [System.Id], [System.Title], [Microsoft.VSTS.Scheduling.StartDate]
      FROM WorkItems
      WHERE [System.WorkItemType] = '${this.escapeWiql(workItemType)}'
        AND [System.Title] LIKE '${this.escapeWiql(titlePrefix)}%'
        AND [System.AssignedTo] = '${this.escapeWiql(personIdentity)}'
        AND [Microsoft.VSTS.Scheduling.StartDate] >= '${addDays(startDate, -1)}'
        AND [Microsoft.VSTS.Scheduling.StartDate] < '${addDays(endDate, 1)}'
        AND [System.State] <> 'Removed'
      ORDER BY [Microsoft.VSTS.Scheduling.StartDate] ASC
    `;

    const result = await this.client.post<WiqlQueryResult>(
      `/${project}/_apis/wit/wiql?api-version=7.0`,
      { query: wiql }
    );

    const existingMap = new Map<string, { id: number; title: string; isoDate: string; count?: number }>();
    
    if (result.workItems && result.workItems.length > 0) {
      const ids = result.workItems.map(w => w.id).join(',');
      const batchResult = await this.client.get<WorkItemBatchResult>(
        `/${project}/_apis/wit/workitems?ids=${ids}&fields=System.Title,Microsoft.VSTS.Scheduling.StartDate&api-version=7.0`
      );

      for (const workItem of batchResult.value || []) {
        const title = workItem.fields['System.Title'];
        if (!title) continue;
        // Derive the date from the title, not the UTC StartDate instant, so the
        // map key matches the planned local date regardless of timezone offset.
        const parsed = parseTitleDate(title, titlePrefix);
        if (!parsed.isValid) continue;
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
      WHERE [System.WorkItemType] = '${this.escapeWiql(workItemType)}'
        AND [System.Title] = '${this.escapeWiql(data.title)}'
        AND [System.AssignedTo] = '${this.escapeWiql(data.assignedTo)}'
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
    return value.replace(/'/g, "''").replace(/\[/g, '[[]').replace(/\]/g, '[]]');
  }
}