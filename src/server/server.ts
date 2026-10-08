import * as fs from 'fs';
import * as http from 'http';
import * as path from 'path';
import { logger } from '../utils/logger.js';
import { loadDotenv } from '../utils/dotenv.js';
import { ApiRouter } from './api-router.js';

const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

export class AppServer {
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
    this.apiRouter = new ApiRouter();
    const distUi = path.resolve(process.cwd(), 'dist/ui');
    const srcUi = path.resolve(process.cwd(), 'src/ui');
    this.staticDir = fs.existsSync(distUi) ? distUi : srcUi;

    this.server = http.createServer(async (req, res) => {
      // Set basic CORS headers
      res.setHeader('Access-Control-Allow-Origin', '*');
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
      }

      // Try API router first
      const handled = await this.apiRouter.handleRequest(req, res);
      if (handled) return;

      // Serve static frontend assets
      this.serveStatic(req, res);
    });
  }

  private serveStatic(req: http.ServerResponse['req'], res: http.ServerResponse): void {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    let relativePath = url.pathname;

    if (relativePath === '/' || relativePath === '') {
      relativePath = '/index.html';
    }

    const filePath = path.join(this.staticDir, relativePath);

    // Security check: prevent directory traversal
    if (!filePath.startsWith(this.staticDir)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Access Denied');
      return;
    }

    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      // Fallback to index.html for SPA navigation
      const indexPath = path.join(this.staticDir, 'index.html');
      if (fs.existsSync(indexPath)) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        fs.createReadStream(indexPath).pipe(res);
        return;
      }
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found');
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache',
    });
    fs.createReadStream(filePath).pipe(res);
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
