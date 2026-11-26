import {
  test as base,
  expect,
  type APIResponse,
  type BrowserContext,
  type Page,
} from '@playwright/test';
import {
  DEFAULT_SEED_PEOPLE,
  startAcceptanceServer,
  type AcceptanceServerHandle,
} from './acceptance-server.js';
import type { MockAzureServer } from '../mocks/mock-azure.js';
import type { MockGitHubServer } from '../mocks/mock-github.js';
import type { MockOidcServer } from '../mocks/mock-oidc.js';

export { DEFAULT_SEED_PEOPLE };

export interface AcceptanceEnv {
  baseUrl: string;
  isExternal: boolean;
  server: AcceptanceServerHandle | null;
  adminHeader: string;
  auditorHeader: string;
  mockAzure: MockAzureServer | null;
  mockGitHub: MockGitHubServer | null;
  mockOidc: MockOidcServer | null;
}

export interface GotoRouteOptions {
  role?: 'admin' | 'auditor' | 'anonymous';
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle';
}

export interface AcceptanceTestFixtures {
  adminHeaders: Record<string, string>;
  auditorHeaders: Record<string, string>;
  apiGet: (routePath: string, headers?: Record<string, string>) => Promise<APIResponse>;
  apiPost: (routePath: string, data?: unknown, headers?: Record<string, string>) => Promise<APIResponse>;
  apiPut: (routePath: string, data?: unknown, headers?: Record<string, string>) => Promise<APIResponse>;
  apiDelete: (routePath: string, headers?: Record<string, string>) => Promise<APIResponse>;
  loginBasicContext: (role?: 'admin' | 'auditor', target?: Page | BrowserContext) => Promise<void>;
  gotoRoute: (routePath: string, options?: GotoRouteOptions) => Promise<void>;
}

export interface AcceptanceWorkerFixtures {
  appEnv: AcceptanceEnv;
}

function buildUrl(baseUrl: string, routePath: string): string {
  if (/^https?:\/\//i.test(routePath)) return routePath;
  const normalizedBase = baseUrl.replace(/\/+$/, '');
  const normalizedPath = routePath.startsWith('/') ? routePath : `/${routePath}`;
  return `${normalizedBase}${normalizedPath}`;
}

export const test = base.extend<AcceptanceTestFixtures, AcceptanceWorkerFixtures>({
  appEnv: [
    async ({}, use) => {
      const externalUrl = process.env.PLAYWRIGHT_BASE_URL?.trim();
      if (externalUrl) {
        const adminUser = process.env.E2E_ADMIN_USER || 'admin';
        const adminPass = process.env.E2E_ADMIN_PASS || 'e2e-admin-secret';
        const auditorUser = process.env.E2E_AUDITOR_USER || 'auditor';
        const auditorPass = process.env.E2E_AUDITOR_PASS || 'e2e-auditor-secret';
        await use({
          baseUrl: externalUrl.replace(/\/+$/, ''),
          isExternal: true,
          server: null,
          adminHeader: `Basic ${Buffer.from(`${adminUser}:${adminPass}`, 'utf8').toString('base64')}`,
          auditorHeader: `Basic ${Buffer.from(`${auditorUser}:${auditorPass}`, 'utf8').toString('base64')}`,
          mockAzure: null,
          mockGitHub: null,
          mockOidc: null,
        });
        return;
      }

      const server = await startAcceptanceServer({ authMode: 'basic' });
      try {
        await use({
          baseUrl: server.baseUrl,
          isExternal: false,
          server,
          adminHeader: server.basicAdminHeader,
          auditorHeader: server.basicAuditorHeader,
          mockAzure: server.mockAzure,
          mockGitHub: server.mockGitHub,
          mockOidc: server.mockOidc,
        });
      } finally {
        await server.stop();
      }
    },
    { scope: 'worker' },
  ],

  adminHeaders: async ({ appEnv }, use) => {
    await use({ Authorization: appEnv.adminHeader });
  },

  auditorHeaders: async ({ appEnv }, use) => {
    await use({ Authorization: appEnv.auditorHeader });
  },

  apiGet: async ({ appEnv, adminHeaders, request }, use) => {
    await use(async (routePath, headers) => {
      return request.get(buildUrl(appEnv.baseUrl, routePath), {
        headers: headers !== undefined ? headers : adminHeaders,
      });
    });
  },

  apiPost: async ({ appEnv, adminHeaders, request }, use) => {
    await use(async (routePath, data, headers) => {
      return request.post(buildUrl(appEnv.baseUrl, routePath), {
        data,
        headers: headers !== undefined ? headers : adminHeaders,
      });
    });
  },

  apiPut: async ({ appEnv, adminHeaders, request }, use) => {
    await use(async (routePath, data, headers) => {
      return request.put(buildUrl(appEnv.baseUrl, routePath), {
        data,
        headers: headers !== undefined ? headers : adminHeaders,
      });
    });
  },

  apiDelete: async ({ appEnv, adminHeaders, request }, use) => {
    await use(async (routePath, headers) => {
      return request.delete(buildUrl(appEnv.baseUrl, routePath), {
        headers: headers !== undefined ? headers : adminHeaders,
      });
    });
  },

  loginBasicContext: async ({ appEnv, page }, use) => {
    await use(async (role = 'admin', target) => {
      const header = role === 'auditor' ? appEnv.auditorHeader : appEnv.adminHeader;
      const receiver = target ?? page;
      await receiver.setExtraHTTPHeaders({ Authorization: header });
    });
  },

  gotoRoute: async ({ appEnv, loginBasicContext, page }, use) => {
    await use(async (routePath, options = {}) => {
      const role = options.role ?? 'admin';
      if (role === 'anonymous') {
        await page.setExtraHTTPHeaders({});
      } else {
        await loginBasicContext(role, page);
      }
      await page.goto(buildUrl(appEnv.baseUrl, routePath), {
        waitUntil: options.waitUntil ?? 'domcontentloaded',
      });
    });
  },
});

export { expect };
