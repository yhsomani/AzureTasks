/**
 * API Routes
 * HTTP endpoints exposing application use cases
 */

import { Router } from 'express';
import { CreateTasksUseCase } from '../../application/use-cases/create-tasks.js';
import { PlanTasksUseCase } from '../../application/use-cases/plan-tasks.js';
import { GetSystemStatusUseCase } from '../../application/use-cases/get-status.js';
import { ConfigUseCases } from '../../application/use-cases/config.js';
import { ExploreTasksUseCase } from '../../application/use-cases/explore-tasks.js';
import { RepairRelationsUseCase } from '../../application/use-cases/repair-relations.js';
import { CloseDailyTasksUseCase } from '../../application/use-cases/close-daily-tasks.js';
import { GitHubClient } from '../../infrastructure/github/github-client.js';
import { JournalRepository, SchedulerRepository } from '../../domain/ports/repositories.js';
import { logger } from '../../infrastructure/logging/logger.js';

export interface ApiDependencies {
  createTasks: CreateTasksUseCase;
  planTasks: PlanTasksUseCase;
  exploreTasks: ExploreTasksUseCase;
  getStatus: GetSystemStatusUseCase;
  config: ConfigUseCases;
  repairRelations?: RepairRelationsUseCase;
  closeDailyTasks?: CloseDailyTasksUseCase;
  githubClient?: GitHubClient;
  journal: JournalRepository;
  scheduler: SchedulerRepository;
}

