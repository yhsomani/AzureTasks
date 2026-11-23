import { MockAzureDevOpsServer } from './mock-azure-server.js';
import { MockGitHubServer } from './mock-github-server.js';
import { MockOidcServer } from './mock-oidc-server.js';
import { MockWebhookReceiver } from './mock-webhook-receiver.js';
import { TestDatabaseHelper } from './test-database-helper.js';
import { HttpClientHelper, ClientRequestOptions } from './client-helpers.js';
import { runCli, CliResult, CliRunnerOptions } from './cli-runner.js';
import { buildApp, App } from '../../../src/container.js';
import { AppServer } from '../../../src/presentation/api/server.js';

export interface HarnessOptions {
  enableSqlite?: boolean;
  operatorToken?: string;
  viewerToken?: string;
}

export class WorkOpsTestHarness {
  public readonly azureMock: MockAzureDevOpsServer;
  public readonly githubMock: MockGitHubServer;
  public readonly oidcMock: MockOidcServer;
  public readonly webhookMock: MockWebhookReceiver;
  public readonly dbHelper: TestDatabaseHelper;
  public readonly operatorToken: string;
  public readonly viewerToken: string;

  private httpClient: HttpClientHelper;
  private appInstance: App | null = null;
  private serverInstance: AppServer | null = null;
  private currentBaseUrl: string = '';
  private configFilePath: string = '';

  constructor(options: HarnessOptions = {}) {
    this.azureMock = new MockAzureDevOpsServer();
    this.githubMock = new MockGitHubServer();
    this.oidcMock = new MockOidcServer();
    this.webhookMock = new MockWebhookReceiver();
    this.dbHelper = new TestDatabaseHelper({ enableSqlite: options.enableSqlite });
    this.operatorToken = options.operatorToken || 'test-operator-secret-123';
    this.viewerToken = options.viewerToken || 'test-viewer-secret-123';

    this.httpClient = new HttpClientHelper(
      () => this.currentBaseUrl,
      () => this.operatorToken
    );
  }

  public get baseUrl(): string {
    return this.currentBaseUrl;
  }

  public get tempDir(): string {
    return this.dbHelper.tempDir;
  }

  public get app(): App {
    if (!this.appInstance) throw new Error('Harness app not initialized. Call start() first.');
    return this.appInstance;
  }

  public get server(): AppServer {
    if (!this.serverInstance) throw new Error('Harness server not initialized. Call start() first.');
    return this.serverInstance;
  }

  public get client(): HttpClientHelper {
    return this.httpClient;
  }

  public async start(): Promise<void> {
    await this.dbHelper.init();
    await this.azureMock.start();
    await this.githubMock.start();
    await this.oidcMock.start();
    await this.webhookMock.start();

    // Prepare test configuration file
    const configData = {
      organization: 'test-org',
      project: 'TestProject',
      baseUrl: this.azureMock.getBaseUrl(),
      githubApiUrl: this.githubMock.getBaseUrl(),
      githubToken: 'ghp_mock_token_123',
      githubOrg: 'workops',
      teamsWebhookUrl: this.webhookMock.getTeamsUrl(),
      slackWebhookUrl: this.webhookMock.getSlackUrl(),
      timezone: 'Asia/Kolkata',
      cycleAnchorDay: 4,
      people: [
        {
          key: 'dev1',
          name: 'Dev One',
          assignedTo: 'dev1@workops.test',
          email: 'dev1@workops.test',
          activity: 'Development',
          targetHoursPerDay: 8,
          enabled: true,
          autoCloseEnabled: true,
        },
        {
          key: 'dev2',
          name: 'Dev Two',
          assignedTo: 'dev2@workops.test',
          email: 'dev2@workops.test',
          activity: 'Development',
          targetHoursPerDay: 8,
          enabled: true,
          autoCloseEnabled: true,
        },
      ],
    };
    this.configFilePath = this.dbHelper.writeConfigFile(configData);

    // Set process environment overrides
    process.env.AZURE_DEVOPS_PAT = 'test-azure-pat';
    process.env.API_AUTH_TOKEN = this.operatorToken;
    process.env.API_VIEWER_TOKEN = this.viewerToken;
    process.env.GITHUB_API_URL = this.githubMock.getBaseUrl();
    process.env.NODE_ENV = 'test';
    process.env.SQLITE_PATH = this.dbHelper.getSqlitePath();

    // Build the container
    this.appInstance = await buildApp(this.configFilePath, {
      autoStartScheduler: false,
      sqlitePath: this.dbHelper.getSqlitePath(),
    });

    // Prepare API dependencies
    const apiDeps = {
      createTasks: this.appInstance.createTasks,
      planTasks: this.appInstance.planTasks,
      executeTasks: this.appInstance.executeTasks,
      exploreTasks: this.appInstance.exploreTasks,
      getStatus: this.appInstance.getStatus,
      config: this.appInstance.configUseCases,
      repairRelations: this.appInstance.repairRelations,
      closeDailyTasks: this.appInstance.closeDailyTasks,
      activateDailyTasks: this.appInstance.activateDailyTasks,
      githubClient: this.appInstance.githubClient,
      journal: this.appInstance.journal,
      scheduler: this.appInstance.scheduler,
      autoClosureConfigRepo: this.appInstance.autoClosureConfig,
      autoClosureAuditRepo: this.appInstance.autoClosureAudit,
      adminUsers: ['admin@workops.test', 'admin'],
      db: this.appInstance.db,
      secretManager: this.appInstance.secretManager,
      lockManager: this.appInstance.lockManager,
    };

    this.serverInstance = new AppServer(apiDeps as any, 0);
    const port = await this.serverInstance.start();
    this.currentBaseUrl = `http://127.0.0.1:${port}`;
  }

