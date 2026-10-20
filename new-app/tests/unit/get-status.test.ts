import { describe, it, expect, vi, afterEach } from 'vitest';
import { GetSystemStatusUseCase } from '../../src/application/use-cases/get-status';
import { WorkItemRepository, AppConfig } from '../../src/domain/ports/repositories';

describe('GetSystemStatusUseCase', () => {
  const originalEnvPat = process.env.AZURE_DEVOPS_PAT;

  const mockConfig: AppConfig = {
    organization: 'TestOrg',
    project: 'TestProject',
    baseUrl: 'https://dev.azure.com',
    workItemType: '3in1 Task',
    taskSeries: '3in1',
    titlePrefix: '3in1 |',
    startTime: '09:30',
    timezone: 'Asia/Kolkata',
    skipWeekends: true,
    stopDay: 'Thursday',
    stopDayOfWeek: 4,
    thursdayMode: 'CURRENT',
    defaultState: 'To Do',
    autoClose: false,
    copyEstimates: true,
    resetActualWork: true,
    maxRetries: 3,
    initialRetryDelayMs: 1000,
    people: [],
    schedulerEnabled: false,
  };

  afterEach(() => {
    if (originalEnvPat !== undefined) {
      process.env.AZURE_DEVOPS_PAT = originalEnvPat;
    } else {
      delete process.env.AZURE_DEVOPS_PAT;
    }
  });

  it('reports healthy connection when PAT is configured and project/type validate', async () => {
    process.env.AZURE_DEVOPS_PAT = 'test_token_secret_1234';

    const mockRepo: Partial<WorkItemRepository> = {
      validateProject: vi.fn(async () => {}),
      validateWorkItemType: vi.fn(async () => {}),
    };

    const useCase = new GetSystemStatusUseCase(mockRepo as WorkItemRepository, mockConfig);
    const result = await useCase.execute();

    expect(result.connected).toBe(true);
    expect(result.projectValid).toBe(true);
    expect(result.workItemTypeValid).toBe(true);
    expect(result.patConfigured).toBe(true);
    expect(result.patMasked).toBe('test...1234');
    expect(result.organization).toBe('TestOrg');
    expect(result.project).toBe('TestProject');
    expect(result.errorMessage).toBeUndefined();
  });

  it('reports disconnected when PAT is empty or missing', async () => {
    delete process.env.AZURE_DEVOPS_PAT;

    const mockRepo: Partial<WorkItemRepository> = {
      validateProject: vi.fn(),
      validateWorkItemType: vi.fn(),
    };

    const useCase = new GetSystemStatusUseCase(mockRepo as WorkItemRepository, mockConfig);
    const result = await useCase.execute();

    expect(result.connected).toBe(false);
    expect(result.patConfigured).toBe(false);
    expect(result.patMasked).toBe('');
    expect(result.errorMessage).toContain('AZURE_DEVOPS_PAT is not configured');
    expect(mockRepo.validateProject).not.toHaveBeenCalled();
  });

  it('handles validation failure gracefully and reports error message', async () => {
    process.env.AZURE_DEVOPS_PAT = 'secret_pat_9999';

    const mockRepo: Partial<WorkItemRepository> = {
      validateProject: vi.fn(async () => {
        throw new Error('Project "TestProject" not found');
      }),
      validateWorkItemType: vi.fn(),
    };

    const useCase = new GetSystemStatusUseCase(mockRepo as WorkItemRepository, mockConfig);
    const result = await useCase.execute();

    expect(result.connected).toBe(false);
    expect(result.projectValid).toBe(false);
    expect(result.errorMessage).toBe('Project "TestProject" not found');
  });
});
