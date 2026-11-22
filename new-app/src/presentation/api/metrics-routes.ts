import { Router, Request, Response } from 'express';
import { metricsRegistry } from '../../infrastructure/telemetry/metrics.js';

export function createMetricsRouter(): Router {
  const router = Router();

  router.get('/metrics', (req: Request, res: Response) => {
    const metricsToken = process.env.METRICS_AUTH_TOKEN;
    if (metricsToken) {
      const authHeader = req.headers.authorization;
      if (!authHeader) {
        return res.status(401).json({ error: 'Unauthorized', message: 'Metrics authorization required' });
      }
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : authHeader.trim();
      if (token !== metricsToken) {
        return res.status(403).json({ error: 'Forbidden', message: 'Invalid metrics authorization' });
      }
    }

    const payload = metricsRegistry.renderPrometheusMetrics();
    res.setHeader('Content-Type', 'text/plain; version=0.0.4; charset=utf-8');
    return res.status(200).send(payload);
  });

  return router;
}
