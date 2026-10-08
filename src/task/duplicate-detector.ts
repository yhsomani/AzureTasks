/**
 * Assignee-aware duplicate detector for Azure DevOps work items.
 *
 * Ensures that tasks are scoped by Person + Date.
 * Identical titles across different assignees are legitimate independent tasks.
 */

import { WorkItem } from '../azure/types.js';
import { PersonConfig } from '../config/config.js';
import { ParsedDateInfo } from '../date/types.js';
import { matchesPerson } from '../people/person-service.js';

export class DuplicateDetector {
  // Map of Person Name/Email -> (Map of ISO Date -> Work Item IDs)
  private readonly personTaskMap = new Map<string, Map<string, number[]>>();

  /**
   * Generates a stable key for a person
   */
  public getPersonKey(person: PersonConfig): string {
    return person.assignedTo.toLowerCase().trim();
  }

  /**
   * Registers an existing work item for the matching person
   */
  public registerExistingTask(
    item: WorkItem,
    parsedDate: ParsedDateInfo,
    configuredPeople: PersonConfig[]
  ): void {
    const assignedToVal = item.fields['System.AssignedTo'];

    for (const person of configuredPeople) {
      if (matchesPerson(assignedToVal, person)) {
        const pKey = this.getPersonKey(person);
        let dateMap = this.personTaskMap.get(pKey);
        if (!dateMap) {
          dateMap = new Map();
          this.personTaskMap.set(pKey, dateMap);
        }

        const ids = dateMap.get(parsedDate.isoDate) || [];
        if (!ids.includes(item.id)) {
          ids.push(item.id);
        }
        dateMap.set(parsedDate.isoDate, ids);
      }
    }
  }

  /**
   * Gets existing task IDs for a specific person on a specific date
   */
  public getExistingTaskIds(person: PersonConfig, isoDate: string): number[] {
    const pKey = this.getPersonKey(person);
    const dateMap = this.personTaskMap.get(pKey);
    if (!dateMap) {
      return [];
    }
    return dateMap.get(isoDate) || [];
  }

  /**
   * Checks if a task already exists for a specific person on a specific date
   */
  public isDuplicate(person: PersonConfig, isoDate: string): boolean {
    return this.getExistingTaskIds(person, isoDate).length > 0;
  }

  /**
   * Returns a date-to-IDs map for a specific person
   */
  public getPersonDateMap(person: PersonConfig): Map<string, number[]> {
    const pKey = this.getPersonKey(person);
    return this.personTaskMap.get(pKey) || new Map();
  }
}
