import http from 'node:http';
import { AddressInfo } from 'node:net';
import { MockWorkItem, SEED_WORK_ITEMS } from './fixtures/azure-workitems.js';

export interface AzureRequestLogEntry {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body?: any;
  timestamp: number;
}

export interface FaultConfig {
  type: '429' | '500' | '503' | 'timeout';
  count: number;
  retryAfterSec?: number;
}

export class MockAzureDevOpsServer {
  private server: http.Server | null = null;
  private port: number = 0;
  private workItems: Map<number, MockWorkItem> = new Map();
  private nextId = 2000;
  private requestLog: AzureRequestLogEntry[] = [];
  private activeFault: FaultConfig | null = null;

  constructor() {
    this.reset();
  }

  public reset(): void {
    this.workItems.clear();
    for (const item of SEED_WORK_ITEMS) {
      this.workItems.set(item.id, JSON.parse(JSON.stringify(item)));
    }
    this.nextId = 2000;
    this.requestLog = [];
    this.activeFault = null;
  }

  public seedWorkItems(items: Array<Partial<MockWorkItem>>): void {
    for (const it of items) {
      const id = it.id ?? this.nextId++;
      const existing = this.workItems.get(id) || {
        id,
        rev: 1,
        fields: { 'System.Id': id },
        relations: [],
      };
      const merged: MockWorkItem = {
        ...existing,
        ...it,
        id,
        fields: { ...existing.fields, ...(it.fields || {}) },
        relations: it.relations || existing.relations || [],
      };
      this.workItems.set(id, merged);
    }
  }

  public getWorkItem(id: number): MockWorkItem | undefined {
    return this.workItems.get(id);
  }

  public getAllWorkItems(): MockWorkItem[] {
    return Array.from(this.workItems.values());
  }

  public getRequestLog(): AzureRequestLogEntry[] {
    return [...this.requestLog];
  }

  public setFault(type: '429' | '500' | '503' | 'timeout', count = 1, retryAfterSec = 2): void {
    this.activeFault = { type, count, retryAfterSec };
  }

  public clearFault(): void {
    this.activeFault = null;
  }

