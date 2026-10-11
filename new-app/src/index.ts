#!/usr/bin/env node

/**
 * Azure DevOps 3in1 Task Creator — Entry Point
 * CLI + Web UI + Scheduler daemon
 */

import * as dotenv from 'dotenv';
import { buildApp } from './container.js';
import { logger } from './infrastructure/logging/logger.js';
import { AppServer } from './presentation/api/server.js';
import { formatTitleDate } from './domain/value-objects/date-window.js';

dotenv.config();

interface CliOptions {
  command: 'run' | 'plan' | 'serve' | 'daemon' | 'repair' | 'help';
  personKeys?: string[];
  all?: boolean;
  dryRun?: boolean;
  yes?: boolean;
  asOf?: string;
  thursdayMode?: 'CURRENT' | 'FOLLOWING';
  verbose?: boolean;
  configFile?: string;
  port?: number;
}

function parseArgs(args: string[]): CliOptions {
  const opts: CliOptions = { command: 'serve' };

  if (args.length === 0) return opts;

  // First positional token can be a command
  const first = args[0];
  if (!first.startsWith('-')) {
    if (['run', 'plan', 'serve', 'daemon', 'repair', 'help'].includes(first)) {
      opts.command = first as CliOptions['command'];
      args = args.slice(1);
    }
  }

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--help':
      case '-h':
        opts.command = 'help';
        break;
      case '--all':
        opts.all = true;
        break;
      case '--dry-run':
        opts.dryRun = true;
        break;
      case '--yes':
      case '-y':
        opts.yes = true;
        break;
      case '--verbose':
        opts.verbose = true;
        break;
      case '--person': {
        const next = args[++i];
        if (!next) throw new Error('--person requires a name or comma-separated keys');
        opts.personKeys = next.split(',').map(s => s.trim()).filter(Boolean);
        break;
      }
      case '--config': {
        const next = args[++i];
        if (!next) throw new Error('--config requires a file path');
        opts.configFile = next;
        break;
      }
      case '--as-of':
      case '--today-override':
        opts.asOf = args[++i];
        break;
      case '--thursday-mode': {
        const next = args[++i];
        if (next !== 'CURRENT' && next !== 'FOLLOWING') {
          throw new Error('--thursday-mode requires CURRENT or FOLLOWING');
        }
        opts.thursdayMode = next;
        break;
      }
      case '--ui':
      case '--serve':
        opts.command = 'serve';
        break;
      case '--daemon':
      case '--scheduler':
        opts.command = 'daemon';
        break;
      case '--port': {
        const next = args[++i];
        opts.port = parseInt(next, 10);
        break;
      }
      default:
        break;
    }
  }

  return opts;
}

