import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import express from 'express';
import cors from 'cors';
import { logger } from '../utils/logger.js';
import { loadDotenv } from '../utils/dotenv.js';
import { ApiRouter } from './api-router.js';

export class AppServer {
  private app: express.Application;
  private server: http.Server;
  private apiRouter: ApiRouter;
  private staticDir: string;

  constructor(private port: number = 3000) {
    loadDotenv();
    if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === undefined) {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
    }
    const pat = process.env.AZURE_DEVOPS_PAT?.trim();
    if (pat) {
      logger.registerSecret(pat);
    }
    
    this.app = express();
    this.server = http.createServer(this.app);
    this.apiRouter = new ApiRouter();
    
    const distUi = path.resolve(process.cwd(), 'dist/ui');
    const srcUi = path.resolve(process.cwd(), 'src/ui');
    this.staticDir = fs.existsSync(distUi) ? distUi : srcUi;

    this.configureMiddleware();
    this.configureRoutes();
  }

  private configureMiddleware() {
    this.app.use(cors());
    this.app.use(express.json());
    // Attach raw request for SSE (Server Sent Events) logs stream if needed
  }

  private configureRoutes() {
    // API Routes
    this.app.use('/api', this.apiRouter.getRouter());

    // Static Frontend
    this.app.use(express.static(this.staticDir));

    // SPA Fallback
    this.app.get('*', (req, res) => {
      const indexPath = path.join(this.staticDir, 'index.html');
      if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
      } else {
        res.status(404).send('Not Found');
      }
    });
  }

  public start(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server.on('error', (err: any) => {
        if (err.code === 'EADDRINUSE') {
          logger.warn(`Port ${this.port} is already in use. Retrying on port ${this.port + 1}...`);
          this.port++;
          this.server.listen(this.port);
        } else {
          reject(err);
        }
      });

      this.server.listen(this.port, () => {
        logger.info(`Azure DevOps Task Automation Web UI running at http://localhost:${this.port}`);
        resolve(this.port);
      });
    });
  }

  public stop(): Promise<void> {
    return new Promise((resolve) => {
      this.server.close(() => resolve());
    });
  }
}
