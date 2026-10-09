/**
 * HTTP Server
 * Wires dependencies and serves the API + static UI
 */

import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import * as crypto from 'node:crypto';
import express from 'express';
import cors from 'cors';
import { createApiRouter, ApiDependencies } from './routes.js';
import { logger } from '../../infrastructure/logging/logger.js';

/**
 * HTTP Basic auth over a single shared secret. The browser supplies the login
 * dialog natively and caches the credentials for the session, so the SPA needs
 * no changes — its same-origin /api calls carry the header automatically.
 * Comparison is constant-time to avoid leaking the secret via timing.
 */
function basicAuth(user: string, token: string): express.RequestHandler {
  const expected = Buffer.from(`${user}:${token}`, 'utf8');
  return (req, res, next) => {
    // Liveness probe stays public so load balancers / proxies can check it.
    if (req.path === '/api/health') return next();

    const [scheme, encoded] = (req.headers.authorization ?? '').split(' ');
    if (scheme === 'Basic' && encoded) {
      const provided = Buffer.from(encoded, 'base64');
      if (provided.length === expected.length && crypto.timingSafeEqual(provided, expected)) {
        return next();
      }
    }

    res.set('WWW-Authenticate', 'Basic realm="3in1 Task Studio", charset="UTF-8"');
    res.status(401).send('Authentication required.');
  };
}

export class AppServer {
  private app: express.Application;
  private server: http.Server;

  constructor(private deps: ApiDependencies, private port: number = 3000) {
    this.app = express();
    this.server = http.createServer(this.app);
    this.configure();
  }

  private configure(): void {
    this.app.use(cors());

    // Auth (optional): set API_AUTH_TOKEN to require a login. CORS runs first so
    // preflight OPTIONS is answered before the credential check.
    const token = process.env.API_AUTH_TOKEN?.trim();
    if (token) {
      const user = process.env.API_AUTH_USER?.trim() || 'admin';
      logger.registerSecret(token);
      this.app.use(basicAuth(user, token));
      logger.info('HTTP authentication enabled (Basic).');
    } else {
      logger.warn('HTTP authentication disabled. Set API_AUTH_TOKEN to require a login.');
    }

    this.app.use(express.json({ limit: '1mb' }));

    // API
    this.app.use('/api', createApiRouter(this.deps));

    // Static UI
    const publicDir = path.resolve(process.cwd(), 'src/presentation/web/public');
    const distPublicDir = path.resolve(process.cwd(), 'dist/presentation/web/public');
    const staticDir = fs.existsSync(distPublicDir) ? distPublicDir : publicDir;

    this.app.use(express.static(staticDir));

    // SPA fallback (Express 5: use middleware, not a '*' route)
    this.app.use((_req, res) => {
      const indexPath = path.join(staticDir, 'index.html');
      if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
      } else {
        res.status(404).send('Not Found');
      }
    });
  }

  start(): Promise<number> {
    return new Promise((resolve, reject) => {
      const onListening = () => {
        const addr = this.server.address();
        const actualPort = typeof addr === 'object' && addr ? addr.port : this.port;
        logger.info(`Web UI running at http://localhost:${actualPort}`);
        resolve(actualPort);
      };

      this.server.once('listening', onListening);

      this.server.on('error', (err: any) => {
        if (err.code === 'EADDRINUSE') {
          logger.warn(`Port ${this.port} in use, trying ${this.port + 1}...`);
          this.port++;
          this.server.listen(this.port);
        } else {
          reject(err);
        }
      });

      this.server.listen(this.port);
    });
  }

  stop(): Promise<void> {
    return new Promise(resolve => this.server.close(() => resolve()));
  }
}