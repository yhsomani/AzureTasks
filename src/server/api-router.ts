import * as fs from 'fs';
import { IncomingMessage, ServerResponse } from 'http';
import * as path from 'path';
import { AzureDevOpsClient } from '../azure/client.js';
import { WorkItemService } from '../azure/work-item-service.js';
import { AppConfig, loadConfig, PersonConfig } from '../config/config.js';
import { TaskJournal } from '../task/journal.js';
import { TaskOrchestrator } from '../task/task-orchestrator.js';
import { TaskScheduler } from '../task/scheduler.js';
import { TaskExplorerService } from '../task/task-explorer.js';
import { getTodayIso } from '../date/date-engine.js';
import { logger } from '../utils/logger.js';
import { ApiResponse, SystemStatusData } from './types.js';

export class ApiRouter {
  private client: AzureDevOpsClient | null = null;
  private config: AppConfig;
  private scheduler: TaskScheduler;

  constructor() {
    this.config = loadConfig();
    this.scheduler = new TaskScheduler(this.config);
    this.initClient();
  }

  private initClient(): void {
    const pat = process.env.AZURE_DEVOPS_PAT?.trim();
    if (pat) {
      logger.registerSecret(pat);
      this.client = new AzureDevOpsClient({
        organization: this.config.organization,
        pat,
        baseUrl: this.config.baseUrl,
        maxRetries: this.config.maxRetries,
      });
    }
  }

  public async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;
    const method = req.method || 'GET';

    if (!pathname.startsWith('/api/')) {
      return false; // Handled by static server
    }

