#!/usr/bin/env node

/**
 * Azure DevOps 3in1 Multi-Person Task Auto-Creation Utility CLI
 *
 * Automatically copies the chronologically latest 3in1_PWA_MyAccount task
 * for one, multiple, or all configured team members independently.
 */

import { AzureDevOpsClient } from './azure/client.js';
import { CliOptions, loadConfig } from './config/config.js';
import { TaskOrchestrator } from './task/task-orchestrator.js';
import { TaskScheduler } from './task/scheduler.js';
import { AppServer } from './server/server.js';
import { logger } from './utils/logger.js';
import { promptSecure } from './utils/prompt.js';
import { loadDotenv } from './utils/dotenv.js';

function printHelp(): void {
  logger.raw(`
===================================================================
 Azure DevOps 3in1 Multi-Person Task Auto-Creation Tool
===================================================================

USAGE:
  npm run create-tasks [OPTIONS]
  tsx src/index.ts [OPTIONS]

OPTIONS:
  --person <NAME(S)>         Run for specific person (e.g. --person "Rahul" or --person "Rahul,Priya")
  --all                      Run for all configured people in people.json
  --config <FILE>            Path to people/config JSON file (default: people.json)
  --dry-run                  Simulate execution without modifying Azure DevOps
  --yes, -y                  Skip interactive confirmation prompt
  --source-task-id <ID>      Manually specify a source work item ID override
  --timezone <TZ>            Timezone for date calculations (default: Asia/Kolkata)
  --as-of <YYYY-MM-DD>       Simulate execution as of a specific date (for testing)
  --thursday-mode <MODE>     Rolling window mode on Thursday: CURRENT (default) or FOLLOWING
  --repair                   Repair incomplete relationships from journal
  --ui, --serve              Launch interactive Web UI dashboard (http://localhost:3000)
  --daemon, --scheduler      Run automated daily background scheduler (09:30 AM)
  --verbose                  Enable verbose/debug log output
  --help, -h                 Display this help message

ENVIRONMENT VARIABLES:
  AZURE_DEVOPS_PAT           Personal Access Token (with Work Items Read/Write access)
  AZURE_DEVOPS_ORG           Azure DevOps organization (default: BFLDevOpsOrg)
  AZURE_DEVOPS_PROJECT       Azure DevOps project (default: 3in1_Agile_Projects)
  AZURE_DEVOPS_TIMEZONE      Timezone (default: Asia/Kolkata)

EXAMPLES:
  # Launch Unified Web Studio (default when run without arguments):
  npm start

  # Run automated daily background scheduler daemon:
  npm run daemon

  # Run for all configured people with dry-run preview:
  npm run dry-run -- --all

  # Run for a specific person with interactive confirmation:
  npm run create-tasks -- --person "Yash Somani"

  # Run for all people automated (CI/CD):
  npm run create-tasks -- --all --yes
===================================================================
`);
}

function parseArgs(args: string[]): { options: CliOptions; showHelp: boolean } {
  const options: CliOptions = {
    dryRun: false,
    yes: false,
    all: false,
    verbose: false,
  };

  if (args.length === 0) {
    options.ui = true;
    return { options, showHelp: false };
  }

  let showHelp = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--help' || arg === '-h') {
      showHelp = true;
    } else if (arg === '--dry-run') {
      options.dryRun = true;
    } else if (arg === '--yes' || arg === '-y' || arg === '--no-confirm') {
      options.yes = true;
    } else if (arg === '--all') {
      options.all = true;
    } else if (arg === '--person') {
      const next = args[++i];
      if (!next) {
        throw new Error('Option --person requires a name or comma-separated names.');
      }
      options.person = next;
    } else if (arg === '--config') {
      const next = args[++i];
      if (!next) {
        throw new Error('Option --config requires a valid file path.');
      }
      options.configFile = next;
    } else if (arg === '--verbose') {
      options.verbose = true;
    } else if (arg === '--source-task-id') {
      const next = args[++i];
      if (!next || isNaN(parseInt(next, 10))) {
        throw new Error('Option --source-task-id requires a valid numeric Work Item ID.');
      }
      options.sourceTaskId = parseInt(next, 10);
    } else if (arg === '--timezone') {
      const next = args[++i];
      if (!next) {
        throw new Error('Option --timezone requires a valid timezone string (e.g. Asia/Kolkata).');
      }
      options.timezone = next;
    } else if (arg === '--as-of' || arg === '--today-override') {
      const next = args[++i];
      options.asOf = next;
      options.todayOverride = next;
    } else if (arg === '--thursday-mode') {
      const next = args[++i];
      if (next && (next.toUpperCase() === 'FOLLOWING' || next.toUpperCase() === 'CURRENT')) {
        options.thursdayMode = next.toUpperCase() as 'CURRENT' | 'FOLLOWING';
      } else {
        throw new Error('Option --thursday-mode requires CURRENT or FOLLOWING.');
      }
    } else if (arg === '--repair') {
      options.repair = true;
    } else if (arg === '--ui' || arg === '--serve') {
      options.ui = true;
    } else if (arg === '--daemon' || arg === '--scheduler') {
      options.daemon = true;
    }
  }

  return { options, showHelp };
}

