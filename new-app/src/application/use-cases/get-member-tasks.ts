import {
  extractIdentity,
  getPersonIdentityAliases,
  matchesPerson,
} from '../../domain/entities/person.js';
import type { AppConfig, WorkItemRepository } from '../../domain/ports/repositories.js';

export interface MemberTaskSummary {
  id: number;
  title: string;
  state: string;
  assignedTo: string;
  remainingWork?: number;
  completedWork?: number;
  originalEstimate?: number;
  url: string;
}

export class ConfiguredMemberNotFoundError extends Error {
  readonly statusCode = 404;

  constructor(personKey: string) {
    super(`Enabled team member "${personKey}" was not found.`);
    this.name = 'ConfiguredMemberNotFoundError';
  }
}

function readHours(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

export class GetMemberTasksUseCase {
  constructor(
    private readonly workItemRepo: WorkItemRepository,
    private readonly config: AppConfig,
  ) {}

  async execute(personKey: string): Promise<MemberTaskSummary[]> {
    const normalizedKey = personKey.trim().toLowerCase();
    if (!normalizedKey) {
      throw new Error('A team member key is required.');
    }

    const person = (this.config.people || []).find(
      member => member.enabled !== false && member.key.trim().toLowerCase() === normalizedKey,
    );
    if (!person) {
      throw new ConfiguredMemberNotFoundError(personKey);
    }

    const identities = Array.from(new Set([
      ...getPersonIdentityAliases(person),
      person.name,
    ].filter(Boolean)));
    const workItems = await this.workItemRepo.findCandidateTasks(
      this.config.project,
      this.config.workItemType,
      this.config.titlePrefix,
      undefined,
      undefined,
      identities,
    );
    const baseUrl = (this.config.baseUrl || 'https://dev.azure.com').replace(/\/+$/, '');

    return workItems
      .filter(item => matchesPerson(item.fields['System.AssignedTo'], person))
      .map(item => {
        const identity = extractIdentity(item.fields['System.AssignedTo']);
        const fields = item.fields;
        return {
          id: item.id,
          title: String(fields['System.Title'] || `Work item ${item.id}`),
          state: String(fields['System.State'] || 'Unknown'),
          assignedTo: identity?.displayName || identity?.uniqueName || person.name,
          remainingWork: readHours(fields['Microsoft.VSTS.Scheduling.RemainingWork']),
          completedWork: readHours(fields['Microsoft.VSTS.Scheduling.CompletedWork']),
          originalEstimate: readHours(fields['Microsoft.VSTS.Scheduling.OriginalEstimate']),
          url: `${baseUrl}/${this.config.organization}/${this.config.project}/_workitems/edit/${item.id}`,
        };
      });
  }
}