    try {
      if (method === 'GET' && pathname === '/api/status') {
        await this.handleGetStatus(res);
        return true;
      }

      if (method === 'GET' && pathname === '/api/config') {
        await this.handleGetConfig(res);
        return true;
      }

      if (method === 'POST' && pathname === '/api/config/people') {
        const body = await this.readJsonBody(req);
        await this.handleSavePeople(body, res);
        return true;
      }

      if (method === 'POST' && pathname === '/api/config/settings') {
        const body = await this.readJsonBody(req);
        await this.handleSaveSettings(body, res);
        return true;
      }

      if (method === 'POST' && pathname === '/api/config/pat') {
        const body = await this.readJsonBody(req);
        await this.handleSavePat(body, res);
        return true;
      }

      if (method === 'GET' && pathname === '/api/tasks/live') {
        await this.handleGetLiveTasks(res);
        return true;
      }

      if (method === 'POST' && pathname === '/api/tasks/plan') {
        const body = await this.readJsonBody(req);
        await this.handlePlanTasks(body, res);
        return true;
      }

      if (method === 'POST' && pathname === '/api/tasks/execute') {
        const body = await this.readJsonBody(req);
        await this.handleExecuteTasks(body, res);
        return true;
      }

      if (method === 'GET' && pathname === '/api/explorer') {
        await this.handleGetExplorer(url, res);
        return true;
      }

      if (method === 'POST' && pathname === '/api/explorer/create-missing') {
        const body = await this.readJsonBody(req);
        await this.handleCreateMissingFromExplorer(body, res);
        return true;
      }

      if (method === 'GET' && pathname === '/api/journal') {
        await this.handleGetJournal(res);
        return true;
      }

      if (method === 'GET' && pathname === '/api/journal/export') {
        await this.handleExportJournal(url, res);
        return true;
      }

      if (method === 'POST' && pathname === '/api/journal/repair') {
        await this.handleRepairJournal(res);
        return true;
      }

      if (method === 'GET' && pathname === '/api/scheduler') {
        await this.handleGetScheduler(res);
        return true;
      }

      if (method === 'POST' && pathname === '/api/scheduler/toggle') {
        const body = await this.readJsonBody(req);
        await this.handleToggleScheduler(body, res);
        return true;
      }

      if (method === 'GET' && pathname === '/api/logs') {
        await this.handleGetLogs(url, res);
        return true;
      }

      if (method === 'GET' && pathname === '/api/logs/stream') {
        await this.handleStreamLogs(req, res);
        return true;
      }

      this.sendJson(res, 404, { success: false, error: `API route not found: ${pathname}` });
      return true;
    } catch (err: any) {
      logger.error(`API Error on ${method} ${pathname}: ${err.message}`);
      this.sendJson(res, 500, { success: false, error: err.message || 'Internal Server Error' });
      return true;
    }
  }

  private async handleGetStatus(res: ServerResponse): Promise<void> {
    const pat = process.env.AZURE_DEVOPS_PAT?.trim() || '';
    const patConfigured = pat.length > 0;
    const patMasked = patConfigured ? `${pat.slice(0, 4)}...${pat.slice(-4)}` : '';

    let connected = false;
    let projectValid = false;
    let workItemTypeValid = false;
    let statusError: string | undefined;

    if (this.client) {
      try {
        const wis = new WorkItemService(this.client);
        await wis.validateProject(this.config.project);
        projectValid = true;
        await wis.validateWorkItemType(this.config.project, this.config.workItemType);
        workItemTypeValid = true;
        connected = true;
      } catch (err: any) {
        connected = false;
        statusError = err.message || String(err);
      }
    } else if (!patConfigured) {
      statusError = 'AZURE_DEVOPS_PAT is not configured.';
    }

    const data: SystemStatusData = {
      organization: this.config.organization,
      project: this.config.project,
      baseUrl: this.config.baseUrl,
      connected,
      patConfigured,
      patMasked,
      projectValid,
      workItemTypeValid,
      timezone: this.config.timezone,
      thursdayMode: this.config.thursdayMode,
      errorMessage: statusError,
    };

    this.sendJson(res, 200, { success: true, data });
  }

  private async handleGetConfig(res: ServerResponse): Promise<void> {
    this.config = loadConfig();
    this.sendJson(res, 200, { success: true, data: this.config });
  }

  private async handleSavePeople(body: any, res: ServerResponse): Promise<void> {
    if (!body || !Array.isArray(body.people)) {
      this.sendJson(res, 400, { success: false, error: 'Expected { people: [...] } payload.' });
      return;
    }

    const people: PersonConfig[] = body.people;
    const seenIdentities = new Set<string>();

    for (const p of people) {
      if (!p.name?.trim() || !p.assignedTo?.trim()) {
        this.sendJson(res, 400, {
          success: false,
          error: 'Each person must have non-empty name and assignedTo fields.',
        });
        return;
      }
      const lower = p.assignedTo.trim().toLowerCase();
      if (seenIdentities.has(lower)) {
        this.sendJson(res, 400, {
          success: false,
          error: `Duplicate identity "${p.assignedTo}". Multiple people cannot map to the same identity.`,
        });
        return;
      }
      seenIdentities.add(lower);
    }

    // Save to people.json
    const peopleJsonPath = path.resolve(process.cwd(), 'people.json');
    let currentData: any = {};
    if (fs.existsSync(peopleJsonPath)) {
      try {
        currentData = JSON.parse(fs.readFileSync(peopleJsonPath, 'utf-8'));
      } catch {
        currentData = {};
      }
    }

    currentData.people = people;
    fs.writeFileSync(peopleJsonPath, JSON.stringify(currentData, null, 2), 'utf-8');
    this.config = loadConfig();

    this.sendJson(res, 200, {
      success: true,
      data: { message: 'People configuration updated successfully.', people },
    });
  }

  private async handleSaveSettings(body: any, res: ServerResponse): Promise<void> {
    if (!body || typeof body !== 'object') {
      this.sendJson(res, 400, { success: false, error: 'Expected JSON settings payload.' });
      return;
    }

    const peopleJsonPath = path.resolve(process.cwd(), 'people.json');
    let currentData: any = {};
    if (fs.existsSync(peopleJsonPath)) {
      try {
        currentData = JSON.parse(fs.readFileSync(peopleJsonPath, 'utf-8'));
      } catch {
        currentData = {};
      }
    }

    if (body.timezone) currentData.timezone = body.timezone;
    if (body.thursdayMode) currentData.thursdayMode = body.thursdayMode;
    if (body.startTime) currentData.startTime = body.startTime;
    if (body.organization) currentData.organization = body.organization;
    if (body.project) currentData.project = body.project;

    fs.writeFileSync(peopleJsonPath, JSON.stringify(currentData, null, 2), 'utf-8');
    this.config = loadConfig();
    this.initClient();

    this.sendJson(res, 200, {
      success: true,
      data: { message: 'Settings saved successfully.', config: this.config },
    });
  }

  private async handleGetLiveTasks(res: ServerResponse): Promise<void> {
    if (!this.client) {
      this.sendJson(res, 500, {
        success: false,
        error: 'Azure DevOps client not initialized. Please ensure AZURE_DEVOPS_PAT is set.',
      });
      return;
    }

    const orchestrator = new TaskOrchestrator(this.client, this.config, {
      dryRun: true,
      yes: true,
      all: true,
      verbose: false,
    });

    const planData = await orchestrator.buildPlan();
    this.sendJson(res, 200, {
      success: true,
      data: {
        todayIso: planData.todayIso,
        nextThursdayIso: planData.nextThursdayIso,
        personPlans: planData.personPlans,
      },
    });
  }

  private async handlePlanTasks(body: any, res: ServerResponse): Promise<void> {
    if (!this.client) {
      this.sendJson(res, 500, {
        success: false,
        error: 'Azure DevOps client not initialized.',
      });
      return;
    }

    const { personKeys, asOf, thursdayMode } = body || {};
    const configCopy = { ...this.config };
    if (thursdayMode) {
      configCopy.thursdayMode = thursdayMode;
    }

    let personArg: string | undefined;
    if (Array.isArray(personKeys) && personKeys.length > 0) {
      personArg = personKeys.join(',');
    }

    const orchestrator = new TaskOrchestrator(this.client, configCopy, {
      dryRun: true,
      yes: true,
      all: !personArg,
      person: personArg,
      asOf,
      todayOverride: asOf,
      thursdayMode: configCopy.thursdayMode,
      verbose: false,
    });

    const planData = await orchestrator.buildPlan();
    this.sendJson(res, 200, {
      success: true,
      data: {
        todayIso: planData.todayIso,
        nextThursdayIso: planData.nextThursdayIso,
        personPlans: planData.personPlans,
      },
    });
  }

  private async handleExecuteTasks(body: any, res: ServerResponse): Promise<void> {
    if (!this.client) {
      this.sendJson(res, 500, {
        success: false,
        error: 'Azure DevOps client not initialized.',
      });
      return;
    }

    const { personKeys, asOf, thursdayMode, dryRun } = body || {};
    const configCopy = { ...this.config };
    if (thursdayMode) {
      configCopy.thursdayMode = thursdayMode;
    }

    let personArg: string | undefined;
    if (Array.isArray(personKeys) && personKeys.length > 0) {
      personArg = personKeys.join(',');
    }

    const orchestrator = new TaskOrchestrator(this.client, configCopy, {
      dryRun: !!dryRun,
      yes: true,
      all: !personArg,
      person: personArg,
      asOf,
      todayOverride: asOf,
      thursdayMode: configCopy.thursdayMode,
      verbose: false,
    });

    const result = await orchestrator.run();
    this.sendJson(res, 200, {
      success: true,
      data: result,
    });
  }

  private async handleGetExplorer(url: URL, res: ServerResponse): Promise<void> {
    if (!this.client) {
      this.sendJson(res, 500, {
        success: false,
        error: 'Azure DevOps client not initialized. Please ensure AZURE_DEVOPS_PAT is configured.',
      });
      return;
    }

    const preset = url.searchParams.get('preset') || '';
    let startDate = url.searchParams.get('startDate') || '';
    let endDate = url.searchParams.get('endDate') || '';
    const usersParam = url.searchParams.get('users') || '';
    const asOf = url.searchParams.get('asOf') || undefined;

    if (preset) {
      const presetRange = TaskExplorerService.getPresetDateRange(preset, this.config.timezone, asOf);
      startDate = presetRange.startDate;
      endDate = presetRange.endDate;
    } else if (!startDate || !endDate) {
      const defaultRange = TaskExplorerService.getPresetDateRange('today_to_next_thursday', this.config.timezone, asOf);
      startDate = startDate || defaultRange.startDate;
      endDate = endDate || defaultRange.endDate;
    }

    const selectedUsers = usersParam
      ? usersParam.split(',').map((u) => u.trim()).filter(Boolean)
      : undefined;

    const explorerService = new TaskExplorerService(this.client, this.config);
    const result = await explorerService.exploreDateRange({
      startDate,
      endDate,
      selectedUsers,
      asOf,
    });

    this.sendJson(res, 200, {
      success: true,
      data: result,
    });
  }

  private async handleCreateMissingFromExplorer(body: any, res: ServerResponse): Promise<void> {
    if (!this.client) {
      this.sendJson(res, 500, {
        success: false,
        error: 'Azure DevOps client not initialized.',
      });
      return;
    }

    const { personKeys, asOf } = body || {};

    let personArg: string | undefined;
    if (Array.isArray(personKeys) && personKeys.length > 0) {
      personArg = personKeys.join(',');
    }

    const orchestrator = new TaskOrchestrator(this.client, this.config, {
      dryRun: false,
      yes: true,
      all: !personArg,
      person: personArg,
      asOf,
      todayOverride: asOf,
      thursdayMode: this.config.thursdayMode,
      verbose: false,
    });

    const result = await orchestrator.run();

    this.sendJson(res, 200, {
      success: true,
      data: {
        message: 'Missing eligible tasks evaluated and created.',
        createdCount: result.totalCreatedCount,
        skippedCount: result.totalDuplicateCount,
        result,
      },
    });
  }

  private async handleGetJournal(res: ServerResponse): Promise<void> {
    const journal = new TaskJournal();
    const entries = journal.getEntries();
    const incomplete = journal.getUnfinishedRelations();

    this.sendJson(res, 200, {
      success: true,
      data: {
        totalEntries: entries.length,
        incompleteEntriesCount: incomplete.length,
        entries: entries.slice(-100).reverse(), // Last 100 entries, newest first
      },
    });
  }

  private async handleRepairJournal(res: ServerResponse): Promise<void> {
    if (!this.client) {
      this.sendJson(res, 500, { success: false, error: 'Azure DevOps client not initialized.' });
      return;
    }

    const orchestrator = new TaskOrchestrator(this.client, this.config, {
      dryRun: false,
      yes: true,
      all: true,
      verbose: false,
      repair: true,
    });

    await orchestrator.repair();
    this.sendJson(res, 200, {
      success: true,
      data: { message: 'Relationship repair process executed.' },
    });
  }

  private async handleSavePat(body: any, res: ServerResponse): Promise<void> {
    const pat = body?.pat?.trim();
    if (!pat) {
      this.sendJson(res, 400, { success: false, error: 'PAT cannot be empty.' });
      return;
    }

    process.env.AZURE_DEVOPS_PAT = pat;
    logger.registerSecret(pat);

    const envPath = path.resolve(process.cwd(), '.env');
    let envContent = '';
    if (fs.existsSync(envPath)) {
      envContent = fs.readFileSync(envPath, 'utf-8');
    }

    const lines = envContent.split('\n');
    let found = false;
    const newLines = lines.map((l) => {
      if (l.trim().startsWith('AZURE_DEVOPS_PAT=')) {
        found = true;
        return `AZURE_DEVOPS_PAT="${pat}"`;
      }
      return l;
    });

    if (!found) {
      newLines.push(`AZURE_DEVOPS_PAT="${pat}"`);
    }

    fs.writeFileSync(envPath, newLines.join('\n').trim() + '\n', 'utf-8');
    this.initClient();

    this.sendJson(res, 200, {
      success: true,
      data: { message: 'PAT saved and Azure DevOps client re-initialized.' },
    });
  }

  private async handleGetScheduler(res: ServerResponse): Promise<void> {
    this.sendJson(res, 200, { success: true, data: this.scheduler.getStatus() });
  }

  private async handleToggleScheduler(body: any, res: ServerResponse): Promise<void> {
    const shouldEnable = body?.enabled !== undefined ? Boolean(body.enabled) : Boolean(body?.enable);
    if (shouldEnable) {
      this.scheduler.start();
    } else {
      this.scheduler.stop();
    }
    this.sendJson(res, 200, { success: true, data: this.scheduler.getStatus() });
  }

  private async handleExportJournal(url: URL, res: ServerResponse): Promise<void> {
    const format = url.searchParams.get('format') || 'csv';
    const journal = new TaskJournal();
    const entries = journal.getEntries();

    if (format === 'json') {
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Content-Disposition': 'attachment; filename="task-journal.json"',
      });
      res.end(JSON.stringify(entries, null, 2));
      return;
    }

    const headers = [
      'Timestamp',
      'RunId',
      'PersonName',
      'AssignedTo',
      'TargetIsoDate',
      'Title',
      'SourceTaskId',
      'CreatedWorkItemId',
      'FieldStatus',
      'RelationStatus',
      'Verified',
      'Error',
    ];

    const escapeCsv = (val: any) => {
      if (val === undefined || val === null) return '""';
      const str = String(val).replace(/"/g, '""');
      return `"${str}"`;
    };

    const rows = entries.map((e) =>
      [
        escapeCsv(e.timestamp),
        escapeCsv(e.runId),
        escapeCsv(e.personName),
        escapeCsv(e.assignedTo),
        escapeCsv(e.targetIsoDate),
        escapeCsv(e.title),
        escapeCsv(e.sourceTaskId),
        escapeCsv(e.createdWorkItemId),
        escapeCsv(e.fieldCopyStatus),
        escapeCsv(e.relationCopyStatus),
        escapeCsv(e.verified),
        escapeCsv(e.error),
      ].join(',')
    );

    const csvContent = [headers.join(','), ...rows].join('\n');
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="task-journal.csv"',
    });
    res.end(csvContent);
  }

  private async handleGetLogs(url: URL, res: ServerResponse): Promise<void> {
    const limit = parseInt(url.searchParams.get('limit') || '100', 10);
    const logs = logger.getRecentLogs(limit);
    this.sendJson(res, 200, { success: true, data: { logs } });
  }

  private async handleStreamLogs(req: IncomingMessage, res: ServerResponse): Promise<void> {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });

    // Send initial recent logs
    const initialLogs = logger.getRecentLogs(40);
    res.write(`data: ${JSON.stringify({ type: 'init', logs: initialLogs })}\n\n`);

    const unsubscribe = logger.addListener((entry) => {
      try {
        res.write(`data: ${JSON.stringify({ type: 'log', entry })}\n\n`);
      } catch {
        // Stream closed
      }
    });

    req.on('close', () => {
      unsubscribe();
    });
  }

  private readJsonBody(req: IncomingMessage): Promise<any> {
    return new Promise((resolve, reject) => {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
        if (body.length > 1e6) {
          req.destroy();
          reject(new Error('Request payload too large'));
        }
      });
      req.on('end', () => {
        if (!body.trim()) {
          resolve({});
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch (e) {
          reject(new Error('Invalid JSON format'));
        }
      });
      req.on('error', reject);
    });
  }

  private sendJson(res: ServerResponse, statusCode: number, data: ApiResponse): void {
    res.writeHead(statusCode, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    res.end(JSON.stringify(data));
  }
}
