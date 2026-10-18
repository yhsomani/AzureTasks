import * as fs from 'node:fs';
import { FileConfigRepository } from '../../src/infrastructure/config/file-config-repo.ts';
import { NodeSchedulerRepository } from '../../src/infrastructure/scheduler/node-scheduler-repo.ts';

const [configPath, markerPath, phase] = process.argv.slice(2);
if (!configPath || !markerPath || !['attempt', 'restart'].includes(phase)) {
  throw new Error('Usage: probe CONFIG MARKER attempt|restart');
}
const repo = new FileConfigRepository(configPath);
const config = await repo.load();
const scheduler = new NodeSchedulerRepository(config, repo);
scheduler.setAutoCloseFunction(async () => {
  fs.appendFileSync(markerPath, 'attempt\n');
  return { totalFound: 1, totalClosed: 1, totalAlreadyClosed: 0, totalFailed: 0 };
});
if (phase === 'attempt') {
  await scheduler.runAutoCloseScheduled();
  if (!scheduler.getStatus().lastAutoClose) throw new Error('Missing scheduler EOD checkpoint');
} else {
  const existing = scheduler.getStatus().lastAutoClose;
  if (!existing) throw new Error('Restart did not read persisted EOD checkpoint');
  const next = scheduler.getNextAutoCloseTarget(new Date(existing)).target;
  if (next.getTime() <= new Date(existing).getTime()) {
    throw new Error('EOD resumed the same attempt after a cold restart');
  }
  await scheduler.start(false);
  scheduler.checkHeartbeat();
  await scheduler.stop(false);
}
console.log(phase + ': checkpoint observed');
