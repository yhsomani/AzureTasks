/**
 * HTTP Server
 * Wires dependencies and serves the API + static UI
 */

import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import * as crypto from 'node:crypto';
import { isIP } from 'node:net';
import express from 'express';
import cors from 'cors';
import { createApiRouter, ApiDependencies } from './routes.js';
import { logger } from '../../infrastructure/logging/logger.js';
import { unsafeRequestOriginGuard } from './request-origin.js';
import { generalLimiter, strictLimiter, authLimiter, bulkOperationsLimiter } from './rate-limiter.js';
import { validateEnvironmentSecrets, validateGitIgnore, ensureEnvExample } from './env-validation.js';
import { EntraIdAuthProvider } from '../../infrastructure/auth/entra-id-auth-provider.js';
import { createAuthRouter } from '../../infrastructure/auth/session-routes.js';
import { normalizeRole } from '../../infrastructure/auth/rbac.js';
import { tenantGuard } from '../../infrastructure/auth/tenant-guard.js';
import { tracingMiddleware } from '../../infrastructure/telemetry/tracer.js';
import { createMetricsRouter } from './metrics-routes.js';
import { createAzureDataRouter } from './azure-data-routes.js';
import { IAzureDataRepository } from '../../domain/ports/azure-data-repository.js';

/**
 * HTTP Basic auth over a single shared secret. The browser supplies the login
 * dialog natively and caches the credentials for the session, so the SPA needs
 * no changes — its same-origin /api calls carry the header automatically.
 * Comparison is constant-time to avoid leaking the secret via timing.
 */
function basicAuth(user: string, token: string, viewerUser?: string, viewerToken?: string): express.RequestHandler {
  const operator = Buffer.from(`${user}:${token}`, 'utf8');
  const viewer = viewerUser && viewerToken ? Buffer.from(`${viewerUser}:${viewerToken}`, 'utf8') : null;
  const matches = (candidate: Buffer, expected: Buffer): boolean =>
    candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);

  return (req, res, next) => {
    if (req.user || req.path === '/api/health' || req.path === '/metrics' || req.path.startsWith('/auth/')) return next();
    const [scheme, encoded] = (req.headers.authorization ?? '').split(' ');
    if (scheme === 'Basic' && encoded) {
      const provided = Buffer.from(encoded, 'base64');
      if (matches(provided, operator)) {
        (req as express.Request & { authRole?: string; authUser?: string }).authRole = 'operator';
        (req as express.Request & { authRole?: string; authUser?: string }).authUser = user;
        req.user = {
          id: user,
          email: `${user.toLowerCase()}@workops.test`,
          name: user === 'admin' ? 'System Admin' : user,
          roles: ['Admin'],
          tenantId: 'tenant-enterprise-01',
        };
        return next();
      }
      if (viewer && matches(provided, viewer)) {
        (req as express.Request & { authRole?: string; authUser?: string }).authRole = 'viewer';
        (req as express.Request & { authRole?: string; authUser?: string }).authUser = viewerUser;
        req.user = {
          id: viewerUser || 'viewer',
          email: `${(viewerUser || 'viewer').toLowerCase()}@workops.test`,
          name: 'Compliance Auditor',
          roles: ['Auditor'],
          tenantId: 'tenant-enterprise-01',
        };
        // Viewer credentials may read the UI and API but cannot mutate local
        // configuration, credentials, scheduling or remote Azure work items.
        if (['GET', 'HEAD', 'OPTIONS'].includes(req.method.toUpperCase())) return next();
        // These POST routes contain non-mutating previews. EOD and activation previews are
        // checked again after express.json() parses dryRun inside the route.
        if (req.method === 'POST' &&
          ['/api/tasks/plan', '/api/tasks/close-today', '/api/tasks/activate-today'].includes(req.path)) return next();
        return res.status(403).json({
          success: false,
          error: 'This credential has read-only access. Operator authorization is required.',
        });
      }
    }
    res.set('WWW-Authenticate', 'Basic realm="3in1 Task Studio", charset="UTF-8"');
    res.status(401).send('Authentication required.');
  };
}

export class AppServer {
  private app: express.Application;
  private server: http.Server;

  constructor(
    private deps: ApiDependencies,
    private port: number = 3000,
    private readonly options: { readOnly?: boolean; azureDataRepo?: IAzureDataRepository } = {}
  ) {
    this.app = express();
    this.server = http.createServer(this.app);
    
    // Validate environment security before configuring
    ensureEnvExample();
    validateGitIgnore();
    validateEnvironmentSecrets();
    
    this.configure();
  }

