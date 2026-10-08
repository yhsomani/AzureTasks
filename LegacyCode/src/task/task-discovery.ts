/**
 * Person-level source task discovery service for Azure DevOps work items.
 *
 * For each configured person, discovers that person's chronologically latest
 * dated task independently, respecting per-person source overrides.
 */

import { WorkItem } from '../azure/types.js';
import { WiqlService } from '../azure/wiql-service.js';
import { WorkItemService } from '../azure/work-item-service.js';
import { PersonConfig } from '../config/config.js';
import { parseDateFromTitle } from '../date/parser.js';
import { ParsedDateInfo } from '../date/types.js';
import { matchesPerson } from '../people/person-service.js';
import { logger } from '../utils/logger.js';
import { DuplicateDetector } from './duplicate-detector.js';

export interface DiscoveredTask {
  workItem: WorkItem;
  parsedDate: ParsedDateInfo;
}

export interface PersonDiscovery {
  person: PersonConfig;
  sourceTask: DiscoveredTask | null;
  allPersonTasks: DiscoveredTask[];
  status: 'FOUND' | 'SOURCE_NOT_FOUND' | 'AMBIGUOUS';
  errorMessage?: string;
}

export interface MultiPersonDiscoveryResult {
  personDiscoveries: Map<string, PersonDiscovery>;
  duplicateDetector: DuplicateDetector;
  allProjectWorkItems: WorkItem[];
}

export class TaskDiscoveryService {
  constructor(
    private readonly wiqlService: WiqlService,
    private readonly workItemService: WorkItemService
  ) {}

