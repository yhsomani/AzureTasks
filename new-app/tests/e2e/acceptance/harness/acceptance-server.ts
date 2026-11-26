import { ChildProcess, spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MockAzureServer } from '../mocks/mock-azure.js';
import { createMockAzureDataDb } from '../mocks/mock-azure-data-db.js';
import { MockGitHubServer } from '../mocks/mock-github.js';
import { MockOidcServer } from '../mocks/mock-oidc.js';

export type AcceptanceAuthMode = 'basic' | 'oidc' | 'disabled';

export interface SeedPerson {
  key: string;
  name: string;
  assignedTo: string;
  enabled?: boolean;
  autoCloseEnabled?: boolean;
  sourceTaskId?: number;
  pod?: string;
  role?: string;
  titlePrefix?: string;
  githubUsername?: string;
  githubRepositories?: string[];
  githubBranches?: string[];
  aliases?: string[];
  canonicalId?: string;
}

export const DEFAULT_SEED_PEOPLE: SeedPerson[] = [
  {
    key: 'alice',
    name: 'Alice Chen',
    assignedTo: 'alice@workops.test',
    enabled: true,
    autoCloseEnabled: true,
    pod: 'POD-001 Platform Engineering',
    role: 'Developer',
    githubUsername: 'alice-dev',
    githubRepositories: ['workops/core'],
    githubBranches: ['main'],
    aliases: ['alice.chen@workops.test'],
  },
  {
    key: 'bob',
    name: 'Bob Patel',
    assignedTo: 'bob@workops.test',
    enabled: true,
    autoCloseEnabled: true,
    pod: 'POD-002 Customer Engineering',
    role: 'Lead',
    githubUsername: 'bob-lead',
    githubRepositories: ['workops/web'],
    githubBranches: ['main'],
    aliases: ['bob.patel@workops.test'],
  },
];

export interface AcceptanceServerOptions {
  authMode?: AcceptanceAuthMode;
  enableRateLimit?: boolean;
  people?: SeedPerson[];
  organization?: string;
  project?: string;
  workItemType?: string;
  titlePrefix?: string;
  timezone?: string;
  readOnlyAzureDb?: boolean;
  azureDbTeamCount?: number;
  port?: number;
  startTimeoutMs?: number;
  adminUser?: string;
  adminToken?: string;
  auditorUser?: string;
  auditorToken?: string;
  envOverrides?: Record<string, string>;
}

export interface AcceptanceRestartOverrides {
  authMode?: AcceptanceAuthMode;
  enableRateLimit?: boolean;
  port?: number;
  startTimeoutMs?: number;
  envOverrides?: Record<string, string>;
}

export interface AcceptanceServerHandle {
  baseUrl: string;
  port: number;
  tempDir: string;
  configPath: string;
  dbPath: string;
  azureDataDbPath: string;
  authMode: AcceptanceAuthMode;
  mockAzure: MockAzureServer;
  mockGitHub: MockGitHubServer;
  mockOidc: MockOidcServer;
  basicAdminHeader: string;
  basicAuditorHeader: string;
  getLogs: () => { stdout: string; stderr: string };
  stop: () => Promise<void>;
  restart: (overrides?: AcceptanceRestartOverrides) => Promise<void>;
}

function resolveRepoRoot(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(here, '../../../..');
}

async function allocateFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address();
      if (!addr || typeof addr === 'string') {
        srv.close(() => reject(new Error('Failed to allocate free TCP port')));
        return;
      }
      const port = addr.port;
      srv.close((err) => {
        if (err) reject(err);
        else resolve(port);
      });
    });
  });
}

function getPreviousWeekdayIso(): { isoDate: string; titleDate: string } {
  const d = new Date();
  d.setUTCHours(12, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - 1);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) {
    d.setUTCDate(d.getUTCDate() - 1);
  }
  const isoDate = d.toISOString().slice(0, 10);
  const titleDate = new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    month: 'short',
    day: 'numeric',
  }).format(d);
  return { isoDate, titleDate };
}

