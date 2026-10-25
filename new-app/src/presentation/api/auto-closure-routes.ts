/**
 * Auto-Closure Configuration API Routes
 * Endpoints for managing auto-closure rules and audit history
 */

import { Router, Request, Response } from 'express';
import {
  AutoClosureConfigRepository,
  AutoClosureAuditLogRepository,
  AutoClosureConfig,
} from '../../domain/ports/repositories.js';
import { AutoClosureService } from '../../domain/services/auto-closure-service.js';
import { logger } from '../../infrastructure/logging/logger.js';

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  if (typeof err === 'string') {
    return err;
  }
  return 'An unknown error occurred';
}

export interface AutoClosureRouteDependencies {
  configRepo?: AutoClosureConfigRepository;
  auditRepo?: AutoClosureAuditLogRepository;
  adminUsers?: string[];  // Email addresses of admin users
  requestingUser?: (req: Request) => string;  // Function to extract user from request
}

export function createAutoClosureRouter(deps: AutoClosureRouteDependencies): Router {
  const router = Router();
  const autoClosureService = new AutoClosureService();

  // Helper to extract user from request
  const getUser = (req: Request): string => {
    if (deps.requestingUser) {
      return deps.requestingUser(req);
    }
    return (req as any).user?.email || (req as any).authUser || 'anonymous';
  };

  // Helper to check admin authorization
  const checkAdminAuth = (req: Request, res: Response): boolean => {
    const user = getUser(req);
    const auth = autoClosureService.checkConfigurationAuthorization(user, deps.adminUsers);
    if (!auth.isAuthorized) {
      res.status(403).json({
        success: false,
        error: auth.reason,
      });
      logger.warn(`Unauthorized auto-closure config access attempt by ${user}`);
      return false;
    }
    return true;
  };

  // GET /api/auto-closure/config - Get current configuration
  router.get('/config', async (req, res) => {
    try {
      if (!deps.configRepo) {
        return res.status(503).json({
          success: false,
          error: 'Auto-closure configuration service is not available',
        });
      }

      const config = await deps.configRepo.load();
      logger.info('Auto-closure config retrieved');
      res.json({ success: true, data: config });
    } catch (err: unknown) {
      logger.error(`Failed to load auto-closure config: ${getErrorMessage(err)}`);
      res.status(500).json({ success: false, error: getErrorMessage(err) });
    }
  });

  // PUT /api/auto-closure/config - Update configuration
  router.put('/config', async (req, res) => {
    try {
      if (!checkAdminAuth(req, res)) return;

      if (!deps.configRepo) {
        return res.status(503).json({
          success: false,
          error: 'Auto-closure configuration service is not available',
        });
      }

      const user = getUser(req);
      const newConfig: AutoClosureConfig = req.body;

      if (!newConfig || typeof newConfig !== 'object') {
        return res.status(400).json({
          success: false,
          error: 'Configuration must be a valid object',
        });
      }

      // Validate configuration
      const validation = await deps.configRepo.validate(newConfig);
      if (!validation.isValid) {
        logger.warn(`Invalid auto-closure config from ${user}: ${validation.errors.join('; ')}`);
        return res.status(400).json({
          success: false,
          error: 'Configuration validation failed',
          details: {
            errors: validation.errors,
            warnings: validation.warnings,
          },
        });
      }

      // Check for conflicts
      const conflicts = autoClosureService.detectConflicts(newConfig);
      if (conflicts.length > 0) {
        logger.info(`Auto-closure config has conflicts: ${conflicts.join('; ')}`);
      }

      // Add audit metadata
      const auditedConfig = {
        ...newConfig,
        lastModifiedBy: user,
        updatedAt: new Date().toISOString(),
      };

      // Save configuration
      await deps.configRepo.save(auditedConfig);

      logger.info(
        `Auto-closure config updated by ${user}: ` +
        `${auditedConfig.enabled ? 'enabled' : 'disabled'} with ${auditedConfig.rules.length} rules`
      );

      res.json({
        success: true,
        data: auditedConfig,
        warnings: validation.warnings,
        conflicts,
      });
    } catch (err: unknown) {
      const user = getUser(req);
      logger.error(`Failed to update auto-closure config (user: ${user}): ${getErrorMessage(err)}`);
      res.status(500).json({ success: false, error: getErrorMessage(err) });
    }
  });

  // GET /api/auto-closure/audit - Get audit history
  router.get('/audit', async (req, res) => {
    try {
      if (!deps.auditRepo) {
        return res.status(503).json({
          success: false,
          error: 'Auto-closure audit service is not available',
        });
      }

      const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 100;
      const filters: any = {};

      if (req.query.taskId) {
        filters.taskId = parseInt(String(req.query.taskId), 10);
      }
      if (req.query.userId) {
        filters.userId = String(req.query.userId);
      }
      if (req.query.status) {
        filters.status = String(req.query.status);
      }
      if (req.query.triggerSource) {
        filters.triggerSource = String(req.query.triggerSource);
      }
      if (req.query.startDate) {
        filters.startDate = String(req.query.startDate);
      }
      if (req.query.endDate) {
        filters.endDate = String(req.query.endDate);
      }

      const entries = await deps.auditRepo.getEntries(
        limit > 0 && limit <= 1000 ? limit : 100,
        Object.keys(filters).length > 0 ? filters : undefined
      );

      logger.info(`Auto-closure audit history retrieved: ${entries.length} entries`);
      res.json({ success: true, data: entries, count: entries.length });
    } catch (err: unknown) {
      logger.error(`Failed to retrieve auto-closure audit: ${getErrorMessage(err)}`);
      res.status(500).json({ success: false, error: getErrorMessage(err) });
    }
  });

  // GET /api/auto-closure/audit/export/csv - Export audit as CSV
  router.get('/audit/export/csv', async (req, res) => {
    try {
      if (!deps.auditRepo) {
        return res.status(503).json({
          success: false,
          error: 'Auto-closure audit service is not available',
        });
      }

      const csv = await deps.auditRepo.exportCsv();
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename="auto-closure-audit.csv"');
      res.send(csv);

      logger.info('Auto-closure audit exported as CSV');
    } catch (err: unknown) {
      logger.error(`Failed to export auto-closure audit: ${getErrorMessage(err)}`);
      res.status(500).json({ success: false, error: getErrorMessage(err) });
    }
  });

  // GET /api/auto-closure/audit/export/json - Export audit as JSON
  router.get('/audit/export/json', async (req, res) => {
    try {
      if (!deps.auditRepo) {
        return res.status(503).json({
          success: false,
          error: 'Auto-closure audit service is not available',
        });
      }

      const json = await deps.auditRepo.exportJson();
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', 'attachment; filename="auto-closure-audit.json"');
      res.send(json);

      logger.info('Auto-closure audit exported as JSON');
    } catch (err: unknown) {
      logger.error(`Failed to export auto-closure audit: ${getErrorMessage(err)}`);
      res.status(500).json({ success: false, error: getErrorMessage(err) });
    }
  });

  // DELETE /api/auto-closure/audit - Cleanup old audit entries
  router.delete('/audit', async (req, res) => {
    try {
      if (!checkAdminAuth(req, res)) return;

      if (!deps.auditRepo) {
        return res.status(503).json({
          success: false,
          error: 'Auto-closure audit service is not available',
        });
      }

      const { beforeDate } = req.body;
      if (!beforeDate || typeof beforeDate !== 'string') {
        return res.status(400).json({
          success: false,
          error: 'beforeDate must be provided in ISO format (YYYY-MM-DD)',
        });
      }

      const user = getUser(req);
      const deleted = await deps.auditRepo.cleanup(beforeDate);

      logger.info(`Auto-closure audit cleanup by ${user}: ${deleted} entries deleted before ${beforeDate}`);

      res.json({
        success: true,
        data: { deleted, beforeDate },
      });
    } catch (err: unknown) {
      const user = getUser(req);
      logger.error(`Failed to cleanup auto-closure audit (user: ${user}): ${getErrorMessage(err)}`);
      res.status(500).json({ success: false, error: getErrorMessage(err) });
    }
  });

  return router;
}