  /**
   * Discovers candidate source tasks for all specified people independently.
   */
  public async discoverForPeople(
    project: string,
    workItemType: string,
    titlePrefix: string,
    people: PersonConfig[],
    globalSourceOverrideId?: number,
    defaultSourceTaskId?: number
  ): Promise<MultiPersonDiscoveryResult> {
    logger.info(`Searching project '${project}' for '${workItemType}' work items...`);

    // 1. Query all work items matching title prefix
    const candidateIds = await this.wiqlService.findCandidateSourceTasks(
      project,
      workItemType,
      titlePrefix
    );

    logger.debug(`WIQL query returned ${candidateIds.length} candidate work item IDs`);

    // Also include any per-person or global source overrides or default source task
    for (const p of people) {
      if (p.sourceTaskId && !candidateIds.includes(p.sourceTaskId)) {
        candidateIds.push(p.sourceTaskId);
      }
    }
    if (globalSourceOverrideId && !candidateIds.includes(globalSourceOverrideId)) {
      candidateIds.push(globalSourceOverrideId);
    }
    if (defaultSourceTaskId && !candidateIds.includes(defaultSourceTaskId)) {
      candidateIds.push(defaultSourceTaskId);
    }

    const duplicateDetector = new DuplicateDetector();
    const personDiscoveries = new Map<string, PersonDiscovery>();

    if (candidateIds.length === 0) {
      for (const person of people) {
        personDiscoveries.set(duplicateDetector.getPersonKey(person), {
          person,
          sourceTask: null,
          allPersonTasks: [],
          status: 'SOURCE_NOT_FOUND',
          errorMessage: `No work items found matching '${titlePrefix}' in project '${project}'.`,
        });
      }
      return {
        personDiscoveries,
        duplicateDetector,
        allProjectWorkItems: [],
      };
    }

    // 2. Fetch full work item details in batch
    const allFetched = await this.workItemService.getWorkItemsBatch(candidateIds, 'all');

    // Strict Team Management filter: only include work items assigned to configured team members or explicit templates
    const allWorkItems = allFetched.filter((item) => {
      const isTemplate =
        Boolean(globalSourceOverrideId && item.id === globalSourceOverrideId) ||
        Boolean(defaultSourceTaskId && item.id === defaultSourceTaskId) ||
        people.some((p) => p.sourceTaskId === item.id);
      if (isTemplate) return true;
      return people.some((p) => matchesPerson(item.fields['System.AssignedTo'], p));
    });

    // 3. Register all valid dated work items into duplicate detector
    for (const item of allWorkItems) {
      const title = String(item.fields['System.Title'] || '');
      const createdDate = item.fields['System.CreatedDate'] as string | undefined;
      const parsed = parseDateFromTitle(title, createdDate);
      if (parsed) {
        duplicateDetector.registerExistingTask(item, parsed, people);
      }
    }

    // 4. For each person, independently find that person's latest source task
    for (const person of people) {
      const pKey = duplicateDetector.getPersonKey(person);
      const effectiveOverrideId = person.sourceTaskId || globalSourceOverrideId;

      // Handle explicit source override for this person
      if (effectiveOverrideId) {
        logger.info(`Using source override #${effectiveOverrideId} for ${person.name}`);
        let overrideItem = allWorkItems.find((w) => w.id === effectiveOverrideId);

        if (!overrideItem) {
          try {
            overrideItem = await this.workItemService.getWorkItem(effectiveOverrideId, 'all');
          } catch (err) {
            personDiscoveries.set(pKey, {
              person,
              sourceTask: null,
              allPersonTasks: [],
              status: 'SOURCE_NOT_FOUND',
              errorMessage: `Override work item #${effectiveOverrideId} could not be retrieved: ${
                err instanceof Error ? err.message : String(err)
              }`,
            });
            continue;
          }
        }

        // Validate override work item
        const itemProj = String(overrideItem.fields['System.TeamProject'] || '');
        const itemType = String(overrideItem.fields['System.WorkItemType'] || '');
        const itemTitle = String(overrideItem.fields['System.Title'] || '');
        const itemCreated = overrideItem.fields['System.CreatedDate'] as string | undefined;

        if (itemProj.toLowerCase() !== project.toLowerCase()) {
          personDiscoveries.set(pKey, {
            person,
            sourceTask: null,
            allPersonTasks: [],
            status: 'SOURCE_NOT_FOUND',
            errorMessage: `Override task #${effectiveOverrideId} belongs to project '${itemProj}', expected '${project}'.`,
          });
          continue;
        }

        if (itemType.toLowerCase() !== workItemType.toLowerCase()) {
          personDiscoveries.set(pKey, {
            person,
            sourceTask: null,
            allPersonTasks: [],
            status: 'SOURCE_NOT_FOUND',
            errorMessage: `Override task #${effectiveOverrideId} is of type '${itemType}', expected '${workItemType}'.`,
          });
          continue;
        }

        const parsed = parseDateFromTitle(itemTitle, itemCreated);
        if (!parsed) {
          personDiscoveries.set(pKey, {
            person,
            sourceTask: null,
            allPersonTasks: [],
            status: 'SOURCE_NOT_FOUND',
            errorMessage: `Override task #${effectiveOverrideId} title "${itemTitle}" does not follow date format '${titlePrefix} <D MMM>'.`,
          });
          continue;
        }

        personDiscoveries.set(pKey, {
          person,
          sourceTask: { workItem: overrideItem, parsedDate: parsed },
          allPersonTasks: [{ workItem: overrideItem, parsedDate: parsed }],
          status: 'FOUND',
        });
        continue;
      }

      // Automatic discovery for this person: filter tasks assigned to this person
      const personTasks: DiscoveredTask[] = [];

      for (const item of allWorkItems) {
        if (!matchesPerson(item.fields['System.AssignedTo'], person)) {
          continue;
        }

        const title = String(item.fields['System.Title'] || '');
        const createdDate = item.fields['System.CreatedDate'] as string | undefined;
        const parsed = parseDateFromTitle(title, createdDate);

        if (parsed) {
          personTasks.push({
            workItem: item,
            parsedDate: parsed,
          });
        }
      }

      if (personTasks.length === 0) {
        if (defaultSourceTaskId) {
          logger.info(`Using default template task #${defaultSourceTaskId} for ${person.name}`);
          let defaultItem = allWorkItems.find((w) => w.id === defaultSourceTaskId);
          if (!defaultItem) {
            try {
              defaultItem = await this.workItemService.getWorkItem(defaultSourceTaskId, 'all');
            } catch (err: any) {
              logger.warn(`Failed to fetch default template task #${defaultSourceTaskId}: ${err.message}`);
            }
          }
          if (defaultItem) {
            const defaultTitle = String(defaultItem.fields['System.Title'] || '');
            const defaultCreated = defaultItem.fields['System.CreatedDate'] as string | undefined;
            const parsed = parseDateFromTitle(defaultTitle, defaultCreated);
            if (parsed) {
              personDiscoveries.set(pKey, {
                person,
                sourceTask: { workItem: defaultItem, parsedDate: parsed },
                allPersonTasks: [],
                status: 'FOUND',
              });
              continue;
            }
          }
        }

        logger.warn(`No existing dated tasks found for ${person.name} (${person.assignedTo})`);
        personDiscoveries.set(pKey, {
          person,
          sourceTask: null,
          allPersonTasks: [],
          status: 'SOURCE_NOT_FOUND',
          errorMessage: `No valid existing source task found for ${person.name} (${person.assignedTo}).`,
        });
        continue;
      }

      // Sort strictly chronologically by parsed date
      personTasks.sort((a, b) => {
        if (a.parsedDate.isoDate !== b.parsedDate.isoDate) {
          return a.parsedDate.isoDate.localeCompare(b.parsedDate.isoDate);
        }
        return a.workItem.id - b.workItem.id; // Deterministic tie-breaker
      });

      const latest = personTasks[personTasks.length - 1];

      // Check if multiple tasks for this person share the latest date
      const sameDateTasks = personTasks.filter(
        (t) => t.parsedDate.isoDate === latest.parsedDate.isoDate
      );
      if (sameDateTasks.length > 1) {
        logger.warn(
          `Multiple tasks found for ${person.name} with latest date ${latest.parsedDate.formattedTitleDate}: ${sameDateTasks
            .map((t) => `#${t.workItem.id}`)
            .join(', ')}. Selected #${latest.workItem.id} deterministically.`
        );
      }

      personDiscoveries.set(pKey, {
        person,
        sourceTask: latest,
        allPersonTasks: personTasks,
        status: 'FOUND',
      });
    }

    return {
      personDiscoveries,
      duplicateDetector,
      allProjectWorkItems: allWorkItems,
    };
  }
}
