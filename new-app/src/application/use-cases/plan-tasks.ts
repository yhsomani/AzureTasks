/**
 * Plan Tasks Use Case
 * Generates a preview of what tasks would be created without actually creating them
 */

import { WorkItemRepository, AppConfig } from '../../domain/ports/repositories.js';
import { Person } from '../../domain/entities/person.js';
import { DiscoveredTask, extractTitlePrefix } from '../../domain/entities/task.js';
import { TaskDiscoveryService, DuplicateDetector, DatePlanningService } from '../../domain/services/task-services.js';
import { validateNotPastDate } from '../../domain/value-objects/date-window.js';
import { PersonExecutionPlan } from './create-tasks.js';

export interface PlanTasksInput {
  personKeys?: string[];
  all?: boolean;
  asOf?: string;
  thursdayMode?: 'CURRENT' | 'FOLLOWING';
}

export interface PlanTasksOutput {
  todayIso: string;
  nextThursdayIso: string;
  personPlans: PersonExecutionPlan[];
}

export class PlanTasksUseCase {
  private readonly discovery: TaskDiscoveryService;
  private readonly duplicateDetector: DuplicateDetector;
  private readonly datePlanning: DatePlanningService;

  constructor(
    private readonly workItemRepo: WorkItemRepository,
    private readonly config: AppConfig
  ) {
    this.discovery = new TaskDiscoveryService(workItemRepo);
    this.duplicateDetector = new DuplicateDetector();
    this.datePlanning = new DatePlanningService();
  }

  async execute(input: PlanTasksInput = {}): Promise<PlanTasksOutput> {
    const people = this.selectPeople(input);
    if (people.length === 0) {
      throw new Error('No people selected for planning');
    }

    const actualTodayIso = this.datePlanning.getTodayIso(this.config.timezone);
    const configuredTodayIso = input?.asOf || actualTodayIso;
    validateNotPastDate(configuredTodayIso, actualTodayIso);
    
    const todayIso = configuredTodayIso;
    // Effective window mode: request override wins over persisted config.
    const thursdayMode = input?.thursdayMode ?? this.config.thursdayMode;
    const nextThursdayIso = this.datePlanning.getNextThursdayIso(todayIso, thursdayMode, this.config.stopDayOfWeek);

    // Discover source tasks
    const discoveredTasks = await this.discovery.discoverForPeople(
      this.config.project,
      this.config.workItemType,
      this.config.titlePrefix,
      people,
      undefined,
      this.config.defaultSourceTaskId
    );

    // Get existing tasks for duplicate detection
    for (const person of people) {
      const personPrefix = person.titlePrefix || this.config.titlePrefix;
      const existingMap = await this.discovery.getExistingTasksMap(
        this.config.project,
        this.config.workItemType,
        personPrefix,
        person,
        todayIso,
        nextThursdayIso
      );
      this.duplicateDetector.setPersonDateMap(person.key, existingMap);
    }

    // Build plans
    const personPlans = this.buildPlans(people, discoveredTasks, todayIso, thursdayMode);

    return { todayIso, nextThursdayIso, personPlans };
  }

  private selectPeople(input: PlanTasksInput): Person[] {
    const allPeople = this.config.people
      .filter(p => p.enabled !== false)
      .map(p => new Person(p));

    if (input.all || (!input.personKeys && !input.all)) {
      return allPeople;
    }

    if (input.personKeys && input.personKeys.length > 0) {
      return allPeople.filter(p => input.personKeys!.includes(p.key));
    }

    return [];
  }

  private buildPlans(
    people: Person[],
    discoveredTasks: Map<string, DiscoveredTask>,
    todayIso: string,
    thursdayMode: 'CURRENT' | 'FOLLOWING'
  ): PersonExecutionPlan[] {
    const nextThursdayIso = this.datePlanning.getNextThursdayIso(todayIso, thursdayMode, this.config.stopDayOfWeek);
    return people.map(person => {
      const discovered = discoveredTasks.get(person.key);
      
      if (!discovered) {
        return {
          person,
          sourceTask: null,
          status: 'SOURCE_NOT_FOUND' as const,
          statusMessage: `No valid source task found for ${person.name}.`,
          effectiveStartDate: todayIso,
          nextThursday: nextThursdayIso,
          plannedDates: [],
        };
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

      return {
        person,
        sourceTask: discovered,
        status,
        statusMessage: statusMsg,
        effectiveStartDate: plan.effectiveStartDate,
        nextThursday: plan.nextThursday,
        plannedDates: plan.plannedDates,
      };
    });
  }
}