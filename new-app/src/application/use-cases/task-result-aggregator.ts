/**
 * Task Result Aggregator
 * Responsibilities: Result formatting, output building, error summarization
 * Extracted from CreateTasksUseCase (~200 LOC)
 */

import { Person } from '../../domain/entities/person.js';
import { PlannedDate } from '../../domain/value-objects/date-window.js';
import { TaskPlanBuilder, PersonExecutionPlan } from './task-plan-builder.js';

export interface PersonExecutionResult {
  person: Person;
  sourceTaskId?: number;
  sourceTaskDate?: string;
  status: 'SUCCESS' | 'PARTIAL' | 'SOURCE_FAILED' | 'FAILED' | 'SKIPPED';
  createdTasks: any[]; // CreatedTask[]
  duplicateSkips: PlannedDate[];
  weekendSkips: PlannedDate[];
  failedTasks: PlannedDate[];
  relationsProcessed: number;
  relationsFailed: number;
  auditWarnings?: string[];
}

export interface CreateTasksOutput {
  peopleProcessedCount: number;
  totalCreatedCount: number;
  totalDuplicateCount: number;
  totalWeekendSkipCount: number;
  totalSourceFailureCount: number;
  totalTaskFailureCount: number;
  totalRelationFailureCount: number;
  personResults: PersonExecutionResult[];
}

export class TaskResultAggregator {
  /**
   * Build final output from execution plans and results
   */
  buildOutput(
    plans: PersonExecutionPlan[],
    resultsMap: Map<string, PersonExecutionResult>
  ): CreateTasksOutput {
    let totalCreated = 0;
    let totalDuplicates = 0;
    let totalWeekends = 0;
    let totalSourceFailures = 0;
    let totalTaskFailures = 0;
    let totalRelationFailures = 0;

    const personResults: PersonExecutionResult[] = [];

    for (const plan of plans) {
      const res = resultsMap.get(plan.person.key);

      if (plan.status === 'SOURCE_NOT_FOUND') {
        totalSourceFailures++;
      }

      const dupCount = plan.plannedDates.filter(d => 
        ['DUPLICATE', 'DUPLICATE_ALREADY_EXISTS', 'MULTIPLE_EXISTING_TASKS'].includes(d.status)
      ).length;
      const wCount = plan.plannedDates.filter(d => d.status === 'WEEKEND_SKIP').length;
      totalDuplicates += dupCount;
      totalWeekends += wCount;

      if (res) {
        totalCreated += res.createdTasks.length;
        totalTaskFailures += res.failedTasks.length;
        totalRelationFailures += res.relationsFailed;
        personResults.push(res);
      } else {
        personResults.push({
          person: plan.person,
          sourceTaskId: plan.sourceTask?.workItem.id,
          sourceTaskDate: plan.sourceTask?.parsedDate.formattedTitleDate,
          status: plan.status === 'SOURCE_NOT_FOUND' ? 'SOURCE_FAILED' : 'SKIPPED',
          createdTasks: [],
          duplicateSkips: plan.plannedDates.filter(d => 
            ['DUPLICATE', 'DUPLICATE_ALREADY_EXISTS', 'MULTIPLE_EXISTING_TASKS'].includes(d.status)
          ),
          weekendSkips: plan.plannedDates.filter(d => d.status === 'WEEKEND_SKIP'),
          failedTasks: [],
          relationsProcessed: 0,
          relationsFailed: 0,
        });
      }
    }

    return {
      peopleProcessedCount: plans.length,
      totalCreatedCount: totalCreated,
      totalDuplicateCount: totalDuplicates,
      totalWeekendSkipCount: totalWeekends,
      totalSourceFailureCount: totalSourceFailures,
      totalTaskFailureCount: totalTaskFailures,
      totalRelationFailureCount: totalRelationFailures,
      personResults,
    };
  }

  /**
   * Aggregate execution results for multiple people
   */
  aggregateResults(results: PersonExecutionResult[]): CreateTasksOutput {
    let totalCreated = 0;
    let totalDuplicates = 0;
    let totalWeekends = 0;
    let totalSourceFailures = 0;
    let totalTaskFailures = 0;
    let totalRelationFailures = 0;

    for (const res of results) {
      if (res.status === 'SOURCE_FAILED') totalSourceFailures++;
      totalCreated += res.createdTasks.length;
      totalDuplicates += res.duplicateSkips.length;
      totalWeekends += res.weekendSkips.length;
      totalTaskFailures += res.failedTasks.length;
      totalRelationFailures += res.relationsFailed;
    }

    return {
      peopleProcessedCount: results.length,
      totalCreatedCount: totalCreated,
      totalDuplicateCount: totalDuplicates,
      totalWeekendSkipCount: totalWeekends,
      totalSourceFailureCount: totalSourceFailures,
      totalTaskFailureCount: totalTaskFailures,
      totalRelationFailureCount: totalRelationFailures,
      personResults: results,
    };
  }

  /**
   * Format execution summary as human-readable text
   */
  formatExecutionSummary(output: CreateTasksOutput): string {
    const lines: string[] = [
      '',
      '========================================',
      'TASK CREATION SUMMARY',
      '========================================',
      `People processed: ${output.peopleProcessedCount}`,
      `Total created: ${output.totalCreatedCount}`,
      `Duplicates skipped: ${output.totalDuplicateCount}`,
      `Weekends skipped: ${output.totalWeekendSkipCount}`,
      `Source failures: ${output.totalSourceFailureCount}`,
      `Task failures: ${output.totalTaskFailureCount}`,
      `Relation failures: ${output.totalRelationFailureCount}`,
      '========================================',
      '',
    ];

    return lines.join('\n');
  }

  /**
   * Format plan as human-readable text
   */
  formatPlan(plans: PersonExecutionPlan[], totalToCreate: number, startTime: string, timezone: string): string {
    const lines: string[] = [
      '',
      '========================================',
      'TASK CREATION PLAN',
      '========================================',
      `People: ${plans.length}`,
      `Tasks to create: ${totalToCreate}`,
      '',
    ];

    for (const plan of plans) {
      const createList = plan.plannedDates.filter(d => d.status === 'PLANNED');
      if (createList.length > 0) {
        lines.push(`${plan.person.name} (${plan.person.assignedTo}):`);
        for (const item of createList) {
          lines.push(`  - ${item.fullTitle} (${startTime} ${timezone})`);
        }
      } else {
        lines.push(`${plan.person.name}: 0 tasks (${plan.statusMessage || 'All dates up to date'})`);
      }
    }
    lines.push('========================================');
    lines.push('');

    return lines.join('\n');
  }
}