  public async start(): Promise<string> {
    if (this.server) {
      return `http://127.0.0.1:${this.port}`;
    }

    return new Promise((resolve, reject) => {
      this.server = http.createServer(async (req, res) => {
        try {
          await this.handleRequest(req, res);
        } catch (err: any) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ message: err?.message || 'Mock server error' }));
        }
      });

      this.server.listen(0, '127.0.0.1', () => {
        const addr = this.server!.address() as AddressInfo;
        this.port = addr.port;
        resolve(`http://127.0.0.1:${this.port}`);
      });

      this.server.on('error', reject);
    });
  }

  public async stop(): Promise<void> {
    if (!this.server) return;
    return new Promise((resolve, reject) => {
      this.server!.close((err) => {
        this.server = null;
        if (err) reject(err);
        else resolve();
      });
    });
  }

  public getBaseUrl(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  private async parseBody(req: http.IncomingMessage): Promise<any> {
    return new Promise((resolve) => {
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(Buffer.from(c)));
      req.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        if (!text.trim()) return resolve(undefined);
        try {
          resolve(JSON.parse(text));
        } catch {
          resolve(text);
        }
      });
    });
  }

  private async handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const rawUrl = req.url || '/';
    const method = req.method?.toUpperCase() || 'GET';
    const body = await this.parseBody(req);

    this.requestLog.push({
      method,
      url: rawUrl,
      headers: req.headers,
      body,
      timestamp: Date.now(),
    });

    // Check fault injection
    if (this.activeFault && this.activeFault.count > 0) {
      this.activeFault.count--;
      const { type, retryAfterSec } = this.activeFault;
      if (type === '429') {
        res.writeHead(429, {
          'Content-Type': 'application/json',
          'Retry-After': String(retryAfterSec || 2),
        });
        res.end(JSON.stringify({ message: 'Rate limit exceeded' }));
        return;
      }
      if (type === '500') {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'Internal Server Error' }));
        return;
      }
      if (type === '503') {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'Service Unavailable' }));
        return;
      }
      if (type === 'timeout') {
        // Delay response
        await new Promise((r) => setTimeout(r, 2000));
        res.writeHead(504, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: 'Gateway Timeout' }));
        return;
      }
    }

    const urlObj = new URL(rawUrl, `http://127.0.0.1:${this.port}`);
    const pathname = urlObj.pathname;

    // Route: Project existence check
    // Pattern: /:org/_apis/projects/:project
    if (pathname.includes('/_apis/projects/')) {
      const parts = pathname.split('/_apis/projects/');
      const project = parts[1] || 'DefaultProject';
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ id: 'proj-uuid-1', name: project, state: 'wellFormed' }));
      return;
    }

    // Route: Work item type check
    // Pattern: /.../_apis/wit/workitemtypes/:type
    if (pathname.includes('/_apis/wit/workitemtypes/')) {
      const parts = pathname.split('/_apis/wit/workitemtypes/');
      const type = decodeURIComponent(parts[1] || 'Task');
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ name: type, referenceName: `Microsoft.VSTS.WorkItemTypes.${type}` }));
      return;
    }

    // Route: WIQL query
    // Pattern: /.../_apis/wit/wiql
    if (pathname.endsWith('/_apis/wit/wiql')) {
      const queryStr = (body?.query || '').toLowerCase();
      const matchedIds: Array<{ id: number; url: string }> = [];

      for (const [id, item] of this.workItems.entries()) {
        let match = true;
        // Simple WIQL string filtering
        if (queryStr.includes('[system.workitemtype] = \'task\'') || queryStr.includes('[system.workitemtype]=\'task\'')) {
          if (item.fields['System.WorkItemType'] !== 'Task') match = false;
        }
        if (queryStr.includes('[system.workitemtype] in (\'user story\', \'product backlog item\')')) {
          const type = item.fields['System.WorkItemType'];
          if (type !== 'User Story' && type !== 'Product Backlog Item') match = false;
        }
        if (match) {
          matchedIds.push({
            id,
            url: `${this.getBaseUrl()}/_apis/wit/workItems/${id}`,
          });
        }
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ workItems: matchedIds }));
      return;
    }

    // Route: Batch fetch work items
    // Pattern: /.../_apis/wit/workitems?ids=...
    if (pathname.endsWith('/_apis/wit/workitems') && method === 'GET') {
      const idsParam = urlObj.searchParams.get('ids') || '';
      const ids = idsParam.split(',').map((s) => Number(s.trim())).filter(Boolean);
      const value: MockWorkItem[] = [];

      for (const id of ids) {
        const item = this.workItems.get(id);
        if (item) {
          value.push(JSON.parse(JSON.stringify(item)));
        }
      }

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ count: value.length, value }));
      return;
    }

    // Route: Single work item fetch
    // Pattern: /.../_apis/wit/workitems/:id
    const singleMatch = pathname.match(/_apis\/wit\/workitems\/(\d+)$/i);
    if (singleMatch && method === 'GET') {
      const id = Number(singleMatch[1]);
      const item = this.workItems.get(id);
      if (!item) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: `Work item ${id} not found.` }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(item));
      return;
    }

    // Route: Create work item (JSON Patch)
    // Pattern: /.../_apis/wit/workitems/$:type
    const createMatch = pathname.match(/_apis\/wit\/workitems\/\$([^?]+)/i);
    if (createMatch && method === 'POST') {
      const type = decodeURIComponent(createMatch[1]);
      const newId = this.nextId++;
      const fields: Record<string, any> = {
        'System.Id': newId,
        'System.WorkItemType': type,
        'System.State': 'New',
      };
      const relations: any[] = [];

      if (Array.isArray(body)) {
        for (const op of body) {
          if (op.op === 'add' && op.path?.startsWith('/fields/')) {
            const fieldName = op.path.replace('/fields/', '');
            fields[fieldName] = op.value;
          } else if (op.op === 'add' && op.path === '/relations/-') {
            relations.push(op.value);
          }
        }
      }

      const created: MockWorkItem = {
        id: newId,
        rev: 1,
        fields,
        relations,
        url: `${this.getBaseUrl()}/_apis/wit/workItems/${newId}`,
      };
      this.workItems.set(newId, created);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(created));
      return;
    }

    // Route: Update work item (JSON Patch)
    // Pattern: /.../_apis/wit/workitems/:id
    if (singleMatch && method === 'PATCH') {
      const id = Number(singleMatch[1]);
      const item = this.workItems.get(id);
      if (!item) {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ message: `Work item ${id} not found.` }));
        return;
      }

      if (Array.isArray(body)) {
        for (const op of body) {
          if ((op.op === 'add' || op.op === 'replace') && op.path?.startsWith('/fields/')) {
            const fieldName = op.path.replace('/fields/', '');
            item.fields[fieldName] = op.value;
          } else if (op.op === 'add' && op.path === '/relations/-') {
            item.relations = item.relations || [];
            item.relations.push(op.value);
          }
        }
      }
      item.rev = (item.rev || 1) + 1;
      this.workItems.set(id, item);

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(item));
      return;
    }

    // Default fallback
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ message: 'Mock Azure DevOps Server OK', path: pathname }));
  }
}
