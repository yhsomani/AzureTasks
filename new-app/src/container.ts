/**
 * Composition Root
 * Wires infrastructure adapters to application use cases.
 */

import * as path from 'node:path';
import * as dotenv from 'dotenv';
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
import { ExploreTasksUseCase, ExploreTasksInput, ExploreTasksOutput } from './application/use-cases/explore-tasks.js';
import { CloseDailyTasksUseCase, CloseDailyTasksInput, CloseDailyTasksOutput } from './application/use-cases/close-daily-tasks.js';
import { GitHubClient } from './infrastructure/github/github-client.js';
import { DatePlanningService } from './domain/index.js';
import { AppConfig } from './domain/ports/repositories.js';
import { logger } from './infrastructure/logging/logger.js';
import { assertTlsSafety } from './infrastructure/security/tls-safety.js';

export interface App {
  config: AppConfig;
  createTasks: CreateTasksUseCase;
  planTasks: PlanTasksUseCase;
  exploreTasks: ExploreTasksUseCase;
  getStatus: GetSystemStatusUseCase;
  configUseCases: ConfigUseCases;
  repairRelations: RepairRelationsUseCase;
  closeDailyTasks: CloseDailyTasksUseCase;
  githubClient: GitHubClient;
  journal: FileJournalRepository;
  scheduler: NodeSchedulerRepository;
}

/**
 * Build the application container.
 * The PAT is read from the environment; the config is loaded from disk.
 */
export async function buildApp(
  configFilePath?: string,
  options: { autoStartScheduler?: boolean } = {}
): Promise<App> {
  // A user-supplied --config may live outside the current working directory.
  // Load its adjacent .env before constructing clients, while preserving
  // explicitly injected deployment environment variables.
  if (configFilePath) {
    const resolved = path.resolve(process.cwd(), configFilePath);
    dotenv.config({ path: path.join(path.dirname(resolved), '.env'), override: false, quiet: true });
  }

  // Defense-in-depth: enforce strict TLS safety regardless of invocation pathway
  assertTlsSafety();

  const configRepo = new FileConfigRepository(configFilePath);
  const config = await configRepo.load();

  const pat = process.env.AZURE_DEVOPS_PAT?.trim() || '';
  if (pat) logger.registerSecret(pat);

  const ghToken = (config.githubToken || process.env.GITHUB_TOKEN || process.env.GH_PAT)?.trim() || '';
  if (ghToken) logger.registerSecret(ghToken);

  const authSecret = process.env.API_AUTH_TOKEN?.trim() || '';
  if (authSecret) logger.registerSecret(authSecret);

  // Pass the live config object (not a snapshot) so organization/baseUrl edits
  // take effect without a restart; the PAT is resolved from the environment at
  // request time for the same reason.
  const client = new AzureDevOpsClient(config);

  const workItemRepo = new AzureWorkItemService(client, () => config.timezone);
  const journalRepo = new FileJournalRepository();
  const lockRepo = new FileLockRepository();
  const schedulerRepo = new NodeSchedulerRepository(config, configRepo);
  const datePlanning = new DatePlanningService();

  const githubClient = new GitHubClient({
    get token() { return config.githubToken || process.env.GITHUB_TOKEN || process.env.GH_PAT; },
    get org() { return config.githubOrg || process.env.GITHUB_ORG; },
    apiUrl: config.githubApiUrl,
    get userSuffix() { return config.githubUserSuffix ?? process.env.GITHUB_USER_SUFFIX ?? '_bflghec'; },
  });

  const createTasks = new CreateTasksUseCase(workItemRepo, journalRepo, lockRepo, config);
  const planTasks = new PlanTasksUseCase(workItemRepo, config);
  const exploreTasks = new ExploreTasksUseCase(workItemRepo, config);
  const getStatus = new GetSystemStatusUseCase(workItemRepo, config);
  const configUseCases = new ConfigUseCases(configRepo, config);
  const repairRelations = new RepairRelationsUseCase(workItemRepo, journalRepo, lockRepo);
  const closeDailyTasks = new CloseDailyTasksUseCase(
    config,
    workItemRepo,
    datePlanning,
    githubClient,
    configRepo,
    journalRepo,
    lockRepo
  );

  // Wire scheduler to run task creation
  schedulerRepo.setScheduleFunction(async () => {
    const result = await createTasks.execute({ all: true, yes: true });
    if (result.totalTaskFailureCount > 0 || result.totalRelationFailureCount > 0 ||
      result.personResults.some(p => (p.auditWarnings?.length ?? 0) > 0)) {
      throw new Error('Scheduled task creation had failures or unverified audit/relation results. Inspect the task journal.');
    }
  });

  // Wire scheduler to run EOD task auto-closure
  schedulerRepo.setAutoCloseFunction(async () => {
    logger.info('Scheduler: executing automated EOD task closure...');
    const result = await closeDailyTasks.execute({ bypassRules: false });
    logger.info(`Scheduler EOD closure finished: ${result.totalClosed} closed, ${result.totalAlreadyClosed} already closed, ${result.totalFailed} failed.`);
    if (result.totalFailed > 0) {
      throw new Error(`${result.totalFailed} task(s) failed during auto-closure`);
    }
    return result;
  });

  // Auto-start scheduler if configured and not explicitly suppressed
  const shouldAutoStart = options.autoStartScheduler !== false && (config.schedulerEnabled || config.schedulerAutoStart);
  if (shouldAutoStart) {
    logger.info('Auto-starting persistent scheduler on boot...');
    schedulerRepo.start();
  }

  return {
    config,
    createTasks,
    planTasks,
    exploreTasks,
    getStatus,
    configUseCases,
    repairRelations,
    closeDailyTasks,
    githubClient,
    journal: journalRepo,
    scheduler: schedulerRepo,
  };
}

export type {
  CreateTasksInput,
  CreateTasksOutput,
  ProgressEvent,
  PlanTasksInput,
  PlanTasksOutput,
  ExploreTasksInput,
  ExploreTasksOutput,
  SystemStatusOutput,
  CloseDailyTasksInput,
  CloseDailyTasksOutput,
};