async function main(): Promise<void> {
  loadDotenv();

  const { options, showHelp } = parseArgs(process.argv.slice(2));

  if (showHelp) {
    printHelp();
    process.exit(0);
  }

  // Handle corporate enterprise proxy SSL certificates if not explicitly overridden
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === undefined) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
  }

  logger.setVerbose(options.verbose);

  if (options.ui) {
    const pat = process.env.AZURE_DEVOPS_PAT?.trim();
    if (pat) logger.registerSecret(pat);
    const port = parseInt(process.env.PORT || '3000', 10);
    const server = new AppServer(port);
    await server.start();
    return;
  }

  if (options.daemon) {
    let pat = process.env.AZURE_DEVOPS_PAT?.trim();
    if (!pat) {
      logger.warn('AZURE_DEVOPS_PAT environment variable not detected.');
      logger.info('Please enter your Azure DevOps Personal Access Token (PAT):');
      pat = await promptSecure('PAT: ');
    }
    if (!pat) {
      logger.error('No Personal Access Token provided for scheduler daemon. Exiting.');
      process.exit(1);
    }
    logger.registerSecret(pat);
    process.env.AZURE_DEVOPS_PAT = pat;

    const config = loadConfig(options.configFile);
    if (options.timezone) config.timezone = options.timezone;
    if (options.thursdayMode) config.thursdayMode = options.thursdayMode;

    logger.info('===================================================================');
    logger.info(' Azure DevOps 3in1 Task Automation — Scheduler Daemon');
    logger.info('===================================================================');
    const scheduler = new TaskScheduler(config);
    scheduler.start();
    const status = scheduler.getStatus();
    logger.info(`Scheduler running. Target execution time: ${status.targetTime} (${status.timezone})`);
    logger.info('Runs automatically on weekdays (Mon-Fri) for all configured team members.');
    logger.info('Press Ctrl+C to terminate the daemon.');

    const gracefulExit = () => {
      logger.info('\nStopping scheduler daemon...');
      scheduler.stop();
      process.exit(0);
    };
    process.on('SIGINT', gracefulExit);
    process.on('SIGTERM', gracefulExit);
    return;
  }

  // 1. Retrieve PAT safely
  let pat = process.env.AZURE_DEVOPS_PAT?.trim();

  if (!pat) {
    logger.warn('AZURE_DEVOPS_PAT environment variable not detected.');
    logger.info('Please enter your Azure DevOps Personal Access Token (PAT):');
    pat = await promptSecure('PAT: ');
  }

  if (!pat) {
    logger.error('No Personal Access Token provided. Exiting.');
    process.exit(1);
  }

  // Register PAT for immediate scrubbing
  logger.registerSecret(pat);

  // 2. Load configuration and people
  const config = loadConfig(options.configFile);
  if (options.timezone) {
    config.timezone = options.timezone;
  }
  if (options.thursdayMode) {
    config.thursdayMode = options.thursdayMode;
  }

  // 3. Initialize Azure client and orchestrator
  try {
    const client = new AzureDevOpsClient({
      organization: config.organization,
      pat,
      baseUrl: config.baseUrl,
      maxRetries: config.maxRetries,
    });

    const orchestrator = new TaskOrchestrator(client, config, options);

    if (options.repair) {
      await orchestrator.repair();
      process.exit(0);
    }

    const result = await orchestrator.run();

    if (result.totalTaskFailureCount > 0 || result.totalSourceFailureCount > 0) {
      logger.warn(
        `Execution completed with ${result.totalTaskFailureCount} task failure(s) and ${result.totalSourceFailureCount} source failure(s).`
      );
      process.exit(1);
    }

    process.exit(0);
  } catch (error) {
    logger.error(
      `Fatal error during execution: ${error instanceof Error ? error.message : String(error)}`,
      options.verbose ? error : undefined
    );
    process.exit(2);
  }
}

main().catch((err) => {
  logger.error(`Unhandled error: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(3);
});
