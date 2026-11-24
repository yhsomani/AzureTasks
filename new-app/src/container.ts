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
import { ActivateDailyTasksUseCase } from './application/use-cases/activate-daily-tasks.js';
import { ExecuteTasksUseCase, ExecuteTasksInput, ExecuteTasksOutput } from './application/use-cases/execute-tasks.js';
import { GitHubClient } from './infrastructure/github/github-client.js';
import { FileAutoClosureConfigRepository } from "./infrastructure/config/file-auto-closure-config-repo.js";
import { FileAutoClosureAuditRepository } from "./infrastructure/journal/file-auto-closure-audit-repo.js";
import { RelationalConfigRepository } from './infrastructure/config/relational-config-repo.js';
import { DualConfigRepository } from './infrastructure/config/dual-config-repo.js';
import { RelationalAutoClosureConfigRepository } from './infrastructure/config/relational-auto-closure-config-repo.js';
import { DualAutoClosureConfigRepository } from './infrastructure/config/dual-auto-closure-config-repo.js';
import { RelationalAutoClosureAuditRepository } from './infrastructure/journal/relational-auto-closure-audit-repo.js';
import { DualAutoClosureAuditRepository } from './infrastructure/journal/dual-auto-closure-audit-repo.js';
import { DualJournalRepository } from './infrastructure/persistence/dual-journal-repo.js';
import { createDatabase, WorkOpsDb } from './infrastructure/persistence/database.js';
import { RelationalPlanTokenRepository } from './infrastructure/persistence/relational-plan-token-repo.js';
import { RelationalJournalRepository } from './infrastructure/persistence/relational-journal-repo.js';
import { SqliteAzureDataRepository } from './infrastructure/persistence/sqlite-azure-data-repo.js';
import { IAzureDataRepository } from './domain/ports/azure-data-repository.js';
import { createLockManager } from './infrastructure/lock/distributed-lock-manager.js';
import { DatePlanningService } from './domain/index.js';
import {
  AppConfig,
  IPlanTokenRepository,
  ILockManager,
  JournalRepository,
  JournalEntry,
  ConfigRepository,
  AutoClosureConfigRepository,
  AutoClosureAuditLogRepository,
} from './domain/ports/repositories.js';
import { logger } from './infrastructure/logging/logger.js';
import { assertTlsSafety } from './infrastructure/security/tls-safety.js';
import { createSecretManager, ISecretManager } from './infrastructure/security/secret-manager.js';
import { VerifiedAutoClosurePolicyEngine } from './domain/services/policy-engine.js';

export {
  DualJournalRepository,
  DualConfigRepository,
  DualAutoClosureConfigRepository,
  DualAutoClosureAuditRepository,
};

export interface App {
  config: AppConfig;
  createTasks: CreateTasksUseCase;
  planTasks: PlanTasksUseCase;
  executeTasks: ExecuteTasksUseCase;
  exploreTasks: ExploreTasksUseCase;
  getStatus: GetSystemStatusUseCase;
  configUseCases: ConfigUseCases;
  repairRelations: RepairRelationsUseCase;
  closeDailyTasks: CloseDailyTasksUseCase;
  activateDailyTasks: ActivateDailyTasksUseCase;
  githubClient: GitHubClient;
  journal: JournalRepository;
  scheduler: NodeSchedulerRepository;
  autoClosureConfig: AutoClosureConfigRepository;
  autoClosureAudit: AutoClosureAuditLogRepository;
  db?: WorkOpsDb;
  planTokenRepo?: IPlanTokenRepository;
  lockManager?: ILockManager;
  policyEngine?: VerifiedAutoClosurePolicyEngine;
  secretManager?: ISecretManager;
  azureDataRepo: IAzureDataRepository;
  configRepo?: ConfigRepository;
}

export interface BuildAppOptions {
  autoStartScheduler?: boolean;
  db?: WorkOpsDb;
  planTokenRepo?: IPlanTokenRepository;
  lockManager?: ILockManager;
  sqlitePath?: string;
  databaseUrl?: string;
  secretManager?: ISecretManager;
  policyEngine?: VerifiedAutoClosurePolicyEngine;
  azureDataRepo?: IAzureDataRepository;
}

/**
 * Build the application container.
 * The PAT is read from the environment; the config is loaded from disk.
 */
