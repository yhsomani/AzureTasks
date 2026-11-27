import { describe, expect, it, vi } from 'vitest';
import { GetMemberTasksUseCase } from '../../src/application/use-cases/get-member-tasks.js';
import type { AppConfig, WorkItemRepository } from '../../src/domain/ports/repositories.js';

const config: AppConfig = {
  organization: 'ExampleOrg',
  project: 'Example Project',
  baseUrl: 'https://dev.azure.com',
  workItemType: 'Task',
  taskSeries: '3in1',
  titlePrefix: '3in1 |',
  timezone: 'Asia/Kolkata',
  startTime: '09:30',
  thursdayMode: 'CURRENT',
  skipWeekends: true,
  stopDay: 'Thursday',
  stopDayOfWeek: 4,
  defaultState: 'To Do',
  autoClose: false,
  copyEstimates: true,
  resetActualWork: true,
  maxRetries: 3,
  initialRetryDelayMs: 1000,
  people: [
    {
      key: 'vishal',
      name: 'Vishal Shinde',
      assignedTo: 'vishal@example.com',
      aliases: ['vishal.legacy@example.com'],
      enabled: true,
    },
    {
      key: 'inactive',
      name: 'Inactive Person',
      assignedTo: 'inactive@example.com',
      enabled: false,
    },
  ],
  schedulerEnabled: false,
};

describe('GetMemberTasksUseCase', () => {
  it('returns all matching states without applying date or title-series filtering', async () => {
    const findCandidateTasks = vi.fn(async () => [
      {
        id: 901,
        rev: 1,
        fields: {
          'System.Title': 'Historical task without a date title',
          'System.State': 'Closed',
          'System.AssignedTo': {
            displayName: 'Vishal Shinde',
            uniqueName: 'vishal@example.com',
          },
          'Microsoft.VSTS.Scheduling.CompletedWork': 4,
          'Microsoft.VSTS.Scheduling.OriginalEstimate': 4,
        },
      },
      {
        id: 902,
        rev: 1,
        fields: {
          'System.Title': 'Open task',
          'System.State': 'Active',
          'System.AssignedTo': 'vishal.legacy@example.com',
          'Microsoft.VSTS.Scheduling.RemainingWork': 2,
        },
      },
      {
        id: 903,
        rev: 1,
        fields: {
          'System.Title': 'Another member task',
          'System.State': 'Active',
          'System.AssignedTo': 'other@example.com',
        },
      },
    ]);
    const repo = { findCandidateTasks } as unknown as WorkItemRepository;
    const useCase = new GetMemberTasksUseCase(repo, config);

    const tasks = await useCase.execute('VISHAL');

    expect(findCandidateTasks).toHaveBeenCalledWith(
      'Example Project',
      'Task',
      '3in1 |',
      undefined,
      undefined,
      ['vishal@example.com', 'vishal', 'vishal.legacy@example.com', 'Vishal Shinde'],
    );
    expect(tasks).toEqual([
      {
        id: 901,
        title: 'Historical task without a date title',
        state: 'Closed',
        assignedTo: 'Vishal Shinde',
        remainingWork: undefined,
        completedWork: 4,
        originalEstimate: 4,
        url: 'https://dev.azure.com/ExampleOrg/Example Project/_workitems/edit/901',
      },
      {
        id: 902,
        title: 'Open task',
        state: 'Active',
        assignedTo: 'vishal.legacy@example.com',
        remainingWork: 2,
        completedWork: undefined,
        originalEstimate: undefined,
        url: 'https://dev.azure.com/ExampleOrg/Example Project/_workitems/edit/902',
      },
    ]);
  });

  it('rejects unknown and disabled members without querying Azure', async () => {
    const findCandidateTasks = vi.fn();
    const useCase = new GetMemberTasksUseCase(
      { findCandidateTasks } as unknown as WorkItemRepository,
      config,
    );

    await expect(useCase.execute('missing')).rejects.toMatchObject({ statusCode: 404 });
    await expect(useCase.execute('inactive')).rejects.toMatchObject({ statusCode: 404 });
    expect(findCandidateTasks).not.toHaveBeenCalled();
  });

  it('propagates Azure discovery failures instead of returning an empty list', async () => {
    const findCandidateTasks = vi.fn().mockRejectedValue(new Error('Azure unavailable'));
    const useCase = new GetMemberTasksUseCase(
      { findCandidateTasks } as unknown as WorkItemRepository,
      config,
    );

    await expect(useCase.execute('vishal')).rejects.toThrow('Azure unavailable');
  });
});