  private configure(): void {
    // Distributed tracing & OpenTelemetry W3C traceparent context propagation
    this.app.use(tracingMiddleware());

    // Prometheus Metrics endpoint (/metrics)
    this.app.use(createMetricsRouter());

    // Security headers
    this.app.use((_req, res, next) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Frame-Options', 'SAMEORIGIN');
      res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
      res.setHeader('Permissions-Policy', 'geolocation=(), camera=(), microphone=()');
      res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://api.github.com; base-uri 'self'; object-src 'none'; form-action 'self'; frame-ancestors 'self';"
      );
      next();
    });

    const allowedOrigin = process.env.CORS_ORIGIN?.trim();
    // The SPA is same-origin by default; do not advertise wildcard cross-origin
    // access to the task-mutation API unless an explicit trusted origin is set.
    if (allowedOrigin) this.app.use(cors({ origin: allowedOrigin }));

    this.app.use(unsafeRequestOriginGuard({
      publicOrigin: process.env.PUBLIC_ORIGIN?.trim(),
      allowedOrigin,
    }));

    // Enterprise OIDC / OAuth2 Authentication Provider
    const oidcIssuer = process.env.OIDC_ISSUER?.trim() || process.env.ENTRA_ID_ISSUER?.trim();
    const oidcClientId = process.env.OIDC_CLIENT_ID?.trim() || process.env.AZURE_AD_CLIENT_ID?.trim() || 'workops-client';
    const oidcAudience = process.env.OIDC_AUDIENCE?.trim() || 'workops-api';
    const authProvider = new EntraIdAuthProvider({
      issuer: oidcIssuer,
      clientId: oidcClientId,
      audience: oidcAudience,
      tenantId: process.env.AZURE_AD_TENANT_ID?.trim(),
      clientSecret: process.env.AZURE_AD_CLIENT_SECRET?.trim(),
    });

    // JWT verification middleware for OIDC tokens
    this.app.use(authProvider.createMiddleware());

    // Mount Auth session endpoints (/auth/login, /auth/callback, /auth/logout)
    this.app.use('/auth', createAuthRouter({ authProvider }));

    // Production endpoints can mutate remote Azure DevOps items and therefore
    // must never boot without an access-control boundary.
    const token = process.env.API_AUTH_TOKEN?.trim();
    if (process.env.NODE_ENV === 'production' && !token) {
      throw new Error('API_AUTH_TOKEN must be configured in production.');
    }
    if (token) {
      const user = process.env.API_AUTH_USER?.trim() || 'admin';
      const viewerToken = process.env.API_VIEWER_TOKEN?.trim();
      const viewerUser = process.env.API_VIEWER_USER?.trim() || 'viewer';
      if (viewerToken && (viewerToken === token || (viewerUser === user && viewerToken === token))) {
        throw new Error('API_VIEWER_TOKEN must differ from the operator API_AUTH_TOKEN.');
      }
      logger.registerSecret(token);
      if (viewerToken) logger.registerSecret(viewerToken);
      
      // Apply auth limiter to authentication attempts
      if (process.env.NODE_ENV !== 'test' || process.env.ENABLE_RATE_LIMIT_IN_TEST === 'true') {
        this.app.use(authLimiter);
      }
      
      this.app.use(basicAuth(user, token, viewerUser, viewerToken));
      logger.info(viewerToken ? 'HTTP authentication enabled (operator + read-only viewer).' : 'HTTP authentication enabled (operator).');
    } else if (process.env.API_VIEWER_TOKEN?.trim()) {
      throw new Error('A viewer credential requires an operator API_AUTH_TOKEN.');
    } else {
      logger.warn('HTTP authentication disabled. Set API_AUTH_TOKEN to require a login.');
    }

    // Mock role/identity support ONLY for explicit test harness (after basicAuth, never bypassing API_AUTH_TOKEN)
    this.app.use((req, _res, next) => {
      if (
        !req.user &&
        !token &&
        process.env.NODE_ENV === 'test' &&
        process.env.ENABLE_MOCK_AUTH === 'true'
      ) {
        const mockRole = (req.headers['x-mock-role'] as string) || (req.headers['x-user-role'] as string);
        const mockEmail = (req.headers['x-mock-email'] as string) || (req.headers['x-operator-email'] as string);
        if (mockRole || mockEmail) {
          const role = mockRole ? normalizeRole(mockRole) : 'Admin';
          req.user = {
            id: 'mock-user',
            email: mockEmail ? mockEmail.trim().toLowerCase() : 'admin@workops.test',
            name: 'Mock User',
            roles: [role],
            tenantId: 'tenant-enterprise-01',
          };
        }
      }
      next();
    });

    // Rate limiting middleware (applied after origin guard and auth)
    if (process.env.NODE_ENV !== 'test' || process.env.ENABLE_RATE_LIMIT_IN_TEST === 'true') {
      this.app.use(generalLimiter);
      this.app.use(strictLimiter);
      this.app.use(bulkOperationsLimiter);
    }

    this.app.use(express.json({ limit: '1mb' }));
    if (this.options.readOnly) {
      this.app.use('/api', (req, res, next) => {
        (req as express.Request & { authRole?: string }).authRole = 'viewer';
        const read = ['GET', 'HEAD', 'OPTIONS'].includes(req.method);
        const preview = req.method === 'POST' && (req.path === '/tasks/plan' ||
          (['/tasks/close-today', '/tasks/activate-today'].includes(req.path) && req.body?.dryRun === true));
        if (read || preview) return next();
        return res.status(403).json({ success: false, error: 'This server is running in read-only mode.' });
      });
    }

    // Tenant isolation guard for all API endpoints except health probe
    const tenantIsolation = tenantGuard({ requireTenant: process.env.REQUIRE_TENANT === 'true' });
    this.app.use('/api', (req, res, next) => {
      if (req.path === '/health') return next();
      return tenantIsolation(req, res, next);
    });

    // Azure Data Intelligence API
    this.app.use('/api/azure-data', createAzureDataRouter(this.options.azureDataRepo || this.deps.azureDataRepo));

    // API
    this.app.use('/api', createApiRouter(this.deps));
    // An unknown API route must never be answered with the SPA HTML shell.
    this.app.use('/api', (_req, res) => {
      res.status(404).json({ success: false, error: 'API route not found.' });
    });

    // Static UI: in non-prod serve src/presentation/web/public first (for index.html/styles.css)
    // and fall back to dist/presentation/web/public (for Vite-built /assets/*) without copying into src/.
    const publicDir = path.resolve(process.cwd(), 'src/presentation/web/public');
    const distPublicDir = path.resolve(process.cwd(), 'dist/presentation/web/public');
    const isProd = process.env.NODE_ENV === 'production';
    const staticOptions: Parameters<typeof express.static>[1] = {
      maxAge: 0,
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html') || filePath.endsWith('.js') || filePath.endsWith('.css')) {
          res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
          res.setHeader('Pragma', 'no-cache');
          res.setHeader('Expires', '0');
        }
      },
    };

    if (isProd) {
      const prodStaticDir = fs.existsSync(distPublicDir) ? distPublicDir : publicDir;
      this.app.use(express.static(prodStaticDir, staticOptions));
    } else {
      if (fs.existsSync(publicDir)) {
        this.app.use(express.static(publicDir, staticOptions));
      }
      if (fs.existsSync(distPublicDir)) {
        this.app.use(express.static(distPublicDir, staticOptions));
      }
    }

    // SPA fallback (Express 5: use middleware, not a '*' route)
    this.app.use((req, res) => {
      if (req.path.startsWith('/assets/')) {
        res.status(404).send('Not Found');
        return;
      }
      const indexDir = isProd
        ? (fs.existsSync(distPublicDir) ? distPublicDir : publicDir)
        : (fs.existsSync(path.join(publicDir, 'index.html')) ? publicDir : distPublicDir);
      const indexPath = path.join(indexDir, 'index.html');
      if (fs.existsSync(indexPath)) {
        res.sendFile(indexPath);
      } else {
        res.status(404).send('Not Found');
      }
    });
  }

  getApp(): express.Application {
    return this.app;
  }

  start(): Promise<number> {
    // Basic authentication is not TLS. An authenticated service must not
    // silently bind public interfaces and bypass its HTTPS reverse proxy.
    // Containers requiring a wildcard interface must explicitly configure it
    // and keep that backend port private to the trusted ingress network.
    const listenHost = process.env.LISTEN_HOST?.trim() || '127.0.0.1';
    if (listenHost !== 'localhost' && isIP(listenHost) === 0) {
      return Promise.reject(new Error('LISTEN_HOST must be localhost or a numeric IPv4/IPv6 address.'));
    }
    return new Promise((resolve, reject) => {
      let retries = 0;
      const onListening = () => {
        const addr = this.server.address();
        const actualPort = typeof addr === 'object' && addr ? addr.port : this.port;
        const displayHost = isIP(listenHost) === 6 ? `[${listenHost}]` : listenHost;
        logger.info(`Web UI listening at http://${displayHost}:${actualPort} (internal HTTP only; configure external HTTPS termination).`);
        resolve(actualPort);
      };

      const listen = () => this.server.listen(this.port, listenHost);
      this.server.once('listening', onListening);

      this.server.on('error', (err: any) => {
        if (err.code === 'EADDRINUSE' && process.env.NODE_ENV !== 'production' && retries++ < 3) {
          logger.warn(`Port ${this.port} in use, trying ${this.port + 1}...`);
          this.port++;
          listen();
        } else {
          reject(err);
        }
      });

      listen();
    });
  }

  stop(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (typeof (this.server as any).closeAllConnections === 'function') {
        (this.server as any).closeAllConnections();
      }
      this.server.close(err => {
        if (err && (err as any).code !== 'ERR_SERVER_NOT_RUNNING') {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }
}