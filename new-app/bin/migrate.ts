#!/usr/bin/env node
import { createDatabase } from '../src/infrastructure/persistence/database.js';
import { MigrationService } from '../src/infrastructure/persistence/migration/migration-service.js';

async function run(): Promise<void> {
  const args = process.argv.slice(2);
  let sqlitePath: string | undefined;
  let databaseUrl: string | undefined;
  let peoplePath: string | undefined;
  let journalPath: string | undefined;
  let autoClosureConfigPath: string | undefined;
  let calendarPath: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--sqlite-path' && args[i + 1]) {
      sqlitePath = args[++i];
    } else if (args[i] === '--database-url' && args[i + 1]) {
      databaseUrl = args[++i];
    } else if (args[i] === '--people' && args[i + 1]) {
      peoplePath = args[++i];
    } else if (args[i] === '--journal' && args[i + 1]) {
      journalPath = args[++i];
    } else if (args[i] === '--auto-closure-config' && args[i + 1]) {
      autoClosureConfigPath = args[++i];
    } else if (args[i] === '--calendar' && args[i + 1]) {
      calendarPath = args[++i];
    }
  }

  console.log('Starting WorkOps Zero-Data-Loss Migration...');
  const db = createDatabase({ sqlitePath, url: databaseUrl });

  try {
    const migration = new MigrationService(db);
    const report = await migration.migrate({
      peoplePath,
      journalPath,
      autoClosureConfigPath,
      calendarPath,
    });

    console.log('Migration Completed.');
    console.log('--- Migration Report ---');
    console.log(`Success:                 ${report.success}`);
    console.log(`Source Members:          ${report.sourceMembers}`);
    console.log(`Migrated Members:        ${report.migratedMembers}`);
    console.log(`Source Journal Entries:  ${report.sourceJournalEntries}`);
    console.log(`Migrated Journal:        ${report.migratedJournalEntries}`);
    console.log(`Source Auto-Closure:     ${report.sourceAutoClosureRules}`);
    console.log(`Migrated Auto-Closure:   ${report.migratedAutoClosureRules}`);

    if (report.errors.length > 0) {
      console.error('Errors encountered:');
      for (const err of report.errors) {
        console.error(` - ${err}`);
      }
      process.exit(1);
    }

    process.exit(0);
  } catch (error: any) {
    console.error('Migration failed with fatal error:', error.message || error);
    process.exit(1);
  } finally {
    if (db.engine === 'sqlite') {
      db.close();
    } else {
      await db.close();
    }
  }
}

run();
