/**
 * API Routes
 * HTTP endpoints exposing application use cases
 */

import { Router } from 'express';
import { asyncHandler, readyHandler } from './async-handler.js';
import { CreateTasksUseCase } from '../../application/use-cases/create-tasks.js';
import { PlanTasksUseCase } from '../../application/use-cases/plan-tasks.js';
import { GetSystemStatusUseCase } from '../../application/use-cases/get-status.js';
import { ConfigUseCases } from '../../application/use-cases/config.js';
import { ExploreTasksUseCase } from '../../application/use-cases/explore-tasks.js';
import { RepairRelationsUseCase } from '../../application/use-cases/repair-relations.js';
import { CloseDailyTasksUseCase } from '../../application/use-cases/close-daily-tasks.js';
import { ActivateDailyTasksUseCase } from '../../application/use-cases/activate-daily-tasks.js';
import { GitHubClient } from '../../infrastructure/github/github-client.js';
import { JournalRepository, SchedulerRepository } from '../../domain/ports/repositories.js';
import { logger } from '../../infrastructure/logging/logger.js';
import { getTodayIso } from '../../domain/value-objects/date-window.js';
import { ReadCoordinator } from './read-coordinator.js';

/** Extract error message from unknown caught value. */
function getErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  if (typeof err === 'string') {
    return err;
  }
  return 'An unknown error occurred';
}

export interface ApiDependencies {
  createTasks: CreateTasksUseCase;
  planTasks: PlanTasksUseCase;
  exploreTasks: ExploreTasksUseCase;
  getStatus: GetSystemStatusUseCase;
  config: ConfigUseCases;
  repairRelations?: RepairRelationsUseCase;
  closeDailyTasks?: CloseDailyTasksUseCase;
  activateDailyTasks?: ActivateDailyTasksUseCase;
  githubClient?: GitHubClient;
  journal: JournalRepository;
  scheduler: SchedulerRepository;
}

/**
 * Resolve an explicit member scope at the HTTP boundary. An empty list must
 * never expand to all configured employees for mutating endpoints.
 * Legacy unfiltered plan previews may still default to all users.
 */
function resolvePersonScope(
  body: Record<string, unknown> | undefined,
  allowImplicitAll = false,
): { personKeys?: string[]; all: boolean } {
  const keys = body?.personKeys;
  if (keys !== undefined) {
    if (!Array.isArray(keys) || keys.length === 0 ||
      keys.some(key => typeof key !== 'string' || !key.trim())) {
      throw new Error('personKeys must be a non-empty array of member keys.');
    }
    if (body?.all === true) {
      throw new Error('Choose personKeys or all=true, not both.');
    }
    const personKeys = keys.map(key => key.trim());
    if (new Set(personKeys).size !== personKeys.length) {
      throw new Error('personKeys must not contain duplicate member keys.');
    }
    return { personKeys, all: false };
  }
  if (body?.all === true || (allowImplicitAll && body?.all === undefined)) {
    return { all: true };
  }
  throw new Error('Select member keys or explicitly set all=true.');
}

/** Keep user-controlled response sizes finite and predictable. */
function parsePageLimit(value: unknown, fallback: number, max: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^[1-9]\d*$/.test(value)) {
    throw new Error(`limit must be a positive integer up to ${max}.`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed > max) {
    throw new Error(`limit must be a positive integer up to ${max}.`);
  }
  return parsed;
}

