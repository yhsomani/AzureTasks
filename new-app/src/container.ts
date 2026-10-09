/**
 * Composition Root
 * Wires infrastructure adapters to application use cases.
 */

import { AzureDevOpsClient } from './infrastructure/azure/client.js';
import { AzureWorkItemService } from './infrastructure/azure/work-item-service.js';
import { FileConfigRepository } from './infrastructure/config/file-config-repo.js';
import { FileJournalRepository } from './infrastructure/journal/file-journal-repo.js';
import { FileLockRepository } from './infrastructure/lock/file-lock-repo.js';
import { NodeSchedulerRepository } from './infrastructure/scheduler/node-scheduler-repo.js';
import { CreateTasksUseCase, CreateTasksInput, CreateTasksOutput, ProgressEvent } from './application/use-cases/create-tasks.js';
import { PlanTasksUseCase, PlanTasksInput, PlanTasksOutput } from './application/use-cases/plan-tasks.js';
import { GetSystemStatusUseCase, SystemStatusOutput } from './application/use-cases/get-status.js';
import { ConfigUseCases } from './application/use-cases/config.js';
import { RepairRelationsUseCase } from './application/use-cases/repair-relations.js';
import { AppConfig } from './domain/ports/repositories.js';
import { logger } from './infrastructure/logging/logger.js';

export interface App {
  config: AppConfig;
  createTasks: CreateTasksUseCase;
  planTasks: PlanTasksUseCase;
  getStatus: GetSystemStatusUseCase;
  configUseCases: ConfigUseCases;
  repairRelations: RepairRelationsUseCase;
  journal: FileJournalRepository;
  scheduler: NodeSchedulerRepository;
}

/**
 * Build the application container.
 * The PAT is read from the environment; the config is loaded from disk.
 */
export async function buildApp(configFilePath?: string): Promise<App> {
  const configRepo = new FileConfigRepository(configFilePath);
  const config = await configRepo.load();

  const pat = process.env.AZURE_DEVOPS_PAT?.trim() || '';
  if (pat) logger.registerSecret(pat);

  // Pass the live config object (not a snapshot) so organization/baseUrl edits
  // take effect without a restart; the PAT is resolved from the environment at
  // request time for the same reason.
  const client = new AzureDevOpsClient(config);

  const workItemRepo = new AzureWorkItemService(client);
  const journalRepo = new FileJournalRepository();
  const lockRepo = new FileLockRepository();
  const schedulerRepo = new NodeSchedulerRepository(config);

  const createTasks = new CreateTasksUseCase(workItemRepo, journalRepo, lockRepo, config);
  const planTasks = new PlanTasksUseCase(workItemRepo, config);
  const getStatus = new GetSystemStatusUseCase(workItemRepo, journalRepo, schedulerRepo, config);
  const configUseCases = new ConfigUseCases(configRepo, config);
  const repairRelations = new RepairRelationsUseCase(workItemRepo, journalRepo);

  // Wire scheduler to run task creation
  schedulerRepo.setScheduleFunction(async () => {
    const result = await createTasks.execute({ all: true, yes: true });
    if (result.totalTaskFailureCount > 0) {
      throw new Error(`${result.totalTaskFailureCount} task(s) failed`);
    }
  });

  return {
    config,
    createTasks,
    planTasks,
    getStatus,
    configUseCases,
    repairRelations,
    journal: journalRepo,
    scheduler: schedulerRepo,
  };
}

export type { CreateTasksInput, CreateTasksOutput, ProgressEvent, PlanTasksInput, PlanTasksOutput, SystemStatusOutput };