export async function buildApp(
  configFilePath?: string,
  options: BuildAppOptions = {}
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

  // Initialize relational database (supporting DB_ENGINE / DATABASE_ENGINE, with DB_DISABLED=true support)
  let db: WorkOpsDb | undefined = options.db;
  if (!db && process.env.DB_DISABLED !== 'true') {
    try {
      db = createDatabase({
        sqlitePath: options.sqlitePath || process.env.SQLITE_PATH,
        url: options.databaseUrl || process.env.DATABASE_URL,
      });
    } catch (err: any) {
      logger.warn(`Failed to initialize database: ${err.message}.`);
    }
  }

  // Dual-mode Config Repository: Relational primary with FileConfigRepository fallback & auto-seeding
  const fileConfigRepo = new FileConfigRepository(configFilePath);
  const relationalConfigRepo = db ? new RelationalConfigRepository(db, configFilePath) : undefined;
  const configRepo: ConfigRepository = relationalConfigRepo
    ? new DualConfigRepository(relationalConfigRepo, fileConfigRepo)
    : fileConfigRepo;
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

  // Dual-mode Journal Repository
  const fileJournalRepo = new FileJournalRepository(
    configFilePath
      ? path.join(path.dirname(path.resolve(process.cwd(), configFilePath)), '.task-journal.json')
      : undefined
  );
  const relationalJournalRepo = db ? new RelationalJournalRepository(db) : undefined;
  const journalRepo: JournalRepository = relationalJournalRepo
    ? new DualJournalRepository(relationalJournalRepo, fileJournalRepo)
    : fileJournalRepo;

  const planTokenRepo: IPlanTokenRepository =
    options.planTokenRepo ||
    (db ? new RelationalPlanTokenRepository(db) : (undefined as any));

  const lockManager: ILockManager =
    options.lockManager ||
    (db ? createLockManager(db) : (undefined as any));

  const lockRepo = new FileLockRepository();
  const schedulerRepo = new NodeSchedulerRepository(config, configRepo);

  // Dual-mode Auto-Closure Config Repository
  const fileAutoClosureConfigRepo = new FileAutoClosureConfigRepository();
  const relationalAutoClosureConfigRepo = db ? new RelationalAutoClosureConfigRepository(db) : undefined;
  const autoClosureConfigRepo: AutoClosureConfigRepository = relationalAutoClosureConfigRepo
    ? new DualAutoClosureConfigRepository(relationalAutoClosureConfigRepo, fileAutoClosureConfigRepo)
    : fileAutoClosureConfigRepo;

  // Dual-mode Auto-Closure Audit Repository
  const fileAutoClosureAuditRepo = new FileAutoClosureAuditRepository();
  const relationalAutoClosureAuditRepo = db ? new RelationalAutoClosureAuditRepository(db) : undefined;
  const autoClosureAuditRepo: AutoClosureAuditLogRepository = relationalAutoClosureAuditRepo
    ? new DualAutoClosureAuditRepository(relationalAutoClosureAuditRepo, fileAutoClosureAuditRepo)
    : fileAutoClosureAuditRepo;

  const datePlanning = new DatePlanningService();

  const githubClient = new GitHubClient({
    get token() { return config.githubToken || process.env.GITHUB_TOKEN || process.env.GH_PAT; },
    get org() { return config.githubOrg || process.env.GITHUB_ORG; },
    apiUrl: config.githubApiUrl,
    get userSuffix() { return config.githubUserSuffix ?? process.env.GITHUB_USER_SUFFIX ?? '_bflghec'; },
  });

  const createTasks = new CreateTasksUseCase(workItemRepo, journalRepo, lockRepo, config);
  const planTasks = new PlanTasksUseCase(workItemRepo, config, planTokenRepo);
  const executeTasks = new ExecuteTasksUseCase(workItemRepo, journalRepo, planTokenRepo, lockManager, config);
  const exploreTasks = new ExploreTasksUseCase(workItemRepo, config);
  const getStatus = new GetSystemStatusUseCase(workItemRepo, config);
  const configUseCases = new ConfigUseCases(configRepo, config);
  const repairRelations = new RepairRelationsUseCase(workItemRepo, journalRepo, lockRepo);
  const secretManager = options.secretManager || createSecretManager();
  const policyEngine = options.policyEngine || new VerifiedAutoClosurePolicyEngine();
  const azureDataRepo: IAzureDataRepository = options.azureDataRepo || new SqliteAzureDataRepository();

  const closeDailyTasks = new CloseDailyTasksUseCase(
    config,
    workItemRepo,
    datePlanning,
    githubClient,
    configRepo,
    journalRepo,
    lockRepo,
    autoClosureConfigRepo,
    autoClosureAuditRepo,
    policyEngine
  );
  const activateDailyTasks = new ActivateDailyTasksUseCase(
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

  // Wire scheduler to run 5:30 PM task auto-activation
  schedulerRepo.setAutoActiveFunction(async () => {
    logger.info('Scheduler: executing automated 5:30 PM task activation...');
    const result = await activateDailyTasks.execute({});
    logger.info(`Scheduler task activation finished: ${result.totalActivated} activated, ${result.totalAlreadyActive} already active, ${result.totalFailed} failed.`);
    if (result.totalFailed > 0) {
      throw new Error(`${result.totalFailed} task(s) failed during auto-activation`);
    }
    return result;
  });

  // Wire scheduler to run EOD task auto-closure
  schedulerRepo.setAutoCloseFunction(async () => {
    logger.info('Scheduler: executing automated EOD task closure...');
    const result = await closeDailyTasks.execute({
      enforcePolicyGating: true,
      operatorEmail: 'system-scheduler@workops.test',
    });
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
    executeTasks,
    exploreTasks,
    getStatus,
    configUseCases,
    repairRelations,
    closeDailyTasks,
    activateDailyTasks,
    githubClient,
    journal: journalRepo,
    scheduler: schedulerRepo,
    autoClosureConfig: autoClosureConfigRepo,
    autoClosureAudit: autoClosureAuditRepo,
    db,
    planTokenRepo,
    lockManager,
    policyEngine,
    secretManager,
    azureDataRepo,
    configRepo,
  };
}

export type {
  CreateTasksInput,
  CreateTasksOutput,
  ProgressEvent,
  PlanTasksInput,
  PlanTasksOutput,
  ExecuteTasksInput,
  ExecuteTasksOutput,
  ExploreTasksInput,
  ExploreTasksOutput,
  SystemStatusOutput,
  CloseDailyTasksInput,
  CloseDailyTasksOutput,
};
