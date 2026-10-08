import { describe, it, expect } from 'vitest';
import { WorkItem } from '../src/azure/types.js';
import { PersonConfig } from '../src/config/config.js';
import { planCreationDates } from '../src/date/date-engine.js';
import { parseDateFromTitle } from '../src/date/parser.js';
import { DuplicateDetector } from '../src/task/duplicate-detector.js';

describe('Duplicate Detector — Assignee Isolation & Multi-Task Handling', () => {
  const people: PersonConfig[] = [
    { name: 'Rahul', assignedTo: 'rahul@company.com' },
    { name: 'Priya', assignedTo: 'priya@company.com' },
    { name: 'Amit', assignedTo: 'amit@company.com' },
  ];

  it('allows identical dates across different people while preventing duplicates for the same person', () => {
    const detector = new DuplicateDetector();

    const rahulTask: WorkItem = {
      id: 101,
      rev: 1,
      fields: {
        'System.Title': '3in1_PWA_MyAccount | 12 Oct',
        'System.AssignedTo': 'rahul@company.com',
      },
      url: '',
    };

    const parsed12Oct = parseDateFromTitle('3in1_PWA_MyAccount | 12 Oct', '2026-10-01')!;

    // Register Rahul's 12 Oct task
    detector.registerExistingTask(rahulTask, parsed12Oct, people);

    // 1. Rahul on 12 Oct: MUST be duplicate!
    expect(detector.isDuplicate(people[0], '2026-10-12')).toBe(true);
    expect(detector.getExistingTaskIds(people[0], '2026-10-12')).toEqual([101]);

    // 2. Priya on 12 Oct: MUST NOT be duplicate! (Person isolation)
    expect(detector.isDuplicate(people[1], '2026-10-12')).toBe(false);
    expect(detector.getExistingTaskIds(people[1], '2026-10-12')).toEqual([]);

    // 3. Register Priya's 12 Oct task
    const priyaTask: WorkItem = {
      id: 201,
      rev: 1,
      fields: {
        'System.Title': '3in1_PWA_MyAccount | 12 Oct',
        'System.AssignedTo': 'priya@company.com',
      },
      url: '',
    };
    detector.registerExistingTask(priyaTask, parsed12Oct, people);

    // Now Priya also has a duplicate for 12 Oct
    expect(detector.isDuplicate(people[1], '2026-10-12')).toBe(true);
    expect(detector.getExistingTaskIds(people[1], '2026-10-12')).toEqual([201]);
  });

  it('distinguishes DUPLICATE_ALREADY_EXISTS and MULTIPLE_EXISTING_TASKS per person', () => {
    const detector = new DuplicateDetector();
    const parsed12Oct = parseDateFromTitle('3in1_PWA_MyAccount | 12 Oct', '2026-10-01')!;

    // Rahul has 1 task on 12 Oct (#101)
    detector.registerExistingTask(
      {
        id: 101,
        rev: 1,
        fields: {
          'System.Title': '3in1_PWA_MyAccount | 12 Oct',
          'System.AssignedTo': 'rahul@company.com',
        },
        url: '',
      },
      parsed12Oct,
      people
    );

    // Priya has 0 tasks on 12 Oct

    // Amit has 2 duplicate tasks on 12 Oct (#301, #302)
    detector.registerExistingTask(
      {
        id: 301,
        rev: 1,
        fields: {
          'System.Title': '3in1_PWA_MyAccount | 12 Oct',
          'System.AssignedTo': 'amit@company.com',
        },
        url: '',
      },
      parsed12Oct,
      people
    );
    detector.registerExistingTask(
      {
        id: 302,
        rev: 1,
        fields: {
          'System.Title': '3in1_PWA_MyAccount | 12 Oct',
          'System.AssignedTo': 'amit@company.com',
        },
        url: '',
      },
      parsed12Oct,
      people
    );

    // Evaluate plan for Rahul:
    const rahulPlan = planCreationDates({
      todayIso: '2026-10-12', // Monday 12 Oct
      latestExistingTaskIso: '2026-10-09',
      existingTasksMap: detector.getPersonDateMap(people[0]),
    });
    const rahul12Oct = rahulPlan.plannedDates.find((d) => d.isoDate === '2026-10-12')!;
    expect(rahul12Oct.status).toBe('DUPLICATE_ALREADY_EXISTS');
    expect(rahul12Oct.existingWorkItemIds).toEqual([101]);

    // Evaluate plan for Priya:
    const priyaPlan = planCreationDates({
      todayIso: '2026-10-12',
      latestExistingTaskIso: '2026-10-09',
      existingTasksMap: detector.getPersonDateMap(people[1]),
    });
    const priya12Oct = priyaPlan.plannedDates.find((d) => d.isoDate === '2026-10-12')!;
    expect(priya12Oct.status).toBe('PLANNED'); // Task missing -> CREATE

    // Evaluate plan for Amit:
    const amitPlan = planCreationDates({
      todayIso: '2026-10-12',
      latestExistingTaskIso: '2026-10-09',
      existingTasksMap: detector.getPersonDateMap(people[2]),
    });
    const amit12Oct = amitPlan.plannedDates.find((d) => d.isoDate === '2026-10-12')!;
    expect(amit12Oct.status).toBe('MULTIPLE_EXISTING_TASKS');
    expect(amit12Oct.existingWorkItemIds).toEqual([301, 302]);
  });

  it('Section Exact Rule: Rahul (exists -> SKIP), Priya (missing -> CREATE), Amit (exists -> SKIP)', () => {
    const detector = new DuplicateDetector();
    const parsed12Oct = parseDateFromTitle('3in1_PWA_MyAccount | 12 Oct', '2026-10-01')!;

    // Rahul has 12 Oct task #101
    detector.registerExistingTask(
      {
        id: 101,
        rev: 1,
        fields: {
          'System.Title': '3in1_PWA_MyAccount | 12 Oct',
          'System.AssignedTo': 'rahul@company.com',
        },
        url: '',
      },
      parsed12Oct,
      people
    );

    // Amit has 12 Oct task #301
    detector.registerExistingTask(
      {
        id: 301,
        rev: 1,
        fields: {
          'System.Title': '3in1_PWA_MyAccount | 12 Oct',
          'System.AssignedTo': 'amit@company.com',
        },
        url: '',
      },
      parsed12Oct,
      people
    );

    // Priya has NO task on 12 Oct

    // Evaluate all 3 independently across the window 12 Oct -> 15 Oct:
    const rahulPlan = planCreationDates({
      todayIso: '2026-10-12',
      latestExistingTaskIso: '2026-10-09',
      existingTasksMap: detector.getPersonDateMap(people[0]),
    });
    const rahul12 = rahulPlan.plannedDates.find((d) => d.formattedTitleDate === '12 Oct')!;
    expect(rahul12.status).toBe('DUPLICATE_ALREADY_EXISTS');
    // Continues remaining dates for Rahul: 13, 14, 15 Oct are PLANNED
    const rahulRemaining = rahulPlan.plannedDates.filter((d) => d.status === 'PLANNED');
    expect(rahulRemaining.map((d) => d.formattedTitleDate)).toEqual(['13 Oct', '14 Oct', '15 Oct']);

    const priyaPlan = planCreationDates({
      todayIso: '2026-10-12',
      latestExistingTaskIso: '2026-10-09',
      existingTasksMap: detector.getPersonDateMap(people[1]),
    });
    const priya12 = priyaPlan.plannedDates.find((d) => d.formattedTitleDate === '12 Oct')!;
    expect(priya12.status).toBe('PLANNED'); // CREATE
    // All 4 dates planned for Priya:
    const priyaAll = priyaPlan.plannedDates.filter((d) => d.status === 'PLANNED');
    expect(priyaAll.map((d) => d.formattedTitleDate)).toEqual(['12 Oct', '13 Oct', '14 Oct', '15 Oct']);

    const amitPlan = planCreationDates({
      todayIso: '2026-10-12',
      latestExistingTaskIso: '2026-10-09',
      existingTasksMap: detector.getPersonDateMap(people[2]),
    });
    const amit12 = amitPlan.plannedDates.find((d) => d.formattedTitleDate === '12 Oct')!;
    expect(amit12.status).toBe('DUPLICATE_ALREADY_EXISTS');
    // Continues remaining dates for Amit: 13, 14, 15 Oct are PLANNED
    const amitRemaining = amitPlan.plannedDates.filter((d) => d.status === 'PLANNED');
    expect(amitRemaining.map((d) => d.formattedTitleDate)).toEqual(['13 Oct', '14 Oct', '15 Oct']);
  });
});