export function createApiRouter(deps: ApiDependencies): Router {
  const router = Router();
  const reads = new ReadCoordinator();
  router.use((req, res, next) => {
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.path !== '/tasks/plan') {
      reads.invalidate();
      res.once('finish', () => reads.invalidate());
    }
    next();
  });

  // Auth role is set by the server after Basic credential verification, never
  // accepted from a browser-provided header. Client uses it to hide mutations.
  router.get('/session', (req, res) => {
    const role = (req as typeof req & { authRole?: string }).authRole === 'viewer' ? 'viewer' : 'operator';
    res.json({ success: true, data: { role } });
  });

  // Liveness says only that the web process can answer HTTP requests.
  // It must not pretend that Azure DevOps or GitHub integrations are working.
  router.get('/health', (_req, res) => {
    res.json({ status: 'alive', dependenciesChecked: false, timestamp: new Date().toISOString() });
  });

  // Readiness performs live read-only Azure project and work-item type checks.
  // Keep this under normal API authentication (unlike the liveness probe).
  router.get('/ready', readyHandler(async (_req, res) => {
    const status = await deps.getStatus.execute();
    if (!status.connected || !status.projectValid || !status.workItemTypeValid) {
      return res.status(503).json({
        success: false,
        data: { status: 'unavailable', azureDevOpsConnected: false },
      });
    }
    return res.json({ success: true, data: { status: 'ready', azureDevOpsConnected: true } });
  }));

  // Status
  router.get('/status', asyncHandler(async (_req, res) => {
    const started = performance.now();
    const data = await reads.run(`status:${String((_req as typeof _req & { authRole?: string }).authRole || 'operator')}`, () => deps.getStatus.execute());
    res.setHeader('Server-Timing', `status;dur=${(performance.now() - started).toFixed(1)}`);
          res.json({ success: true, data });
  }));

  // Config
  router.get('/config', asyncHandler(async (_req, res) => {
    const data = await deps.config.getConfig();
          res.json({ success: true, data });
  }));

  router.get('/calendar', asyncHandler(async (_req, res) => {
    const config = await deps.config.getConfig();
    res.json({ success: true, data: {
      calendar: config.calendar ?? { version: 0, defaultHours: 8, memberHours: {}, exceptions: [] },
      timezone: config.timezone,
      members: config.people.map(person => ({ key: person.key, name: person.name, enabled: person.enabled !== false })),
    } });
  }));

  router.post('/calendar', asyncHandler(async (req, res) => {
    try {
      const result = await deps.config.saveSettings({ calendar: req.body?.calendar });
      if (!req.body?.calendar) return res.status(400).json({ success: false, error: 'Calendar is required.' });
      res.json({ success: true, data: { calendar: result.config.calendar } });
    } catch (error) {
      const message = getErrorMessage(error);
      res.status(message.startsWith('Calendar changed.') ? 409 : 400).json({ success: false, error: message });
    }
  }));

  router.post('/config/people', asyncHandler(async (req, res) => {
    const data = await deps.config.savePeople(req.body);
          res.json({ success: true, data });
  }));

  router.post('/config/settings', asyncHandler(async (req, res) => {
    const data = await deps.config.saveSettings(req.body);
          const savedGhToken = typeof req.body?.githubToken === 'string' ? req.body.githubToken.trim() : '';
          if (savedGhToken) logger.registerSecret(savedGhToken);
          res.json({ success: true, data });
  }));

  router.post('/config/pat', asyncHandler(async (req, res) => {
    const data = await deps.config.savePat(req.body);
          // Scrub the newly saved PAT from all future log output.
          const savedPat = typeof req.body?.pat === 'string' ? req.body.pat.trim() : '';
          if (savedPat) logger.registerSecret(savedPat);
          res.json({ success: true, data });
  }));

  // Tasks
  router.post('/tasks/plan', asyncHandler(async (req, res) => {
    const { asOf, thursdayMode } = req.body || {};
    const scope = resolvePersonScope(req.body, true);
    const data = await deps.planTasks.execute({
      ...scope,
      asOf,
      thursdayMode,
    });
    res.json({ success: true, data });
  }, { statusCode: 400 }));

  router.post('/tasks/execute', asyncHandler(async (req, res) => {
    const { asOf, thursdayMode, dryRun } = req.body || {};
          if (dryRun !== true && req.body?.confirm !== true) {
            return res.status(400).json({ success: false, error: 'Explicit confirm=true is required for Azure task creation.' });
          }
          const scope = resolvePersonScope(req.body);
          const data = await deps.createTasks.execute(
            {
              ...scope,
              asOf,
              thursdayMode,
              dryRun: !!dryRun,
              yes: true,
            },
            (event) => logger.info(event.message)
          );
          res.json({ success: true, data });
  }));

  router.post('/tasks/adhoc', asyncHandler(async (req, res) => {
    const {
            personKey,
            targetIsoDate,
            customTitle,
            sourceTaskId,
            originalEstimate,
            activity,
            description,
            bypassDuplicateCheck,
          } = req.body || {};
          if (!personKey || !targetIsoDate) {
            return res.status(400).json({ success: false, error: 'personKey and targetIsoDate (YYYY-MM-DD) are required' });
          }
          if (req.body?.confirm !== true) {
            return res.status(400).json({ success: false, error: 'Explicit confirm=true is required for ad-hoc Azure task creation.' });
          }
          if (bypassDuplicateCheck === true) {
            return res.status(400).json({ success: false, error: 'Duplicate-check bypass is disabled.' });
          }
          const sourceId = sourceTaskId === undefined || sourceTaskId === '' ? undefined : Number(sourceTaskId);
          const estimate = originalEstimate === undefined || originalEstimate === '' ? undefined : Number(originalEstimate);
          if (sourceId !== undefined && (!Number.isSafeInteger(sourceId) || sourceId <= 0)) {
            return res.status(400).json({ success: false, error: 'sourceTaskId must be a positive integer.' });
          }
          if (estimate !== undefined && (!Number.isFinite(estimate) || estimate < 0)) {
            return res.status(400).json({ success: false, error: 'originalEstimate must be a non-negative finite number.' });
          }
          const result = await deps.createTasks.executeAdHocTask({
            personKey,
            targetIsoDate,
            customTitle,
            sourceTaskId: sourceId,
            originalEstimate: estimate,
            activity,
            description,
            bypassDuplicateCheck: false,
          });
          res.json({ success: true, data: result });
  }));

  router.post('/tasks/repair', asyncHandler(async (req, res) => {
    if (!deps.repairRelations) {
            return res.status(400).json({ success: false, error: 'RepairRelationsUseCase not configured' });
          }
          if (req.body?.confirm !== true) {
            return res.status(400).json({ success: false, error: 'Explicit confirm=true is required to repair Azure relations.' });
          }
          logger.info('Repair API requested: re-copying missing relations...');
          const report = await deps.repairRelations.execute();
          res.json({ success: true, data: report });
  }));

  router.post('/tasks/close-today', asyncHandler(async (req, res) => {
    if (!deps.closeDailyTasks) {
            return res.status(501).json({ success: false, error: 'EOD task closure is not configured' });
          }
          const { asOf } = req.body || {};
          const dryRun = req.body?.dryRun === true;
          if ((req as typeof req & { authRole?: string }).authRole === 'viewer' && !dryRun) {
            return res.status(403).json({
              success: false,
              error: 'Read-only viewer credentials may preview EOD but may not close work items.',
            });
          }
          const runtimeConfig = await deps.config.getConfig();
          const today = getTodayIso(runtimeConfig.timezone || 'UTC');
          if (asOf !== undefined &&
            (typeof asOf !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(asOf) ||
              !Number.isFinite(new Date(`${asOf}T00:00:00Z`).getTime()) ||
              new Date(`${asOf}T00:00:00Z`).toISOString().slice(0, 10) !== asOf)) {
            return res.status(400).json({ success: false, error: 'Invalid EOD reference date (YYYY-MM-DD).' });
          }
          if (!dryRun && asOf && asOf !== today) {
            return res.status(400).json({ success: false, error: 'EOD closure is restricted to the current configured workday. Use preview for other dates.' });
          }
          if (!dryRun && req.body?.confirm !== true) {
            return res.status(400).json({ success: false, error: 'Explicit confirm=true is required for Azure EOD closure.' });
          }
          // Closing tasks is a remote write. A missing or empty member scope must
          // never silently close all employees' work items.
          const scope = resolvePersonScope(req.body, dryRun);
          logger.info(`EOD task closure requested (dryRun=${dryRun}, asOf=${asOf || 'today'})...`);
          const result = await deps.closeDailyTasks.execute({
            personKeys: scope.personKeys,
            asOf,
            dryRun,
          });
          res.json({ success: true, data: result });
  }));

  router.post('/tasks/activate-today', asyncHandler(async (req, res) => {
    if (!deps.activateDailyTasks) {
      return res.status(501).json({ success: false, error: 'Daily task activation is not configured' });
    }
    const { asOf } = req.body || {};
    const dryRun = req.body?.dryRun === true;
    if ((req as typeof req & { authRole?: string }).authRole === 'viewer' && !dryRun) {
      return res.status(403).json({
        success: false,
        error: 'Read-only viewer credentials may preview task activation but may not activate work items.',
      });
    }
    const runtimeConfig = await deps.config.getConfig();
    const today = getTodayIso(runtimeConfig.timezone || 'UTC');
    if (asOf !== undefined &&
      (typeof asOf !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(asOf) ||
        !Number.isFinite(new Date(`${asOf}T00:00:00Z`).getTime()) ||
        new Date(`${asOf}T00:00:00Z`).toISOString().slice(0, 10) !== asOf)) {
      return res.status(400).json({ success: false, error: 'Invalid reference date (YYYY-MM-DD).' });
    }
    if (!dryRun && asOf && asOf !== today) {
      return res.status(400).json({ success: false, error: 'Task activation is restricted to the current configured workday. Use preview for other dates.' });
    }
    if (!dryRun && req.body?.confirm !== true) {
      return res.status(400).json({ success: false, error: 'Explicit confirm=true is required for Azure task activation.' });
    }
    const scope = resolvePersonScope(req.body, dryRun);
    logger.info(`Daily task activation requested (dryRun=${dryRun}, asOf=${asOf || 'today'})...`);
    const result = await deps.activateDailyTasks.execute({
      personKeys: scope.personKeys,
      asOf,
      dryRun,
    });
    res.json({ success: true, data: result });
  }));

  // Explorer
  router.get('/explorer', asyncHandler(async (req, res) => {
    const started = performance.now();
    const preset = typeof req.query.preset === 'string' ? req.query.preset : undefined;
          const startDate = typeof req.query.startDate === 'string' ? req.query.startDate : undefined;
          const endDate = typeof req.query.endDate === 'string' ? req.query.endDate : undefined;
          const asOf = typeof req.query.asOf === 'string' ? req.query.asOf : undefined;
          const usersParam = typeof req.query.users === 'string' ? req.query.users : undefined;
          const personKeys = usersParam ? usersParam.split(',').map(s => s.trim()).filter(Boolean) : undefined;
          const scope = {
            preset,
            startDate,
            endDate,
            asOf,
            personKeys,
          };
          const role = (req as typeof req & { authRole?: string }).authRole || 'operator';
          const data = await reads.run(`explorer:${role}:${JSON.stringify(scope)}`, () => deps.exploreTasks.execute(scope));
          res.setHeader('Server-Timing', `coverage;dur=${(performance.now() - started).toFixed(1)}`);
          res.setHeader('Cache-Control', 'private, no-store');
          res.json({ success: true, data });
  }));

  router.post('/explorer/create-missing', asyncHandler(async (req, res) => {
    const { asOf, thursdayMode } = req.body || {};
          if (req.body?.confirm !== true) {
            return res.status(400).json({ success: false, error: 'Explicit confirm=true is required for missing-task creation.' });
          }
          const scope = resolvePersonScope(req.body);
          const data = await deps.createTasks.execute(
            {
              ...scope,
              asOf,
              thursdayMode,
              dryRun: false,
              yes: true,
            },
            (event) => logger.info(event.message)
          );
          res.json({
            success: true,
            data: {
              message: 'Missing eligible tasks evaluated and created.',
              createdCount: data.totalCreatedCount,
              skippedCount: data.totalDuplicateCount,
              result: data,
            },
          });
  }));

  // Journal
  router.get('/journal', asyncHandler(async (req, res) => {
    try {
      const limit = parsePageLimit(req.query.limit, 100, 1000);
      const entries = await deps.journal.getEntries(limit);
      const unfinished = await deps.journal.getUnfinishedRelations();
      res.json({
        success: true,
        data: { totalEntries: entries.length, incompleteEntriesCount: unfinished.length, entries },
      });
    } catch (err: unknown) {
      const invalidLimit = err instanceof Error && getErrorMessage(err).startsWith('limit must be a positive integer');
      if (invalidLimit) {
        return res.status(400).json({ success: false, error: getErrorMessage(err) });
      }
      throw err;
    }
  }));

  router.get('/journal/export', asyncHandler(async (req, res) => {
    const format = String(req.query.format || 'csv');
          if (format === 'json') {
            const content = await deps.journal.exportJson();
            res.setHeader('Content-Type', 'application/json');
            res.setHeader('Content-Disposition', 'attachment; filename="task-journal.json"');
            res.send(content);
          } else {
            const content = await deps.journal.exportCsv();
            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader('Content-Disposition', 'attachment; filename="task-journal.csv"');
            res.send(content);
          }
  }));

  // Scheduler
  router.get('/scheduler', (_req, res) => {
    res.json({ success: true, data: deps.scheduler.getStatus() });
  });

  router.post('/scheduler/toggle', asyncHandler(async (req, res) => {
    const requestedEnable = req.body?.enabled !== undefined ? req.body.enabled : req.body?.enable;
          if (typeof requestedEnable !== 'boolean' || (req.body?.persist !== undefined &&
            typeof req.body.persist !== 'boolean')) {
            return res.status(400).json({ success: false, error: 'Scheduler enabled and persist must be actual boolean values.' });
          }
          const shouldEnable = requestedEnable;
          const persist = req.body?.persist ?? true;
          if (shouldEnable) await deps.scheduler.start(persist);
          else await deps.scheduler.stop(persist);
          res.json({ success: true, data: deps.scheduler.getStatus() });
  }));

  router.post('/scheduler/config', asyncHandler(async (req, res) => {
    const { startTime, timezone, autoStart, autoClose, autoCloseStartTime, autoCloseEndTime, autoActive, autoActiveTime } = req.body || {};
          if ((autoStart !== undefined && typeof autoStart !== 'boolean') ||
            (autoClose !== undefined && typeof autoClose !== 'boolean') ||
            (autoActive !== undefined && typeof autoActive !== 'boolean') ||
            [startTime, timezone, autoCloseStartTime, autoCloseEndTime, autoActiveTime].some(value =>
              value !== undefined && typeof value !== 'string')) {
            return res.status(400).json({ success: false, error: 'Invalid scheduler settings types.' });
          }
          if (deps.scheduler.configure) {
            await deps.scheduler.configure({
              startTime,
              timezone,
              autoStart,
              autoClose,
              autoCloseStartTime,
              autoCloseEndTime,
              autoActive,
              autoActiveTime,
            });
          }
          res.json({ success: true, data: deps.scheduler.getStatus() });
  }));

  router.post('/scheduler/run-now', asyncHandler(async (req, res) => {
    if (req.body?.confirm !== true || req.body?.all !== true) {
            return res.status(400).json({ success: false, error: 'Scheduler run-now requires confirm=true and all=true.' });
          }
          if (deps.scheduler.triggerRunNow) {
            const result = await deps.scheduler.triggerRunNow();
            if (!result.success) return res.status(409).json({ success: false, error: result.message });
            res.json({ success: true, message: result.message, data: deps.scheduler.getStatus() });
          } else {
            res.status(400).json({ success: false, error: 'Direct run trigger not supported' });
          }
  }));

  router.post('/scheduler/trigger-autoactive', asyncHandler(async (req, res) => {
    if (req.body?.confirm !== true || req.body?.all !== true) {
            return res.status(400).json({ success: false, error: 'Scheduler auto-active requires confirm=true and all=true.' });
          }
          if (deps.scheduler.triggerAutoActiveNow) {
            const result = await deps.scheduler.triggerAutoActiveNow();
            res.json({ success: result.success, message: result.message, data: deps.scheduler.getStatus() });
          } else {
            res.status(400).json({ success: false, error: 'Direct auto-active trigger not supported' });
          }
  }));

  router.post('/scheduler/trigger-autoclose', asyncHandler(async (req, res) => {
    if (req.body?.confirm !== true || req.body?.all !== true) {
            return res.status(400).json({ success: false, error: 'Scheduler auto-close requires confirm=true and all=true.' });
          }
          if (deps.scheduler.triggerAutoCloseNow) {
            const result = await deps.scheduler.triggerAutoCloseNow();
            res.json({ success: result.success, message: result.message, data: deps.scheduler.getStatus() });
          } else {
            res.status(400).json({ success: false, error: 'Direct auto-close trigger not supported' });
          }
  }));

  // GitHub test & preview
  router.get('/github/test-user', asyncHandler(async (req, res) => {
    if (!deps.githubClient) {
            return res.status(501).json({ success: false, error: 'GitHub client not configured' });
          }
          const email = String(req.query.email || '').trim();
          const rawUser = String(req.query.username || '').trim();
          let username = rawUser;
          if (!username && email) {
            username = (await deps.githubClient.resolveUserByEmail(email)) || '';
          }
          if (!username) {
            return res.status(404).json({ success: false, error: `Could not resolve GitHub username for '${email || 'unspecified'}'` });
          }
          const config = await deps.config.getConfig();
          const targetDate = String(req.query.date || '').trim() || getTodayIso(config.timezone);
          const deliverables = await deps.githubClient.getPrDeliverablesForDate(username, targetDate, config.timezone, {
            org: config.githubOrg,
          });
          res.json({ success: true, data: { email, username, deliverables } });
  }));

  // Daily PR Tracking by Team Member
  router.get('/github/daily-prs', asyncHandler(async (req, res) => {
    if (!deps.githubClient) {
            return res.status(501).json({ success: false, error: 'GitHub client not configured' });
          }
          const config = await deps.config.getConfig();
          const timezone = config.timezone || 'Asia/Kolkata';
          const targetDate = String(req.query.date || '').trim() || getTodayIso(timezone);
          const result = await deps.githubClient.getDailyPullRequestsSummary({
            people: config.people || [],
            targetIsoDate: targetDate,
            timezone,
            org: config.githubOrg,
          });
          res.json({ success: true, data: result });
  }));

  // Logs
  router.get('/logs/recent', (req, res) => {
    try {
      const limit = parsePageLimit(req.query.limit, 300, 1000);
      res.json({ success: true, data: logger.getRecentLogs(limit) });
    } catch (err: unknown) {
      res.status(400).json({ success: false, error: getErrorMessage(err) });
    }
  });

  router.get('/logs/stream', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    // Replay recent history so a fresh client isn't empty
    for (const entry of logger.getRecentLogs(100)) {
      res.write(`data: ${JSON.stringify(entry)}\n\n`);
    }

    const unsubscribe = logger.addListener(entry => {
      try {
        res.write(`data: ${JSON.stringify(entry)}\n\n`);
      } catch {
        // client socket closed
      }
    });

    const heartbeat = setInterval(() => {
      try {
        res.write(': ping\n\n');
      } catch {
        clearInterval(heartbeat);
        unsubscribe();
      }
    }, 15000);

    req.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
    });
  });

  return router;
}