export function createApiRouter(deps: ApiDependencies): Router {
  const router = Router();

  // Health check
  router.get('/health', (_req, res) => {
    res.json({ status: 'healthy', timestamp: new Date().toISOString() });
  });

  // Status
  router.get('/status', async (_req, res) => {
    try {
      const data = await deps.getStatus.execute();
      res.json({ success: true, data });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Config
  router.get('/config', async (_req, res) => {
    try {
      const data = await deps.config.getConfig();
      res.json({ success: true, data });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post('/config/people', async (req, res) => {
    try {
      const data = await deps.config.savePeople(req.body);
      res.json({ success: true, data });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  router.post('/config/settings', async (req, res) => {
    try {
      const data = await deps.config.saveSettings(req.body);
      const savedGhToken = typeof req.body?.githubToken === 'string' ? req.body.githubToken.trim() : '';
      if (savedGhToken) logger.registerSecret(savedGhToken);
      res.json({ success: true, data });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  router.post('/config/pat', async (req, res) => {
    try {
      const data = await deps.config.savePat(req.body);
      // Scrub the newly saved PAT from all future log output.
      const savedPat = typeof req.body?.pat === 'string' ? req.body.pat.trim() : '';
      if (savedPat) logger.registerSecret(savedPat);
      res.json({ success: true, data });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  // Tasks
  router.post('/tasks/plan', async (req, res) => {
    try {
      const { personKeys, asOf, thursdayMode } = req.body || {};
      const data = await deps.planTasks.execute({
        personKeys,
        all: !personKeys || personKeys.length === 0,
        asOf,
        thursdayMode,
      });
      res.json({ success: true, data });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  router.post('/tasks/execute', async (req, res) => {
    try {
      const { personKeys, asOf, thursdayMode, dryRun } = req.body || {};
      const data = await deps.createTasks.execute(
        {
          personKeys,
          all: !personKeys || personKeys.length === 0,
          asOf,
          thursdayMode,
          dryRun: !!dryRun,
          yes: true,
        },
        (event) => logger.info(event.message)
      );
      res.json({ success: true, data });
    } catch (err: any) {
      logger.error(`Task execution failed: ${err.message}`);
      res.status(400).json({ success: false, error: err.message });
    }
  });

  router.post('/tasks/adhoc', async (req, res) => {
    try {
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

      const result = await deps.createTasks.executeAdHocTask({
        personKey,
        targetIsoDate,
        customTitle,
        sourceTaskId: sourceTaskId ? parseInt(sourceTaskId, 10) : undefined,
        originalEstimate: originalEstimate !== undefined && originalEstimate !== '' ? parseFloat(originalEstimate) : undefined,
        activity,
        description,
        bypassDuplicateCheck: Boolean(bypassDuplicateCheck),
      });

      res.json({ success: true, data: result });
    } catch (err: any) {
      logger.error(`Ad-hoc task creation failed: ${err.message}`);
      res.status(400).json({ success: false, error: err.message });
    }
  });

  router.post('/tasks/repair', async (_req, res) => {
    try {
      if (!deps.repairRelations) {
        return res.status(400).json({ success: false, error: 'RepairRelationsUseCase not configured' });
      }
      logger.info('Repair API requested: re-copying missing relations...');
      const report = await deps.repairRelations.execute();
      res.json({ success: true, data: report });
    } catch (err: any) {
      logger.error(`Repair relations failed: ${err.message}`);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post('/tasks/close-today', async (req, res) => {
    try {
      if (!deps.closeDailyTasks) {
        return res.status(501).json({ success: false, error: 'EOD task closure is not configured' });
      }
      const { personKeys, asOf, dryRun } = req.body || {};
      logger.info(`EOD task closure requested (dryRun=${Boolean(dryRun)}, asOf=${asOf || 'today'})...`);
      const result = await deps.closeDailyTasks.execute({
        personKeys,
        asOf,
        dryRun: Boolean(dryRun),
        bypassRules: true,
      });
      res.json({ success: true, data: result });
    } catch (err: any) {
      logger.error(`EOD task closure failed: ${err.message}`);
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Explorer
  router.get('/explorer', async (req, res) => {
    try {
      const preset = typeof req.query.preset === 'string' ? req.query.preset : undefined;
      const startDate = typeof req.query.startDate === 'string' ? req.query.startDate : undefined;
      const endDate = typeof req.query.endDate === 'string' ? req.query.endDate : undefined;
      const asOf = typeof req.query.asOf === 'string' ? req.query.asOf : undefined;
      const usersParam = typeof req.query.users === 'string' ? req.query.users : undefined;
      const personKeys = usersParam ? usersParam.split(',').map(s => s.trim()).filter(Boolean) : undefined;

      const data = await deps.exploreTasks.execute({
        preset,
        startDate,
        endDate,
        asOf,
        personKeys,
      });
      res.json({ success: true, data });
    } catch (err: any) {
      res.status(400).json({ success: false, error: err.message });
    }
  });

  router.post('/explorer/create-missing', async (req, res) => {
    try {
      const { personKeys, asOf, thursdayMode } = req.body || {};
      const data = await deps.createTasks.execute(
        {
          personKeys,
          all: !personKeys || personKeys.length === 0,
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
    } catch (err: any) {
      logger.error(`Explorer create-missing failed: ${err.message}`);
      res.status(400).json({ success: false, error: err.message });
    }
  });

  // Journal
  router.get('/journal', async (req, res) => {
    try {
      const limit = parseInt(String(req.query.limit || '100'), 10);
      const entries = await deps.journal.getEntries(limit);
      const unfinished = await deps.journal.getUnfinishedRelations();
      res.json({
        success: true,
        data: { totalEntries: entries.length, incompleteEntriesCount: unfinished.length, entries },
      });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.get('/journal/export', async (req, res) => {
    try {
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
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Scheduler
  router.get('/scheduler', (_req, res) => {
    res.json({ success: true, data: deps.scheduler.getStatus() });
  });

  router.post('/scheduler/toggle', async (req, res) => {
    try {
      const shouldEnable = req.body?.enabled !== undefined
        ? Boolean(req.body.enabled)
        : Boolean(req.body?.enable);
      const persist = req.body?.persist !== undefined ? Boolean(req.body.persist) : true;
      if (shouldEnable) await deps.scheduler.start(persist);
      else await deps.scheduler.stop(persist);
      res.json({ success: true, data: deps.scheduler.getStatus() });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post('/scheduler/config', async (req, res) => {
    try {
      const { startTime, timezone, autoStart, autoClose, autoCloseStartTime, autoCloseEndTime } = req.body || {};
      if (deps.scheduler.configure) {
        await deps.scheduler.configure({
          startTime,
          timezone,
          autoStart,
          autoClose,
          autoCloseStartTime,
          autoCloseEndTime,
        });
      }
      res.json({ success: true, data: deps.scheduler.getStatus() });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post('/scheduler/run-now', async (_req, res) => {
    try {
      if (deps.scheduler.triggerRunNow) {
        const result = await deps.scheduler.triggerRunNow();
        res.json({ success: result.success, message: result.message, data: deps.scheduler.getStatus() });
      } else {
        res.status(400).json({ success: false, error: 'Direct run trigger not supported' });
      }
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  router.post('/scheduler/trigger-autoclose', async (_req, res) => {
    try {
      if (deps.scheduler.triggerAutoCloseNow) {
        const result = await deps.scheduler.triggerAutoCloseNow();
        res.json({ success: result.success, message: result.message, data: deps.scheduler.getStatus() });
      } else {
        res.status(400).json({ success: false, error: 'Direct auto-close trigger not supported' });
      }
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // GitHub test & preview
  router.get('/github/test-user', async (req, res) => {
    try {
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
      const targetDate = String(req.query.date || '').trim() || new Date().toISOString().split('T')[0];
      const deliverables = await deps.githubClient.getPrDeliverablesForDate(username, targetDate, config.timezone, {
        org: config.githubOrg,
      });
      res.json({ success: true, data: { email, username, deliverables } });
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Logs
  router.get('/logs/recent', (req, res) => {
    const limit = parseInt(String(req.query.limit || '300'), 10);
    res.json({ success: true, data: logger.getRecentLogs(limit) });
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