  public async stop(): Promise<void> {
    if (this.serverInstance) {
      await this.serverInstance.stop();
      this.serverInstance = null;
    }
    await this.azureMock.stop();
    await this.githubMock.stop();
    await this.oidcMock.stop();
    await this.webhookMock.stop();
    await this.dbHelper.cleanup();
  }

  public async reset(): Promise<void> {
    this.azureMock.reset();
    this.githubMock.reset();
    this.webhookMock.clear();
    await this.dbHelper.resetDatabase();
  }

  // HTTP Helper delegation
  public request(path: string, options?: ClientRequestOptions): Promise<Response> {
    return this.httpClient.request(path, options);
  }

  public get(path: string, options?: ClientRequestOptions): Promise<Response> {
    return this.httpClient.get(path, options);
  }

  public post(path: string, body?: any, options?: ClientRequestOptions): Promise<Response> {
    return this.httpClient.post(path, body, options);
  }

  public put(path: string, body?: any, options?: ClientRequestOptions): Promise<Response> {
    return this.httpClient.put(path, body, options);
  }

  public delete(path: string, options?: ClientRequestOptions): Promise<Response> {
    return this.httpClient.delete(path, options);
  }

  // CLI runner helper
  public async runCli(args: string[], options: CliRunnerOptions = {}): Promise<CliResult> {
    return runCli(args, {
      cwd: process.cwd(),
      ...options,
      env: {
        CONFIG_PATH: this.configFilePath,
        AZURE_DEVOPS_PAT: 'test-azure-pat',
        API_AUTH_TOKEN: this.operatorToken,
        API_VIEWER_TOKEN: this.viewerToken,
        GITHUB_API_URL: this.githubMock.getBaseUrl(),
        ...(options.env || {}),
      },
    });
  }
}

let activeHarness: WorkOpsTestHarness | null = null;

export async function startHarness(options?: HarnessOptions): Promise<WorkOpsTestHarness> {
  if (activeHarness) {
    await activeHarness.stop();
  }
  activeHarness = new WorkOpsTestHarness(options);
  await activeHarness.start();
  return activeHarness;
}

export async function stopHarness(): Promise<void> {
  if (activeHarness) {
    await activeHarness.stop();
    activeHarness = null;
  }
}

export async function resetHarness(): Promise<void> {
  if (activeHarness) {
    await activeHarness.reset();
  }
}

export function getHarness(): WorkOpsTestHarness {
  if (!activeHarness) {
    throw new Error('No active test harness. Call startHarness() first.');
  }
  return activeHarness;
}
