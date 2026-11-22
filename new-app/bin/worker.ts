#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { WorkerDaemon } from '../src/infrastructure/scheduler/worker-daemon.js';
import { buildApp } from '../src/container.js';
import { logger } from '../src/infrastructure/logging/logger.js';
import { createDatabase } from '../src/infrastructure/persistence/database.js';
import { createLockManager } from '../src/infrastructure/lock/distributed-lock-manager.js';

export interface CreateWorkerDaemonOptions {
  configPath?: string;
  sqlitePath?: string;
  databaseUrl?: string;
  redisClient?: any;
}

export async function createWorkerDaemon(options: CreateWorkerDaemonOptions = {}): Promise<WorkerDaemon> {
  const app = await buildApp(options.configPath, { autoStartScheduler: false });
  const db = app.db || createDatabase({ sqlitePath: options.sqlitePath, url: options.databaseUrl });
  const lockManager = app.lockManager || createLockManager(db, options.redisClient);

  const daemon = new WorkerDaemon({
    lockManager,
    timezone: app.config.timezone || 'UTC',
  });

  // 1. Morning Task Activation Job
  daemon.registerJob({
    id: 'morning-activation',
    name: 'Morning Task Activation',
    intervalMs: 60000,
    maxRetries: 3,
    handler: async () => {
      logger.info('WorkerDaemon: running automated morning task activation...');
      await app.activateDailyTasks.execute({});
    },
  });

  // 2. EOD Verified Auto-Closure Job
  daemon.registerJob({
    id: 'eod-auto-closure',
    name: 'EOD Verified Auto-Closure',
    intervalMs: 60000,
    maxRetries: 3,
    handler: async () => {
      logger.info('WorkerDaemon: running automated EOD task auto-closure...');
      await app.closeDailyTasks.execute({
        enforcePolicyGating: true,
        operatorEmail: 'system-scheduler@workops.test',
      });
    },
  });

  // 3. Daily Task Creation Job
  daemon.registerJob({
    id: 'daily-task-creation',
    name: 'Daily Task Creation',
    intervalMs: 60000,
    maxRetries: 3,
    handler: async () => {
      logger.info('WorkerDaemon: running automated daily task creation...');
      await app.createTasks.execute({ all: true, yes: true });
    },
  });

  return daemon;
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  let configPath: string | undefined;
  let sqlitePath: string | undefined;
  let databaseUrl: string | undefined;
  let runOnce = false;

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--config' && argv[i + 1]) {
      configPath = argv[++i];
    } else if (argv[i] === '--sqlite-path' && argv[i + 1]) {
      sqlitePath = argv[++i];
    } else if (argv[i] === '--database-url' && argv[i + 1]) {
      databaseUrl = argv[++i];
    } else if (argv[i] === '--run-once') {
      runOnce = true;
    }
  }

  logger.info('Initializing WorkOps Background Worker Daemon...');
  const daemon = await createWorkerDaemon({ configPath, sqlitePath, databaseUrl });
  daemon.setupSignalHandlers();

  if (runOnce) {
    logger.info('Running in single-execution mode...');
    daemon.start();
    await daemon.stop();
    logger.info('Single execution run completed.');
  } else {
    daemon.start();
    logger.info('WorkerDaemon is running in the background. Press Ctrl+C to terminate.');
  }
}

const currentFilePath = fileURLToPath(import.meta.url);
if (process.argv[1] && (process.argv[1] === currentFilePath || process.argv[1].endsWith('worker.ts') || process.argv[1].endsWith('worker.js'))) {
  main().catch((err) => {
    logger.error(`Fatal error in worker daemon: ${err.message || err}`);
    process.exit(1);
  });
}