async function waitForHealth(
  baseUrl: string,
  child: ChildProcess,
  getLogs: () => { stdout: string; stderr: string },
  timeoutMs: number
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = '';

  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      const logs = getLogs();
      throw new Error(
        `Acceptance server exited prematurely with code ${child.exitCode}.\nSTDOUT:\n${logs.stdout}\nSTDERR:\n${logs.stderr}`
      );
    }

    try {
      const res = await fetch(`${baseUrl}/api/health`);
      if (res.status === 200) {
        return;
      }
      lastError = `HTTP ${res.status}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  const logs = getLogs();
  throw new Error(
    `Timed out waiting for ${baseUrl}/api/health after ${timeoutMs}ms (${lastError}).\nSTDOUT:\n${logs.stdout}\nSTDERR:\n${logs.stderr}`
  );
}

async function terminateProcess(child: ChildProcess | null): Promise<void> {
  if (!child || child.exitCode !== null) return;

  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (!settled) {
        settled = true;
        resolve();
      }
    };

    child.once('exit', finish);
    try {
      child.kill('SIGTERM');
    } catch {
      finish();
      return;
    }

    const timer = setTimeout(() => {
      if (child.exitCode === null) {
        try {
          child.kill('SIGKILL');
        } catch {
          // ignore
        }
      }
      finish();
    }, 5000);
    timer.unref();
  });
}

export async function startAcceptanceServer(
  options: AcceptanceServerOptions = {}
): Promise<AcceptanceServerHandle> {
  const repoRoot = resolveRepoRoot();
  const distEntry = path.join(repoRoot, 'dist', 'index.js');
  if (!fs.existsSync(distEntry)) {
    throw new Error(
      `Build output not found at ${distEntry}. Run "npm run build" before starting the acceptance server.`
    );
  }

  const organization = options.organization || 'test-org';
  const project = options.project || 'TestProject';
  const workItemType = options.workItemType || 'Task';
  const titlePrefix = options.titlePrefix || 'Task |';
  const timezone = options.timezone || 'UTC';
  const people = (options.people ?? DEFAULT_SEED_PEOPLE).map((p) => ({ ...p }));

  const adminUser = options.adminUser || 'admin';
  const adminToken = options.adminToken || 'e2e-admin-secret';
  const auditorUser = options.auditorUser || 'auditor';
  const auditorToken = options.auditorToken || 'e2e-auditor-secret';

  const basicAdminHeader = `Basic ${Buffer.from(`${adminUser}:${adminToken}`, 'utf8').toString('base64')}`;
  const basicAuditorHeader = `Basic ${Buffer.from(`${auditorUser}:${auditorToken}`, 'utf8').toString('base64')}`;

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'workops-e2e-'));
  const configPath = path.join(tempDir, 'people.json');
  const dbPath = path.join(tempDir, 'workops.db');
  const azureDataDbPath = path.join(tempDir, 'azure-data.db');

  // Symlink only dist/ (never src/) so AppServer resolves dist/presentation/web/public
  // while confining all process.cwd() side-effect files to tempDir.
  const distLink = path.join(tempDir, 'dist');
  fs.symlinkSync(path.join(repoRoot, 'dist'), distLink, process.platform === 'win32' ? 'junction' : 'dir');

  const prevDay = getPreviousWeekdayIso();
  const todayIso = new Date().toISOString().slice(0, 10);

  const mockAzure = new MockAzureServer({
    organization,
    projects: [
      { name: project, id: 'proj-agile-01', workItemTypes: ['Task', '3in1 Task', 'User Story', 'Bug'] },
      { name: '3in1_Agile_Projects', id: 'proj-agile-02', workItemTypes: ['Task', '3in1 Task', 'User Story', 'Bug'] },
    ],
    identities: people.map((p, idx) => ({
      id: `00000000-0000-0000-0000-00000000000${idx + 1}`,
      displayName: p.name,
      uniqueName: p.assignedTo,
      email: p.assignedTo,
      descriptor: `aad.${p.key}`,
    })),
  });

  const mockGitHub = new MockGitHubServer({
    users: people.map((p, idx) => ({
      id: idx + 100,
      login: p.githubUsername || p.key,
      email: p.assignedTo,
      name: p.name,
    })),
    prs: people.map((p, idx) => ({
      id: 9001 + idx,
      number: 101 + idx,
      title: `feat(${p.key}): daily deliverable`,
      html_url: `https://github.com/${p.githubRepositories?.[0] || 'workops/core'}/pull/${101 + idx}`,
      state: idx % 2 === 0 ? 'open' : 'closed',
      created_at: `${todayIso}T08:00:00.000Z`,
      updated_at: `${todayIso}T09:00:00.000Z`,
      closed_at: idx % 2 === 0 ? null : `${todayIso}T09:00:00.000Z`,
      pull_request: { merged_at: idx % 2 === 0 ? null : `${todayIso}T09:00:00.000Z` },
      body: `Automated PR evidence for ${p.name}`,
      repository_url: `https://api.github.com/repos/${p.githubRepositories?.[0] || 'workops/core'}`,
      authorLogin: p.githubUsername || p.key,
    })),
    commits: people.map((p, idx) => ({
      sha: `a1b2c3d4e5f6000${idx + 1}`,
      html_url: `https://github.com/${p.githubRepositories?.[0] || 'workops/core'}/commit/a1b2c3d4e5f6000${idx + 1}`,
      repo: p.githubRepositories?.[0] || 'workops/core',
      branch: p.githubBranches?.[0] || 'main',
      authorLogin: p.githubUsername || p.key,
      authorEmail: p.assignedTo,
      authorName: p.name,
      authoredAt: `${todayIso}T08:30:00.000Z`,
      message: `chore(${p.key}): update sprint tasks`,
    })),
  });

  const mockOidc = new MockOidcServer({
    audience: 'workops-api',
    clientId: 'workops-client',
  });

  const mockAzureUrl = await mockAzure.start();
  const mockGitHubUrl = await mockGitHub.start();
  const mockOidcUrl = await mockOidc.start();

  // Seed parent User Story + source task per seeded person so planning/creation/relations work out-of-the-box
  mockAzure.seedWorkItem({
    id: 100,
    fields: {
      'System.TeamProject': project,
      'System.WorkItemType': 'User Story',
      'System.Title': 'Parent Feature Story — Modernization',
      'System.State': 'Active',
      'System.AreaPath': project,
      'System.IterationPath': `${project}\\Sprint 42`,
    },
  });

  people.forEach((p, idx) => {
    const sourceId = 200 + idx;
    const prefix = p.titlePrefix || titlePrefix;
    const cleanPrefix = prefix.replace(/\|$/, '').trim();
    mockAzure.seedWorkItem({
      id: sourceId,
      fields: {
        'System.TeamProject': project,
        'System.WorkItemType': workItemType,
        'System.Title': `${cleanPrefix} | ${prevDay.titleDate} | ${p.name} Daily Work`,
        'System.State': 'Active',
        'System.AssignedTo': { displayName: p.name, uniqueName: p.assignedTo },
        'System.AreaPath': `${project}\\Platform`,
        'System.IterationPath': `${project}\\Sprint 42`,
        'Microsoft.VSTS.Scheduling.StartDate': `${prevDay.isoDate}T09:30:00Z`,
        'Custom.PlannedStartDate': `${prevDay.isoDate}T09:30:00Z`,
        'Microsoft.VSTS.Scheduling.OriginalEstimate': 8,
        'Microsoft.VSTS.Scheduling.RemainingWork': 4,
        'Microsoft.VSTS.Scheduling.CompletedWork': 4,
        'Microsoft.VSTS.Common.Activity': 'Development',
        'System.CreatedDate': `${prevDay.isoDate}T09:30:00Z`,
      },
      relations: [
        {
          rel: 'System.LinkTypes.Hierarchy-Reverse',
          url: `${mockAzureUrl}/${organization}/_apis/wit/workItems/100`,
          attributes: { name: 'Parent' },
        },
      ],
    });
  });

  createMockAzureDataDb(azureDataDbPath, {
    readOnly: options.readOnlyAzureDb ?? true,
    teamCount: options.azureDbTeamCount ?? 260,
    organization,
  });

  const configPayload = {
    organization,
    project,
    baseUrl: mockAzureUrl,
    workItemType,
    taskSeries: titlePrefix.replace(/\|$/, '').trim(),
    titlePrefix,
    startTime: '09:30',
    timezone,
    skipWeekends: true,
    stopDay: 'THURSDAY',
    stopDayOfWeek: 4,
    thursdayMode: 'CURRENT',
    defaultState: 'New',
    autoClose: false,
    autoActive: false,
    copyEstimates: true,
    resetActualWork: true,
    schedulerEnabled: false,
    schedulerAutoStart: false,
    githubApiUrl: mockGitHubUrl,
    githubOrg: 'workops',
    githubUserSuffix: '',
    people,
  };
  fs.writeFileSync(configPath, JSON.stringify(configPayload, null, 2), 'utf8');

  let currentAuthMode: AcceptanceAuthMode = options.authMode ?? 'basic';
  let currentEnableRateLimit = options.enableRateLimit ?? false;
  let currentPort = options.port ?? (await allocateFreePort());
  let currentBaseUrl = `http://127.0.0.1:${currentPort}`;
  let currentEnvOverrides = options.envOverrides ? { ...options.envOverrides } : {};
  let child: ChildProcess | null = null;
  let stdoutLog = '';
  let stderrLog = '';

  const buildEnv = (
    port: number,
    authMode: AcceptanceAuthMode,
    enableRateLimit: boolean,
    overrides: Record<string, string>
  ): NodeJS.ProcessEnv => {
    const env: NodeJS.ProcessEnv = {
      PATH: process.env.PATH || '',
      HOME: tempDir,
      NODE_ENV: 'test',
      ENABLE_RATE_LIMIT_IN_TEST: enableRateLimit ? 'true' : 'false',
      LISTEN_HOST: '127.0.0.1',
      PORT: String(port),
      SQLITE_PATH: dbPath,
      AZURE_DATA_DB: azureDataDbPath,
      AZURE_DEVOPS_PAT: 'e2e-mock-azure-pat',
      AZURE_DEVOPS_ORG: organization,
      AZURE_DEVOPS_PROJECT: project,
      AZURE_DEVOPS_BASE_URL: mockAzureUrl,
      AZURE_DEVOPS_TIMEZONE: timezone,
      GITHUB_API_URL: mockGitHubUrl,
      GITHUB_TOKEN: 'ghp_e2e_mock_github_token_1234567890abcdef',
      GITHUB_ORG: 'workops',
      GITHUB_USER_SUFFIX: '',
      GITHUB_OFFLINE: 'false',
      AUTO_CLOSE: 'false',
      PLAN_SIGNING_SECRET: 'e2e-acceptance-plan-signing-secret-32b!',
      SECRET_STORAGE_MODE: 'local-file',
      PUBLIC_ORIGIN: `http://127.0.0.1:${port}`,
    };

    if (authMode === 'basic') {
      env.API_AUTH_USER = adminUser;
      env.API_AUTH_TOKEN = adminToken;
      env.API_VIEWER_USER = auditorUser;
      env.API_VIEWER_TOKEN = auditorToken;
    } else if (authMode === 'oidc') {
      env.OIDC_ISSUER = mockOidcUrl;
      env.ENTRA_ID_ISSUER = mockOidcUrl;
      env.OIDC_CLIENT_ID = 'workops-client';
      env.OIDC_AUDIENCE = 'workops-api';
    }

    return { ...env, ...overrides };
  };

  const spawnChild = async (
    port: number,
    authMode: AcceptanceAuthMode,
    enableRateLimit: boolean,
    overrides: Record<string, string>,
    timeoutMs: number
  ): Promise<void> => {
    stdoutLog = '';
    stderrLog = '';
    const env = buildEnv(port, authMode, enableRateLimit, overrides);
    const proc = spawn(
      process.execPath,
      [distEntry, 'serve', '--port', String(port), '--config', configPath],
      {
        cwd: tempDir,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );

    proc.stdout?.setEncoding('utf8');
    proc.stderr?.setEncoding('utf8');
    proc.stdout?.on('data', (chunk: string) => {
      stdoutLog += chunk;
    });
    proc.stderr?.on('data', (chunk: string) => {
      stderrLog += chunk;
    });

    child = proc;
    const baseUrl = `http://127.0.0.1:${port}`;
    await waitForHealth(baseUrl, proc, () => ({ stdout: stdoutLog, stderr: stderrLog }), timeoutMs);
    currentPort = port;
    currentBaseUrl = baseUrl;
  };

  try {
    await spawnChild(
      currentPort,
      currentAuthMode,
      currentEnableRateLimit,
      currentEnvOverrides,
      options.startTimeoutMs ?? 20_000
    );
  } catch (err) {
    await terminateProcess(child);
    await Promise.allSettled([mockAzure.stop(), mockGitHub.stop(), mockOidc.stop()]);
    if (fs.existsSync(azureDataDbPath)) {
      fs.chmodSync(azureDataDbPath, 0o644);
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
    throw err;
  }

  const handle: AcceptanceServerHandle = {
    get baseUrl() {
      return currentBaseUrl;
    },
    get port() {
      return currentPort;
    },
    tempDir,
    configPath,
    dbPath,
    azureDataDbPath,
    get authMode() {
      return currentAuthMode;
    },
    mockAzure,
    mockGitHub,
    mockOidc,
    basicAdminHeader,
    basicAuditorHeader,
    getLogs: () => ({ stdout: stdoutLog, stderr: stderrLog }),
    stop: async () => {
      await terminateProcess(child);
      child = null;
      await Promise.allSettled([mockAzure.stop(), mockGitHub.stop(), mockOidc.stop()]);
      if (fs.existsSync(azureDataDbPath)) {
        try {
          fs.chmodSync(azureDataDbPath, 0o644);
        } catch {
          // ignore
        }
      }
      fs.rmSync(tempDir, { recursive: true, force: true });
    },
    restart: async (overrides: AcceptanceRestartOverrides = {}) => {
      await terminateProcess(child);
      child = null;
      if (overrides.authMode !== undefined) currentAuthMode = overrides.authMode;
      if (overrides.enableRateLimit !== undefined) currentEnableRateLimit = overrides.enableRateLimit;
      if (overrides.envOverrides !== undefined) {
        currentEnvOverrides = { ...overrides.envOverrides };
      }
      const nextPort = overrides.port ?? currentPort;
      await spawnChild(
        nextPort,
        currentAuthMode,
        currentEnableRateLimit,
        currentEnvOverrides,
        overrides.startTimeoutMs ?? 20_000
      );
    },
  };

  return handle;
}
