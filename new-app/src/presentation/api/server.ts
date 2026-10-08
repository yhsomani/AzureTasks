/**
 * HTTP Server
 * Wires dependencies and serves the API + static UI
 */

import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import express from 'express';
import cors from 'cors';
import { createApiRouter, ApiDependencies } from './routes.js';
import { logger } from '../../infrastructure/logging/logger.js';

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
      this.server.on('error', (err: any) => {
        if (err.code === 'EADDRINUSE') {
          logger.warn(`Port ${this.port} in use, trying ${this.port + 1}...`);
          this.port++;
          this.server.listen(this.port);
        } else {
          reject(err);
        }
      });

      this.server.listen(this.port, () => {
        logger.info(`Web UI running at http://localhost:${this.port}`);
        resolve(this.port);
      });
    });
  }

  stop(): Promise<void> {
    return new Promise(resolve => this.server.close(() => resolve()));
  }
}