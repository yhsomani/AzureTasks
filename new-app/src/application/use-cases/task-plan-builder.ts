/**
 * Task Plan Builder
 * Responsibilities: Planning dates, detecting duplicates, building task plans
 * Extracted from CreateTasksUseCase (~250 LOC)
 */

import { Person } from '../../domain/entities/person.js';
import { 
  DiscoveredTask, 
  matchesTaskSeries,
  parseTitleDate,
  extractTitlePrefix,
} from '../../domain/entities/task.js';
import { 
  DuplicateDetector, 
  DatePlanningService,
} from '../../domain/services/task-services.js';
import { 
  PlannedDate,
} from '../../domain/value-objects/date-window.js';
import { AppConfig } from '../../domain/ports/repositories.js';
import { TaskDiscoveryService } from '../../domain/services/task-services.js';

export interface PersonExecutionPlan {
  person: Person;
  sourceTask: DiscoveredTask | null;
  status: 'READY' | 'SOURCE_NOT_FOUND' | 'FUTURE_TASK_WARN' | 'NO_TASKS_NEEDED';
  statusMessage?: string;
  effectiveStartDate: string;
  nextThursday: string;
  plannedDates: PlannedDate[];
}

export class TaskPlanBuilder {
  private readonly datePlanning: DatePlanningService;
  private readonly duplicateDetector: DuplicateDetector;

  constructor(
    private readonly discovery: TaskDiscoveryService,
    private readonly config: AppConfig
  ) {
    this.datePlanning = new DatePlanningService();
    this.duplicateDetector = new DuplicateDetector();
  }

  /**
   * Select people to process based on input criteria
   */
  selectPeople(
    personKeys?: string[],
    all?: boolean
  ): Person[] {
    const allPeople = this.config.people
      .filter(p => p.enabled !== false)
      .map(p => new Person(p));

    if (all || (!personKeys && !all)) {
      return allPeople;
    }

    if (personKeys && personKeys.length > 0) {
      const selected = allPeople.filter(p => personKeys!.includes(p.key));
      if (selected.length !== personKeys.length) {
        const found = selected.map(p => p.key);
        const missing = personKeys.filter(k => !found.includes(k));
        throw new Error(`People not found: ${missing.join(', ')}`);
      }
      return selected;
    }

    return [];
  }

  /**
   * Build execution plans for all people
   */
  async buildPlans(
    people: Person[],
    discoveredTasks: Map<string, DiscoveredTask>,
    todayIso: string,
    thursdayMode: 'CURRENT' | 'FOLLOWING'
  ): Promise<PersonExecutionPlan[]> {
    const nextThursdayIso = this.datePlanning.getNextThursdayIso(todayIso, thursdayMode, this.config.stopDayOfWeek);
    const plans: PersonExecutionPlan[] = [];

    for (const person of people) {
      const discovered = discoveredTasks.get(person.key);
      
      if (!discovered) {
        plans.push({
          person,
          sourceTask: null,
          status: 'SOURCE_NOT_FOUND',
          statusMessage: `No valid source task found for ${person.name}.`,
          effectiveStartDate: todayIso,
          nextThursday: nextThursdayIso,
          plannedDates: [],
        });
        continue;
      }

      const personPrefix = person.titlePrefix || extractTitlePrefix(discovered.workItem.fields['System.Title'] || '') || this.config.titlePrefix;
      const plan = this.datePlanning.planForPerson(
        person,
        discovered,
        todayIso,
        personPrefix,
        thursdayMode,
        this.config.skipWeekends,
        this.config.stopDayOfWeek,
        this.duplicateDetector
      );

      const toCreate = plan.plannedDates.filter(d => d.status === 'PLANNED');
      let status: PersonExecutionPlan['status'] = toCreate.length > 0 ? 'READY' : 'NO_TASKS_NEEDED';
      let statusMsg = plan.warningMessage;

      if (toCreate.length === 0 && !statusMsg) {
        statusMsg = `All working dates up to date (latest task: ${discovered.parsedDate.formattedTitleDate}).`;
      }

      if (discovered.parsedDate.isoDate > nextThursdayIso && toCreate.length === 0) {
        status = 'FUTURE_TASK_WARN';
        statusMsg = `Latest task date (${discovered.parsedDate.isoDate}) is ahead of creation window ending on Thursday (${nextThursdayIso}).`;
      }

      plans.push({
        person,
        sourceTask: discovered,
        status,
        statusMessage: statusMsg,
        effectiveStartDate: plan.effectiveStartDate,
        nextThursday: plan.nextThursday,
        plannedDates: plan.plannedDates,
      });
    }

    return plans;
  }

  /**
   * Populate duplicate detection maps for all people
   */
  async populateDuplicateMaps(
    people: Person[],
    startDate: string,
    endDate: string
  ): Promise<void> {
    for (const person of people) {
      const personPrefix = person.titlePrefix || this.config.titlePrefix;
      const existingMap = await this.discovery.getExistingTasksMap(
        this.config.project,
        this.config.workItemType,
        personPrefix,
        person,
        startDate,
        endDate
      );
      this.duplicateDetector.setPersonDateMap(person.key, existingMap);
    }
  }

  /**
   * Recalculate plans with duplicate detection information
   */
  recalculatePlans(
    plans: PersonExecutionPlan[],
    todayIso: string,
    thursdayMode: 'CURRENT' | 'FOLLOWING'
  ): PersonExecutionPlan[] {
    return plans.map(plan => {
      if (!plan.sourceTask) return plan;
      
      const personPrefix = plan.person.titlePrefix || extractTitlePrefix(plan.sourceTask.workItem.fields['System.Title'] || '') || this.config.titlePrefix;
      const newPlan = this.datePlanning.planForPerson(
        plan.person,
        plan.sourceTask,
        todayIso,
        personPrefix,
        thursdayMode,
        this.config.skipWeekends,
        this.config.stopDayOfWeek,
        this.duplicateDetector
      );
      
      const toCreate = newPlan.plannedDates.filter(d => d.status === 'PLANNED');
      let status: PersonExecutionPlan['status'] = toCreate.length > 0 ? 'READY' : 'NO_TASKS_NEEDED';
      let statusMsg = newPlan.warningMessage;

      if (toCreate.length === 0 && !statusMsg) {
        statusMsg = `All working dates up to date (latest task: ${plan.sourceTask.parsedDate.formattedTitleDate}).`;
      }

      if (plan.sourceTask.parsedDate.isoDate > plan.nextThursday && toCreate.length === 0) {
        status = 'FUTURE_TASK_WARN';
        statusMsg = `Latest task date (${plan.sourceTask.parsedDate.isoDate}) is ahead of creation window ending on Thursday (${plan.nextThursday}).`;
      }

      return {
        ...plan,
        status,
        statusMessage: statusMsg,
        plannedDates: newPlan.plannedDates,
        effectiveStartDate: newPlan.effectiveStartDate,
      };
    });
  }

  /**
   * Get the duplicate detector instance
   */
  getDuplicateDetector(): DuplicateDetector {
    return this.duplicateDetector;
  }

  /**
   * Get the date planning service
   */
  getDatePlanningService(): DatePlanningService {
    return this.datePlanning;
  }
}