function printHelp(): void {
  console.log(`
===================================================================
 Azure DevOps 3in1 Multi-Person Task Auto-Creation Tool
===================================================================

USAGE:
  npm start -- <COMMAND> [OPTIONS]

COMMANDS:
  serve (default)     Launch the interactive Web UI dashboard
  run                 Create tasks now
  plan                Preview task creation (dry-run)
  daemon              Run the automated weekday scheduler
  repair              Repair incomplete relationship copies
  help                Show this help

OPTIONS:
  --person <KEYS>     Comma-separated person keys (default: all)
  --all               Process all configured people
  --dry-run           Simulate without modifying Azure DevOps
  --yes, -y           Skip confirmation
  --as-of <DATE>      Simulate as of YYYY-MM-DD
  --thursday-mode <M> CURRENT (default) or FOLLOWING
  --config <FILE>     Path to people/config JSON
  --port <N>          Port for the web UI (default 3000)
  --verbose           Verbose logging
  --help, -h          Show this help

ENVIRONMENT:
  AZURE_DEVOPS_PAT        Personal Access Token (Work Items Read/Write)
  AZURE_DEVOPS_ORG        Organization (default: BFLDevOpsOrg)
  AZURE_DEVOPS_PROJECT    Project (default: 3in1_Agile_Projects)
  AZURE_DEVOPS_TIMEZONE   Timezone (default: Asia/Kolkata)
===================================================================
`);
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));

  if (opts.command === 'help') {
    printHelp();
    return;
  }

  logger.setVerbose(!!opts.verbose);

  const app = await buildApp(opts.configFile);

  switch (opts.command) {
    case 'serve': {
      const server = new AppServer({
        createTasks: app.createTasks,
        planTasks: app.planTasks,
        exploreTasks: app.exploreTasks,
        getStatus: app.getStatus,
        config: app.configUseCases,
        journal: app.journal,
        scheduler: app.scheduler,
      }, opts.port ?? parseInt(process.env.PORT || '3000', 10));
      await server.start();
      return;
    }

    case 'daemon': {
      logger.info('Starting scheduler daemon (weekdays at 09:30)...');
      app.scheduler.start();
      const status = app.scheduler.getStatus();
      logger.info(`Scheduler running. Next run: ${status.nextRun ?? 'pending'} (${status.timezone})`);
      const shutdown = () => {
        logger.info('Stopping scheduler...');
        app.scheduler.stop();
        process.exit(0);
      };
      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
      return;
    }

    case 'plan':
    case 'run': {
      const isDryRun = opts.command === 'plan' || !!opts.dryRun;
      const result = await app.createTasks.execute({
        personKeys: opts.personKeys,
        all: opts.all || !opts.personKeys,
        dryRun: isDryRun,
        asOf: opts.asOf,
        thursdayMode: opts.thursdayMode,
        yes: opts.yes,
      });
      printSummary(result, isDryRun);
      if (result.totalTaskFailureCount > 0 || result.totalSourceFailureCount > 0) {
        process.exitCode = 1;
      }
      return;
    }

    case 'repair': {
      logger.info('Repair mode: re-copying missing relations...');
      const report = await app.repairRelations.execute();

      if (report.total === 0) {
        logger.info('No incomplete relations found.');
        console.log('Nothing to repair.');
        return;
      }

      console.log('\n===================================================');
      console.log('RELATION REPAIR SUMMARY');
      console.log('===================================================');
      console.log(`Entries examined : ${report.total}`);
      console.log(`Repaired         : ${report.repaired}`);
      console.log(`Still partial    : ${report.partial}`);
      console.log(`Failed           : ${report.failed}`);
      console.log(`Skipped          : ${report.skipped}`);
      console.log('---------------------------------------------------');
      for (const row of report.rows) {
        console.log(
          `[${row.status}] ${row.entry.personName} ${row.entry.targetIsoDate} ` +
          `#${row.entry.createdWorkItemId ?? '-'} — ${row.message}`
        );
      }
      console.log('===================================================\n');

      if (report.failed > 0 || report.partial > 0) {
        process.exitCode = 1;
      }
      return;
    }
  }
}

function printSummary(result: any, dryRun: boolean): void {
  console.log('\n===================================================');
  console.log(dryRun ? 'PLAN (DRY RUN)' : 'EXECUTION SUMMARY');
  console.log('===================================================');
  console.log(`People processed : ${result.peopleProcessedCount}`);
  console.log(`Tasks created    : ${result.totalCreatedCount}`);
  console.log(`Duplicates        : ${result.totalDuplicateCount}`);
  console.log(`Weekend skips     : ${result.totalWeekendSkipCount}`);
  console.log(`Source failures   : ${result.totalSourceFailureCount}`);
  console.log(`Task failures     : ${result.totalTaskFailureCount}`);
  console.log(`Relation failures : ${result.totalRelationFailureCount}`);
  console.log('---------------------------------------------------');
  for (const p of result.personResults) {
    console.log(`${p.person.name}: created=${p.createdTasks.length} skipped=${p.duplicateSkips.length} failed=${p.failedTasks.length}`);
  }
  console.log('===================================================\n');
}

main().catch(err => {
  logger.error(`Fatal: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(2);
});
