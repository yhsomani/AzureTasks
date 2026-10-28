import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../src/container.ts';
import { AppServer } from '../src/presentation/api/server.ts';
import { FileJournalRepository } from '../src/infrastructure/journal/file-journal-repo.ts';

const directory = await mkdtemp(join(tmpdir(), 'task-studio-preview-'));
const configPath = join(directory, 'people.json');
await writeFile(configPath, JSON.stringify({
  people: [], organization: 'Unconfigured', project: 'Unconfigured', timezone: 'UTC',
  schedulerEnabled: false, schedulerAutoStart: false, autoClose: false, autoActive: false,
}), { mode: 0o600 });
for (const name of ['AZURE_DEVOPS_PAT', 'GITHUB_TOKEN', 'GH_PAT', 'API_AUTH_TOKEN', 'API_VIEWER_TOKEN']) {
  process.env[name] = '';
}
process.env.NODE_ENV = 'development';
process.env.LISTEN_HOST = '127.0.0.1';
process.env.SECRET_STORAGE_MODE = 'external';
const app = await buildApp(configPath, { autoStartScheduler: false });
const journal = new FileJournalRepository(join(directory, 'journal.json'));
const server = new AppServer({
  createTasks: app.createTasks, planTasks: app.planTasks, exploreTasks: app.exploreTasks,
  getStatus: app.getStatus, config: app.configUseCases, repairRelations: app.repairRelations,
  closeDailyTasks: app.closeDailyTasks, activateDailyTasks: app.activateDailyTasks,
  githubClient: app.githubClient, journal, scheduler: app.scheduler,
}, Number(process.env.PORT || 3193), { readOnly: true });
const port = await server.start();
console.log(`Isolated rebuild preview: http://127.0.0.1:${port}; empty temporary roster, no integration credentials, automation off.`);
async function shutdown() {
  await app.scheduler.stop();
  await server.stop();
  await journal.close();
  await rm(directory, { recursive: true, force: true });
  process.exit(0);
}
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);